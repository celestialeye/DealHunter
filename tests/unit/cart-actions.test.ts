import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  cartActionApprovalPath,
  claimNextCartAction,
  cartProductKey,
  isEligibleCartConfirmation,
  markCartActionIndeterminate,
  nextCartEpisode,
  revokeListingCartActions,
  revokeProductCartActions,
  updateCartEligibility,
} from "../../src/lib/cart-actions";
import type {
  ListingObservation,
  ListingRecord,
} from "../../src/lib/types";

function listing(overrides: Partial<ListingRecord> = {}): ListingRecord {
  return {
    id: "listing-target",
    project_id: "project-1",
    product_id: "product-1",
    product_name: "Target product",
    retailer_id: "retailer-target",
    retailer: "Target",
    title: "Target product",
    url: "https://www.target.com/p/example-product/-/A-95113212",
    current_price_cents: 3000,
    current_availability: "OUT_OF_STOCK",
    current_availability_text: "Out of stock",
    selection_mode: "EXACT",
    selection_mode_confirmed_at: new Date(0).toISOString(),
    interval_seconds: 60,
    schedule_mode: "SYSTEM",
    interval_min_seconds: 60,
    interval_max_seconds: 120,
    last_interval_seconds: null,
    schedule_reason: null,
    project_default_schedule_mode: "SYSTEM",
    project_default_interval_seconds: 60,
    project_default_interval_min_seconds: 60,
    project_default_interval_max_seconds: 120,
    retailer_minimum_interval_seconds: 60,
    last_observed_at: null,
    next_run_at: new Date(0).toISOString(),
    observation_count: 0,
    product_auto_add_to_cart: 1,
    product_auto_add_terms_version: "2026-09-01",
    product_auto_add_enabled_at: new Date(0).toISOString(),
    ...overrides,
  };
}

function observation(
  overrides: Partial<ListingObservation> = {},
): ListingObservation {
  return {
    availability: "IN_STOCK",
    displayAvailabilityText: "Add to cart",
    priceCents: 3000,
    confidence: 0.99,
    resultStatus: "SUCCESS",
    source: "BROWSER",
    evidenceType: "PRIMARY_CONTROL",
    ...overrides,
  };
}

describe("nextCartEpisode", () => {
  it("queues once for each noneligible-to-eligible transition", () => {
    const first = nextCartEpisode(null, true, true);
    expect(first).toEqual({
      state: { eligibleMatch: true, episodeSequence: 1 },
      shouldQueue: true,
    });

    const repeated = nextCartEpisode(first.state, true, true);
    expect(repeated.shouldQueue).toBe(false);

    const reset = nextCartEpisode(repeated.state, true, false);
    expect(reset.state.eligibleMatch).toBe(false);

    const second = nextCartEpisode(reset.state, true, true);
    expect(second).toEqual({
      state: { eligibleMatch: true, episodeSequence: 2 },
      shouldQueue: true,
    });
  });

  it("does not rearm after an unknown or failed observation", () => {
    const previous = { eligibleMatch: true, episodeSequence: 4 };
    expect(nextCartEpisode(previous, false, false)).toEqual({
      state: previous,
      shouldQueue: false,
    });
  });
});

