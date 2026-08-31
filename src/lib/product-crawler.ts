import { lookup } from "node:dns/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import { getDataDirectory, getDatabase } from "@/lib/db";
import { hostnameMatches } from "@/lib/retailer-registry";
import type { Availability } from "@/lib/types";

export interface RetailerRecord {
  id: string;
  name: string;
  domains_json: string;
  image_domains_json: string;
  authenticity_status: string;
}

export interface CrawledProduct {
  retailer: RetailerRecord;
  title: string;
  description: string;
  imageUrl: string | null;
  cachedImagePath: string | null;
  priceCents: number | null;
  availability: Availability;
  sku: string | null;
}

const knownProductImageSources: Record<
  string,
  { sourceUrl: string; imageUrl: string; preferred?: boolean }
> = {
  "pokemon-pc-etb": {
    sourceUrl:
      "https://www.pokemoncenter.com/product/10-10447-111/pokemon-tcg-30th-celebration-pokemon-center-elite-trainer-box",
    imageUrl:
      "https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10048/P11454_10-10447-111_01.jpg",
    preferred: true,
  },
  "pokemon-sticker-alolan": {
    sourceUrl:
      "https://www.pokemoncenter.com/product/10-10449-121/pokemon-tcg-30th-celebration-tech-sticker-collection-alolan-exeggutor",
    imageUrl:
      "https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10050/P11451_10-10449-121_01.jpg",
    preferred: true,
  },
  "pokemon-sticker-lucario": {
    sourceUrl:
      "https://www.pokemoncenter.com/product/10-10449-122/pokemon-tcg-30th-celebration-tech-sticker-collection-lucario",
    imageUrl:
      "https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10050/P11451_10-10449-122_01.jpg",
    preferred: true,
  },
  "pokemon-knockout": {
    sourceUrl:
      "https://www.pokemoncenter.com/product/10-10667-101/pokemon-tcg-30th-celebration-knock-out-collection",
    imageUrl:
      "https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10050/P12487_10-10667-101_01.jpg",
    preferred: true,
  },
  "pokemon-booster": {
    sourceUrl:
      "https://www.pokemoncenter.com/product/10-10451-115/pokemon-tcg-30th-celebration-booster-bundle-6-packs",
    imageUrl:
      "https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10049/P11460_10-10451-115_01.jpg",
    preferred: true,
  },
  "pokemon-tins-10": {
    sourceUrl:
      "https://www.tcgplayer.com/product/704186/pokemon-me-30th-celebration-30th-celebration-mini-tin-display",
    imageUrl:
      "https://product-images.tcgplayer.com/fit-in/1000x1000/704186.jpg",
  },
};

function localTestingAllowed(hostname: string) {
  return (
    process.env.DEALHUNTER_ALLOW_LOCAL_WEBHOOKS === "1" &&
    (hostname === "127.0.0.1" || hostname === "localhost")
  );
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("10.") ||
    normalized.startsWith("127.") ||
    normalized.startsWith("169.254.") ||
    normalized.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
}

async function assertSafeNetworkTarget(url: URL) {
  if (localTestingAllowed(url.hostname)) return;
  if (url.protocol !== "https:") {
    throw new Error("Retailer pages and images must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed.");
  }
  if (isIP(url.hostname) && isPrivateAddress(url.hostname)) {
    throw new Error("Private network targets are not allowed.");
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("The retailer URL resolved to a private network.");
  }
}

function parseDomains(value: string) {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function findRetailerForUrl(url: URL) {
  const retailers = getDatabase()
    .prepare(
      `SELECT id, name, domains_json, image_domains_json, authenticity_status
       FROM retailers
       WHERE enabled = 1
       ORDER BY authenticity_status = 'BUILT_IN' DESC, name`,
    )
    .all() as unknown as RetailerRecord[];
  return (
    retailers.find((retailer) =>
      parseDomains(retailer.domains_json).some((domain) =>
        hostnameMatches(url.hostname, domain),
      ),
    ) ?? null
  );
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]);
  }
  return null;
}

