import { describe, expect, it } from "vitest";

import { buildDiscordPayload } from "../../src/lib/notifications";

describe("buildDiscordPayload", () => {
  it("creates a product-rich Discord embed", () => {
    const payload = buildDiscordPayload({
      title: "Booster Bundle is available",
      message: "Mock Shop reports the listing at $14.99.",
      listing: {
        id: "listing-1",
        project_id: "project-1",
        product_id: "product-1",
        product_name: "Booster Bundle",
        retailer_id: null,
        retailer: "Mock Shop",
        title: "Six pack bundle",
        url: "https://mock.dealhunter.local/deal?price=14.99",
        current_price_cents: 1499,
        current_availability: "IN_STOCK",
        current_availability_text: "In Stock",
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
      },
    });

    expect(payload.embeds[0].title).toBe("Booster Bundle is available");
    expect(payload.embeds[0].url).toContain("mock.dealhunter.local");
    expect(payload.embeds[0].fields).toContainEqual({
      name: "Price",
      value: "$14.99",
      inline: true,
    });
  });
});
