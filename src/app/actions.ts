"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { audit, createId, getDatabase, nowIso } from "@/lib/db";
import { formatAvailability } from "@/lib/format";
import { calculateNextSchedule, runProjectScan } from "@/lib/monitoring";
import { CART_AUTOMATION_TERMS_VERSION } from "@/lib/cart-actions";
import {
  assertAllowedDiscordWebhook,
  sendDiscordTest,
} from "@/lib/notifications";
import {
  crawlProductUrl,
  findRetailerForUrl,
} from "@/lib/product-crawler";
import { sealSecret } from "@/lib/secrets";
import { learnListingRecipe } from "@/lib/learning/service";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optionalMoney(value: string) {
  if (!value) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Enter a valid non-negative amount.");
  }
  return Math.round(amount * 100);
}

function commaSeparatedDomains(value: string) {
  const domains = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!domains.length) throw new Error("At least one domain is required.");
  return JSON.stringify([...new Set(domains)]);
}

function retailerSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function calculateInitialInheritedSchedule(
  projectId: string,
  retailerId: string | null,
) {
  const defaults = getDatabase()
    .prepare(
      `SELECT p.default_schedule_mode AS project_default_schedule_mode,
              p.default_interval_seconds AS project_default_interval_seconds,
              p.default_interval_min_seconds AS project_default_interval_min_seconds,
              p.default_interval_max_seconds AS project_default_interval_max_seconds,
              COALESCE(r.minimum_interval_seconds, 60) AS retailer_minimum_interval_seconds
       FROM projects p
       LEFT JOIN retailers r ON r.id = ?
       WHERE p.id = ?`,
    )
    .get(retailerId, projectId) as
    | {
        project_default_schedule_mode: "SYSTEM" | "FIXED" | "BOUNDED";
        project_default_interval_seconds: number;
        project_default_interval_min_seconds: number;
        project_default_interval_max_seconds: number;
        retailer_minimum_interval_seconds: number;
      }
    | undefined;
  if (!defaults) {
    throw new Error("Project monitoring schedule was not found.");
  }
  return calculateNextSchedule(
    {
      schedule_mode: "INHERIT",
      interval_seconds: 60,
      interval_min_seconds: 60,
      interval_max_seconds: 120,
      ...defaults,
    },
    [],
    "SUCCESS",
  );
}

export async function createProjectAction(formData: FormData) {
  const input = z
    .object({
      name: z.string().min(2).max(100),
      description: z.string().max(500),
      budget: z.string(),
    })
    .parse({
      name: text(formData, "name"),
      description: text(formData, "description"),
      budget: text(formData, "budget"),
    });
  const id = createId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO projects
       (id, name, description, budget_cents, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.description,
      optionalMoney(input.budget),
      now,
      now,
    );
  audit("project", id, "CREATED", `Created project ${input.name}.`);
  redirect(`/projects/${id}`);
}