function findProductJson(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const product = findProductJson(entry);
      if (product) return product;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = Array.isArray(record["@type"])
    ? record["@type"].join(" ")
    : String(record["@type"] ?? "");
  if (type.toLowerCase().includes("product")) return record;
  if (record["@graph"]) return findProductJson(record["@graph"]);
  return null;
}

function productJsonLd(html: string) {
  const matches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of matches) {
    try {
      const product = findProductJson(JSON.parse(match[1]));
      if (product) return product;
    } catch {
      continue;
    }
  }
  return null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return firstString(value[0]);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstString(record.url ?? record.contentUrl);
  }
  return null;
}

function availabilityFromValue(value: unknown): Availability {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("instock")) return "IN_STOCK";
  if (normalized.includes("outofstock")) return "OUT_OF_STOCK";
  if (normalized.includes("preorder")) return "PREORDER";
  if (normalized.includes("backorder")) return "BACKORDER";
  if (normalized.includes("limited")) return "LIMITED";
  return "UNKNOWN";
}

function productOffer(product: Record<string, unknown> | null) {
  if (!product?.offers) return null;
  const offer = Array.isArray(product.offers)
    ? product.offers[0]
    : product.offers;
  return offer && typeof offer === "object"
    ? (offer as Record<string, unknown>)
    : null;
}

function pageTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1].replace(/\s+/g, " ")) : null;
}

function cleanDescription(value: string) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "))
    .slice(0, 2000);
}

function looksLikeChallenge(html: string) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const sample = decodeEntities(withoutScripts.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .slice(0, 20_000)
    .toLowerCase();
  return [
    "verify you are human",
    "access denied",
    "checking your browser",
    "unusual traffic",
    "pardon our interruption",
  ].some((phrase) => sample.includes(phrase));
}

async function renderProductPage(url: URL) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1365, height: 900 },
    });
    const page = await context.newPage();
    const response = await page.goto(url.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const html = await page.content();
    const visibleText = await page.locator("body").innerText();
    if (
      !response ||
      response.status() === 403 ||
      response.status() === 429 ||
      looksLikeChallenge(visibleText)
    ) {
      throw new Error(
        "The retailer presented an access challenge that requires user action.",
      );
    }
    return { html, finalUrl: new URL(page.url()) };
  } finally {
    await browser.close();
  }
}

async function fetchProductPage(url: URL) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "DealHunter/0.1 private product catalog",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 403 || response.status === 429) {
    return renderProductPage(url);
  }
  if (!response.ok) {
    throw new Error(`The retailer returned HTTP ${response.status}.`);
  }
  const html = await response.text();
  if (looksLikeChallenge(html)) {
    return renderProductPage(url);
  }
  return { html, finalUrl: new URL(response.url || url.toString()) };
}

async function cacheProductImage(
  productId: string,
  imageValue: string | null,
  pageUrl: URL,
  retailer: RetailerRecord,
) {
  if (!imageValue) return null;
  const imageUrl = new URL(imageValue, pageUrl);
  const allowedDomains = parseDomains(retailer.image_domains_json);
  if (
    !allowedDomains.some((domain) =>
      hostnameMatches(imageUrl.hostname, domain),
    )
  ) {
    return null;
  }
  await assertSafeNetworkTarget(imageUrl);
  const response = await fetch(imageUrl, {
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
      "user-agent": "DealHunter/0.1 private product catalog",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type")?.split(";")[0];
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  };
  const extension = contentType ? extensions[contentType] : undefined;
  if (!extension) return null;
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > 5_000_000) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000) return null;

  const imageDirectory = path.join(getDataDirectory(), "images");
  mkdirSync(imageDirectory, { recursive: true });
  const fileName = `${productId}.${extension}`;
  writeFileSync(path.join(imageDirectory, fileName), bytes, { mode: 0o600 });
  return `/api/product-images/${fileName}`;
}

