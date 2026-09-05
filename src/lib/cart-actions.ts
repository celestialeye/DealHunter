import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { createId, getDataDirectory, nowIso } from "@/lib/db";
import { hostnameMatches } from "@/lib/retailer-registry";
import type {
  CartActionRecord,
  ListingObservation,
  ListingRecord,
} from "@/lib/types";

export const CART_AUTOMATION_TERMS_VERSION = "2026-09-01";

interface CartEpisodeState {
  eligibleMatch: boolean;
  episodeSequence: number;
}

export interface CartConfirmation {
  initialObservation: ListingObservation;
  finalObservation: ListingObservation;
  freshlyConfirmedActionable: boolean;
}

export function nextCartEpisode(
  previous: CartEpisodeState | null,
  observationKnown: boolean,
  eligible: boolean,
) {
  const current = previous ?? {
    eligibleMatch: false,
    episodeSequence: 0,
  };
  if (!observationKnown) {
    return { state: current, shouldQueue: false };
  }
  if (!eligible) {
    return {
      state: { ...current, eligibleMatch: false },
      shouldQueue: false,
    };
  }
  if (current.eligibleMatch) {
    return { state: current, shouldQueue: false };
  }
  return {
    state: {
      eligibleMatch: true,
      episodeSequence: current.episodeSequence + 1,
    },
    shouldQueue: true,
  };
}

const cartRetailerAdapters: Record<
  string,
  { domains: string[]; patterns: RegExp[] }
