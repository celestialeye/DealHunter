import { getDatabase } from "../src/lib/db";
import {
  learnListingRecipe,
  reuseActiveRetailerRecipe,
} from "../src/lib/learning/service";

async function main() {
  const projectId = process.argv[2] ?? "pokemon-30th-celebration";
  const force = process.argv.includes("--force");
  const database = getDatabase();
  const listings = database
    .prepare(
      `SELECT l.id, l.retailer,
        EXISTS(
          SELECT 1 FROM listing_recipes lr
          WHERE lr.listing_id = l.id AND lr.active_recipe_id IS NOT NULL
        ) AS has_recipe
       FROM listings l
       JOIN products p ON p.id = l.product_id
       WHERE p.project_id = ?
       ORDER BY l.retailer, l.created_at`,
    )
    .all(projectId) as Array<{
    id: string;
    retailer: string;
    has_recipe: number;
  }>;
  const retailers = [...new Set(listings.map((listing) => listing.retailer))];

  for (const retailer of retailers) {
    const retailerListings = listings.filter(
      (listing) => listing.retailer === retailer,
    );
    const existingRepresentative = retailerListings.find(
      (listing) => listing.has_recipe,
    );
    const representative =
      !force && existingRepresentative
        ? existingRepresentative
        : retailerListings[0];
    if (!representative) continue;

    if (!existingRepresentative || force) {
      console.log(`Learning ${retailer} from ${representative.id}...`);
      const learned = await learnListingRecipe(
        representative.id,
        force ? "USER_RELEARN" : "INITIAL",
      );
      console.log(
        `${retailer}: recipe v${learned.version} ${learned.testsPassed ? "validated" : "rejected"} (${learned.recipe.strategy})`,
      );
      if (!learned.testsPassed) continue;
    } else {
      console.log(
        `${retailer}: reusing active recipe from ${representative.id}`,
      );
    }

    for (const listing of retailerListings) {
      if (listing.id === representative.id) continue;
      const active = database
        .prepare(
          `SELECT active_recipe_id FROM listing_recipes WHERE listing_id = ?`,
        )
        .get(listing.id) as { active_recipe_id: string | null } | undefined;
      if (active?.active_recipe_id && !force) continue;
      reuseActiveRetailerRecipe(representative.id, listing.id);
      console.log(`  reused retailer knowledge for ${listing.id}`);
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
