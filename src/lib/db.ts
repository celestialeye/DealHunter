import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  repairSeedSimulationArtifacts,
  seedPokemonProject,
} from "@/lib/seed-data";
import { seedRetailerRegistry } from "@/lib/retailer-registry";

declare global {
  var dealHunterDatabase: DatabaseSync | undefined;
}

export function getDataDirectory() {
  const directory = process.env.DEALHUNTER_DATA_DIR
    ? path.resolve(process.env.DEALHUNTER_DATA_DIR)
    : path.join(process.cwd(), ".dealhunter");
  mkdirSync(directory, { recursive: true });
  return directory;
}

function databasePath() {
  return path.join(getDataDirectory(), "dealhunter.db");
}

function ensureColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string,
) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((entry) => entry.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 15000;
    BEGIN IMMEDIATE;
  `);
  try {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      budget_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS retailers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      domains_json TEXT NOT NULL,
      image_domains_json TEXT NOT NULL DEFAULT '[]',
      authenticity_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      canonical_name TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT '',
      target_quantity INTEGER NOT NULL DEFAULT 1 CHECK(target_quantity >= 0),
      owned_quantity INTEGER NOT NULL DEFAULT 0 CHECK(owned_quantity >= 0),
      expected_price_cents INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      retailer TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL UNIQUE,
      current_price_cents INTEGER,
      current_availability TEXT NOT NULL DEFAULT 'UNKNOWN',
      selection_mode TEXT NOT NULL DEFAULT 'EXACT',
      interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK(interval_seconds >= 60),
      last_observed_at TEXT,
      next_run_at TEXT NOT NULL,
      observation_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      observed_at TEXT NOT NULL,
      availability TEXT NOT NULL,
      price_cents INTEGER,
      confidence REAL NOT NULL,
      result_status TEXT NOT NULL,
      source TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS snapshots_listing_time
      ON snapshots(listing_id, observed_at DESC);

    CREATE TABLE IF NOT EXISTS monitoring_runs (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      source TEXT,
      availability TEXT,
      price_cents INTEGER,
      confidence REAL,
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS monitoring_runs_listing_time
      ON monitoring_runs(listing_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      max_price_cents INTEGER,
      required_availability TEXT NOT NULL DEFAULT 'ACTIONABLE',
      action_alert INTEGER NOT NULL DEFAULT 1,
      action_purchase INTEGER NOT NULL DEFAULT 0,
      allow_random_variant INTEGER NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1,
      cooldown_minutes INTEGER NOT NULL DEFAULT 30,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_triggered_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rule_listing_states (
      rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      last_match INTEGER NOT NULL DEFAULT 0,
      consecutive_matches INTEGER NOT NULL DEFAULT 0,
      transition_sequence INTEGER NOT NULL DEFAULT 0,
      last_triggered_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (rule_id, listing_id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
      rule_id TEXT REFERENCES rules(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'INFO',
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      secret_value TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      alert_id TEXT REFERENCES alerts(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      response_code INTEGER,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_intents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      rule_id TEXT REFERENCES rules(id) ON DELETE SET NULL,
      state TEXT NOT NULL DEFAULT 'AWAITING_APPROVAL',
      quantity INTEGER NOT NULL,
      max_total_cents INTEGER,
      observed_total_cents INTEGER,
      retailer TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discord_captures (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS retailer_knowledge (
      id TEXT PRIMARY KEY,
      retailer_id TEXT NOT NULL,
      page_archetype TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      knowledge_json TEXT NOT NULL,
      source_learning_run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(retailer_id, page_archetype, version)
    );

    CREATE TABLE IF NOT EXISTS learning_runs (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      final_url TEXT,
      page_state TEXT,
      artifact_directory TEXT,
      dom_hypothesis_json TEXT,
      visual_hypothesis_json TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS monitor_recipes (
      id TEXT PRIMARY KEY,
      retailer_id TEXT,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      strategy TEXT NOT NULL,
      recipe_json TEXT NOT NULL,
      source_learning_run_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      activated_at TEXT,
      UNIQUE(listing_id, version)
    );

    CREATE TABLE IF NOT EXISTS recipe_tests (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL REFERENCES monitor_recipes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS listing_recipes (
      listing_id TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
      active_recipe_id TEXT REFERENCES monitor_recipes(id) ON DELETE SET NULL,
      shadow_recipe_id TEXT REFERENCES monitor_recipes(id) ON DELETE SET NULL,
      rollback_recipe_id TEXT REFERENCES monitor_recipes(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drift_events (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      recipe_id TEXT REFERENCES monitor_recipes(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS learning_settings (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      dom_model TEXT NOT NULL,
      visual_model TEXT NOT NULL,
      screening_engine TEXT NOT NULL DEFAULT 'PLAYWRIGHT',
      reasoning_effort TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO learning_settings
      (id, provider, dom_model, visual_model, reasoning_effort, updated_at)
    VALUES
      ('default', 'COPILOT_CLI', 'gpt-5-mini', 'gpt-5-mini', 'low',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  `);

  ensureColumn(database, "products", "description", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "products", "image_url", "TEXT");
  ensureColumn(database, "products", "image_local_path", "TEXT");
  ensureColumn(database, "products", "image_source_url", "TEXT");
  ensureColumn(database, "products", "source_url", "TEXT");
  ensureColumn(database, "products", "retailer_sku", "TEXT");
  ensureColumn(database, "products", "metadata_status", "TEXT");
  ensureColumn(database, "products", "metadata_error", "TEXT");
  ensureColumn(database, "products", "metadata_checked_at", "TEXT");
  ensureColumn(database, "listings", "retailer_id", "TEXT");
  ensureColumn(database, "listings", "retailer_sku", "TEXT");
  ensureColumn(
    database,
    "listings",
    "schedule_mode",
    "TEXT NOT NULL DEFAULT 'INHERIT'",
  );
  ensureColumn(
    database,
    "listings",
    "interval_min_seconds",
    "INTEGER NOT NULL DEFAULT 60",
  );
  ensureColumn(
    database,
    "listings",
    "interval_max_seconds",
    "INTEGER NOT NULL DEFAULT 120",
  );
  ensureColumn(database, "listings", "last_interval_seconds", "INTEGER");
  ensureColumn(database, "listings", "schedule_reason", "TEXT");
  ensureColumn(
    database,
    "projects",
    "default_schedule_mode",
    "TEXT NOT NULL DEFAULT 'SYSTEM'",
  );
  ensureColumn(
    database,
    "projects",
    "default_interval_seconds",
    "INTEGER NOT NULL DEFAULT 60",
  );
  ensureColumn(
    database,
    "projects",
    "default_interval_min_seconds",
    "INTEGER NOT NULL DEFAULT 60",
  );
  ensureColumn(
    database,
    "projects",
    "default_interval_max_seconds",
    "INTEGER NOT NULL DEFAULT 120",
  );
  ensureColumn(
    database,
    "retailers",
    "minimum_interval_seconds",
    "INTEGER NOT NULL DEFAULT 60",
  );
  ensureColumn(
    database,
    "retailers",
    "max_browser_concurrency",
    "INTEGER NOT NULL DEFAULT 2",
  );
  ensureColumn(
    database,
    "retailers",
    "challenge_cooldown_seconds",
    "INTEGER NOT NULL DEFAULT 900",
  );
  ensureColumn(database, "listings", "confirmed_availability", "TEXT");
  ensureColumn(database, "listings", "current_availability_text", "TEXT");
  ensureColumn(database, "listings", "confirmed_availability_text", "TEXT");
  ensureColumn(database, "listings", "confirmed_price_cents", "INTEGER");
  ensureColumn(database, "listings", "confirmed_at", "TEXT");
  ensureColumn(database, "listings", "last_attempt_status", "TEXT");
  ensureColumn(database, "listings", "last_attempt_at", "TEXT");
  ensureColumn(database, "listings", "availability_hint", "TEXT");
  ensureColumn(database, "listings", "availability_hint_text", "TEXT");
  ensureColumn(database, "listings", "availability_hint_source", "TEXT");
  ensureColumn(database, "listings", "availability_hint_observed_at", "TEXT");
  ensureColumn(database, "snapshots", "monitoring_run_id", "TEXT");
  ensureColumn(database, "snapshots", "evidence_type", "TEXT");
  ensureColumn(database, "snapshots", "availability_text", "TEXT");
  ensureColumn(database, "snapshots", "confirmation_group_id", "TEXT");
  ensureColumn(database, "monitoring_runs", "evidence_type", "TEXT");
  ensureColumn(database, "monitoring_runs", "availability_text", "TEXT");
  ensureColumn(database, "monitoring_runs", "confirmation_group_id", "TEXT");
  ensureColumn(database, "monitoring_runs", "recipe_id", "TEXT");
  ensureColumn(database, "monitoring_runs", "recipe_version", "INTEGER");
  ensureColumn(
    database,
    "learning_settings",
    "screening_engine",
    "TEXT NOT NULL DEFAULT 'PLAYWRIGHT'",
  );
  ensureColumn(database, "learning_runs", "screening_engine", "TEXT");
  database.exec(`
    UPDATE learning_runs
    SET screening_engine = 'PLAYWRIGHT'
    WHERE screening_engine IS NULL;
  `);
  const hierarchyMigration = database
    .prepare(
      "SELECT value FROM system_state WHERE key = 'schedule-hierarchy-v1'",
    )
    .get();
  if (!hierarchyMigration) {
    database.exec(`
      UPDATE listings
      SET schedule_mode = 'INHERIT'
      WHERE schedule_mode = 'SYSTEM';

      INSERT INTO system_state (key, value, updated_at)
      VALUES (
        'schedule-hierarchy-v1',
        'complete',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    `);
  }
  ensureColumn(database, "alerts", "transition_key", "TEXT");
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS alerts_transition_key
      ON alerts(transition_key)
      WHERE transition_key IS NOT NULL;

    UPDATE listings
    SET confirmed_availability = current_availability,
        confirmed_price_cents = current_price_cents,
        confirmed_at = COALESCE(last_observed_at, created_at)
    WHERE confirmed_availability IS NULL
      AND current_availability != 'UNKNOWN';

    UPDATE listings
    SET current_availability_text = CASE current_availability
          WHEN 'UNAVAILABLE' THEN 'Unavailable'
          WHEN 'OUT_OF_STOCK' THEN 'Out of Stock'
          WHEN 'COMING_SOON' THEN 'Coming Soon'
          WHEN 'IN_STOCK' THEN 'In Stock'
          WHEN 'PREORDER' THEN 'Preorder'
          WHEN 'BACKORDER' THEN 'Backorder'
          WHEN 'LIMITED' THEN 'Limited'
          ELSE NULL
        END
    WHERE current_availability_text IS NULL;

    UPDATE listings
    SET availability_hint_text = CASE availability_hint
          WHEN 'UNAVAILABLE' THEN 'Unavailable'
          WHEN 'OUT_OF_STOCK' THEN 'Out of Stock'
          WHEN 'COMING_SOON' THEN 'Coming Soon'
          ELSE NULL
        END
    WHERE availability_hint_text IS NULL;

    UPDATE rules
    SET required_availability = 'ACTIONABLE'
    WHERE required_availability != 'ACTIONABLE';
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS monitoring_runs_listing_finished
      ON monitoring_runs(listing_id, finished_at);
  `);
  const backfill = database
    .prepare(
      "SELECT value FROM system_state WHERE key = 'snapshot-run-backfill-v1'",
    )
    .get();
  if (!backfill) {
    database.exec(`
      UPDATE snapshots
      SET monitoring_run_id = (
        SELECT monitoring_runs.id
        FROM monitoring_runs
        WHERE monitoring_runs.listing_id = snapshots.listing_id
          AND monitoring_runs.finished_at = snapshots.observed_at
        LIMIT 1
      )
      WHERE monitoring_run_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM monitoring_runs
          WHERE monitoring_runs.listing_id = snapshots.listing_id
            AND monitoring_runs.finished_at = snapshots.observed_at
        );

      INSERT INTO system_state (key, value, updated_at)
      VALUES (
        'snapshot-run-backfill-v1',
        'complete',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    `);
  }
  database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getDatabase() {
  if (!global.dealHunterDatabase) {
    const database = new DatabaseSync(databasePath());
    database.exec("PRAGMA busy_timeout = 15000;");
    migrate(database);
    global.dealHunterDatabase = database;
    const count = database
      .prepare("SELECT COUNT(*) AS count FROM projects")
      .get() as { count: number };
    if (count.count === 0) {
      seedPokemonProject(database);
    }
    seedRetailerRegistry(database);
    repairSeedSimulationArtifacts(database);
  }
  return global.dealHunterDatabase;
}

export function createId() {
  return randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export function audit(
  entityType: string,
  entityId: string,
  action: string,
  detail: string,
) {
  getDatabase()
    .prepare(
      `INSERT INTO audit_events
        (id, entity_type, entity_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(createId(), entityType, entityId, action, detail, nowIso());
}
