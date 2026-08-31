import { getDatabase } from "@/lib/db";

export interface MonitoringRunFilters {
  query?: string;
  productId?: string;
  retailer?: string;
  status?: string;
  availability?: string;
  source?: string;
  page?: number;
  pageSize?: number;
}

export interface ProductTimelineFilters {
  retailer?: string;
  status?: string;
  availability?: string;
  source?: string;
  range?: "24h" | "7d" | "30d" | "all";
  page?: number;
  pageSize?: number;
}

export function getDashboardData() {
  const database = getDatabase();
  const stats = database
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM projects WHERE status = 'ACTIVE') AS active_projects,
        (SELECT COUNT(*) FROM listings WHERE status = 'ACTIVE') AS monitored_listings,
        (SELECT COUNT(*) FROM listings WHERE current_availability = 'IN_STOCK') AS in_stock,
        (SELECT COUNT(*) FROM alerts WHERE status = 'OPEN') AS open_alerts,
        (SELECT COUNT(*) FROM purchase_intents WHERE state = 'AWAITING_APPROVAL') AS pending_purchases`,
    )
    .get() as Record<string, number>;

  const projects = database
    .prepare(
      `SELECT p.*,
        COUNT(DISTINCT pr.id) AS product_count,
        COUNT(DISTINCT l.id) AS listing_count,
        SUM(CASE WHEN l.current_availability = 'IN_STOCK' THEN 1 ELSE 0 END) AS in_stock_count
       FROM projects p
       LEFT JOIN products pr ON pr.project_id = p.id
       LEFT JOIN listings l ON l.product_id = pr.id
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
    )
    .all() as Array<Record<string, string | number | null>>;

  const listings = database
    .prepare(
      `SELECT l.*, pr.project_id, pr.canonical_name AS product_name,
        pr.variant, pr.expected_price_cents, pr.target_quantity, pr.owned_quantity,
        (
          SELECT mr.status
          FROM monitoring_runs mr
          WHERE mr.listing_id = l.id
          ORDER BY mr.started_at DESC, mr.id DESC
          LIMIT 1
        ) AS last_result_status
       FROM listings l
       JOIN products pr ON pr.id = l.product_id
       ORDER BY
         CASE l.current_availability
           WHEN 'IN_STOCK' THEN 0
           WHEN 'LIMITED' THEN 1
           WHEN 'PREORDER' THEN 2
           WHEN 'COMING_SOON' THEN 3
           ELSE 4
         END,
         l.last_observed_at DESC
       LIMIT 12`,
    )
    .all() as Array<Record<string, string | number | null>>;

  const alerts = database
    .prepare(
      `SELECT a.*, p.name AS project_name, l.retailer
       FROM alerts a
       JOIN projects p ON p.id = a.project_id
       LEFT JOIN listings l ON l.id = a.listing_id
       ORDER BY a.created_at DESC
       LIMIT 8`,
    )
    .all() as Array<Record<string, string | number | null>>;

  return { stats, projects, listings, alerts };
}

