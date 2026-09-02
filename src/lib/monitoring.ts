import { createId, getDatabase, nowIso } from "@/lib/db";
import { resolveChallenge } from "@/lib/challenges";
import { extractTargetProductId } from "@/lib/outbound-actions";
import {
  cartProductKey,
  updateCartEligibility,
} from "@/lib/cart-actions";
import {
  buildDiscordPayload,
  deliverAlertToDiscord,
} from "@/lib/notifications";
import type {
  Availability,
  ListingObservation,
  ListingRecord,
} from "@/lib/types";

function availabilityFromJsonLd(value: unknown): Availability {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("instock")) return "IN_STOCK";
  if (normalized.includes("preorder")) return "PREORDER";
  if (normalized.includes("backorder")) return "BACKORDER";
  if (normalized.includes("outofstock")) return "OUT_OF_STOCK";
  return "UNKNOWN";
}

function defaultAvailabilityText(value: Availability) {
  const labels: Record<Availability, string> = {
    IN_STOCK: "In Stock",
    OUT_OF_STOCK: "Out of Stock",
    PREORDER: "Preorder",
    BACKORDER: "Backorder",
    COMING_SOON: "Coming Soon",
    LIMITED: "Limited",
    UNAVAILABLE: "Unavailable",
    UNKNOWN: "Unknown",
  };
  return labels[value];
}