describe("cartProductKey", () => {
  it("extracts stable keys for every built-in retailer", () => {
    expect(
      cartProductKey(
        "retailer-target",
        "https://www.target.com/p/example/-/A-95113212",
      ),
    ).toBe("A-95113212");
    expect(
      cartProductKey(
        "retailer-best-buy",
        "https://www.bestbuy.com/site/example/6576418.p",
      ),
    ).toBe("6576418");
    expect(
      cartProductKey(
        "retailer-best-buy",
        "https://www.bestbuy.com/product/example/JJG2TL8X74/sku/6685574",
      ),
    ).toBe("6685574");
    expect(
      cartProductKey(
        "retailer-best-buy",
        "https://www.bestbuy.com/product/example/JJG2TL8XCJ",
      ),
    ).toBe("JJG2TL8XCJ");
    expect(
      cartProductKey(
        "retailer-pokemon-center",
        "https://www.pokemoncenter.com/product/10-10447-111/example",
      ),
    ).toBe("10-10447-111");
    expect(
      cartProductKey(
        "retailer-walmart",
        "https://www.walmart.com/ip/example/123456789",
      ),
    ).toBe("123456789");
    expect(
      cartProductKey(
        "retailer-gamestop",
        "https://www.gamestop.com/example/412345.html",
      ),
    ).toBe("412345");
    expect(
      cartProductKey(
        "retailer-costco",
        "https://www.costco.com/example.product.1234567.html",
      ),
    ).toBe("1234567");
    expect(
      cartProductKey(
        "retailer-costco",
        "https://www.costco.com/p/-/example/100115268",
      ),
    ).toBe("100115268");
    expect(
      cartProductKey(
        "retailer-sams-club",
        "https://www.samsclub.com/ip/example/prod12345678",
      ),
    ).toBe("prod12345678");
    expect(
      cartProductKey(
        "retailer-sams-club",
        "https://www.samsclub.com/ip/example/13612812905",
      ),
    ).toBe("13612812905");
    expect(
      cartProductKey(
        "retailer-barnes-noble",
        "https://www.barnesandnoble.com/w/example/1141234567",
      ),
    ).toBe("1141234567");
    expect(
      cartProductKey(
        "retailer-tcgplayer",
        "https://www.tcgplayer.com/product/123456/example",
      ),
    ).toBe("123456");
  });

  it("extracts stable keys when retailer URLs include query parameters", () => {
    expect(
      cartProductKey(
        "retailer-target",
        "https://www.target.com/p/example/-/A-95113212?preselect=95113212",
      ),
    ).toBe("A-95113212");
    expect(
      cartProductKey(
        "retailer-best-buy",
        "https://www.bestbuy.com/product/example/JJG2TL8X74/sku/6685574?intl=nosplash",
      ),
    ).toBe("6685574");
    expect(
      cartProductKey(
        "retailer-costco",
        "https://www.costco.com/p/-/example/100115268?langId=-1",
      ),
    ).toBe("100115268");
  });

  it("rejects cross-retailer and non-product URLs", () => {
    expect(() =>
      cartProductKey(
        "retailer-target",
        "https://www.walmart.com/ip/example/123456789",
      ),
    ).toThrow("selected retailer");
    expect(() =>
      cartProductKey("retailer-target", "https://www.target.com/c/deals"),
    ).toThrow("supported product ID");
    expect(() =>
      cartProductKey(
        "retailer-unknown",
        "https://example.com/product/123",
      ),
    ).toThrow("does not support");
  });

});