export function getProjects() {
  return getDatabase()
    .prepare(
      `SELECT p.*,
        COUNT(DISTINCT pr.id) AS product_count,
        COUNT(DISTINCT l.id) AS listing_count
       FROM projects p
       LEFT JOIN products pr ON pr.project_id = p.id
       LEFT JOIN listings l ON l.product_id = pr.id
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
    )
    .all() as Array<Record<string, string | number | null>>;
}

export function getProject(id: string) {
  const database = getDatabase();
  const project = database
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as Record<string, string | number | null> | undefined;
  if (!project) return null;

  const products = database
    .prepare(
      `SELECT pr.*,
        COUNT(l.id) AS listing_count,
        MIN(l.current_price_cents) AS best_price_cents,
        SUM(CASE WHEN l.current_availability = 'IN_STOCK' THEN 1 ELSE 0 END) AS in_stock_count
       FROM products pr
       LEFT JOIN listings l ON l.product_id = pr.id
       WHERE pr.project_id = ?
       GROUP BY pr.id
       ORDER BY pr.canonical_name, pr.variant`,
    )
    .all(id) as Array<Record<string, string | number | null>>;

  const listings = database
    .prepare(
      `SELECT l.*, pr.canonical_name AS product_name, pr.variant,
        pr.expected_price_cents,
        (
          SELECT mr.status
          FROM monitoring_runs mr
          WHERE mr.listing_id = l.id
          ORDER BY mr.started_at DESC
          LIMIT 1
        ) AS last_result_status,
        (
          SELECT mr.detail
          FROM monitoring_runs mr
          WHERE mr.listing_id = l.id
          ORDER BY mr.started_at DESC, mr.id DESC
          LIMIT 1
        ) AS last_result_detail,
        (
          SELECT mr.availability
          FROM monitoring_runs mr
          WHERE mr.listing_id = l.id
          ORDER BY mr.started_at DESC, mr.id DESC
          LIMIT 1
        ) AS last_result_availability,
        (
          SELECT mr.availability_text
          FROM monitoring_runs mr
          WHERE mr.listing_id = l.id
          ORDER BY mr.started_at DESC, mr.id DESC
          LIMIT 1
        ) AS last_result_availability_text,
        (
          SELECT mr.started_at
          FROM monitoring_runs mr
          WHERE mr.listing_id = l.id
          ORDER BY mr.started_at DESC, mr.id DESC
          LIMIT 1
        ) AS last_result_started_at
       FROM listings l
       JOIN products pr ON pr.id = l.product_id
       WHERE pr.project_id = ?
       ORDER BY pr.canonical_name, l.retailer`,
    )
    .all(id) as Array<Record<string, string | number | null>>;

  const rules = database
    .prepare("SELECT * FROM rules WHERE project_id = ? ORDER BY created_at DESC")
    .all(id) as Array<Record<string, string | number | null>>;

  const snapshots = database
    .prepare(
      `SELECT s.*, l.title, l.retailer
       FROM snapshots s
       JOIN listings l ON l.id = s.listing_id
       JOIN products pr ON pr.id = l.product_id
       WHERE pr.project_id = ?
       ORDER BY s.observed_at DESC
       LIMIT 40`,
    )
    .all(id) as Array<Record<string, string | number | null>>;

  const monitoringRuns = database
    .prepare(
      `SELECT r.*, l.title, l.retailer, l.url,
        pr.canonical_name AS product_name
       FROM monitoring_runs r
       JOIN listings l ON l.id = r.listing_id
       JOIN products pr ON pr.id = l.product_id
       WHERE pr.project_id = ?
       ORDER BY r.started_at DESC
       LIMIT 100`,
    )
    .all(id) as Array<Record<string, string | number | null>>;

  return { project, products, listings, rules, snapshots, monitoringRuns };
}

export function getProjectMonitoringRuns(
  projectId: string,
  filters: MonitoringRunFilters,
) {
  const database = getDatabase();
  const conditions = ["pr.project_id = ?"];
  const values: Array<string | number> = [projectId];

  if (filters.query) {
    conditions.push(
      "(pr.canonical_name LIKE ? OR l.title LIKE ? OR l.retailer LIKE ? OR r.detail LIKE ?)",
    );
    const query = `%${filters.query}%`;
    values.push(query, query, query, query);
  }
  if (filters.productId) {
    conditions.push("pr.id = ?");
    values.push(filters.productId);
  }
  if (filters.retailer) {
    conditions.push("l.retailer = ?");
    values.push(filters.retailer);
  }
  if (filters.status) {
    conditions.push("r.status = ?");
    values.push(filters.status);
  }
  if (filters.availability) {
    conditions.push("r.availability = ?");
    values.push(filters.availability);
  }
  if (filters.source) {
    conditions.push("r.source = ?");
    values.push(filters.source);
  }

  const where = conditions.join(" AND ");
  const from = `
    FROM monitoring_runs r
    JOIN listings l ON l.id = r.listing_id
    JOIN products pr ON pr.id = l.product_id
    WHERE ${where}
  `;
  const count = database
    .prepare(`SELECT COUNT(*) AS count ${from}`)
    .get(...values) as { count: number };
  const pageSize = [10, 25, 50, 100].includes(Number(filters.pageSize))
    ? Number(filters.pageSize)
    : 25;
  const totalPages = Math.max(1, Math.ceil(Number(count.count) / pageSize));
  const page = Math.min(
    totalPages,
    Math.max(1, Number.isFinite(filters.page) ? Number(filters.page) : 1),
  );
  const offset = (page - 1) * pageSize;

  const rows = database
    .prepare(
      `SELECT r.*, l.title, l.retailer, l.url,
        pr.id AS product_id, pr.canonical_name AS product_name, pr.variant
       ${from}
       ORDER BY r.started_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, offset) as Array<
    Record<string, string | number | null>
  >;

  const stats = database
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN r.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successful,
        SUM(CASE WHEN r.status != 'SUCCESS' THEN 1 ELSE 0 END) AS issues,
        CAST(ROUND(AVG(r.duration_ms)) AS INTEGER) AS average_duration_ms
       ${from}`,
    )
    .get(...values) as Record<string, number | null>;

  const products = database
    .prepare(
      `SELECT DISTINCT pr.id, pr.canonical_name, pr.variant
       FROM monitoring_runs r
       JOIN listings l ON l.id = r.listing_id
       JOIN products pr ON pr.id = l.product_id
       WHERE pr.project_id = ?
       ORDER BY pr.canonical_name, pr.variant`,
    )
    .all(projectId) as Array<Record<string, string | number | null>>;
  const retailers = database
    .prepare(
      `SELECT DISTINCT l.retailer AS value
       FROM monitoring_runs r
       JOIN listings l ON l.id = r.listing_id
       JOIN products pr ON pr.id = l.product_id
       WHERE pr.project_id = ?
       ORDER BY l.retailer`,
    )
    .all(projectId) as Array<{ value: string }>;
  const statuses = database
    .prepare(
      `SELECT DISTINCT r.status AS value
       FROM monitoring_runs r
       JOIN listings l ON l.id = r.listing_id
       JOIN products pr ON pr.id = l.product_id
       WHERE pr.project_id = ? AND r.status IS NOT NULL
       ORDER BY r.status`,
    )
    .all(projectId) as Array<{ value: string }>;
  const availabilities = database
    .prepare(
      `SELECT DISTINCT r.availability AS value
       FROM monitoring_runs r
       JOIN listings l ON l.id = r.listing_id
       JOIN products pr ON pr.id = l.product_id
       WHERE pr.project_id = ? AND r.availability IS NOT NULL
       ORDER BY r.availability`,
    )
    .all(projectId) as Array<{ value: string }>;
  const sources = database
    .prepare(
      `SELECT DISTINCT r.source AS value
       FROM monitoring_runs r
       JOIN listings l ON l.id = r.listing_id
       JOIN products pr ON pr.id = l.product_id
       WHERE pr.project_id = ? AND r.source IS NOT NULL
       ORDER BY r.source`,
    )
    .all(projectId) as Array<{ value: string }>;

  return {
    rows,
    stats,
    page,
    pageSize,
    total: Number(count.count),
    totalPages,
    options: { products, retailers, statuses, availabilities, sources },
  };
}

export function getProduct(id: string) {
  const database = getDatabase();
  const product = database
    .prepare(
      `SELECT pr.*, p.name AS project_name, p.currency,
        MIN(l.current_price_cents) AS best_price_cents,
        SUM(CASE WHEN l.current_availability = 'IN_STOCK' THEN 1 ELSE 0 END) AS in_stock_count,
        COUNT(l.id) AS listing_count
       FROM products pr
       JOIN projects p ON p.id = pr.project_id
       LEFT JOIN listings l ON l.product_id = pr.id
       WHERE pr.id = ?
       GROUP BY pr.id`,
    )
    .get(id) as Record<string, string | number | null> | undefined;
  if (!product) return null;

  const listings = database
    .prepare(
      `SELECT l.*, r.authenticity_status, r.slug AS retailer_slug,
        mr.id AS active_recipe_id,
        mr.version AS active_recipe_version,
        mr.status AS active_recipe_status,
        mr.strategy AS active_recipe_strategy,
        (
          SELECT mr.status
          FROM monitoring_runs mr
          WHERE mr.listing_id = l.id
          ORDER BY mr.started_at DESC
          LIMIT 1
        ) AS last_result_status,
        (
          SELECT mr.detail
          FROM monitoring_runs mr
          WHERE mr.listing_id = l.id
          ORDER BY mr.started_at DESC
          LIMIT 1
        ) AS last_result_detail
       FROM listings l
       LEFT JOIN retailers r ON r.id = l.retailer_id
       LEFT JOIN listing_recipes lr ON lr.listing_id = l.id
       LEFT JOIN monitor_recipes mr ON mr.id = lr.active_recipe_id
       WHERE l.product_id = ?
       ORDER BY
         CASE l.current_availability WHEN 'IN_STOCK' THEN 0 ELSE 1 END,
         l.current_price_cents,
         l.retailer`,
    )
    .all(id) as Array<Record<string, string | number | null>>;

  const snapshots = database
    .prepare(
      `SELECT s.*, l.retailer, l.title
       FROM snapshots s
       JOIN listings l ON l.id = s.listing_id
       WHERE l.product_id = ?
       ORDER BY s.observed_at DESC
       LIMIT 120`,
    )
    .all(id) as Array<Record<string, string | number | null>>;

  const monitoringRuns = database
    .prepare(
      `SELECT r.*, l.retailer, l.title, l.url
       FROM monitoring_runs r
       JOIN listings l ON l.id = r.listing_id
       WHERE l.product_id = ?
       ORDER BY r.started_at DESC
       LIMIT 100`,
    )
    .all(id) as Array<Record<string, string | number | null>>;

  const learningRuns = database
    .prepare(
      `SELECT lr.*, l.retailer, l.title
       FROM learning_runs lr
       JOIN listings l ON l.id = lr.listing_id
       WHERE l.product_id = ?
       ORDER BY lr.started_at DESC
       LIMIT 30`,
    )
    .all(id) as Array<Record<string, string | number | null>>;

  return { product, listings, snapshots, monitoringRuns, learningRuns };
}

export function getProductMonitoringTimeline(
  productId: string,
  filters: ProductTimelineFilters,
) {
  const database = getDatabase();
  const conditions = ["l.product_id = ?"];
  const values: Array<string | number> = [productId];
  if (filters.retailer) {
    conditions.push("l.retailer = ?");
    values.push(filters.retailer);
  }
  if (filters.status) {
    conditions.push("r.status = ?");
    values.push(filters.status);
  }
  if (filters.availability) {
    conditions.push("COALESCE(s.availability, r.availability) = ?");
    values.push(filters.availability);
  }
  if (filters.source) {
    conditions.push("COALESCE(r.source, s.source) = ?");
    values.push(filters.source);
  }
  const ranges: Record<string, number> = {
    "24h": 24,
    "7d": 24 * 7,
    "30d": 24 * 30,
  };
  const range = filters.range ?? "7d";
  if (range !== "all") {
    conditions.push("r.started_at >= ?");
    values.push(
      new Date(Date.now() - ranges[range] * 60 * 60 * 1000).toISOString(),
    );
  }

  const where = conditions.join(" AND ");
  const from = `
    FROM monitoring_runs r
    JOIN listings l ON l.id = r.listing_id
    LEFT JOIN snapshots s ON s.monitoring_run_id = r.id
    WHERE ${where}
  `;
  const count = database
    .prepare(`SELECT COUNT(*) AS count ${from}`)
    .get(...values) as { count: number };
  const pageSize = [10, 25, 50, 100].includes(Number(filters.pageSize))
    ? Number(filters.pageSize)
    : 25;
  const totalPages = Math.max(1, Math.ceil(Number(count.count) / pageSize));
  const requestedPage = Number(filters.page ?? 1);
  const page = Math.min(
    totalPages,
    Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1),
  );

  const rows = database
    .prepare(
      `SELECT
        r.id, r.started_at, r.finished_at, r.duration_ms,
        r.status AS run_status, r.detail AS run_detail,
        COALESCE(s.source, r.source) AS source,
        COALESCE(s.availability, r.availability) AS availability,
        COALESCE(s.availability_text, r.availability_text) AS availability_text,
        COALESCE(s.price_cents, r.price_cents) AS price_cents,
        COALESCE(s.confidence, r.confidence) AS confidence,
        s.id AS snapshot_id, s.observed_at,
        l.id AS listing_id, l.retailer, l.title, l.url
       ${from}
       ORDER BY r.started_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, (page - 1) * pageSize) as Array<
    Record<string, string | number | null>
  >;
  const stats = database
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN r.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successful,
        SUM(CASE WHEN r.status NOT IN ('SUCCESS', 'RUNNING') THEN 1 ELSE 0 END) AS issues,
        CAST(ROUND(AVG(r.duration_ms)) AS INTEGER) AS average_duration_ms
       ${from}`,
    )
    .get(...values) as Record<string, number | null>;

  const optionRows = database
    .prepare(
      `SELECT DISTINCT l.retailer,
        r.status,
        COALESCE(s.availability, r.availability) AS availability,
        COALESCE(r.source, s.source) AS source
       FROM monitoring_runs r
       JOIN listings l ON l.id = r.listing_id
       LEFT JOIN snapshots s ON s.monitoring_run_id = r.id
       WHERE l.product_id = ?`,
    )
    .all(productId) as Array<{
    retailer: string;
    status: string | null;
    availability: string | null;
    source: string | null;
  }>;

  return {
    rows,
    stats,
    page,
    pageSize,
    total: Number(count.count),
    totalPages,
    options: {
      retailers: [...new Set(optionRows.map((row) => row.retailer))].sort(),
      statuses: [
        ...new Set(
          optionRows
            .map((row) => row.status)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort(),
      availabilities: [
        ...new Set(
          optionRows
            .map((row) => row.availability)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort(),
      sources: [
        ...new Set(
          optionRows
            .map((row) => row.source)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort(),
    },
  };
}

export function getRetailers() {
  return getDatabase()
    .prepare(
      `SELECT r.*,
        COUNT(l.id) AS listing_count
       FROM retailers r
       LEFT JOIN listings l ON l.retailer_id = r.id
       GROUP BY r.id
       ORDER BY
         CASE r.authenticity_status WHEN 'BUILT_IN' THEN 0 ELSE 1 END,
         r.name`,
    )
    .all() as Array<Record<string, string | number | null>>;
}

export function getAlerts() {
  return getDatabase()
    .prepare(
      `SELECT a.*, p.name AS project_name, l.retailer, l.url,
        pr.canonical_name AS product_name
       FROM alerts a
       JOIN projects p ON p.id = a.project_id
       LEFT JOIN listings l ON l.id = a.listing_id
       LEFT JOIN products pr ON pr.id = l.product_id
       ORDER BY a.created_at DESC`,
    )
    .all() as Array<Record<string, string | number | null>>;
}

export function getPurchaseIntents() {
  return getDatabase()
    .prepare(
      `SELECT i.*, p.name AS project_name, pr.canonical_name AS product_name,
        pr.variant, l.title AS listing_title, l.url, l.selection_mode
       FROM purchase_intents i
       JOIN projects p ON p.id = i.project_id
       JOIN products pr ON pr.id = i.product_id
       JOIN listings l ON l.id = i.listing_id
       ORDER BY i.created_at DESC`,
    )
    .all() as Array<Record<string, string | number | null>>;
}

export function getNotificationSettings() {
  const database = getDatabase();
  const channels = database
    .prepare(
      `SELECT id, name, type, enabled, created_at
       FROM notification_channels
       ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, string | number | null>>;
  const deliveries = database
    .prepare(
      `SELECT d.*, c.name AS channel_name
       FROM notification_deliveries d
       JOIN notification_channels c ON c.id = d.channel_id
       ORDER BY d.created_at DESC
       LIMIT 20`,
    )
    .all() as Array<Record<string, string | number | null>>;
  const captures = database
    .prepare(
      "SELECT * FROM discord_captures ORDER BY created_at DESC LIMIT 5",
    )
    .all() as Array<Record<string, string>>;
  return { channels, deliveries, captures };
}

export function getLearningSettings() {
  return getDatabase()
    .prepare(
      `SELECT provider, dom_model, visual_model, screening_engine,
        reasoning_effort, updated_at
       FROM learning_settings WHERE id = 'default'`,
    )
    .get() as Record<string, string>;
}
