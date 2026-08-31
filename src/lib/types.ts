export type Availability =
  | "IN_STOCK"
  | "OUT_OF_STOCK"
  | "PREORDER"
  | "BACKORDER"
  | "COMING_SOON"
  | "LIMITED"
  | "UNAVAILABLE"
  | "UNKNOWN";

export type ObservationStatus =
  | "SUCCESS"
  | "CHALLENGE"
  | "RATE_LIMITED"
  | "PARSE_ERROR"
  | "NETWORK_ERROR";

export type SelectionMode =
  | "EXACT"
  | "CUSTOMER_CHOICE"
  | "RANDOM_VARIANT"
  | "ASSORTMENT"
  | "UNKNOWN";

export type EvidenceType =
  | "RETAILER_FULFILLMENT"
  | "PRIMARY_CONTROL"
  | "SEO_METADATA"
  | "TEST_FIXTURE"
  | "NONE";

export interface ListingRecord {
  id: string;
  project_id: string;
  product_id: string;
  product_name: string;
  retailer: string;
  title: string;
  url: string;
  current_price_cents: number | null;
  current_availability: Availability;
  current_availability_text: string | null;
  selection_mode: SelectionMode;
  interval_seconds: number;
  schedule_mode: "INHERIT" | "SYSTEM" | "FIXED" | "BOUNDED";
  interval_min_seconds: number;
  interval_max_seconds: number;
  last_interval_seconds: number | null;
  schedule_reason: string | null;
  project_default_schedule_mode: "SYSTEM" | "FIXED" | "BOUNDED";
  project_default_interval_seconds: number;
  project_default_interval_min_seconds: number;
  project_default_interval_max_seconds: number;
  retailer_minimum_interval_seconds: number;
  last_observed_at: string | null;
  next_run_at: string;
  observation_count: number;
  active_recipe_id?: string | null;
  active_recipe_version?: number | null;
  active_recipe_strategy?: string | null;
}

export interface ListingObservation {
  availability: Availability;
  displayAvailabilityText?: string | null;
  priceCents: number | null;
  confidence: number;
  resultStatus: ObservationStatus;
  source: "HTTP" | "BROWSER" | "SIMULATION";
  evidenceType?: EvidenceType;
  detail?: string;
}

export interface DiscordEmbedPayload {
  username: string;
  embeds: Array<{
    title: string;
    description: string;
    url?: string;
    color: number;
    fields: Array<{ name: string; value: string; inline: boolean }>;
    footer: { text: string };
    timestamp: string;
  }>;
}