> = {
  "retailer-target": {
    domains: ["target.com"],
    patterns: [/\/-\/(A-\d+)\/?$/i],
  },
  "retailer-best-buy": {
    domains: ["bestbuy.com"],
    patterns: [
      /\/sku\/(\d+)\/?$/i,
      /\/product\/[^/]+\/([^/]+)(?:\/|$)/i,
      /\/(\d+)\.p\/?$/i,
      /[?&]skuId=(\d+)/i,
    ],
  },
  "retailer-pokemon-center": {
    domains: ["pokemoncenter.com"],
    patterns: [/\/product\/([^/?#]+)/i],
  },
  "retailer-walmart": {
    domains: ["walmart.com"],
    patterns: [/\/ip\/(?:[^/]+\/)?(\d+)/i],
  },
  "retailer-gamestop": {
    domains: ["gamestop.com"],
    patterns: [/\/(\d+)\.html$/i, /\/product\/[^/]+\/(\d+)/i],
  },
  "retailer-costco": {
    domains: ["costco.com"],
    patterns: [/\/p\/(?:[^/]+\/)*(\d+)\/?$/i, /\.product\.(\d+)\.html$/i],
  },
  "retailer-sams-club": {
    domains: ["samsclub.com"],
    patterns: [/\/ip\/[^/]+\/((?:prod)?\d+)/i],
  },
  "retailer-barnes-noble": {
    domains: ["barnesandnoble.com"],
    patterns: [/\/w\/[^/]+\/(\d+)/i],
  },
  "retailer-tcgplayer": {
    domains: ["tcgplayer.com"],
    patterns: [/\/product\/(\d+)/i],
  },
};

function builtInProductKey(retailerId: string, url: URL) {
  const adapter = cartRetailerAdapters[retailerId];
  if (!adapter) {
    throw new Error(`Retailer ${retailerId} does not support cart automation.`);
  }
  if (
    !adapter.domains.some((domain) => hostnameMatches(url.hostname, domain))
  ) {
    throw new Error("Product URL does not match the selected retailer.");
  }
  for (const pattern of adapter.patterns) {
    const match = url.pathname.match(pattern) ?? url.search.match(pattern);
    if (match) return match[1];
  }
  throw new Error("Product URL does not contain a supported product ID.");
}

export function cartProductKey(retailerId: string, productUrl: string) {
  const url = new URL(productUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Cart automation requires an HTTPS product URL.");
  }
  return builtInProductKey(retailerId, url);
}

export function isEligibleCartConfirmation(
  listing: ListingRecord,
  confirmation: CartConfirmation,
) {
  const { initialObservation, finalObservation } = confirmation;
  if (
    !listing.retailer_id ||
    !listing.retailer_id.startsWith("retailer-") ||
    listing.selection_mode !== "EXACT" ||
    !listing.selection_mode_confirmed_at ||
    !confirmation.freshlyConfirmedActionable ||
    initialObservation.source === "SIMULATION" ||
    finalObservation.source === "SIMULATION" ||
    !["PRIMARY_CONTROL", "RETAILER_FULFILLMENT"].includes(
      initialObservation.evidenceType ?? "NONE",
    ) ||
    !["PRIMARY_CONTROL", "RETAILER_FULFILLMENT"].includes(
      finalObservation.evidenceType ?? "NONE",
    ) ||
    finalObservation.resultStatus !== "SUCCESS" ||
    !["IN_STOCK", "PREORDER"].includes(finalObservation.availability)
  ) {
    return false;
  }

  cartProductKey(listing.retailer_id, listing.url);
  return true;
}

function productHasCurrentApproval(listing: ListingRecord) {
  return Boolean(
    listing.product_auto_add_to_cart &&
      listing.product_auto_add_terms_version ===
        CART_AUTOMATION_TERMS_VERSION &&
      listing.product_auto_add_enabled_at,
  );
}

export function updateCartEligibility(
  database: DatabaseSync,
  listing: ListingRecord,
  monitoringRunId: string,
  confirmationGroupId: string | null,
  confirmation: CartConfirmation,
) {
  if (!listing.retailer_id?.startsWith("retailer-")) return null;

  const previous = database
    .prepare(
      `SELECT eligible_match, episode_sequence, last_action_episode_sequence
       FROM cart_listing_states WHERE listing_id = ?`,
    )
    .get(listing.id) as
    | {
        eligible_match: number;
        episode_sequence: number;
        last_action_episode_sequence: number;
      }
    | undefined;
  const observationKnown =
    confirmation.finalObservation.resultStatus === "SUCCESS" &&
    confirmation.finalObservation.availability !== "UNKNOWN";
  const eligible = isEligibleCartConfirmation(listing, confirmation);
  const transition = nextCartEpisode(
    previous
      ? {
          eligibleMatch: Boolean(previous.eligible_match),
          episodeSequence: previous.episode_sequence,
        }
      : null,
    observationKnown,
    eligible,
  );
  const updatedAt = nowIso();

  database
    .prepare(
      `INSERT INTO cart_listing_states
       (listing_id, eligible_match, episode_sequence,
        last_action_episode_sequence, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(listing_id) DO UPDATE SET
         eligible_match = excluded.eligible_match,
         episode_sequence = excluded.episode_sequence,
         last_action_episode_sequence = excluded.last_action_episode_sequence,
         updated_at = excluded.updated_at`,
    )
    .run(
      listing.id,
      transition.state.eligibleMatch ? 1 : 0,
      transition.state.episodeSequence,
      previous?.last_action_episode_sequence ?? 0,
      updatedAt,
    );

  if (
    !eligible ||
    !confirmationGroupId ||
    !productHasCurrentApproval(listing) ||
    (previous?.last_action_episode_sequence ?? 0) >=
      transition.state.episodeSequence
  ) {
    return null;
  }

  const actionId = createId();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  database
    .prepare(
      `INSERT OR IGNORE INTO cart_actions
       (id, listing_id, monitoring_run_id, confirmation_group_id,
        retailer_id, retailer, product_key, product_url, availability,
        quantity, episode_sequence, status, confirmed_at, expires_at,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'PENDING', ?, ?, ?, ?)`,
    )
    .run(
      actionId,
      listing.id,
      monitoringRunId,
      confirmationGroupId,
      listing.retailer_id,
      listing.retailer,
      cartProductKey(listing.retailer_id, listing.url),
      listing.url,
      confirmation.finalObservation.availability,
      transition.state.episodeSequence,
      updatedAt,
      expiresAt,
      updatedAt,
      updatedAt,
    );
  const inserted = database
    .prepare("SELECT changes() AS count")
    .get() as { count: number };
  if (!inserted.count) return null;
  database
    .prepare(
      `UPDATE cart_listing_states
       SET last_action_episode_sequence = ?, updated_at = ?
       WHERE listing_id = ?`,
    )
    .run(transition.state.episodeSequence, updatedAt, listing.id);
  return actionId;
}

function configuredChromeProfile(database: DatabaseSync) {
  const row = database
    .prepare(
      `SELECT chrome_profile_name
       FROM cart_automation_settings WHERE id = 'default'`,
    )
    .get() as { chrome_profile_name: string | null } | undefined;
  return row?.chrome_profile_name?.trim() || null;
}

export function getConfiguredChromeProfile(database: DatabaseSync) {
  return configuredChromeProfile(database);
}

export function cartActionApprovalPath(actionId: string) {
  return path.join(
    getDataDirectory(),
    "cart-action-approvals",
    `${actionId}.approved`,
  );
}

function removeCartActionApproval(actionId: string) {
  rmSync(cartActionApprovalPath(actionId), { force: true });
}

export function revokeProductCartActions(
  database: DatabaseSync,
  productId: string,
  updatedAt: string,
) {
  const actions = database
    .prepare(
      `SELECT id
       FROM cart_actions
       WHERE listing_id IN (
         SELECT id FROM listings WHERE product_id = ?
       ) AND status IN ('PENDING', 'RUNNING')`,
    )
    .all(productId) as Array<{ id: string }>;
  database
    .prepare(
      `UPDATE cart_actions
       SET status = 'SKIPPED',
           error_message = 'Product auto-add approval was disabled.',
           completed_at = ?, updated_at = ?
       WHERE listing_id IN (
         SELECT id FROM listings WHERE product_id = ?
       ) AND status IN ('PENDING', 'RUNNING')`,
    )
    .run(updatedAt, updatedAt, productId);
  for (const action of actions) {
    removeCartActionApproval(action.id);
  }
}

export function revokeListingCartActions(
  database: DatabaseSync,
  listingId: string,
  updatedAt: string,
) {
  const actions = database
    .prepare(
      `SELECT id
       FROM cart_actions
       WHERE listing_id = ? AND status IN ('PENDING', 'RUNNING')`,
    )
    .all(listingId) as Array<{ id: string }>;
  database
    .prepare(
      `UPDATE cart_actions
       SET status = 'SKIPPED',
           error_message = 'The monitored listing was removed.',
           completed_at = ?, updated_at = ?
       WHERE listing_id = ? AND status IN ('PENDING', 'RUNNING')`,
    )
    .run(updatedAt, updatedAt, listingId);
  for (const action of actions) {
    removeCartActionApproval(action.id);
  }
}

export function claimNextCartAction(
  database: DatabaseSync,
): CartActionRecord | null {
  let approvalPath: string | null = null;
  database.exec("BEGIN IMMEDIATE");
  try {
    if (!configuredChromeProfile(database)) {
      database.exec("COMMIT");
      return null;
    }
    const checkedAt = nowIso();
    const staleBefore = new Date(Date.now() - 3 * 60_000).toISOString();
    const staleRunningActions = database
      .prepare(
        `SELECT id
         FROM cart_actions
         WHERE status = 'RUNNING'
           AND COALESCE(started_at, updated_at) <= ?`,
      )
      .all(staleBefore) as Array<{ id: string }>;
    for (const action of staleRunningActions) {
      removeCartActionApproval(action.id);
    }
    database
      .prepare(
        `UPDATE cart_listing_states
         SET eligible_match = 0, updated_at = ?
         WHERE listing_id IN (
           SELECT listing_id
           FROM cart_actions
           WHERE (status = 'PENDING' AND expires_at <= ?)
              OR (
                status = 'RUNNING'
                AND COALESCE(started_at, updated_at) <= ?
              )
         )`,
      )
      .run(checkedAt, checkedAt, staleBefore);
    database
      .prepare(
        `UPDATE cart_actions
         SET status = 'SKIPPED',
             error_message = 'Confirmed availability expired before execution.',
             completed_at = ?, updated_at = ?
         WHERE status = 'PENDING' AND expires_at <= ?`,
      )
      .run(checkedAt, checkedAt, checkedAt);
    database
      .prepare(
        `UPDATE cart_actions
         SET status = 'SKIPPED',
             error_message = 'Cart execution lease expired before completion.',
             completed_at = ?, updated_at = ?
         WHERE status = 'RUNNING'
           AND COALESCE(started_at, updated_at) <= ?`,
      )
      .run(checkedAt, checkedAt, staleBefore);
    const action = database
      .prepare(
        `SELECT * FROM cart_actions
         WHERE status = 'PENDING' AND expires_at > ?
         ORDER BY created_at
         LIMIT 1`,
      )
      .get(checkedAt) as CartActionRecord | undefined;
    if (!action) {
      database.exec("COMMIT");
      return null;
    }
    const listing = database
      .prepare(
        `SELECT pr.auto_add_to_cart, pr.auto_add_terms_version,
          pr.auto_add_enabled_at
         FROM listings l
         JOIN products pr ON pr.id = l.product_id
         WHERE l.id = ?`,
      )
      .get(action.listing_id) as
      | {
          auto_add_to_cart: number;
          auto_add_terms_version: string | null;
          auto_add_enabled_at: string | null;
        }
      | undefined;
    if (
      !listing?.auto_add_to_cart ||
      listing.auto_add_terms_version !== CART_AUTOMATION_TERMS_VERSION ||
      !listing.auto_add_enabled_at
    ) {
      const skippedAt = nowIso();
      database
        .prepare(
          `UPDATE cart_actions
           SET status = 'SKIPPED', error_message = ?,
               completed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'PENDING'`,
        )
        .run(
          "Product auto-add approval was disabled or expired.",
          skippedAt,
          skippedAt,
          action.id,
        );
      database.exec("COMMIT");
      return null;
    }
    const startedAt = nowIso();
    database
      .prepare(
        `UPDATE cart_actions
         SET status = 'RUNNING', attempt_count = attempt_count + 1,
             started_at = ?, updated_at = ?, error_message = NULL
         WHERE id = ? AND status = 'PENDING'`,
      )
      .run(startedAt, startedAt, action.id);
    approvalPath = cartActionApprovalPath(action.id);
    mkdirSync(path.dirname(approvalPath), { recursive: true });
    const approvalExpiresAt = new Date(
      Math.min(
        new Date(action.expires_at).getTime(),
        Date.now() + 4 * 60_000,
      ),
    ).toISOString();
    writeFileSync(
      approvalPath,
      JSON.stringify({
        token: action.id,
        expiresAt: approvalExpiresAt,
      }),
      { encoding: "utf8", flag: "wx" },
    );
    database.exec("COMMIT");
    return {
      ...action,
      status: "RUNNING",
      attempt_count: action.attempt_count + 1,
      started_at: startedAt,
      updated_at: startedAt,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    if (approvalPath) {
      rmSync(approvalPath, { force: true });
    }
    throw error;
  }
}

export function completeCartAction(
  database: DatabaseSync,
  actionId: string,
  result: {
    baselineProductQuantity: number;
    finalProductQuantity: number;
    baselineCartUnits: number;
    finalCartUnits: number;
  },
) {
  const completedAt = nowIso();
  const updateResult = database
    .prepare(
      `UPDATE cart_actions
       SET status = 'SUCCEEDED', baseline_product_quantity = ?,
           final_product_quantity = ?, baseline_cart_units = ?,
           final_cart_units = ?, completed_at = ?, updated_at = ?,
           error_message = NULL
       WHERE id = ? AND status = 'RUNNING'`,
    )
    .run(
      result.baselineProductQuantity,
      result.finalProductQuantity,
      result.baselineCartUnits,
      result.finalCartUnits,
      completedAt,
      completedAt,
      actionId,
    );
  removeCartActionApproval(actionId);
  return updateResult.changes > 0;
}

export function markCartActionIndeterminate(
  database: DatabaseSync,
  actionId: string,
  errorMessage: string,
) {
  const completedAt = nowIso();
  const updateResult = database
    .prepare(
      `UPDATE cart_actions
       SET status = 'INDETERMINATE', error_message = ?, completed_at = ?,
           updated_at = ?
       WHERE id = ? AND status = 'RUNNING'`,
    )
    .run(errorMessage.slice(0, 1000), completedAt, completedAt, actionId);
  removeCartActionApproval(actionId);
  return updateResult.changes > 0;
}

export function failCartAction(
  database: DatabaseSync,
  actionId: string,
  errorMessage: string,
) {
  const completedAt = nowIso();
  const result = database
    .prepare(
      `UPDATE cart_actions
       SET status = 'FAILED', error_message = ?, completed_at = ?,
           updated_at = ?
       WHERE id = ? AND status = 'RUNNING'`,
    )
    .run(errorMessage.slice(0, 1000), completedAt, completedAt, actionId);
  removeCartActionApproval(actionId);
  return result.changes > 0;
}