export async function crawlProductUrl(
  productId: string,
  value: string,
): Promise<CrawledProduct> {
  const url = new URL(value);
  await assertSafeNetworkTarget(url);
  const retailer = findRetailerForUrl(url);
  if (!retailer) {
    throw new Error(
      `No enabled retailer recognizes ${url.hostname}. Add it to the retailer registry first.`,
    );
  }

  const page = await fetchProductPage(url);
  const html = page.html;
  const product = productJsonLd(html);
  const offer = productOffer(product);
  const title =
    firstString(product?.name) ??
    metaContent(html, "og:title") ??
    pageTitle(html);
  if (!title) throw new Error("The product title could not be identified.");

  const descriptionValue =
    firstString(product?.description) ??
    metaContent(html, "og:description") ??
    metaContent(html, "description") ??
    "";
  const imageUrl =
    firstString(product?.image) ?? metaContent(html, "og:image");
  const priceValue =
    offer?.price ??
    offer?.lowPrice ??
    metaContent(html, "product:price:amount");
  const price = priceValue === null ? NaN : Number(priceValue);
  const resolvedImageUrl = imageUrl
    ? new URL(imageUrl, page.finalUrl).toString()
    : null;
  const cachedImagePath = await cacheProductImage(
    productId,
    resolvedImageUrl,
    page.finalUrl,
    retailer,
  );

  return {
    retailer,
    title: decodeEntities(title),
    description: cleanDescription(descriptionValue),
    imageUrl: resolvedImageUrl,
    cachedImagePath,
    priceCents: Number.isFinite(price) ? Math.round(price * 100) : null,
    availability: availabilityFromValue(
      offer?.availability ?? metaContent(html, "product:availability"),
    ),
    sku:
      firstString(product?.sku) ??
      firstString(product?.mpn) ??
      firstString(offer?.sku),
  };
}

