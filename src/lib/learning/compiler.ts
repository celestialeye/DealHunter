import {
  monitorRecipeSchema,
  type LearningBundle,
  type LearningContext,
  type LearningHypothesis,
  type MonitorRecipe,
} from "@/lib/learning/types";

export interface RecipeTestResult {
  name: string;
  status: "PASSED" | "FAILED";
  detail: string;
}

function strategiesAgree(
  dom: LearningHypothesis,
  visual: LearningHypothesis,
) {
  return (
    dom.recommendedStrategy === visual.recommendedStrategy ||
    dom.pageState === "CHALLENGE" ||
    visual.pageState === "CHALLENGE"
  );
}

export function compileMonitorRecipe(input: {
  context: LearningContext;
  bundle: LearningBundle;
  dom: LearningHypothesis;
  visual: LearningHypothesis;
  provider: string;
  model: string;
  learningRunId: string;
}): MonitorRecipe {
  const { context, bundle, dom, visual } = input;
  const host = new URL(context.productUrl).hostname;
  const hasBestBuyFulfillment =
    host.endsWith("bestbuy.com") &&
    bundle.httpSource.includes('"fulfillmentOptions"') &&
    bundle.httpSource.includes('"buttonStates"');
  const challenged =
    !hasBestBuyFulfillment &&
    (dom.pageState === "CHALLENGE" ||
      visual.pageState === "CHALLENGE" ||
      bundle.challengeSignatures.length > 0);
  let strategy = challenged
    ? ("CHALLENGE_ONLY" as const)
    : dom.recommendedStrategy;
  if (hasBestBuyFulfillment) {
    strategy = "BEST_BUY_FULFILLMENT";
  } else if (!challenged && host.endsWith("target.com")) {
    strategy = "TARGET_PRIMARY_CONTROL";
  }

  return monitorRecipeSchema.parse({
    schemaVersion: 1,
    pageArchetype: challenged
      ? "challenge-page"
      : dom.pageArchetype || visual.pageArchetype,
    strategy,
    identity: {
      expectedHost: host,
      expectedTitle:
        dom.productTitle ?? visual.productTitle ?? context.expectedTitle,
      expectedSku: dom.sku ?? visual.sku ?? context.expectedSku,
    },
    acquisition: {
      mode:
        strategy === "BEST_BUY_FULFILLMENT" ||
        strategy === "GENERIC_JSONLD"
          ? "HTTP"
          : "BROWSER",
      timeoutMs: 45_000,
    },
    selectors: {
      productContainer:
        dom.productContainerSelector ?? visual.productContainerSelector,
      price: dom.priceSelector ?? visual.priceSelector,
      availability:
        dom.availabilitySelector ?? visual.availabilitySelector,
      purchaseControl:
        dom.purchaseControlSelector ?? visual.purchaseControlSelector,
    },
    availability: {
      inStockTerms: ["in stock", "add to cart", "available"],
      unavailableTerms: ["unavailable", "out of stock", "sold out"],
      comingSoonTerms: ["coming soon", "preorder", "pre-order"],
      purchaseControlMustBeEnabled: true,
    },
    challenge: {
      signatures: [
        ...new Set([
          ...bundle.challengeSignatures,
          ...dom.challengeSignatures,
          ...visual.challengeSignatures,
        ]),
      ],
      action: "QUARANTINE",
    },
    excludedRegions: [
      ...new Set([...dom.excludedRegions, ...visual.excludedRegions]),
    ],
    generatedBy: {
      provider: input.provider,
      model: input.model,
      learningRunId: input.learningRunId,
    },
  });
}

export function validateCompiledRecipe(input: {
  context: LearningContext;
  bundle: LearningBundle;
  dom: LearningHypothesis;
  visual: LearningHypothesis;
  recipe: MonitorRecipe;
}): RecipeTestResult[] {
  const { context, bundle, dom, visual, recipe } = input;
  const challenged = recipe.strategy === "CHALLENGE_ONLY";
  const bestBuyHttpFallback =
    recipe.strategy === "BEST_BUY_FULFILLMENT" &&
    bundle.httpSource.includes('"fulfillmentOptions"');
  return [
    {
      name: "page-state-agreement",
      status:
        dom.pageState === visual.pageState || challenged || bestBuyHttpFallback
          ? "PASSED"
          : "FAILED",
      detail: `DOM=${dom.pageState}; visual=${visual.pageState}.`,
    },
    {
      name: "strategy-agreement",
      status: strategiesAgree(dom, visual) ? "PASSED" : "FAILED",
      detail: `DOM=${dom.recommendedStrategy}; visual=${visual.recommendedStrategy}; compiled=${recipe.strategy}.`,
    },
    {
      name: "identity-binding",
      status:
        challenged ||
        recipe.identity.expectedTitle
          .toLowerCase()
          .includes(context.expectedTitle.toLowerCase().slice(0, 20))
          ? "PASSED"
          : "FAILED",
      detail: challenged
        ? "Challenge recipe preserves expected listing identity."
        : `Expected title=${context.expectedTitle}; learned=${recipe.identity.expectedTitle}.`,
    },
    {
      name: "challenge-detection",
      status:
        challenged === (bundle.challengeSignatures.length > 0) ||
        bestBuyHttpFallback
          ? "PASSED"
          : "FAILED",
      detail: `Captured signatures: ${bundle.challengeSignatures.join(", ") || "none"}.`,
    },
    {
      name: "runtime-strategy-supported",
      status: [
        "BEST_BUY_FULFILLMENT",
        "TARGET_PRIMARY_CONTROL",
        "GENERIC_JSONLD",
        "CHALLENGE_ONLY",
      ].includes(recipe.strategy)
        ? "PASSED"
        : "FAILED",
      detail: `Compiled runtime strategy=${recipe.strategy}.`,
    },
  ];
}
