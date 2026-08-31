import { describe, expect, it } from "vitest";

import {
  calculateNextSchedule,
  detectPokemonCenterChallenge,
  parseBestBuyButtonState,
  parseTargetProductSection,
  simulatedObservation,
} from "../../src/lib/monitoring";
import type { ListingRecord } from "../../src/lib/types";

function listing(overrides: Partial<ListingRecord> = {}): ListingRecord {
  return {
    id: "listing-1",
    project_id: "project-1",
    product_id: "product-1",
    product_name: "Pokémon Center Elite Trainer Box",
    retailer: "Pokémon Center",
    title: "Pokémon Center Elite Trainer Box",
    url: "https://www.pokemoncenter.com/product/10-10447-111/example",
    current_price_cents: 5999,
    current_availability: "OUT_OF_STOCK",
    current_availability_text: "Out of Stock",
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
    ...overrides,
  };
}

describe("simulatedObservation", () => {
  it("preserves the known retailer availability and price", () => {
    const observation = simulatedObservation(listing());

    expect(observation.availability).toBe("OUT_OF_STOCK");
    expect(observation.priceCents).toBe(5999);
  });

  describe("calculateNextSchedule", () => {
    it("honors a user-selected fixed interval", () => {
      const schedule = calculateNextSchedule(
        {
          schedule_mode: "FIXED",
          interval_seconds: 180,
          interval_min_seconds: 60,
          interval_max_seconds: 120,
          project_default_schedule_mode: "SYSTEM",
          project_default_interval_seconds: 60,
          project_default_interval_min_seconds: 60,
          project_default_interval_max_seconds: 120,
          retailer_minimum_interval_seconds: 60,
        },
        [],
        "SUCCESS",
      );

      expect(schedule.intervalSeconds).toBe(180);
    });

    it("selects a value inside the user bounded range", () => {
      const schedule = calculateNextSchedule(
        {
          schedule_mode: "BOUNDED",
          interval_seconds: 60,
          interval_min_seconds: 120,
          interval_max_seconds: 240,
          project_default_schedule_mode: "SYSTEM",
          project_default_interval_seconds: 60,
          project_default_interval_min_seconds: 60,
          project_default_interval_max_seconds: 120,
          retailer_minimum_interval_seconds: 60,
        },
        [],
        "SUCCESS",
        () => 0.5,
      );

      expect(schedule.intervalSeconds).toBe(180);
    });

    it("backs off system scheduling after challenge history", () => {
      const schedule = calculateNextSchedule(
        {
          schedule_mode: "SYSTEM",
          interval_seconds: 60,
          interval_min_seconds: 60,
          interval_max_seconds: 120,
          project_default_schedule_mode: "SYSTEM",
          project_default_interval_seconds: 60,
          project_default_interval_min_seconds: 60,
          project_default_interval_max_seconds: 120,
          retailer_minimum_interval_seconds: 60,
        },
        ["CHALLENGE", "RATE_LIMITED", "SUCCESS"],
        "CHALLENGE",
        () => 0.5,
      );

      expect(schedule.intervalSeconds).toBe(900);
    });

    it("inherits the project schedule without violating the retailer floor", () => {
      const schedule = calculateNextSchedule(
        {
          schedule_mode: "INHERIT",
          interval_seconds: 60,
          interval_min_seconds: 60,
          interval_max_seconds: 120,
          project_default_schedule_mode: "FIXED",
          project_default_interval_seconds: 60,
          project_default_interval_min_seconds: 60,
          project_default_interval_max_seconds: 120,
          retailer_minimum_interval_seconds: 180,
        },
        [],
        "SUCCESS",
      );

      expect(schedule.intervalSeconds).toBe(180);
      expect(schedule.reason).toContain("Inherited project policy");
    });
  });

  describe("detectPokemonCenterChallenge", () => {
    it("recognizes a successful HTTP challenge shell", () => {
      const html = `
        <html>
          <head><title>Pardon Our Interruption</title></head>
          <body>
            <iframe src="/_Incapsula_Resource"></iframe>
            <script src="https://hcaptcha.com/1/api.js"></script>
          </body>
        </html>
      `;

      expect(detectPokemonCenterChallenge(html).challenged).toBe(true);
    });
  });

  it("uses explicit mock deal state and price", () => {
    const observation = simulatedObservation(
      listing({
        url: "https://mock.dealhunter.local/deal?price=14.99",
        current_price_cents: 1999,
      }),
    );

    expect(observation.availability).toBe("IN_STOCK");
    expect(observation.priceCents).toBe(1499);
  });
});

describe("parseBestBuyButtonState", () => {
  it("prefers the fulfillment button over conflicting JSON-LD", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Product","offers":{"availability":"https://schema.org/InStock"}}
      </script>
      <script>
        {"fulfillmentOptions":{"buttonStates":[{"buttonState":"COMING_SOON","condition":"NEW","displayText":"Coming Soon"}]}}
      </script>
    `;

    expect(parseBestBuyButtonState(html)).toEqual({
      availability: "COMING_SOON",
      state: "COMING_SOON",
      displayText: "Coming Soon",
    });
  });
});

describe("parseTargetProductSection", () => {
  it("does not treat a disabled add-to-cart label as in stock", () => {
    const section = `
      Pokémon Trading Card Game: 30th Celebration Elite Trainer Box
      New at $69.99
      Out of stock
      Add to cart
      Final sale item
    `;

    expect(parseTargetProductSection(section, null)).toEqual({
      availability: "OUT_OF_STOCK",
      priceCents: 6999,
      displayAvailabilityText: "Out of stock",
    });
  });

  it("requires the primary add-to-cart button to be enabled", () => {
    const section = `
      Pokémon Trading Card Game Product
      $19.99
      Add to cart
    `;

    expect(parseTargetProductSection(section, null, false, true)).toEqual({
      availability: "OUT_OF_STOCK",
      priceCents: 1999,
      displayAvailabilityText: null,
    });
    expect(parseTargetProductSection(section, null, false, false)).toEqual({
      availability: "UNKNOWN",
      priceCents: 1999,
      displayAvailabilityText: null,
    });
    expect(parseTargetProductSection(section, null, true, true)).toEqual({
      availability: "IN_STOCK",
      priceCents: 1999,
      displayAvailabilityText: "Add to cart",
    });
  });
});