export async function enrichNextProduct() {
  const database = getDatabase();
  const state = database
    .prepare("SELECT value FROM system_state WHERE key = 'metadata-crawl'")
    .get() as { value: string } | undefined;
  if (state && Date.now() - Date.parse(state.value) < 60_000) {
    return 0;
  }

  const candidate = database
    .prepare(
      `SELECT pr.id,
        COALESCE(
          pr.source_url,
          (SELECT l.url FROM listings l WHERE l.product_id = pr.id ORDER BY l.created_at LIMIT 1)
        ) AS source_url
       FROM products pr
       WHERE (pr.image_local_path IS NULL OR pr.description = '')
         AND (
           pr.metadata_checked_at IS NULL
           OR pr.metadata_checked_at <= ?
         )
       ORDER BY pr.metadata_checked_at IS NOT NULL, pr.created_at
       LIMIT 1`,
    )
    .get(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as
    | { id: string; source_url: string | null }
    | undefined;
  if (!candidate?.source_url) return 0;

  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO system_state (key, value, updated_at)
       VALUES ('metadata-crawl', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(now, now);

  try {
    const crawled = await crawlProductUrl(candidate.id, candidate.source_url);
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
        candidate.source_url,
        crawled.sku,
        candidate.source_url,
        now,
        candidate.id,
      );
  } catch (error) {
    database
      .prepare(
        `UPDATE products
         SET source_url = ?, metadata_status = 'FAILED', metadata_error = ?,
             metadata_checked_at = ?
         WHERE id = ?`,
      )
      .run(
        candidate.source_url,
        error instanceof Error ? error.message : "Metadata crawl failed.",
        now,
        candidate.id,
      );
  }
  return 1;
}

export async function mineProjectImages(projectId: string) {
  const database = getDatabase();
  const products = database
    .prepare(
      `SELECT id, canonical_name, description, image_url, image_local_path,
        image_source_url
       FROM products
       WHERE project_id = ?
       ORDER BY canonical_name`,
    )
    .all(projectId) as Array<{
    id: string;
    canonical_name: string;
    description: string;
    image_url: string | null;
    image_local_path: string | null;
    image_source_url: string | null;
  }>;
  const results: Array<{
    productId: string;
    productName: string;
    status: "CACHED" | "REMOTE_ONLY" | "FAILED" | "EXISTING";
    source?: string;
    detail?: string;
  }> = [];

  for (const product of products) {
    const preferredSource = knownProductImageSources[product.id];
    const shouldRefreshPreferred =
      preferredSource?.preferred === true &&
      product.image_source_url !== preferredSource.sourceUrl;
    if (product.image_local_path && !shouldRefreshPreferred) {
      results.push({
        productId: product.id,
        productName: product.canonical_name,
        status: "EXISTING",
      });
      continue;
    }
    const listings = database
      .prepare(
        `SELECT url, retailer
         FROM listings
         WHERE product_id = ?
         ORDER BY
           CASE retailer
             WHEN 'Target' THEN 0
             WHEN 'Best Buy' THEN 1
             WHEN 'Pokémon Center' THEN 2
             ELSE 3
           END,
           created_at`,
      )
      .all(product.id) as Array<{ url: string; retailer: string }>;
    let lastError = "No retailer listing is available.";
    let completed = false;

    if (!shouldRefreshPreferred) {
      for (const listing of listings) {
        try {
          const crawled = await crawlProductUrl(product.id, listing.url);
          if (!crawled.imageUrl) {
            lastError = `${listing.retailer} did not provide a product image.`;
            continue;
          }
          const now = new Date().toISOString();
          database
            .prepare(
              `UPDATE products
               SET description = CASE WHEN description = '' THEN ? ELSE description END,
                   image_url = ?, image_local_path = ?, image_source_url = ?,
                   metadata_status = ?, metadata_error = NULL,
                   metadata_checked_at = ?
               WHERE id = ?`,
            )
            .run(
              crawled.description,
              crawled.imageUrl,
              crawled.cachedImagePath,
              listing.url,
              crawled.cachedImagePath ? "SUCCESS" : "REMOTE_ONLY",
              now,
              product.id,
            );
          results.push({
            productId: product.id,
            productName: product.canonical_name,
            status: crawled.cachedImagePath ? "CACHED" : "REMOTE_ONLY",
            source: listing.url,
          });
          completed = true;
          break;
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : "Product crawl failed.";
        }
      }
    }

    if (!completed || shouldRefreshPreferred) {
      const knownSource = preferredSource;
      if (knownSource) {
        const sourceUrl = new URL(knownSource.sourceUrl);
        const retailer = findRetailerForUrl(sourceUrl);
        if (retailer) {
          try {
            const cachedImagePath = await cacheProductImage(
              product.id,
              knownSource.imageUrl,
              sourceUrl,
              retailer,
            );
            if (cachedImagePath) {
              database
                .prepare(
                  `UPDATE products
                   SET image_url = ?, image_local_path = ?,
                       image_source_url = ?, metadata_status = 'SUCCESS',
                       metadata_error = NULL, metadata_checked_at = ?
                   WHERE id = ?`,
                )
                .run(
                  knownSource.imageUrl,
                  cachedImagePath,
                  knownSource.sourceUrl,
                  new Date().toISOString(),
                  product.id,
                );
              results.push({
                productId: product.id,
                productName: product.canonical_name,
                status: "CACHED",
                source: knownSource.sourceUrl,
              });
              completed = true;
            }
          } catch (error) {
            lastError =
              error instanceof Error
                ? error.message
                : "Known image source failed.";
          }
        }
      }
    }

    if (!completed) {
      database
        .prepare(
          `UPDATE products
           SET metadata_status = 'FAILED', metadata_error = ?,
               metadata_checked_at = ?
           WHERE id = ?`,
        )
        .run(lastError, new Date().toISOString(), product.id);
      results.push({
        productId: product.id,
        productName: product.canonical_name,
        status: "FAILED",
        detail: lastError,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return results;
}
