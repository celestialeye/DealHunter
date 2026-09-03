import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  cartProductKey,
  isEligibleCartConfirmation,
  nextCartEpisode,
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
        "retailer-sams-club",
        "https://www.samsclub.com/ip/example/prod12345678",
      ),
    ).toBe("prod12345678");
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
