import { z } from "zod";

export const learningHypothesisSchema = z.object({
  pageState: z.enum(["PRODUCT", "CHALLENGE", "NOT_FOUND", "UNKNOWN"]),
  pageArchetype: z.string().min(1).max(80),
  recommendedStrategy: z.enum([
    "BEST_BUY_FULFILLMENT",
    "TARGET_PRIMARY_CONTROL",
    "GENERIC_DOM",
    "GENERIC_JSONLD",
    "CHALLENGE_ONLY",
  ]),
  productTitle: z.string().max(500).nullable(),
  sku: z.string().max(120).nullable(),
  priceText: z.string().max(120).nullable(),
  availabilityText: z.string().max(240).nullable(),
  productContainerSelector: z.string().max(500).nullable(),
  priceSelector: z.string().max(500).nullable(),
  availabilitySelector: z.string().max(500).nullable(),
  purchaseControlSelector: z.string().max(500).nullable(),
  purchaseControlLabel: z.string().max(160).nullable(),
  challengeSignatures: z.array(z.string().max(240)).max(20),
  excludedRegions: z.array(z.string().max(240)).max(20),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(3000),
});

export type LearningHypothesis = z.infer<typeof learningHypothesisSchema>;

export const monitorRecipeSchema = z.object({
  schemaVersion: z.literal(1),
  pageArchetype: z.string().min(1),
  strategy: z.enum([
    "BEST_BUY_FULFILLMENT",
    "TARGET_PRIMARY_CONTROL",
    "GENERIC_DOM",
    "GENERIC_JSONLD",
    "CHALLENGE_ONLY",
  ]),
  identity: z.object({
    expectedHost: z.string().min(1),
    expectedTitle: z.string().min(1),
    expectedSku: z.string().nullable(),
  }),
  acquisition: z.object({
    mode: z.enum(["HTTP", "BROWSER"]),
    timeoutMs: z.number().int().min(5000).max(60000),
  }),
  selectors: z.object({
    productContainer: z.string().nullable(),
    price: z.string().nullable(),
    availability: z.string().nullable(),
    purchaseControl: z.string().nullable(),
  }),
  availability: z.object({
    inStockTerms: z.array(z.string()),
    unavailableTerms: z.array(z.string()),
    comingSoonTerms: z.array(z.string()),
    purchaseControlMustBeEnabled: z.boolean(),
  }),
  challenge: z.object({
    signatures: z.array(z.string()),
    action: z.literal("QUARANTINE"),
  }),
  excludedRegions: z.array(z.string()),
  generatedBy: z.object({
    provider: z.string(),
    model: z.string(),
    learningRunId: z.string(),
  }),
});

export type MonitorRecipe = z.infer<typeof monitorRecipeSchema>;

export interface LearningBundle {
  screeningEngine: "PLAYWRIGHT" | "SELENIUMBASE";
  artifactDirectory: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string;
  httpSource: string;
  sanitizedDom: string;
  visibleText: string;
  accessibilityTree: string;
  networkSummary: Array<{
    status: number;
    resourceType: string;
    url: string;
    contentType: string | null;
  }>;
  screenshotPath: string;
  challengeSignatures: string[];
}

export interface LearningContext {
  listingId: string;
  retailer: string;
  expectedTitle: string;
  expectedSku: string | null;
  productUrl: string;
}
