import type { DatabaseSync } from "node:sqlite";

interface SeedProduct {
  key: string;
  name: string;
  variant?: string;
  target: number;
  expected: number;
  notes?: string;
}

interface SeedListing {
  product: string;
  retailer: string;
  title: string;
  url: string;
  availability: string;
  price: number;
  mode?: string;
}

const products: SeedProduct[] = [
  { key: "pc-etb", name: "Pokémon Center Elite Trainer Box", target: 2, expected: 5999, notes: "Pokémon Center exclusive edition." },
  { key: "etb", name: "Elite Trainer Box", target: 1, expected: 4999 },
  { key: "poster", name: "Poster Collection", target: 1, expected: 1499 },
  { key: "sylveon", name: "Sylveon ex Box", target: 1, expected: 2199 },
  { key: "greninja", name: "Greninja ex Box", target: 1, expected: 2199 },
  { key: "random-ex", name: "Sylveon / Greninja ex Box", variant: "Styles may vary", target: 0, expected: 2199 },
  { key: "knockout", name: "Knock Out Collection", target: 1, expected: 999 },
  { key: "sticker-alolan", name: "Tech Sticker Collection", variant: "Alolan Exeggutor", target: 1, expected: 1499 },
  { key: "sticker-lucario", name: "Tech Sticker Collection", variant: "Lucario", target: 1, expected: 1499 },
  { key: "sticker-random", name: "Tech Sticker Collection", variant: "Styles may vary", target: 0, expected: 1499 },
  { key: "booster", name: "Booster Bundle", variant: "Six packs", target: 3, expected: 2694 },
  { key: "tins-10", name: "Mini Tins", variant: "Complete ten-pack", target: 1, expected: 9990 },
  { key: "tin-random", name: "Mini Tin", variant: "One random tin", target: 0, expected: 999 },
  { key: "binder", name: "Binder Collection", target: 1, expected: 3199 },
  { key: "battle", name: "Battle Deck", variant: "Espeon ex or Umbreon ex", target: 1, expected: 1999 },
  { key: "ditto", name: "Ditto Premium Collection", target: 1, expected: 3999 },
  { key: "figure", name: "Mew / Mewtwo Figure Collection", variant: "Styles may vary", target: 1, expected: 2999 },
  { key: "upc", name: "Day / Night Ultra Premium Collection", variant: "Styles may vary", target: 1, expected: 17999 },
];

