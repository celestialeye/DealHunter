import { createId, getDatabase, nowIso } from "@/lib/db";
import { captureLearningBundle } from "@/lib/learning/capture";
import {
  compileMonitorRecipe,
  validateCompiledRecipe,
} from "@/lib/learning/compiler";
import { getLearningProvider } from "@/lib/learning/provider";
import {
  monitorRecipeSchema,
  type LearningContext,
  type MonitorRecipe,
} from "@/lib/learning/types";

function nextRecipeVersion(listingId: string) {
  const result = getDatabase()
    .prepare(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version
       FROM monitor_recipes WHERE listing_id = ?`,
    )
    .get(listingId) as { version: number };
  return Number(result.version);
}

function activateRecipe(
  listingId: string,
  recipeId: string,
  version: number,
) {
  const database = getDatabase();
  const existing = database
    .prepare(
      "SELECT active_recipe_id FROM listing_recipes WHERE listing_id = ?",
    )
    .get(listingId) as { active_recipe_id: string | null } | undefined;
  const now = nowIso();
  database.exec("BEGIN IMMEDIATE");
  try {
    if (existing?.active_recipe_id) {
      database
        .prepare(
          "UPDATE monitor_recipes SET status = 'ROLLBACK' WHERE id = ?",
        )
        .run(existing.active_recipe_id);
    }
    database
      .prepare(
        `UPDATE monitor_recipes
         SET status = 'ACTIVE', activated_at = ?
         WHERE id = ?`,
      )
      .run(now, recipeId);
    database
      .prepare(
        `INSERT INTO listing_recipes
         (listing_id, active_recipe_id, shadow_recipe_id, rollback_recipe_id, updated_at)
         VALUES (?, ?, NULL, ?, ?)
         ON CONFLICT(listing_id) DO UPDATE SET
           rollback_recipe_id = listing_recipes.active_recipe_id,
           active_recipe_id = excluded.active_recipe_id,
           shadow_recipe_id = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(listingId, recipeId, existing?.active_recipe_id ?? null, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return version;
}

function storeRetailerKnowledge(input: {
  retailerId: string | null;
  learningRunId: string;
  recipe: MonitorRecipe;
}) {
  if (!input.retailerId) return;
  const database = getDatabase();
  const version = database
    .prepare(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version
       FROM retailer_knowledge
       WHERE retailer_id = ? AND page_archetype = ?`,
    )
    .get(input.retailerId, input.recipe.pageArchetype) as { version: number };
  const now = nowIso();
  database
    .prepare(
      `INSERT INTO retailer_knowledge
       (id, retailer_id, page_archetype, version, status, knowledge_json,
        source_learning_run_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
    )
    .run(
      createId(),
      input.retailerId,
      input.recipe.pageArchetype,
      Number(version.version),
      JSON.stringify({
        strategy: input.recipe.strategy,
        acquisition: input.recipe.acquisition,
        selectors: input.recipe.selectors,
        availability: input.recipe.availability,
        challenge: input.recipe.challenge,
        excludedRegions: input.recipe.excludedRegions,
      }),
      input.learningRunId,
      now,
      now,
    );
}

export async function learnListingRecipe(
  listingId: string,
  triggerType: "INITIAL" | "USER_RELEARN" | "DRIFT_RELEARN",
) {
  const database = getDatabase();
  const listing = database
    .prepare(
      `SELECT l.id, l.url, l.title, l.retailer, l.retailer_id, l.retailer_sku,
        pr.canonical_name
       FROM listings l
       JOIN products pr ON pr.id = l.product_id
       WHERE l.id = ?`,
    )
    .get(listingId) as
    | {
        id: string;
        url: string;
        title: string;
        retailer: string;
        retailer_id: string | null;
        retailer_sku: string | null;
        canonical_name: string;
      }
    | undefined;
  if (!listing) throw new Error("Listing not found for learning.");

  const provider = getLearningProvider();
  const learningRunId = createId();
  const startedAt = nowIso();
  const model = `${provider.domModel} + ${provider.visualModel}`;
  database
    .prepare(
      `INSERT INTO learning_runs
       (id, listing_id, trigger_type, status, provider, model, started_at)
       VALUES (?, ?, ?, 'CAPTURING', ?, ?, ?)`,
    )
    .run(
      learningRunId,
      listingId,
      triggerType,
      provider.id,
      model,
      startedAt,
    );

  const context: LearningContext = {
    listingId,
    retailer: listing.retailer,
    expectedTitle: listing.canonical_name || listing.title,
    expectedSku: listing.retailer_sku,
    productUrl: listing.url,
  };

  try {
    const bundle = await captureLearningBundle(context, learningRunId);
    database
      .prepare(
        `UPDATE learning_runs
         SET status = 'ANALYZING', final_url = ?, artifact_directory = ?,
             screening_engine = ?
         WHERE id = ?`,
      )
      .run(
        bundle.finalUrl,
        bundle.artifactDirectory,
        bundle.screeningEngine,
        learningRunId,
      );

    const [dom, visual] = await Promise.all([
      provider.analyzeDom(context, bundle),
      provider.analyzeScreenshot(context, bundle),
    ]);
    const recipe = compileMonitorRecipe({
      context,
      bundle,
      dom,
      visual,
      provider: provider.id,
      model,
      learningRunId,
    });
    const tests = validateCompiledRecipe({
      context,
      bundle,
      dom,
      visual,
      recipe,
    });
    const recipeId = createId();
    const version = nextRecipeVersion(listingId);
    const createdAt = nowIso();
    const testsPassed = tests.every((test) => test.status === "PASSED");

    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(
          `INSERT INTO monitor_recipes
           (id, retailer_id, listing_id, version, status, strategy, recipe_json,
            source_learning_run_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          recipeId,
          listing.retailer_id,
          listingId,
          version,
          testsPassed ? "SHADOW_VALIDATED" : "REJECTED",
          recipe.strategy,
          JSON.stringify(recipe),
          learningRunId,
          createdAt,
        );
      const insertTest = database.prepare(
        `INSERT INTO recipe_tests
         (id, recipe_id, name, status, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const test of tests) {
        insertTest.run(
          createId(),
          recipeId,
          test.name,
          test.status,
          test.detail,
          createdAt,
        );
      }
      database
        .prepare(
          `UPDATE learning_runs
           SET status = ?, page_state = ?, dom_hypothesis_json = ?,
               visual_hypothesis_json = ?, completed_at = ?
           WHERE id = ?`,
        )
        .run(
          testsPassed ? "VALIDATED" : "FAILED_VALIDATION",
          dom.pageState === visual.pageState
            ? dom.pageState
            : "CONFLICTED",
          JSON.stringify(dom),
          JSON.stringify(visual),
          createdAt,
          learningRunId,
        );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    if (testsPassed) {
      activateRecipe(listingId, recipeId, version);
      storeRetailerKnowledge({
        retailerId: listing.retailer_id,
        learningRunId,
        recipe,
      });
    }
    return { learningRunId, recipeId, version, recipe, tests, testsPassed };
  } catch (error) {
    database
      .prepare(
        `UPDATE learning_runs
         SET status = 'FAILED', error_message = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(
        error instanceof Error ? error.message : "Learning failed.",
        nowIso(),
        learningRunId,
      );
    throw error;
  }
}

export function reuseActiveRetailerRecipe(
  sourceListingId: string,
  targetListingId: string,
) {
  const database = getDatabase();
  const source = database
    .prepare(
      `SELECT mr.*
       FROM listing_recipes lr
       JOIN monitor_recipes mr ON mr.id = lr.active_recipe_id
       WHERE lr.listing_id = ?`,
    )
    .get(sourceListingId) as
    | {
        id: string;
        retailer_id: string | null;
        recipe_json: string;
        source_learning_run_id: string;
      }
    | undefined;
  const target = database
    .prepare(
      `SELECT l.title, l.retailer_sku, l.url, pr.canonical_name
       FROM listings l JOIN products pr ON pr.id = l.product_id
       WHERE l.id = ?`,
    )
    .get(targetListingId) as
    | {
        title: string;
        retailer_sku: string | null;
        url: string;
        canonical_name: string;
      }
    | undefined;
  if (!source || !target) throw new Error("Recipe reuse source is missing.");

  const recipe = monitorRecipeSchema.parse(JSON.parse(source.recipe_json));
  recipe.identity.expectedHost = new URL(target.url).hostname;
  recipe.identity.expectedTitle = target.canonical_name || target.title;
  recipe.identity.expectedSku = target.retailer_sku;
  const recipeId = createId();
  const version = nextRecipeVersion(targetListingId);
  const createdAt = nowIso();
  const existing = database
    .prepare(
      "SELECT active_recipe_id FROM listing_recipes WHERE listing_id = ?",
    )
    .get(targetListingId) as { active_recipe_id: string | null } | undefined;
  database.exec("BEGIN IMMEDIATE");
  try {
    if (existing?.active_recipe_id) {
      database
        .prepare(
          "UPDATE monitor_recipes SET status = 'ROLLBACK' WHERE id = ?",
        )
        .run(existing.active_recipe_id);
    }
    database
      .prepare(
        `INSERT INTO monitor_recipes
         (id, retailer_id, listing_id, version, status, strategy, recipe_json,
          source_learning_run_id, created_at, activated_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      )
      .run(
        recipeId,
        source.retailer_id,
        targetListingId,
        version,
        recipe.strategy,
        JSON.stringify(recipe),
        source.source_learning_run_id,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO recipe_tests
         (id, recipe_id, name, status, detail, created_at)
         VALUES (?, ?, 'retailer-knowledge-reuse', 'PASSED', ?, ?)`,
      )
      .run(
        createId(),
        recipeId,
        `Reused validated ${recipe.strategy} retailer recipe with target identity rebound.`,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO listing_recipes
         (listing_id, active_recipe_id, shadow_recipe_id, rollback_recipe_id, updated_at)
         VALUES (?, ?, NULL, NULL, ?)
         ON CONFLICT(listing_id) DO UPDATE SET
           rollback_recipe_id = listing_recipes.active_recipe_id,
           active_recipe_id = excluded.active_recipe_id,
           updated_at = excluded.updated_at`,
      )
      .run(targetListingId, recipeId, createdAt);
    database
      .prepare(
        `UPDATE monitor_recipes
         SET status = 'ROLLBACK'
         WHERE status = 'ACTIVE'
           AND id NOT IN (
             SELECT active_recipe_id
             FROM listing_recipes
             WHERE active_recipe_id IS NOT NULL
           )`,
      )
      .run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return recipeId;
}