function productIdentityTokenMatches(value: string, productKey: string) {
  const tokens = [
    productKey,
    productKey.replace(/^[A-Za-z]+-/, ""),
  ].filter(Boolean);
  return tokens.some((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`,
      "i",
    ).test(value);
  });
}

export function isActionableAvailability(value: Availability) {
  return (
    value === "IN_STOCK" ||
    value === "PREORDER" ||
    value === "BACKORDER" ||
    value === "LIMITED"
  );
}

export function matchesRuleAvailability(
  availability: Availability,
  requiredAvailability: string,
) {
  return requiredAvailability === "ACTIONABLE"
    ? isActionableAvailability(availability)
    : availability === requiredAvailability;
}

function findProductOffer(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductOffer(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = Array.isArray(record["@type"])
    ? record["@type"].join(" ")
    : String(record["@type"] ?? "");
  if (type.toLowerCase().includes("product") && record.offers) {
    const offers = Array.isArray(record.offers)
      ? record.offers[0]
      : record.offers;
    return offers && typeof offers === "object"
      ? (offers as Record<string, unknown>)
      : null;
  }
  if (record["@graph"]) return findProductOffer(record["@graph"]);
  return null;
}

function parseJsonLd(html: string): ListingObservation | null {
  const matches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of matches) {
    try {
      const offer = findProductOffer(JSON.parse(match[1]));
      if (!offer) continue;
      const price = Number(offer.price ?? offer.lowPrice);
      const availability = availabilityFromJsonLd(offer.availability);
      return {
        availability,
        displayAvailabilityText: defaultAvailabilityText(availability),
        priceCents: Number.isFinite(price) ? Math.round(price * 100) : null,
        confidence: 0.88,
        resultStatus: "SUCCESS",
        source: "HTTP",
        evidenceType: "SEO_METADATA",
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function parseBestBuyButtonState(html: string) {
  const match = html.match(
    /"fulfillmentOptions":\{"buttonStates":\[\{"buttonState":"([^"]+)"(?:,[\s\S]{0,300}?"displayText":"([^"]*)")?/,
  );
  if (!match) return null;
  const state = match[1].toUpperCase();
  const displayText = match[2] || state.replaceAll("_", " ");
  if (state === "COMING_SOON") {
    return { availability: "COMING_SOON" as const, state, displayText };
  }
  if (
    state === "ADD_TO_CART" ||
    state === "PRE_ORDER" ||
    state === "PREORDER"
  ) {
    return {
      availability:
        state === "ADD_TO_CART" ? ("IN_STOCK" as const) : ("PREORDER" as const),
      state,
      displayText,
    };
  }
  if (
    state === "SOLD_OUT" ||
    state === "OUT_OF_STOCK" ||
    state === "UNAVAILABLE" ||
    state === "NOT_AVAILABLE"
  ) {
    return { availability: "OUT_OF_STOCK" as const, state, displayText };
  }
  return { availability: "UNKNOWN" as const, state, displayText };
}

export function detectPokemonCenterChallenge(html: string) {
  const normalized = html.toLowerCase();
  const signatures = [
    "pardon our interruption",
    "_incapsula_resource",
    "incapsula incident id",
    "hcaptcha.com",
    "reese84",
  ];
  const matched = signatures.filter((signature) =>
    normalized.includes(signature),
  );
  return matched.length
    ? {
        challenged: true,
        signatures: matched,
      }
    : {
        challenged: false,
        signatures: [] as string[],
      };
}

export function parseTargetProductSection(
  productSection: string,
  fallbackPriceCents: number | null,
  primaryCartEnabled = false,
  primaryCartPresent = false,
  primaryPreorderEnabled = false,
  primaryPreorderPresent = false,
) {
  const normalized = productSection.toLowerCase();
  const priceMatch = productSection.match(/\$(\d{1,5}(?:\.\d{2})?)/);
  const priceCents = priceMatch
    ? Math.round(Number(priceMatch[1]) * 100)
    : fallbackPriceCents;

  let availability: Availability = "UNKNOWN";
  let displayAvailabilityText: string | null = null;
  if (normalized.includes("out of stock")) {
    availability = "OUT_OF_STOCK";
    displayAvailabilityText =
      productSection.match(/out of stock/i)?.[0] ?? "Out of Stock";
  } else if (normalized.includes("coming soon")) {
    availability = "COMING_SOON";
    displayAvailabilityText =
      productSection.match(/coming soon/i)?.[0] ?? "Coming Soon";
  } else if (normalized.includes("preorder") && primaryPreorderPresent) {
    availability = primaryPreorderEnabled ? "PREORDER" : "OUT_OF_STOCK";
    displayAvailabilityText = primaryPreorderEnabled
      ? (productSection.match(/preorder/i)?.[0] ?? "Preorder")
      : null;
  } else if (normalized.includes("add to cart") && primaryCartPresent) {
    availability = primaryCartEnabled ? "IN_STOCK" : "OUT_OF_STOCK";
    displayAvailabilityText = primaryCartEnabled ? "Add to cart" : null;
  }
  return { availability, priceCents, displayAvailabilityText };
}

export function calculateNextSchedule(
  listing: Pick<
    ListingRecord,
    | "schedule_mode"
    | "interval_seconds"
    | "interval_min_seconds"
    | "interval_max_seconds"
    | "project_default_schedule_mode"
    | "project_default_interval_seconds"
    | "project_default_interval_min_seconds"
    | "project_default_interval_max_seconds"
    | "retailer_minimum_interval_seconds"
  >,
  recentStatuses: string[],
  currentStatus: string,
  random = Math.random,
) {
  const inherited = listing.schedule_mode === "INHERIT";
  const effectiveMode = inherited
    ? listing.project_default_schedule_mode
    : listing.schedule_mode;
  const fixedSeconds = inherited
    ? listing.project_default_interval_seconds
    : listing.interval_seconds;
  const minimumSeconds = inherited
    ? listing.project_default_interval_min_seconds
    : listing.interval_min_seconds;
  const maximumSeconds = inherited
    ? listing.project_default_interval_max_seconds
    : listing.interval_max_seconds;
  const retailerFloor = Math.max(
    60,
    listing.retailer_minimum_interval_seconds,
  );
  const inheritedPrefix = inherited ? "Inherited project policy. " : "";

  if (effectiveMode === "FIXED") {
    const interval = Math.max(retailerFloor, fixedSeconds);
    return {
      intervalSeconds: interval,
      reason: `${inheritedPrefix}Fixed interval: ${interval} seconds after retailer minimum.`,
    };
  }

  if (effectiveMode === "BOUNDED") {
    const minimum = Math.max(retailerFloor, minimumSeconds);
    const maximum = Math.max(minimum, maximumSeconds);
    return {
      intervalSeconds: randomIntervalSeconds(minimum, maximum, random),
      reason: `${inheritedPrefix}Bounded interval: ${minimum}-${maximum} seconds after retailer minimum.`,
    };
  }

  const statuses = [currentStatus, ...recentStatuses].slice(0, 50);
  const challengeCount = statuses.filter(
    (status) => status === "CHALLENGE" || status === "RATE_LIMITED",
  ).length;
  const failureCount = statuses.filter(
    (status) =>
      status === "NETWORK_ERROR" ||
      status === "PARSE_ERROR" ||
      status === "CHALLENGE" ||
      status === "RATE_LIMITED",
  ).length;
  const challengeRate = statuses.length
    ? challengeCount / statuses.length
    : 0;
  const failureRate = statuses.length ? failureCount / statuses.length : 0;
  const healthyRange = Math.max(0, maximumSeconds - minimumSeconds);
  const healthyMinimum = Math.max(retailerFloor, minimumSeconds);
  const healthyMaximum = Math.max(
    healthyMinimum,
    maximumSeconds,
    healthyMinimum + healthyRange,
  );
  let scheduleMinimum = healthyMinimum;
  let scheduleMaximum = healthyMaximum;
  let scheduleBasis = "healthy randomized window";

  if (currentStatus === "CHALLENGE" || currentStatus === "RATE_LIMITED") {
    scheduleMinimum = Math.max(healthyMinimum, 810);
    scheduleMaximum = Math.max(healthyMaximum, 990);
    scheduleBasis = "current challenge/rate-limit backoff";
  } else if (challengeRate >= 0.2) {
    scheduleMinimum = Math.max(healthyMinimum, 540);
    scheduleMaximum = Math.max(healthyMaximum, 660);
    scheduleBasis = "retailer challenge/rate-limit history backoff";
  } else if (failureRate >= 0.3) {
    scheduleMinimum = Math.max(healthyMinimum, 108);
    scheduleMaximum = Math.max(healthyMaximum, 132);
    scheduleBasis = "retailer failure history backoff";
  }

  return {
    intervalSeconds: randomIntervalSeconds(
      scheduleMinimum,
      scheduleMaximum,
      random,
    ),
    reason: `${inheritedPrefix}System recommendation from ${statuses.length} retailer checks (${scheduleBasis}, ${scheduleMinimum}-${scheduleMaximum} seconds): ${(challengeRate * 100).toFixed(0)}% challenge/rate-limit and ${(failureRate * 100).toFixed(0)}% total failure rate; retailer minimum ${retailerFloor} seconds.`,
  };
}

export function randomIntervalSeconds(
  minimumSeconds: number,
  maximumSeconds: number,
  random = Math.random,
) {
  const minimum = Math.ceil(minimumSeconds);
  const maximum = Math.max(minimum, Math.floor(maximumSeconds));
  return Math.floor(minimum + random() * (maximum - minimum + 1));
}

export function simulatedObservation(
  listing: ListingRecord,
): ListingObservation {
  const url = new URL(listing.url);
  const priceParameter = url.searchParams.get("price");
  const explicitPrice =
    priceParameter === null ? null : Number(priceParameter);
  const isDeal = url.hostname === "mock.dealhunter.local";
  const localDemoDeal =
    process.env.DEALHUNTER_DEMO_MODE === "1" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  return {
    availability:
      isDeal || localDemoDeal ? "IN_STOCK" : listing.current_availability,
    displayAvailabilityText: isDeal || localDemoDeal
      ? "In Stock"
      : listing.current_availability_text ??
        defaultAvailabilityText(listing.current_availability),
    priceCents: explicitPrice !== null && Number.isFinite(explicitPrice)
      ? Math.round(explicitPrice * 100)
      : listing.current_price_cents,
    confidence: 0.98,
    resultStatus: "SUCCESS",
    source: "SIMULATION",
    evidenceType: "TEST_FIXTURE",
    detail: "Safe local simulation; no retailer request was made.",
  };
}

async function observeTargetWithBrowser(
  listing: ListingRecord,
): Promise<ListingObservation> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      locale: "en-US",
      viewport: { width: 1365, height: 900 },
    });
    const response = await page.goto(listing.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (!response || response.status() === 403 || response.status() === 429) {
      return {
        availability: "UNKNOWN",
        priceCents: listing.current_price_cents,
        confidence: 0,
        resultStatus:
          response?.status() === 429 ? "RATE_LIMITED" : "CHALLENGE",
        source: "BROWSER",
        evidenceType: "NONE",
        detail: `Target returned HTTP ${response?.status() ?? "unknown"}.`,
      };
    }

    const heading = page.locator("h1").first();
    await heading.waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForFunction(
      () => {
        const productTitle = document.querySelector("h1")?.textContent?.trim();
        const body = document.body?.innerText ?? "";
        if (!productTitle) return false;
        const start = body.indexOf(productTitle);
        if (start < 0) return false;
        const sectionEnd = body.indexOf("Skip to next section", start);
        const section = body.slice(
          start,
          sectionEnd > start ? sectionEnd : start + 1_500,
        );
        return (
          /\$\d{1,5}(?:\.\d{2})?/.test(section) &&
          /(out of stock|coming soon|preorder|add to cart)/i.test(section)
        );
      },
      { timeout: 25_000 },
    );
    let productSection = "";
    let previousSection = "";
    for (let sample = 0; sample < 4; sample += 1) {
      await page.waitForTimeout(1_500);
      productSection = await page.evaluate(() => {
        const productTitle = document.querySelector("h1")?.textContent?.trim();
        const body = document.body?.innerText ?? "";
        if (!productTitle) return "";
        const start = body.indexOf(productTitle);
        if (start < 0) return "";
        const sectionEnd = body.indexOf("Skip to next section", start);
        return body.slice(
          start,
          sectionEnd > start ? sectionEnd : start + 1_500,
        );
      });
      if (productSection === previousSection) break;
      previousSection = productSection;
    }
    const targetProductId = extractTargetProductId(listing.url).slice(2);
    const primaryFulfillment = page
      .locator(
        `button[data-test="shippingButton"][id*="${targetProductId}"]`,
      )
      .first();
    const primaryFulfillmentPresent =
      (await primaryFulfillment.count()) > 0;
    const primaryFulfillmentText = primaryFulfillmentPresent
      ? ((await primaryFulfillment.textContent()) ?? "").trim()
      : "";
    const primaryCartPresent =
      primaryFulfillmentPresent &&
      /add to cart/i.test(primaryFulfillmentText);
    const primaryCartEnabled =
      primaryCartPresent && (await primaryFulfillment.isEnabled());
    const primaryPreorderPresent =
      primaryFulfillmentPresent &&
      /pre-?order/i.test(primaryFulfillmentText);
    const primaryPreorderEnabled =
      primaryPreorderPresent && (await primaryFulfillment.isEnabled());
    const { availability, priceCents, displayAvailabilityText } =
      parseTargetProductSection(
      productSection,
      listing.current_price_cents,
      primaryCartEnabled,
      primaryCartPresent,
      primaryPreorderEnabled,
      primaryPreorderPresent,
      );

    return {
      availability,
      displayAvailabilityText,
      priceCents,
      confidence: availability === "UNKNOWN" ? 0.4 : 0.98,
      resultStatus: availability === "UNKNOWN" ? "PARSE_ERROR" : "SUCCESS",
      source: "BROWSER",
      evidenceType:
        availability === "UNKNOWN" ? "NONE" : "PRIMARY_CONTROL",
      detail:
        availability === "UNKNOWN"
          ? "Target rendered the product, but no primary fulfillment state was found."
          : `Target primary product section reported ${availability}.`,
    };
  } catch (error) {
    return {
      availability: "UNKNOWN",
      priceCents: listing.current_price_cents,
      confidence: 0,
      resultStatus: "NETWORK_ERROR",
      source: "BROWSER",
      evidenceType: "NONE",
      detail:
        error instanceof Error
          ? `Target browser observation failed: ${error.message}`
          : "Target browser observation failed.",
    };
  } finally {
    await browser.close();
  }
}

async function observeRetailerWithBrowser(
  listing: ListingRecord,
): Promise<ListingObservation> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      locale: "en-US",
      viewport: { width: 1365, height: 900 },
    });
    const response = await page.goto(listing.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (!response || response.status() === 403 || response.status() === 429) {
      return {
        availability: "UNKNOWN",
        priceCents: listing.current_price_cents,
        confidence: 0,
        resultStatus:
          response?.status() === 429 ? "RATE_LIMITED" : "CHALLENGE",
        source: "BROWSER",
        evidenceType: "NONE",
        detail: `${listing.retailer} returned HTTP ${response?.status() ?? "unknown"}.`,
      };
    }

    await page.locator("h1").first().waitFor({
      state: "visible",
      timeout: 25_000,
    });
    await page.waitForTimeout(2_000);
    const productKey = cartProductKey(
      listing.retailer_id ?? "",
      listing.url,
    );
    let finalProductKey: string;
    try {
      finalProductKey = cartProductKey(
        listing.retailer_id ?? "",
        page.url(),
      );
    } catch {
      return {
        availability: "UNKNOWN",
        priceCents: listing.current_price_cents,
        confidence: 0,
        resultStatus: "PARSE_ERROR",
        source: "BROWSER",
        evidenceType: "NONE",
        detail: `${listing.retailer} redirected to an unsupported product URL.`,
      };
    }
    if (finalProductKey !== productKey) {
      return {
        availability: "UNKNOWN",
        priceCents: listing.current_price_cents,
        confidence: 0,
        resultStatus: "PARSE_ERROR",
        source: "BROWSER",
        evidenceType: "NONE",
        detail: `${listing.retailer} redirected to a different product.`,
      };
    }
    const result = await page.evaluate(() => {
      const heading = document.querySelector("h1");
      const title = heading?.textContent?.trim() ?? "";
      const headingBox = heading?.getBoundingClientRect();
      const bodyText = document.body?.innerText ?? "";
      const start = title ? bodyText.indexOf(title) : -1;
      const productSection =
        start >= 0 ? bodyText.slice(start, start + 2_000) : bodyText.slice(0, 2_000);
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, [role="button"], input[type="submit"], input[type="button"]',
        ),
      )
        .map((element) => {
          const box = element.getBoundingClientRect();
          const name = (
            element.getAttribute("aria-label") ||
            element.getAttribute("value") ||
            element.innerText ||
            ""
          ).trim();
          const disabled =
            element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true";
          const identityValues: string[] = [];
          const associatedLinks: string[] = [];
          let container: HTMLElement | null = element;
          for (let depth = 0; depth < 7 && container; depth += 1) {
            identityValues.push(
              ...[
              container.id,
              container.getAttribute("data-sku-id"),
              container.getAttribute("data-product-id"),
              container.getAttribute("data-tcin"),
              ].filter((value): value is string => Boolean(value)),
            );
            associatedLinks.push(
              ...Array.from(
              container.querySelectorAll<HTMLAnchorElement>("a[href]"),
              ).map((link) => link.href),
            );
            container = container.parentElement;
          }
          return {
            name,
            disabled,
            identityValues,
            associatedLinks,
            top: box.top,
            width: box.width,
            height: box.height,
          };
        })
        .filter(
          (candidate) =>
            /\b(add to cart|pre-?order)\b/i.test(candidate.name) &&
            candidate.width > 0 &&
            candidate.height > 0 &&
            (!headingBox || candidate.top >= headingBox.top - 100) &&
            (!headingBox || candidate.top <= headingBox.top + 1_800),
        )
        .sort((left, right) => left.top - right.top);
      return {
        productSection,
        candidates,
      };
    });
    const control =
      result.candidates.find(
        (candidate) =>
          candidate.identityValues.some((value) =>
            productIdentityTokenMatches(value, productKey),
          ) ||
          candidate.associatedLinks.some((link) => {
            try {
              return (
                cartProductKey(listing.retailer_id ?? "", link) === productKey
              );
            } catch {
              return false;
            }
          }),
      ) ?? null;

    const priceMatch = result.productSection.match(
      /\$(\d{1,5}(?:\.\d{2})?)/,
    );
    const priceCents = priceMatch
      ? Math.round(Number(priceMatch[1]) * 100)
      : listing.current_price_cents;
    if (control) {
      const preorder = /pre-?order/i.test(control.name);
      const availability = control.disabled
        ? "OUT_OF_STOCK"
        : preorder
          ? "PREORDER"
          : "IN_STOCK";
      return {
        availability,
        displayAvailabilityText: control.disabled
          ? "Out of stock"
          : control.name,
        priceCents,
        confidence: 0.95,
        resultStatus: "SUCCESS",
        source: "BROWSER",
        evidenceType: "PRIMARY_CONTROL",
        detail: `${listing.retailer} primary purchase control reported ${availability}.`,
      };
    }

    const normalized = result.productSection.toLowerCase();
    const availability = normalized.includes("out of stock")
      ? "OUT_OF_STOCK"
      : normalized.includes("coming soon")
        ? "COMING_SOON"
        : "UNKNOWN";
    return {
      availability,
      displayAvailabilityText:
        availability === "OUT_OF_STOCK"
          ? "Out of stock"
          : availability === "COMING_SOON"
            ? "Coming soon"
            : null,
      priceCents,
      confidence: availability === "UNKNOWN" ? 0.3 : 0.8,
      resultStatus: availability === "UNKNOWN" ? "PARSE_ERROR" : "SUCCESS",
      source: "BROWSER",
      evidenceType: availability === "UNKNOWN" ? "NONE" : "PRIMARY_CONTROL",
      detail:
        availability === "UNKNOWN"
          ? `${listing.retailer} rendered without an unambiguous primary purchase control.`
          : `${listing.retailer} product section reported ${availability}.`,
    };
  } catch (error) {
    return {
      availability: "UNKNOWN",
      priceCents: listing.current_price_cents,
      confidence: 0,
      resultStatus: "NETWORK_ERROR",
      source: "BROWSER",
      evidenceType: "NONE",
      detail:
        error instanceof Error
          ? `${listing.retailer} browser observation failed: ${error.message}`
          : `${listing.retailer} browser observation failed.`,
    };
  } finally {
    await browser.close();
  }
}

async function acquireObservation(
  listing: ListingRecord,
): Promise<ListingObservation> {
  const url = new URL(listing.url);
  if (
    url.hostname === "mock.dealhunter.local" ||
    (process.env.DEALHUNTER_DEMO_MODE === "1" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")) ||
    process.env.DEALHUNTER_LIVE_FETCH === "0"
  ) {
    return simulatedObservation(listing);
  }
  if (url.hostname === "target.com" || url.hostname.endsWith(".target.com")) {
    return observeTargetWithBrowser(listing);
  }
  if (listing.auto_add_to_cart && listing.retailer_id?.startsWith("retailer-")) {
    return observeRetailerWithBrowser(listing);
  }

  try {
    const response = await fetch(listing.url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "DealHunter/0.1 product availability monitor; contact configured by operator",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 403) {
      const resolution = await resolveChallenge({
        retailer: listing.retailer,
        listingId: listing.id,
        signal: "ACCESS_DENIED",
        detail: "Retailer returned HTTP 403.",
      });
      return {
        availability: "UNKNOWN",
        priceCents: null,
        confidence: 0,
        resultStatus: "CHALLENGE",
        source: "HTTP",
        evidenceType: "NONE",
        detail: `${resolution.detail} Handler: ${resolution.handlerId}.`,
      };
    }
    if (response.status === 429) {
      const resolution = await resolveChallenge({
        retailer: listing.retailer,
        listingId: listing.id,
        signal: "RATE_LIMITED",
        detail: "Retailer returned HTTP 429.",
      });
      return {
        availability: "UNKNOWN",
        priceCents: null,
        confidence: 0,
        resultStatus: "RATE_LIMITED",
        source: "HTTP",
        evidenceType: "NONE",
        detail: `${resolution.detail} Handler: ${resolution.handlerId}.`,
      };
    }
    if (!response.ok) {
      return {
        availability: "UNKNOWN",
        priceCents: null,
        confidence: 0,
        resultStatus: "NETWORK_ERROR",
        source: "HTTP",
        evidenceType: "NONE",
        detail: `Retailer returned HTTP ${response.status}.`,
      };
    }
    const html = await response.text();
    if (
      url.hostname === "pokemoncenter.com" ||
      url.hostname.endsWith(".pokemoncenter.com")
    ) {
      const challenge = detectPokemonCenterChallenge(html);
      if (challenge.challenged) {
        const resolution = await resolveChallenge({
          retailer: listing.retailer,
          listingId: listing.id,
          signal: "CAPTCHA",
          detail: `Detected signatures: ${challenge.signatures.join(", ")}.`,
        });
        return {
          availability: "UNKNOWN",
          priceCents: null,
          confidence: 0,
          resultStatus: "CHALLENGE",
          source: "HTTP",
          evidenceType: "NONE",
          detail: `Pokémon Center challenge detected (${challenge.signatures.join(", ")}). ${resolution.detail} Handler: ${resolution.handlerId}.`,
        };
      }
    }
    const parsed = parseJsonLd(html);
    if (
      url.hostname === "bestbuy.com" ||
      url.hostname.endsWith(".bestbuy.com")
    ) {
      const buttonState = parseBestBuyButtonState(html);
      if (buttonState) {
        return {
          availability: buttonState.availability,
          displayAvailabilityText: buttonState.displayText,
          priceCents: parsed?.priceCents ?? listing.current_price_cents,
          confidence: 0.99,
          resultStatus: "SUCCESS",
          source: "HTTP",
          evidenceType: "RETAILER_FULFILLMENT",
          detail: `Best Buy fulfillment button state: ${buttonState.state} (${buttonState.displayText}).`,
        };
      }
      if (parsed?.availability === "IN_STOCK") {
        return {
          availability: "UNKNOWN",
          priceCents: parsed.priceCents,
          confidence: 0.35,
          resultStatus: "PARSE_ERROR",
          source: "HTTP",
          evidenceType: "SEO_METADATA",
          detail:
            "Best Buy JSON-LD reported in stock, but no authoritative fulfillment button state was found.",
        };
      }
    }
    return (
      parsed ?? {
        availability: "UNKNOWN",
        priceCents: null,
        confidence: 0,
        resultStatus: "PARSE_ERROR",
        source: "HTTP",
        evidenceType: "NONE",
        detail: "No supported product offer metadata was found.",
      }
    );
  } catch (error) {
    return {
      availability: "UNKNOWN",
      priceCents: null,
      confidence: 0,
      resultStatus: "NETWORK_ERROR",
      source: "HTTP",
      evidenceType: "NONE",
      detail: error instanceof Error ? error.message : "Observation failed.",
    };
  }

}

function isAuthoritativePositive(observation: ListingObservation) {
  return (
    observation.evidenceType === "RETAILER_FULFILLMENT" ||
    observation.evidenceType === "PRIMARY_CONTROL" ||
    observation.evidenceType === "TEST_FIXTURE"
  );
}

async function confirmActionableObservation(
  listing: ListingRecord,
  observation: ListingObservation,
) {
  if (
    observation.resultStatus !== "SUCCESS" ||
    !isActionableAvailability(observation.availability)
  ) {
    return {
      initialObservation: observation,
      finalObservation: observation,
      freshlyConfirmedActionable: false,
    };
  }
  if (!isAuthoritativePositive(observation)) {
    return {
      initialObservation: observation,
      finalObservation: {
        ...observation,
        availability: "UNKNOWN" as const,
        confidence: 0,
        resultStatus: "PARSE_ERROR" as const,
        detail:
          "Actionable availability candidate rejected because its evidence was not authoritative.",
      },
      freshlyConfirmedActionable: false,
    };
  }

  if (observation.evidenceType !== "TEST_FIXTURE") {
    const confirmationDelayMs = 1_250 + Math.floor(Math.random() * 1_001);
    await new Promise((resolve) => setTimeout(resolve, confirmationDelayMs));
  }
  const confirmation = await acquireObservation(listing);
  if (
    confirmation.resultStatus === "SUCCESS" &&
    isActionableAvailability(confirmation.availability) &&
    isAuthoritativePositive(confirmation)
  ) {
    return {
      initialObservation: observation,
      finalObservation: {
        ...confirmation,
        confidence: Math.min(observation.confidence, confirmation.confidence),
        detail: `${confirmation.detail ?? "Authoritative availability evidence."} Actionable availability confirmed by a fresh second observation.`,
      },
      freshlyConfirmedActionable: true,
    };
  }
  if (
    confirmation.resultStatus === "SUCCESS" &&
    confirmation.availability !== "UNKNOWN"
  ) {
    return {
      initialObservation: observation,
      finalObservation: {
        ...confirmation,
        detail: `${confirmation.detail ?? ""} Initial actionable availability candidate was rejected by confirmation.`,
      },
      freshlyConfirmedActionable: false,
    };
  }
  return {
    initialObservation: observation,
    finalObservation: {
      ...confirmation,
      availability: "UNKNOWN" as const,
      confidence: 0,
      detail: `Initial actionable availability candidate was not accepted because confirmation failed: ${confirmation.detail ?? confirmation.resultStatus}.`,
    },
    freshlyConfirmedActionable: false,
  };
}

async function evaluateRules(
  listing: ListingRecord,
  observation: ListingObservation,
) {
  if (
    observation.resultStatus !== "SUCCESS" ||
    observation.availability === "UNKNOWN"
  ) {
    return;
  }
  const database = getDatabase();
  const rules = database
    .prepare(
      `SELECT * FROM rules
       WHERE project_id = ? AND enabled = 1`,
    )
    .all(listing.project_id) as Array<Record<string, string | number | null>>;

  for (const rule of rules) {
    const ruleId = String(rule.id);
    const requiredAvailability = String(rule.required_availability);
    const maxPrice =
      rule.max_price_cents === null ? null : Number(rule.max_price_cents);
    const matchesAvailability = matchesRuleAvailability(
      observation.availability,
      requiredAvailability,
    );
    const matchesPrice =
      maxPrice === null ||
      (observation.priceCents !== null &&
        observation.priceCents <= maxPrice);
    const matches = matchesAvailability && matchesPrice;
    const state = database
      .prepare(
        `SELECT last_match, consecutive_matches, transition_sequence,
          last_triggered_at
         FROM rule_listing_states
         WHERE rule_id = ? AND listing_id = ?`,
      )
      .get(ruleId, listing.id) as
      | {
          last_match: number;
          consecutive_matches: number;
          transition_sequence: number;
          last_triggered_at: string | null;
        }
      | undefined;
    const updatedAt = nowIso();

    if (!matches) {
      database
        .prepare(
          `INSERT INTO rule_listing_states
           (rule_id, listing_id, last_match, consecutive_matches,
            transition_sequence, last_triggered_at, updated_at)
           VALUES (?, ?, 0, 0, ?, ?, ?)
           ON CONFLICT(rule_id, listing_id) DO UPDATE SET
             last_match = 0,
             consecutive_matches = 0,
             updated_at = excluded.updated_at`,
        )
        .run(
          ruleId,
          listing.id,
          state?.transition_sequence ?? 0,
          state?.last_triggered_at ?? null,
          updatedAt,
        );
      continue;
    }

    if (state?.last_match === 1) {
      database
        .prepare(
          `UPDATE rule_listing_states
           SET consecutive_matches = consecutive_matches + 1,
               updated_at = ?
           WHERE rule_id = ? AND listing_id = ?`,
        )
        .run(updatedAt, ruleId, listing.id);
      continue;
    }

    const lastTriggered = state?.last_triggered_at
      ? Date.parse(state.last_triggered_at)
      : 0;
    const cooldownMs = Number(rule.cooldown_minutes) * 60_000;
    if (Date.now() - lastTriggered < cooldownMs) continue;

    const alertId = createId();
    const price =
      observation.priceCents === null
        ? "an unknown price"
        : `$${(observation.priceCents / 100).toFixed(2)}`;
    const availabilityText =
      observation.displayAvailabilityText ??
      defaultAvailabilityText(observation.availability);
    const title = `${listing.product_name} can be ordered now`;
    const message = `${listing.retailer} reports ${listing.title} at ${price}. Availability: ${availabilityText}. Rule: ${String(rule.name)}.`;
    const createdAt = nowIso();
    const transitionSequence = (state?.transition_sequence ?? 0) + 1;
    const transitionKey = `${ruleId}:${listing.id}:${transitionSequence}`;
    let alertInserted = false;

    database.exec("BEGIN IMMEDIATE");
    try {
      const alertResult = database
        .prepare(
          `INSERT OR IGNORE INTO alerts
           (id, project_id, listing_id, rule_id, type, title, message,
            severity, status, transition_key, created_at)
           VALUES (?, ?, ?, ?, 'DEAL', ?, ?, 'HIGH', 'OPEN', ?, ?)`,
        )
        .run(
          alertId,
          listing.project_id,
          listing.id,
          ruleId,
          title,
          message,
          transitionKey,
          createdAt,
        );
      alertInserted = alertResult.changes === 1;
      database
        .prepare(
          `INSERT INTO rule_listing_states
           (rule_id, listing_id, last_match, consecutive_matches,
            transition_sequence, last_triggered_at, updated_at)
           VALUES (?, ?, 1, 1, ?, ?, ?)
           ON CONFLICT(rule_id, listing_id) DO UPDATE SET
             last_match = 1,
             consecutive_matches = rule_listing_states.consecutive_matches + 1,
             transition_sequence = excluded.transition_sequence,
             last_triggered_at = excluded.last_triggered_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          ruleId,
          listing.id,
          transitionSequence,
          createdAt,
          createdAt,
        );
      database
        .prepare("UPDATE rules SET last_triggered_at = ? WHERE id = ?")
        .run(createdAt, ruleId);

      if (alertInserted && Number(rule.action_purchase) === 1) {
        const randomListing = listing.selection_mode === "RANDOM_VARIANT";
        const randomAllowed = Number(rule.allow_random_variant) === 1;
        if (!randomListing || randomAllowed) {
          const product = database
            .prepare(
              `SELECT target_quantity, owned_quantity
               FROM products WHERE id = ?`,
            )
            .get(listing.product_id) as {
            target_quantity: number;
            owned_quantity: number;
          };
          const reserved = database
            .prepare(
              `SELECT COALESCE(SUM(quantity), 0) AS quantity
               FROM purchase_intents
               WHERE product_id = ?
                 AND state NOT IN ('REJECTED', 'CANCELLED', 'FAILED_FINAL')`,
            )
            .get(listing.product_id) as { quantity: number };
          const remaining =
            product.target_quantity -
            product.owned_quantity -
            Number(reserved.quantity);
          const quantity = Math.min(Number(rule.quantity), remaining);
          if (quantity > 0) {
            database
              .prepare(
                `INSERT INTO purchase_intents
                 (id, project_id, product_id, listing_id, rule_id, state,
                  quantity, max_total_cents, observed_total_cents, retailer,
                  created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'AWAITING_APPROVAL', ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                createId(),
                listing.project_id,
                listing.product_id,
                listing.id,
                ruleId,
                quantity,
                maxPrice === null ? null : maxPrice * quantity,
                observation.priceCents === null
                  ? null
                  : observation.priceCents * quantity,
                listing.retailer,
                createdAt,
                createdAt,
              );
          }
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    if (!alertInserted) continue;
    const updatedListing = {
      ...listing,
      current_price_cents: observation.priceCents,
      current_availability: observation.availability,
    };
    await deliverAlertToDiscord(
      listing.project_id,
      alertId,
      buildDiscordPayload({ title, message, listing: updatedListing }),
    );
  }
}

export async function observeListing(listingId: string) {
  const database = getDatabase();
  const listing = database
    .prepare(
      `SELECT l.*, pr.project_id, pr.canonical_name AS product_name,
        p.default_schedule_mode AS project_default_schedule_mode,
        p.default_interval_seconds AS project_default_interval_seconds,
        p.default_interval_min_seconds AS project_default_interval_min_seconds,
        p.default_interval_max_seconds AS project_default_interval_max_seconds,
        COALESCE(rt.minimum_interval_seconds, 60) AS retailer_minimum_interval_seconds,
        mr.id AS active_recipe_id,
        mr.version AS active_recipe_version,
        mr.strategy AS active_recipe_strategy
       FROM listings l
       JOIN products pr ON pr.id = l.product_id
       JOIN projects p ON p.id = pr.project_id
       LEFT JOIN retailers rt ON rt.id = l.retailer_id
       LEFT JOIN listing_recipes lr ON lr.listing_id = l.id
       LEFT JOIN monitor_recipes mr ON mr.id = lr.active_recipe_id
       WHERE l.id = ?`,
    )
    .get(listingId) as ListingRecord | undefined;
  if (!listing) throw new Error("Listing not found.");

  const runId = createId();
  const startedAt = nowIso();
  const started = performance.now();
  database
    .prepare(
      `INSERT INTO monitoring_runs
       (id, listing_id, recipe_id, recipe_version, started_at, status, detail)
       VALUES (?, ?, ?, ?, ?, 'RUNNING', '')`,
    )
    .run(
      runId,
      listing.id,
      listing.active_recipe_id ?? null,
      listing.active_recipe_version ?? null,
      startedAt,
    );

  const initialObservation = await acquireObservation(listing);
  const confirmationGroupId =
    isActionableAvailability(initialObservation.availability)
      ? createId()
      : null;
  const confirmation = await confirmActionableObservation(
    listing,
    initialObservation,
  );
  const observation = confirmation.finalObservation;
  const observedAt = nowIso();
  const durationMs = Math.max(0, Math.round(performance.now() - started));
  const recentStatuses = database
    .prepare(
      `SELECT r.status
       FROM monitoring_runs r
       JOIN listings l ON l.id = r.listing_id
       WHERE l.retailer = ? AND r.id != ? AND r.status != 'RUNNING'
       ORDER BY r.started_at DESC
       LIMIT 50`,
    )
    .all(listing.retailer, runId) as Array<{ status: string }>;
  const schedule = calculateNextSchedule(
    listing,
    recentStatuses.map((row) => row.status),
    observation.resultStatus,
  );
  const nextRunAt = new Date(
    Date.now() + schedule.intervalSeconds * 1000,
  ).toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `INSERT INTO snapshots
         (id, listing_id, monitoring_run_id, observed_at, availability,
          availability_text, price_cents, confidence, result_status, source, evidence_type,
          confirmation_group_id, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        createId(),
        listing.id,
        runId,
        observedAt,
        observation.availability,
        observation.displayAvailabilityText ?? null,
        observation.priceCents,
        observation.confidence,
        observation.resultStatus,
        observation.source,
        observation.evidenceType ?? "NONE",
        confirmationGroupId,
        observation.detail ?? "",
      );
    database
      .prepare(
        `UPDATE listings
         SET current_availability = CASE
               WHEN ? = 'SUCCESS' AND ? != 'UNKNOWN' THEN ?
               ELSE current_availability
             END,
             current_price_cents = COALESCE(?, current_price_cents),
             current_availability_text = CASE
               WHEN ? = 'SUCCESS' AND ? != 'UNKNOWN'
                 THEN COALESCE(?, current_availability_text)
               ELSE current_availability_text
             END,
             confirmed_availability = CASE
               WHEN ? = 'SUCCESS' AND ? != 'UNKNOWN' THEN ?
               ELSE confirmed_availability
             END,
             confirmed_price_cents = CASE
               WHEN ? = 'SUCCESS' AND ? != 'UNKNOWN'
                 THEN COALESCE(?, confirmed_price_cents)
               ELSE confirmed_price_cents
             END,
             confirmed_availability_text = CASE
               WHEN ? = 'SUCCESS' AND ? != 'UNKNOWN'
                 THEN COALESCE(?, confirmed_availability_text)
               ELSE confirmed_availability_text
             END,
             confirmed_at = CASE
               WHEN ? = 'SUCCESS' AND ? != 'UNKNOWN' THEN ?
               ELSE confirmed_at
             END,
             last_attempt_status = ?, last_attempt_at = ?,
             last_observed_at = ?, next_run_at = ?,
             last_interval_seconds = ?, schedule_reason = ?,
             observation_count = observation_count + 1
         WHERE id = ?`,
      )
      .run(
        observation.resultStatus,
        observation.availability,
        observation.availability,
        observation.priceCents,
        observation.resultStatus,
        observation.availability,
        observation.displayAvailabilityText ?? null,
        observation.resultStatus,
        observation.availability,
        observation.availability,
        observation.resultStatus,
        observation.availability,
        observation.priceCents,
        observation.resultStatus,
        observation.availability,
        observation.displayAvailabilityText ?? null,
        observation.resultStatus,
        observation.availability,
        observedAt,
        observation.resultStatus,
        observedAt,
        observedAt,
        nextRunAt,
        schedule.intervalSeconds,
        schedule.reason,
        listing.id,
      );
    database
      .prepare(
        `UPDATE monitoring_runs
         SET finished_at = ?, duration_ms = ?, status = ?, source = ?,
             availability = ?, price_cents = ?, confidence = ?,
             availability_text = ?, evidence_type = ?,
             confirmation_group_id = ?, detail = ?
         WHERE id = ?`,
      )
      .run(
        observedAt,
        durationMs,
        observation.resultStatus,
        observation.source,
        observation.availability,
        observation.priceCents,
        observation.confidence,
        observation.displayAvailabilityText ?? null,
        observation.evidenceType ?? "NONE",
        confirmationGroupId,
        observation.detail ?? "",
        runId,
      );
    updateCartEligibility(
      database,
      listing,
      runId,
      confirmationGroupId,
      confirmation,
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  await evaluateRules(listing, observation);
  return observation;
}

export async function runProjectScan(projectId: string) {
  const listings = getDatabase()
    .prepare(
      `SELECT l.id
       FROM listings l
       JOIN products pr ON pr.id = l.product_id
       WHERE pr.project_id = ? AND l.status = 'ACTIVE'
       ORDER BY l.retailer, l.title`,
    )
    .all(projectId) as Array<{ id: string }>;
  for (const [index, listing] of listings.entries()) {
    await observeListing(listing.id);
    if (index < listings.length - 1) {
      await waitForScanPacing();
    }
  }
  return listings.length;
}

async function waitForScanPacing() {
  const pacingDelayMs = 250 + Math.floor(Math.random() * 501);
  await new Promise((resolve) => setTimeout(resolve, pacingDelayMs));
}

export async function runDueScans() {
  const listings = getDatabase()
    .prepare(
      `SELECT id FROM listings
       WHERE status = 'ACTIVE' AND next_run_at <= ?
       ORDER BY next_run_at
       LIMIT 100`,
    )
    .all(nowIso()) as Array<{ id: string }>;
  for (const [index, listing] of listings.entries()) {
    await observeListing(listing.id);
    if (index < listings.length - 1) {
      await waitForScanPacing();
    }
  }
  return listings.length;
}