export async function updateProjectScheduleAction(formData: FormData) {
  const projectId = text(formData, "projectId");
  const mode = text(formData, "scheduleMode");
  if (!["SYSTEM", "FIXED", "BOUNDED"].includes(mode)) {
    throw new Error("Unsupported project schedule mode.");
  }
  const fixed = Math.max(60, Number(text(formData, "fixedSeconds") || "60"));
  const minimum = Math.max(
    60,
    Number(text(formData, "minimumSeconds") || "60"),
  );
  const maximum = Math.max(
    minimum,
    Number(text(formData, "maximumSeconds") || String(minimum)),
  );
  getDatabase()
    .prepare(
      `UPDATE projects
       SET default_schedule_mode = ?, default_interval_seconds = ?,
           default_interval_min_seconds = ?,
           default_interval_max_seconds = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(mode, fixed, minimum, maximum, nowIso(), projectId);
  audit(
    "project",
    projectId,
    "SCHEDULE_UPDATED",
    `Set project default schedule to ${mode}.`,
  );
  revalidatePath(`/projects/${projectId}`);
}

export async function addProductAction(formData: FormData) {
  const projectId = text(formData, "projectId");
  const name = text(formData, "name");
  if (name.length < 2) throw new Error("Product name is required.");
  const id = createId();
  getDatabase()
    .prepare(
      `INSERT INTO products
       (id, project_id, canonical_name, variant, target_quantity,
        expected_price_cents, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      name,
      text(formData, "variant"),
      Math.max(0, Number(text(formData, "targetQuantity") || "1")),
      optionalMoney(text(formData, "expectedPrice")),
      text(formData, "notes"),
      nowIso(),
    );
  audit("product", id, "CREATED", `Added ${name} to project.`);
  revalidatePath(`/projects/${projectId}`);
}

export async function addProductFromUrlAction(formData: FormData) {
  const projectId = text(formData, "projectId");
  const sourceUrl = new URL(text(formData, "url"));
  const normalizedUrl = sourceUrl.toString().toLowerCase().replace(/\/$/, "");
  const existing = getDatabase()
    .prepare("SELECT product_id FROM listings WHERE normalized_url = ?")
    .get(normalizedUrl) as { product_id: string } | undefined;
  if (existing) redirect(`/products/${existing.product_id}`);

  const productId = createId();
  const listingId = createId();
  const initialRunId = createId();
  const crawled = await crawlProductUrl(productId, sourceUrl.toString());
  const now = nowIso();
  const initialSchedule = calculateInitialInheritedSchedule(
    projectId,
    crawled.retailer.id,
  );
  const nextRun = new Date(
    Date.now() + initialSchedule.intervalSeconds * 1000,
  ).toISOString();
  const targetQuantity = Math.max(
    0,
    Number(text(formData, "targetQuantity") || "1"),
  );
  const database = getDatabase();

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `INSERT INTO products
         (id, project_id, canonical_name, variant, target_quantity,
          expected_price_cents, notes, description, image_url,
          image_local_path, image_source_url, source_url, retailer_sku,
          metadata_status,
          metadata_checked_at, created_at)
         VALUES (?, ?, ?, '', ?, ?, '', ?, ?, ?, ?, ?, ?, 'SUCCESS', ?, ?)`,
      )
      .run(
        productId,
        projectId,
        crawled.title,
        targetQuantity,
        crawled.priceCents,
        crawled.description,
        crawled.imageUrl,
        crawled.cachedImagePath,
        sourceUrl.toString(),
        sourceUrl.toString(),
        crawled.sku,
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO listings
         (id, product_id, retailer_id, retailer, retailer_sku, title, url,
          normalized_url, current_price_cents, current_availability,
          current_availability_text, selection_mode, interval_seconds,
          schedule_mode, schedule_reason, last_observed_at, next_run_at,
          observation_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EXACT', 60, 'INHERIT', ?, ?, ?, 1, ?)`,
      )
      .run(
        listingId,
        productId,
        crawled.retailer.id,
        crawled.retailer.name,
        crawled.sku,
        crawled.title,
        sourceUrl.toString(),
        normalizedUrl,
        crawled.priceCents,
        crawled.availability,
        formatAvailability(crawled.availability),
        initialSchedule.reason,
        now,
        nextRun,
        now,
      );
    database
      .prepare(
        `INSERT INTO snapshots
         (id, listing_id, monitoring_run_id, observed_at, availability,
          availability_text, price_cents, confidence, result_status, source, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0.95, 'SUCCESS', 'HTTP', ?)`,
      )
      .run(
        createId(),
        listingId,
        initialRunId,
        now,
        crawled.availability,
        formatAvailability(crawled.availability),
        crawled.priceCents,
        "Initial product metadata crawl.",
      );
    database
      .prepare(
        `INSERT INTO monitoring_runs
         (id, listing_id, started_at, finished_at, duration_ms, status,
         source, availability, availability_text, price_cents, confidence, detail)
         VALUES (?, ?, ?, ?, 0, 'SUCCESS', 'HTTP', ?, ?, ?, 0.95, ?)`,
      )
      .run(
        initialRunId,
        listingId,
        now,
        now,
        crawled.availability,
        formatAvailability(crawled.availability),
        crawled.priceCents,
        `Product created from URL and queued for monitoring in ${initialSchedule.intervalSeconds} seconds.`,
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  audit(
    "product",
    productId,
    "CRAWLED_FROM_URL",
    `Created from ${sourceUrl.hostname} with cached metadata.`,
  );
  await learnListingRecipe(listingId, "INITIAL");
  redirect(`/products/${productId}`);
}

export async function addListingAction(formData: FormData) {
  const projectId = text(formData, "projectId");
  const productId = text(formData, "productId");
  const url = new URL(text(formData, "url"));
  if (url.protocol !== "https:") {
    throw new Error("Retailer listings must use HTTPS.");
  }
  const registeredRetailer = findRetailerForUrl(url);
  const id = createId();
  const now = nowIso();
  const initialSchedule = calculateInitialInheritedSchedule(
    projectId,
    registeredRetailer?.id ?? null,
  );
  getDatabase()
    .prepare(
      `INSERT INTO listings
       (id, product_id, retailer_id, retailer, title, url, normalized_url,
        current_price_cents, current_availability, selection_mode,
        schedule_mode, interval_seconds, schedule_reason, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNKNOWN', ?, 'INHERIT', ?, ?, ?, ?)`,
    )
    .run(
      id,
      productId,
      registeredRetailer?.id ?? null,
      registeredRetailer?.name ?? text(formData, "retailer"),
      text(formData, "title"),
      url.toString(),
      url.toString().toLowerCase().replace(/\/$/, ""),
      optionalMoney(text(formData, "price")),
      text(formData, "selectionMode") || "EXACT",
      Math.max(60, Number(text(formData, "interval") || "60")),
      initialSchedule.reason,
      new Date(
        Date.now() + initialSchedule.intervalSeconds * 1000,
      ).toISOString(),
      now,
    );
  audit("listing", id, "CREATED", `Added retailer listing ${url.hostname}.`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/products/${productId}`);
}

export async function updateListingScheduleAction(formData: FormData) {
  const listingId = text(formData, "listingId");
  const productId = text(formData, "productId");
  const mode = text(formData, "scheduleMode");
  if (!["INHERIT", "SYSTEM", "FIXED", "BOUNDED"].includes(mode)) {
    throw new Error("Unsupported schedule mode.");
  }

  const fixed = Math.max(60, Number(text(formData, "fixedSeconds") || "60"));
  const minimum = Math.max(
    60,
    Number(text(formData, "minimumSeconds") || "60"),
  );
  const maximum = Math.max(
    minimum,
    Number(text(formData, "maximumSeconds") || String(minimum)),
  );
  const database = getDatabase();
  const inheritedSchedule = database
    .prepare(
      `SELECT p.default_schedule_mode AS project_default_schedule_mode,
              p.default_interval_seconds AS project_default_interval_seconds,
              p.default_interval_min_seconds AS project_default_interval_min_seconds,
              p.default_interval_max_seconds AS project_default_interval_max_seconds,
              COALESCE(r.minimum_interval_seconds, 60) AS retailer_minimum_interval_seconds
       FROM listings l
       JOIN products pr ON pr.id = l.product_id
       JOIN projects p ON p.id = pr.project_id
       LEFT JOIN retailers r ON r.id = l.retailer_id
       WHERE l.id = ? AND l.product_id = ?`,
    )
    .get(listingId, productId) as
    | {
        project_default_schedule_mode: "SYSTEM" | "FIXED" | "BOUNDED";
        project_default_interval_seconds: number;
        project_default_interval_min_seconds: number;
        project_default_interval_max_seconds: number;
        retailer_minimum_interval_seconds: number;
      }
    | undefined;
  if (!inheritedSchedule) {
    throw new Error("Listing schedule target was not found.");
  }
  const schedule = calculateNextSchedule(
    {
      schedule_mode: mode as "INHERIT" | "SYSTEM" | "FIXED" | "BOUNDED",
      interval_seconds: fixed,
      interval_min_seconds: minimum,
      interval_max_seconds: maximum,
      ...inheritedSchedule,
    },
    [],
    "SUCCESS",
  );
  database
    .prepare(
      `UPDATE listings
       SET schedule_mode = ?, interval_seconds = ?,
           interval_min_seconds = ?, interval_max_seconds = ?,
           next_run_at = ?, schedule_reason = ?
       WHERE id = ? AND product_id = ?`,
    )
    .run(
      mode,
      fixed,
      minimum,
      maximum,
      new Date(Date.now() + schedule.intervalSeconds * 1000).toISOString(),
      schedule.reason,
      listingId,
      productId,
    );
  audit(
    "listing",
    listingId,
    "SCHEDULE_UPDATED",
    `Set schedule mode to ${mode}.`,
  );
  revalidatePath(`/products/${productId}`);
}

export async function updateProductAutoCartAction(formData: FormData) {
  const productId = text(formData, "productId");
  const enabled = formData.get("autoAddToCart") === "on";
  const database = getDatabase();
  const product = database
    .prepare(
      `SELECT id, project_id
       FROM products
       WHERE id = ?`,
    )
    .get(productId) as
    | { id: string; project_id: string }
    | undefined;
  if (!product) {
    throw new Error("Product auto-cart target was not found.");
  }

  const updatedAt = nowIso();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `UPDATE products
         SET auto_add_to_cart = ?, auto_add_terms_version = ?,
             auto_add_enabled_at = ?
         WHERE id = ?`,
      )
      .run(
        enabled ? 1 : 0,
        CART_AUTOMATION_TERMS_VERSION,
        enabled ? updatedAt : null,
        productId,
      );
    if (!enabled) {
      database
        .prepare(
          `UPDATE cart_actions
           SET status = 'SKIPPED',
               error_message = 'Product auto-add approval was disabled.',
               completed_at = ?, updated_at = ?
           WHERE listing_id IN (
             SELECT id FROM listings WHERE product_id = ?
           ) AND status = 'PENDING'`,
        )
        .run(updatedAt, updatedAt, productId);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  audit(
    "product",
    productId,
    enabled ? "AUTO_CART_ENABLED" : "AUTO_CART_DISABLED",
    enabled
      ? `Enabled automatic ensure-one-in-cart actions across all listings under terms ${CART_AUTOMATION_TERMS_VERSION}; checkout remains disabled.`
      : "Revoked automatic cart-add approval.",
  );
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/projects/${product.project_id}`);
  revalidatePath("/settings");
}

export async function deleteListingAction(formData: FormData) {
  const listingId = text(formData, "listingId");
  const productId = text(formData, "productId");
  const database = getDatabase();
  const listing = database
    .prepare(
      `SELECT l.title, l.retailer, pr.project_id
       FROM listings l
       JOIN products pr ON pr.id = l.product_id
       WHERE l.id = ? AND l.product_id = ?`,
    )
    .get(listingId, productId) as
    | { title: string; retailer: string; project_id: string }
    | undefined;
  if (!listing) {
    throw new Error("Listing to remove was not found.");
  }

  database
    .prepare("DELETE FROM listings WHERE id = ? AND product_id = ?")
    .run(listingId, productId);
  audit(
    "listing",
    listingId,
    "DELETED",
    `Removed ${listing.title} monitoring from ${listing.retailer}.`,
  );
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/projects/${listing.project_id}`);
}

export async function relearnListingAction(formData: FormData) {
  const listingId = text(formData, "listingId");
  const productId = text(formData, "productId");
  await learnListingRecipe(listingId, "USER_RELEARN");
  audit(
    "listing",
    listingId,
    "RELEARNED",
    "Captured a new dual-model learning bundle and activated its validated recipe.",
  );
  revalidatePath(`/products/${productId}`);
}

export async function refreshProductDetailsAction(formData: FormData) {
  const productId = text(formData, "productId");
  const database = getDatabase();
  const product = database
    .prepare(
      `SELECT source_url,
        (SELECT url FROM listings WHERE product_id = products.id ORDER BY created_at LIMIT 1) AS listing_url
       FROM products WHERE id = ?`,
    )
    .get(productId) as
    | { source_url: string | null; listing_url: string | null }
    | undefined;
  const sourceUrl = product?.source_url ?? product?.listing_url;
  if (!sourceUrl) throw new Error("This product has no source URL.");

  const started = performance.now();
  const refreshRunId = createId();
  const crawled = await crawlProductUrl(productId, sourceUrl);
  const now = nowIso();
  const listing = database
    .prepare(
      "SELECT id FROM listings WHERE product_id = ? AND normalized_url = ?",
    )
    .get(productId, sourceUrl.toLowerCase().replace(/\/$/, "")) as
    | { id: string }
    | undefined;

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `UPDATE products
         SET description = ?, image_url = ?,
             image_local_path = ?, image_source_url = ?, retailer_sku = ?,
             source_url = ?,
             metadata_status = 'SUCCESS', metadata_error = NULL,
             metadata_checked_at = ?
         WHERE id = ?`,
      )
      .run(
        crawled.description,
        crawled.imageUrl,
        crawled.cachedImagePath,
        sourceUrl,
        crawled.sku,
        sourceUrl,
        now,
        productId,
      );
    if (listing) {
      database
        .prepare(
          `UPDATE listings
           SET title = ?, retailer_id = ?, retailer = ?, retailer_sku = ?,
               current_price_cents = ?, current_availability = ?,
               current_availability_text = ?,
               last_observed_at = ?, observation_count = observation_count + 1
           WHERE id = ?`,
        )
        .run(
          crawled.title,
          crawled.retailer.id,
          crawled.retailer.name,
          crawled.sku,
          crawled.priceCents,
          crawled.availability,
          formatAvailability(crawled.availability),
          now,
          listing.id,
        );
      database
        .prepare(
          `INSERT INTO snapshots
           (id, listing_id, monitoring_run_id, observed_at, availability,
            availability_text, price_cents, confidence, result_status, source, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0.95, 'SUCCESS', 'HTTP', ?)`,
        )
        .run(
          createId(),
          listing.id,
          refreshRunId,
          now,
          crawled.availability,
          formatAvailability(crawled.availability),
          crawled.priceCents,
          "Product details refreshed from retailer page.",
        );
      database
        .prepare(
          `INSERT INTO monitoring_runs
           (id, listing_id, started_at, finished_at, duration_ms, status,
            source, availability, availability_text, price_cents, confidence, detail)
           VALUES (?, ?, ?, ?, ?, 'SUCCESS', 'HTTP', ?, ?, ?, 0.95, ?)`,
        )
        .run(
          refreshRunId,
          listing.id,
          now,
          now,
          Math.max(0, Math.round(performance.now() - started)),
          crawled.availability,
          formatAvailability(crawled.availability),
          crawled.priceCents,
          "Manual product metadata refresh.",
        );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  audit("product", productId, "REFRESHED", `Refreshed from ${sourceUrl}.`);
  revalidatePath(`/products/${productId}`);
}

export async function createRetailerAction(formData: FormData) {
  const name = text(formData, "name");
  if (name.length < 2) throw new Error("Retailer name is required.");
  const id = createId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO retailers
       (id, name, slug, domains_json, image_domains_json,
        authenticity_status, enabled, minimum_interval_seconds,
        max_browser_concurrency, challenge_cooldown_seconds,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'USER_ADDED', 1, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      `${retailerSlug(name)}-${id.slice(0, 8)}`,
      commaSeparatedDomains(text(formData, "domains")),
      commaSeparatedDomains(
        text(formData, "imageDomains") || text(formData, "domains"),
      ),
      Math.max(
        60,
        Number(text(formData, "minimumIntervalSeconds") || "60"),
      ),
      Math.max(1, Number(text(formData, "maxBrowserConcurrency") || "2")),
      Math.max(
        60,
        Number(text(formData, "challengeCooldownSeconds") || "900"),
      ),
      now,
      now,
    );
  audit("retailer", id, "CREATED", `Added retailer ${name}.`);
  revalidatePath("/retailers");
}

export async function updateRetailerAction(formData: FormData) {
  const id = text(formData, "retailerId");
  const name = text(formData, "name");
  getDatabase()
    .prepare(
      `UPDATE retailers
       SET name = ?, domains_json = ?, image_domains_json = ?,
           enabled = ?, minimum_interval_seconds = ?,
           max_browser_concurrency = ?, challenge_cooldown_seconds = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      name,
      commaSeparatedDomains(text(formData, "domains")),
      commaSeparatedDomains(
        text(formData, "imageDomains") || text(formData, "domains"),
      ),
      formData.get("enabled") ? 1 : 0,
      Math.max(
        60,
        Number(text(formData, "minimumIntervalSeconds") || "60"),
      ),
      Math.max(1, Number(text(formData, "maxBrowserConcurrency") || "2")),
      Math.max(
        60,
        Number(text(formData, "challengeCooldownSeconds") || "900"),
      ),
      nowIso(),
      id,
    );
  audit("retailer", id, "UPDATED", `Updated retailer ${name}.`);
  revalidatePath("/retailers");
}

export async function deleteRetailerAction(formData: FormData) {
  const id = text(formData, "retailerId");
  const database = getDatabase();
  const retailer = database
    .prepare("SELECT authenticity_status, name FROM retailers WHERE id = ?")
    .get(id) as { authenticity_status: string; name: string } | undefined;
  if (!retailer) return;
  if (retailer.authenticity_status === "BUILT_IN") {
    throw new Error("Built-in retailers can be disabled but not deleted.");
  }
  database
    .prepare("UPDATE listings SET retailer_id = NULL WHERE retailer_id = ?")
    .run(id);
  database.prepare("DELETE FROM retailers WHERE id = ?").run(id);
  audit("retailer", id, "DELETED", `Deleted retailer ${retailer.name}.`);
  revalidatePath("/retailers");
}

export async function createRuleAction(formData: FormData) {
  const projectId = text(formData, "projectId");
  const id = createId();
  getDatabase()
    .prepare(
      `INSERT INTO rules
       (id, project_id, name, max_price_cents, required_availability,
        action_alert, action_purchase, allow_random_variant, quantity,
        cooldown_minutes, enabled, created_at)
       VALUES (?, ?, ?, ?, 'ACTIONABLE', 1, 0, 0, 1, 0, 1, ?)`,
    )
    .run(
      id,
      projectId,
      text(formData, "name"),
      optionalMoney(text(formData, "maxPrice")),
      nowIso(),
    );
  audit("rule", id, "CREATED", `Created rule ${text(formData, "name")}.`);
  revalidatePath(`/projects/${projectId}`);
}

export async function updateRuleAction(formData: FormData) {
  const id = text(formData, "ruleId");
  const projectId = text(formData, "projectId");
  const name = text(formData, "name");
  if (name.length < 2) throw new Error("Rule name is required.");
  getDatabase()
    .prepare(
      `UPDATE rules
       SET name = ?, max_price_cents = ?, required_availability = 'ACTIONABLE',
           action_purchase = 0, allow_random_variant = 0, quantity = 1,
           cooldown_minutes = 0, enabled = ?
       WHERE id = ? AND project_id = ?`,
    )
    .run(
      name,
      optionalMoney(text(formData, "maxPrice")),
      formData.get("enabled") ? 1 : 0,
      id,
      projectId,
    );
  audit("rule", id, "UPDATED", `Updated rule ${name}.`);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteRuleAction(formData: FormData) {
  const id = text(formData, "ruleId");
  const projectId = text(formData, "projectId");
  getDatabase().prepare("DELETE FROM rules WHERE id = ? AND project_id = ?").run(
    id,
    projectId,
  );
  audit("rule", id, "DELETED", "Deleted rule.");
  revalidatePath(`/projects/${projectId}`);
}

export async function updateProjectAlertDestinationsAction(
  formData: FormData,
) {
  const projectId = text(formData, "projectId");
  const database = getDatabase();
  const project = database
    .prepare("SELECT id FROM projects WHERE id = ?")
    .get(projectId);
  if (!project) {
    throw new Error("Project was not found.");
  }

  const selectedIds = [
    ...new Set(
      formData
        .getAll("channelId")
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  const availableIds = new Set(
    (
      database
        .prepare("SELECT id FROM notification_channels WHERE enabled = 1")
        .all() as Array<{ id: string }>
    ).map((channel) => channel.id),
  );
  if (selectedIds.some((channelId) => !availableIds.has(channelId))) {
    throw new Error("One or more alert destinations are unavailable.");
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare("DELETE FROM project_notification_channels WHERE project_id = ?")
      .run(projectId);
    const insert = database.prepare(
      `INSERT INTO project_notification_channels
       (project_id, channel_id, created_at)
       VALUES (?, ?, ?)`,
    );
    const createdAt = nowIso();
    for (const channelId of selectedIds) {
      insert.run(projectId, channelId, createdAt);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  audit(
    "project",
    projectId,
    "ALERT_DESTINATIONS_UPDATED",
    `Selected ${selectedIds.length} external alert destination(s).`,
  );
  revalidatePath(`/projects/${projectId}`);
}

export async function runProjectScanAction(formData: FormData) {
  const projectId = text(formData, "projectId");
  await runProjectScan(projectId);
  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/alerts");
  revalidatePath("/purchases");
  revalidatePath("/settings");
}

export async function saveDiscordChannelAction(formData: FormData) {
  const name = text(formData, "name");
  const webhook = text(formData, "webhook");
  assertAllowedDiscordWebhook(webhook);
  const id = createId();
  getDatabase()
    .prepare(
      `INSERT INTO notification_channels
       (id, name, type, secret_value, enabled, created_at)
       VALUES (?, ?, 'DISCORD', ?, 1, ?)`,
    )
    .run(id, name, sealSecret(webhook), nowIso());
  audit("notification_channel", id, "CREATED", `Added Discord channel ${name}.`);
  revalidatePath("/settings");
}

export async function updateLearningSettingsAction(formData: FormData) {
  const domModel = text(formData, "domModel");
  const visualModel = text(formData, "visualModel");
  const screeningEngine = text(formData, "screeningEngine");
  const effort = text(formData, "reasoningEffort");
  if (!domModel || !visualModel) {
    throw new Error("Both learning models are required.");
  }
  if (!["low", "medium", "high"].includes(effort)) {
    throw new Error("Unsupported learning reasoning effort.");
  }
  if (!["PLAYWRIGHT", "SELENIUMBASE", "AUTO"].includes(screeningEngine)) {
    throw new Error("Unsupported screening engine.");
  }
  getDatabase()
    .prepare(
      `UPDATE learning_settings
       SET provider = 'COPILOT_CLI', dom_model = ?, visual_model = ?,
           screening_engine = ?, reasoning_effort = ?, updated_at = ?
       WHERE id = 'default'`,
    )
    .run(domModel, visualModel, screeningEngine, effort, nowIso());
  audit(
    "learning_settings",
    "default",
    "UPDATED",
    `DOM model=${domModel}; visual model=${visualModel}; screening=${screeningEngine}; effort=${effort}.`,
  );
  revalidatePath("/settings");
}

export async function updateCartAutomationProfileAction(formData: FormData) {
  const profileName = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .parse(text(formData, "chromeProfileName"));
  getDatabase()
    .prepare(
      `UPDATE cart_automation_settings
       SET chrome_profile_name = ?, updated_at = ?
       WHERE id = 'default'`,
    )
    .run(profileName, nowIso());
  audit(
    "cart_automation_settings",
    "default",
    "PROFILE_UPDATED",
    `Bound automatic cart actions to Chrome profile ${profileName}.`,
  );
  revalidatePath("/settings");
}

export async function sendDiscordTestAction(formData: FormData) {
  await sendDiscordTest(text(formData, "channelId"));
  revalidatePath("/settings");
}

export async function updatePurchaseIntentAction(formData: FormData) {
  const id = text(formData, "intentId");
  const decision = text(formData, "decision");
  const state = decision === "approve" ? "APPROVED" : "REJECTED";
  getDatabase()
    .prepare(
      `UPDATE purchase_intents SET state = ?, updated_at = ? WHERE id = ?`,
    )
    .run(state, nowIso(), id);
  audit(
    "purchase_intent",
    id,
    state,
    state === "APPROVED"
      ? "Approved for assisted checkout preparation; no order was submitted."
      : "Purchase intent rejected.",
  );
  revalidatePath("/purchases");
}