describe("cart action approval", () => {
  const previousDataDirectory = process.env.DEALHUNTER_DATA_DIR;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    if (previousDataDirectory === undefined) {
      delete process.env.DEALHUNTER_DATA_DIR;
    } else {
      process.env.DEALHUNTER_DATA_DIR = previousDataDirectory;
    }
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function cartActionDatabase() {
    const database = new DatabaseSync(":memory:");
    database.exec(`
        CREATE TABLE products (
          id TEXT PRIMARY KEY,
          auto_add_to_cart INTEGER NOT NULL,
          auto_add_terms_version TEXT,
          auto_add_enabled_at TEXT
        );
        CREATE TABLE listings (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL
        );
        CREATE TABLE cart_automation_settings (
          id TEXT PRIMARY KEY,
          chrome_profile_name TEXT
        );
        CREATE TABLE cart_listing_states (
          listing_id TEXT PRIMARY KEY,
          eligible_match INTEGER NOT NULL,
          episode_sequence INTEGER NOT NULL,
          last_action_episode_sequence INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE cart_actions (
          id TEXT PRIMARY KEY,
          listing_id TEXT NOT NULL,
          monitoring_run_id TEXT NOT NULL,
          confirmation_group_id TEXT NOT NULL,
          retailer_id TEXT NOT NULL,
          retailer TEXT NOT NULL,
          product_key TEXT NOT NULL,
          product_url TEXT NOT NULL,
          availability TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          episode_sequence INTEGER NOT NULL,
          status TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          baseline_product_quantity INTEGER,
          final_product_quantity INTEGER,
          baseline_cart_units INTEGER,
          final_cart_units INTEGER,
          error_message TEXT,
          confirmed_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT
        );
        INSERT INTO products VALUES (
          'product-1', 1, '2026-09-01', '2026-09-01T00:00:00.000Z'
        );
        INSERT INTO listings VALUES ('listing-1', 'product-1');
        INSERT INTO cart_automation_settings VALUES ('default', 'Peter');
        INSERT INTO cart_listing_states VALUES (
          'listing-1', 1, 1, 1, '2026-09-01T00:00:00.000Z'
        );
      `);
    return database;
  }

  function useTemporaryDataDirectory() {
    const directory = mkdtempSync(path.join(tmpdir(), "dealhunter-cart-"));
    temporaryDirectories.push(directory);
    process.env.DEALHUNTER_DATA_DIR = directory;
    return directory;
  }

  function insertAction(
    database: DatabaseSync,
    actionId: string,
    status: "PENDING" | "RUNNING",
    expiresAt: string,
    episodeSequence = 1,
  ) {
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO cart_actions
           (id, listing_id, monitoring_run_id, confirmation_group_id,
            retailer_id, retailer, product_key, product_url, availability,
            quantity, episode_sequence, status, confirmed_at, expires_at,
            created_at, updated_at)
           VALUES (?, 'listing-1', 'run-1', 'confirmation-1',
            'retailer-target', 'Target', 'A-1', 'https://target.com/p/x/-/A-1',
            'IN_STOCK', 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(actionId, episodeSequence, status, now, expiresAt, now, now);
  }

  it("creates an execution approval when claiming an action", () => {
    useTemporaryDataDirectory();
    const database = cartActionDatabase();
    insertAction(
      database,
      "pending-action",
      "PENDING",
      new Date(Date.now() + 60_000).toISOString(),
    );

    expect(claimNextCartAction(database)?.status).toBe("RUNNING");
    const approvalPath = cartActionApprovalPath("pending-action");
    expect(existsSync(approvalPath)).toBe(true);
    const approval = JSON.parse(readFileSync(approvalPath, "utf8")) as {
      token: string;
      expiresAt: string;
    };
    expect(approval.token).toBe("pending-action");
    expect(new Date(approval.expiresAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 60_000,
    );
    database.close();
  });

  it("revokes pending and running actions and removes execution approvals", () => {
    useTemporaryDataDirectory();
    const database = cartActionDatabase();
    const now = new Date().toISOString();
    insertAction(
      database,
      "pending-action",
      "PENDING",
      new Date(Date.now() + 60_000).toISOString(),
    );
    insertAction(
      database,
      "running-action",
      "RUNNING",
      new Date(Date.now() + 60_000).toISOString(),
      2,
    );
    for (const actionId of ["pending-action", "running-action"]) {
      const approvalPath = cartActionApprovalPath(actionId);
      mkdirSync(path.dirname(approvalPath), { recursive: true });
      writeFileSync(approvalPath, actionId);
    }

    revokeProductCartActions(database, "product-1", now);

    expect(
      database
        .prepare("SELECT id, status FROM cart_actions ORDER BY id")
        .all(),
    ).toEqual([
      { id: "pending-action", status: "SKIPPED" },
      { id: "running-action", status: "SKIPPED" },
    ]);
    expect(existsSync(cartActionApprovalPath("pending-action"))).toBe(false);
    expect(existsSync(cartActionApprovalPath("running-action"))).toBe(false);
    database.close();
  });

  it("revokes a running action when its monitored listing is removed", () => {
    useTemporaryDataDirectory();
    const database = cartActionDatabase();
    const now = new Date().toISOString();
    insertAction(
      database,
      "running-action",
      "RUNNING",
      new Date(Date.now() + 60_000).toISOString(),
    );
    const approvalPath = cartActionApprovalPath("running-action");
    mkdirSync(path.dirname(approvalPath), { recursive: true });
    writeFileSync(approvalPath, "running-action");

    revokeListingCartActions(database, "listing-1", now);

    expect(
      database
        .prepare(
          `SELECT status FROM cart_actions WHERE id = 'running-action'`,
        )
        .get(),
    ).toEqual({ status: "SKIPPED" });
    expect(existsSync(approvalPath)).toBe(false);
    database.close();
  });

  it("resets expired eligibility so a fresh observation can queue again", () => {
    useTemporaryDataDirectory();
    const database = cartActionDatabase();
    insertAction(
      database,
      "expired-action",
      "PENDING",
      new Date(Date.now() - 60_000).toISOString(),
    );

    expect(claimNextCartAction(database)).toBeNull();
    expect(
      database
        .prepare(
          `SELECT eligible_match
             FROM cart_listing_states WHERE listing_id = 'listing-1'`,
        )
        .get(),
    ).toEqual({ eligible_match: 0 });
    expect(
      database
        .prepare(
          `SELECT status FROM cart_actions WHERE id = 'expired-action'`,
        )
        .get(),
    ).toEqual({ status: "SKIPPED" });
    database.close();
  });

  it("revokes stale running actions and rearms their listing", () => {
    useTemporaryDataDirectory();
    const database = cartActionDatabase();
    insertAction(
      database,
      "stale-action",
      "RUNNING",
      new Date(Date.now() + 60_000).toISOString(),
    );
    database
      .prepare(
        `UPDATE cart_actions
         SET started_at = ?, updated_at = ?
         WHERE id = 'stale-action'`,
      )
      .run(
        new Date(Date.now() - 4 * 60_000).toISOString(),
        new Date(Date.now() - 4 * 60_000).toISOString(),
      );
    const approvalPath = cartActionApprovalPath("stale-action");
    mkdirSync(path.dirname(approvalPath), { recursive: true });
    writeFileSync(approvalPath, "stale-action");

    expect(claimNextCartAction(database)).toBeNull();
    expect(
      database
        .prepare(
          `SELECT eligible_match
           FROM cart_listing_states WHERE listing_id = 'listing-1'`,
        )
        .get(),
    ).toEqual({ eligible_match: 0 });
    expect(
      database
        .prepare(
          `SELECT status FROM cart_actions WHERE id = 'stale-action'`,
        )
        .get(),
    ).toEqual({ status: "SKIPPED" });
    expect(existsSync(approvalPath)).toBe(false);
    database.close();
  });

  it("records post-click verification failures as indeterminate", () => {
    useTemporaryDataDirectory();
    const database = cartActionDatabase();
    insertAction(
      database,
      "running-action",
      "RUNNING",
      new Date(Date.now() + 60_000).toISOString(),
    );
    const approvalPath = cartActionApprovalPath("running-action");
    mkdirSync(path.dirname(approvalPath), { recursive: true });
    writeFileSync(approvalPath, "running-action");

    expect(
      markCartActionIndeterminate(
        database,
        "running-action",
        "INDETERMINATE: reconciliation timed out",
      ),
    ).toBe(true);
    expect(
      database
        .prepare(
          `SELECT status FROM cart_actions WHERE id = 'running-action'`,
        )
        .get(),
    ).toEqual({ status: "INDETERMINATE" });
    expect(existsSync(approvalPath)).toBe(false);
    database.close();
  });
});

describe("isEligibleCartConfirmation", () => {
  it("accepts freshly confirmed in-stock and preorder controls", () => {
    for (const availability of ["IN_STOCK", "PREORDER"] as const) {
      expect(
        isEligibleCartConfirmation(listing(), {
          initialObservation: observation({ availability }),
          finalObservation: observation({ availability }),
          freshlyConfirmedActionable: true,
        }),
      ).toBe(true);
    }
  });

  it("rejects simulated and unconfirmed observations", () => {
    expect(
      isEligibleCartConfirmation(listing(), {
        initialObservation: observation({ source: "SIMULATION" }),
        finalObservation: observation({ source: "SIMULATION" }),
        freshlyConfirmedActionable: true,
      }),
    ).toBe(false);
    expect(
      isEligibleCartConfirmation(listing(), {
        initialObservation: observation(),
        finalObservation: observation(),
        freshlyConfirmedActionable: false,
      }),
    ).toBe(false);
  });

  it("rejects ambiguous listing selection modes", () => {
    for (const selectionMode of [
      "CUSTOMER_CHOICE",
      "RANDOM_VARIANT",
      "ASSORTMENT",
      "UNKNOWN",
    ] as const) {
      expect(
        isEligibleCartConfirmation(
          listing({ selection_mode: selectionMode }),
          {
            initialObservation: observation(),
            finalObservation: observation(),
            freshlyConfirmedActionable: true,
          },
        ),
      ).toBe(false);
    }
  });

  it("rejects legacy exact listings without explicit classification", () => {
    expect(
      isEligibleCartConfirmation(
        listing({ selection_mode_confirmed_at: null }),
        {
          initialObservation: observation(),
          finalObservation: observation(),
          freshlyConfirmedActionable: true,
        },
      ),
    ).toBe(false);
  });
});

describe("updateCartEligibility", () => {
  it("persists one action per confirmed availability episode", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE cart_listing_states (
        listing_id TEXT PRIMARY KEY,
        eligible_match INTEGER NOT NULL,
        episode_sequence INTEGER NOT NULL,
        last_action_episode_sequence INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE cart_actions (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        monitoring_run_id TEXT NOT NULL,
        confirmation_group_id TEXT NOT NULL,
        retailer_id TEXT NOT NULL,
        retailer TEXT NOT NULL,
        product_key TEXT NOT NULL,
        product_url TEXT NOT NULL,
        availability TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        episode_sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        confirmed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(listing_id, episode_sequence)
      );
    `);
    const approvedListing = listing();
    const eligible = {
      initialObservation: observation(),
      finalObservation: observation(),
      freshlyConfirmedActionable: true,
    };

    expect(
      updateCartEligibility(
        database,
        approvedListing,
        "run-1",
        "confirmation-1",
        eligible,
      ),
    ).toBeTruthy();
    expect(
      updateCartEligibility(
        database,
        approvedListing,
        "run-2",
        "confirmation-2",
        eligible,
      ),
    ).toBeNull();
    expect(
      updateCartEligibility(
        database,
        listing({ product_auto_add_to_cart: 0 }),
        "run-disabled",
        "confirmation-disabled",
        eligible,
      ),
    ).toBeNull();
    expect(
      updateCartEligibility(
        database,
        approvedListing,
        "run-reenabled",
        "confirmation-reenabled",
        eligible,
      ),
    ).toBeNull();

    updateCartEligibility(
      database,
      approvedListing,
      "run-3",
      null,
      {
        initialObservation: observation({
          availability: "OUT_OF_STOCK",
        }),
        finalObservation: observation({
          availability: "OUT_OF_STOCK",
        }),
        freshlyConfirmedActionable: false,
      },
    );
    expect(
      updateCartEligibility(
        database,
        approvedListing,
        "run-4",
        "confirmation-4",
        eligible,
      ),
    ).toBeTruthy();

    const actions = database
      .prepare(
        `SELECT episode_sequence, status
         FROM cart_actions ORDER BY episode_sequence`,
      )
      .all();
    expect(actions).toEqual([
      { episode_sequence: 1, status: "PENDING" },
      { episode_sequence: 2, status: "PENDING" },
    ]);
    database.close();
  });
});