const listings: SeedListing[] = [
  { product: "pc-etb", retailer: "Pokémon Center", title: "Pokémon Center Elite Trainer Box", url: "https://www.pokemoncenter.com/product/10-10447-111/pokemon-tcg-30th-celebration-pokemon-center-elite-trainer-box", availability: "UNAVAILABLE", price: 5999 },
  { product: "sticker-alolan", retailer: "Pokémon Center", title: "Tech Sticker — Alolan Exeggutor", url: "https://www.pokemoncenter.com/product/10-10449-121/pokemon-tcg-30th-celebration-tech-sticker-collection-alolan-exeggutor", availability: "UNAVAILABLE", price: 1499 },
  { product: "sticker-lucario", retailer: "Pokémon Center", title: "Tech Sticker — Lucario", url: "https://www.pokemoncenter.com/product/10-10449-122/pokemon-tcg-30th-celebration-tech-sticker-collection-lucario", availability: "UNAVAILABLE", price: 1499 },
  { product: "knockout", retailer: "Pokémon Center", title: "Knock Out Collection", url: "https://www.pokemoncenter.com/product/10-10667-101/pokemon-tcg-30th-celebration-knock-out-collection", availability: "UNAVAILABLE", price: 999 },
  { product: "booster", retailer: "Pokémon Center", title: "Booster Bundle — six packs", url: "https://www.pokemoncenter.com/product/10-10451-115/pokemon-tcg-30th-celebration-booster-bundle-6-packs", availability: "UNAVAILABLE", price: 2694 },
  { product: "tins-10", retailer: "Pokémon Center", title: "Mini Tins — complete ten-pack", url: "https://www.pokemoncenter.com/product/10-10465-176/pokemon-tcg-30th-celebration-mini-tins-10-pack", availability: "UNAVAILABLE", price: 9990 },
  { product: "etb", retailer: "Best Buy", title: "Elite Trainer Box", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-elite-trainer-box/JJG2TL8XCJ", availability: "COMING_SOON", price: 4999 },
  { product: "poster", retailer: "Best Buy", title: "Poster Collection", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-poster-collection/JJG2TL8X2X", availability: "COMING_SOON", price: 1499 },
  { product: "random-ex", retailer: "Best Buy", title: "Sylveon / Greninja ex Box", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-sylveon-ex-box-or-greninja-ex-box-1-ex-box-per-order-styles-may-vary/JJG2TL82VJ", availability: "COMING_SOON", price: 2199, mode: "RANDOM_VARIANT" },
  { product: "knockout", retailer: "Best Buy", title: "Knock Out Collection", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-knock-out-collection/JJG2TL3WZ5", availability: "COMING_SOON", price: 999 },
  { product: "sticker-random", retailer: "Best Buy", title: "Tech Sticker Collection", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-tech-sticker-collection-1-tech-sticker-collection-per-order-styles-may-vary/JJG2TL8X74/sku/6685574", availability: "COMING_SOON", price: 1499, mode: "RANDOM_VARIANT" },
  { product: "booster", retailer: "Best Buy", title: "Booster Bundle", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-booster-bundle/JJG2TL8X2V", availability: "COMING_SOON", price: 2694 },
  { product: "tin-random", retailer: "Best Buy", title: "Mini Tin", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-mini-tin-1-mini-tin-per-order-styles-may-vary/JJG2TL8X6V", availability: "COMING_SOON", price: 999, mode: "RANDOM_VARIANT" },
  { product: "binder", retailer: "Best Buy", title: "Binder Collection", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-binder-collection/JJG2TL8245/sku/6685568", availability: "COMING_SOON", price: 3199 },
  { product: "battle", retailer: "Best Buy", title: "Battle Deck", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-battle-deck-espeon-ex-or-umbreon-ex-1-battle-deck-per-order-styles-may-vary/JJG2TL3PQZ/sku/6685570", availability: "COMING_SOON", price: 1999, mode: "RANDOM_VARIANT" },
  { product: "ditto", retailer: "Best Buy", title: "Ditto Premium Collection", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-ditto-premium-collection/JJG2TL82YW", availability: "COMING_SOON", price: 3999 },
  { product: "figure", retailer: "Best Buy", title: "Mew / Mewtwo Figure Collection", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-figure-collection-mew-or-mewto-1-figure-collection-per-order-styles-may-vary/JJG2TL8XX8", availability: "COMING_SOON", price: 2999, mode: "RANDOM_VARIANT" },
  { product: "upc", retailer: "Best Buy", title: "Day / Night UPC", url: "https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-ultra-premium-collection-day-or-night-1-ultra-premium-collection-per-order-styles-may-vary/JJG2TL8254", availability: "COMING_SOON", price: 17999, mode: "RANDOM_VARIANT" },
  { product: "etb", retailer: "Target", title: "Elite Trainer Box", url: "https://www.target.com/p/pok-233-mon-trading-card-game-30th-celebration-elite-trainer-box/-/A-1010892076", availability: "OUT_OF_STOCK", price: 6999 },
  { product: "poster", retailer: "Target", title: "Poster Collection", url: "https://www.target.com/p/pok-233-mon-trading-card-game-30th-celebration-poster-collection/-/A-1010892067", availability: "OUT_OF_STOCK", price: 1999 },
  { product: "sylveon", retailer: "Target", title: "Sylveon ex Box", url: "https://www.target.com/p/pok-233-mon-trading-card-game-30th-celebration-sylveon-ex-box/-/A-1010892068", availability: "OUT_OF_STOCK", price: 2999 },
  { product: "greninja", retailer: "Target", title: "Greninja ex Box", url: "https://www.target.com/p/pok-233-mon-tading-card-game-30th-celebration-greninja-ex-box/-/A-1010892065", availability: "OUT_OF_STOCK", price: 2999 },
  { product: "knockout", retailer: "Target", title: "Knock Out Collection", url: "https://www.target.com/p/pok-233-mon-trading-card-game-30th-celebration-knock-out-collection/-/A-1010892070", availability: "OUT_OF_STOCK", price: 1199 },
  { product: "sticker-random", retailer: "Target", title: "Tech Sticker Collection", url: "https://www.target.com/p/pok-233-mon-trading-card-game-30th-celebration-tech-sticker-collection-lucario-or-alolan-exeggutor-styles-may-vary/-/A-1010892078", availability: "OUT_OF_STOCK", price: 1999, mode: "RANDOM_VARIANT" },
];

function availabilityText(value: string) {
  const labels: Record<string, string> = {
    UNAVAILABLE: "Unavailable",
    OUT_OF_STOCK: "Out of Stock",
    COMING_SOON: "Coming Soon",
    IN_STOCK: "In Stock",
    PREORDER: "Preorder",
  };
  return labels[value] ?? value;
}

export function seedPokemonProject(database: DatabaseSync) {
  const now = new Date().toISOString();
  const projectId = "pokemon-30th-celebration";
  database
    .prepare(
      `INSERT INTO projects
       (id, name, description, status, budget_cents, currency, created_at, updated_at)
       VALUES (?, ?, ?, 'ACTIVE', ?, 'USD', ?, ?)`,
    )
    .run(
      projectId,
      "Pokémon 30th Celebration TCG",
      "Monitor exact and assortment listings across Pokémon Center, Best Buy, and Target.",
      75000,
      now,
      now,
    );

  const productIds = new Map<string, string>();
  const insertProduct = database.prepare(
    `INSERT INTO products
     (id, project_id, canonical_name, variant, target_quantity, expected_price_cents, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const product of products) {
    const id = `pokemon-${product.key}`;
    productIds.set(product.key, id);
    insertProduct.run(
      id,
      projectId,
      product.name,
      product.variant ?? "",
      product.target,
      product.expected,
      product.notes ?? "",
      now,
    );
  }

  const insertListing = database.prepare(
    `INSERT INTO listings
     (id, product_id, retailer, title, url, normalized_url, current_price_cents,
      current_availability, current_availability_text, selection_mode,
      schedule_mode, interval_seconds, next_run_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INHERIT', 60, ?, ?)`,
  );
  listings.forEach((listing, index) => {
    const productId = productIds.get(listing.product);
    if (!productId) {
      throw new Error(`Missing seed product ${listing.product}.`);
    }
    insertListing.run(
      `pokemon-listing-${index + 1}`,
      productId,
      listing.retailer,
      listing.title,
      listing.url,
      listing.url.toLowerCase().replace(/\/$/, ""),
      listing.price,
      listing.availability,
      availabilityText(listing.availability),
      listing.mode ?? "EXACT",
      now,
      now,
    );
  });

  database
    .prepare(
      `INSERT INTO rules
       (id, project_id, name, max_price_cents, required_availability,
        action_alert, action_purchase, cooldown_minutes, created_at)
       VALUES (?, ?, ?, NULL, 'IN_STOCK', 1, 0, 0, ?)`,
    )
    .run(
      "pokemon-msrp-alert",
      projectId,
      "Alert as soon as a product becomes available",
      now,
    );
}

export function repairSeedSimulationArtifacts(database: DatabaseSync) {
  const repair = database.prepare(
    `UPDATE listings
     SET current_price_cents = ?, current_availability = ?
     WHERE normalized_url = ?
       AND current_price_cents = 0
       AND EXISTS (
         SELECT 1
         FROM snapshots
         WHERE snapshots.listing_id = listings.id
           AND snapshots.source = 'SIMULATION'
           AND snapshots.price_cents = 0
       )`,
  );
  for (const listing of listings) {
    repair.run(
      listing.price,
      listing.availability,
      listing.url.toLowerCase().replace(/\/$/, ""),
    );
  }
  database
    .prepare(
      `UPDATE rules
       SET name = ?, max_price_cents = NULL
       WHERE id = 'pokemon-msrp-alert'`,
    )
    .run("Alert as soon as a product becomes available");
  database
    .prepare(
      `UPDATE rules
       SET action_purchase = 0,
           allow_random_variant = 0,
           quantity = 1,
           cooldown_minutes = 0
       WHERE project_id = 'pokemon-30th-celebration'`,
    )
    .run();
  const repairProductName = database.prepare(
    `UPDATE products
     SET canonical_name = ?, metadata_status = 'FAILED',
         metadata_error = 'Retailer challenge page was rejected as product metadata.'
     WHERE id = ? AND lower(canonical_name) IN (
       'pardon our interruption',
       'access denied',
       'verify you are human'
     )`,
  );
  for (const product of products) {
    repairProductName.run(product.name, `pokemon-${product.key}`);
  }
  database
    .prepare(
      `UPDATE products
       SET canonical_name = 'Elite Trainer Box'
       WHERE id = 'pokemon-etb'
         AND canonical_name LIKE 'Pokémon - Trading Card Game:%'`,
    )
    .run();
  database
    .prepare(
      `UPDATE listings
       SET availability_hint = 'UNAVAILABLE',
           availability_hint_text = 'Unavailable',
           availability_hint_source = 'OFFICIAL_PAGE_SEARCH_INDEX',
           availability_hint_observed_at = ?
       WHERE retailer = 'Pokémon Center'
         AND id IN (
           'pokemon-listing-1',
           'pokemon-listing-2',
           'pokemon-listing-3',
           'pokemon-listing-4',
           'pokemon-listing-5',
           'pokemon-listing-6'
         )`,
    )
    .run(new Date().toISOString());
  const restoreUnavailable = database.prepare(
    `UPDATE listings
     SET current_availability = 'UNAVAILABLE',
         current_availability_text = 'Unavailable',
         current_price_cents = ?
     WHERE normalized_url = ?
       AND retailer = 'Pokémon Center'
       AND current_availability = 'UNKNOWN'
       AND availability_hint = 'UNAVAILABLE'
       AND last_attempt_status = 'CHALLENGE'`,
  );
  for (const listing of listings.filter(
    (entry) => entry.retailer === "Pokémon Center",
  )) {
    restoreUnavailable.run(
      listing.price,
      listing.url.toLowerCase().replace(/\/$/, ""),
    );
  }
}
