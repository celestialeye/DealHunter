import {
  Bell,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  ListFilter,
  Pencil,
  Radar,
  Search,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  addProductFromUrlAction,
  createRuleAction,
  deleteRuleAction,
  runProjectScanAction,
  updateListingAutoCartAction,
  updateProjectAlertDestinationsAction,
  updateProjectScheduleAction,
  updateRuleAction,
} from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { formatAvailability, formatDate, formatMoney } from "@/lib/format";
import {
  getProject,
  getProjectMonitoringRuns,
  type MonitoringRunFilters,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

type Row = Record<string, string | number | null>;
type ProjectView =
  | "overview"
  | "products"
  | "listings"
  | "rules"
  | "schedule"
  | "runs"
  | "setup";

const views: Array<{
  id: ProjectView;
  label: string;
  description: string;
}> = [
  { id: "overview", label: "Overview", description: "Project health" },
  { id: "products", label: "Products", description: "Acquisition goals" },
  { id: "listings", label: "Listings", description: "Retailer offers" },
  { id: "rules", label: "Alerts", description: "When to notify" },
  { id: "schedule", label: "Monitoring", description: "How often to check" },
  { id: "runs", label: "Check logs", description: "Monitoring details" },
  { id: "setup", label: "Add & manage", description: "New targets" },
];

function displayedAvailability(listing: Row) {
  if (listing.current_availability !== "UNKNOWN") {
    return String(listing.current_availability);
  }
  if (listing.availability_hint) {
    return String(listing.availability_hint);
  }
  if (listing.last_result_status === "CHALLENGE") {
    return "CHALLENGE";
  }
  return "UNKNOWN";
}

function displayedAvailabilityText(listing: Row) {
  if (listing.current_availability !== "UNKNOWN") {
    return listing.current_availability_text
      ? String(listing.current_availability_text)
      : null;
  }
  if (listing.availability_hint) {
    return listing.availability_hint_text
      ? String(listing.availability_hint_text)
      : null;
  }
  return null;
}

function availabilityProvenance(listing: Row) {
  if (listing.last_result_status === "SUCCESS") {
    return "Live observation";
  }
  if (listing.availability_hint) {
    return "Official page evidence · live check challenged";
  }
  if (listing.last_result_status === "CHALLENGE") {
    return "Live check challenged";
  }
  return "No current live evidence";
}

function ProjectTabs({
  projectId,
  activeView,
}: {
  projectId: string;
  activeView: ProjectView;
}) {
  return (
    <nav className="tab-bar" aria-label="Project sections">
      {views.map((view) => (
        <Link
          key={view.id}
          href={`/projects/${projectId}?view=${view.id}`}
          className={
            activeView === view.id ? "tab-link tab-link-active" : "tab-link"
          }
          data-testid={`project-tab-${view.id}`}
        >
          <strong>{view.label}</strong>
          <small>{view.description}</small>
        </Link>
      ))}
    </nav>
  );
}

function OverviewView({
  projectId,
  products,
  listings,
  rules,
  monitoringRuns,
}: {
  projectId: string;
  products: Row[];
  listings: Row[];
  rules: Row[];
  monitoringRuns: Row[];
}) {
  const navigation = [
    {
      view: "products",
      label: "Products",
      value: products.length,
      detail: "Track desired and acquired quantities.",
      icon: Boxes,
    },
    {
      view: "listings",
      label: "Retailer listings",
      value: listings.length,
      detail: "Open product URLs and compare offers.",
      icon: ListFilter,
    },
    {
      view: "rules",
      label: "Active rules",
      value: rules.length,
      detail: "Availability, price, and purchase actions.",
      icon: ShieldAlert,
    },
    {
      view: "runs",
      label: "Recorded checks",
      value: monitoringRuns.length,
      detail: "Inspect every system observation.",
      icon: ScrollText,
    },
  ];

  return (
    <>
      <section className="overview-nav-grid">
        {navigation.map(({ view, label, value, detail, icon: Icon }) => (
          <Link
            className="overview-nav-card"
            href={`/projects/${projectId}?view=${view}`}
            key={view}
          >
            <span className="overview-nav-icon">
              <Icon size={18} />
            </span>
            <strong>{label}</strong>
            <span className="overview-nav-value">{value}</span>
            <small>{detail}</small>
          </Link>
        ))}
      </section>

      <div className="section-title">
        <div>
          <h2>Availability snapshot</h2>
          <p>The most actionable offers across this project.</p>
        </div>
        <Link
          className="inline-link"
          href={`/projects/${projectId}?view=listings`}
        >
          View every listing
        </Link>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Retailer</th>
                <th>Status</th>
                <th>Price</th>
                <th>Last check</th>
              </tr>
            </thead>
            <tbody>
              {listings.slice(0, 8).map((listing) => (
                <tr key={String(listing.id)}>
                  <td className="primary-cell">
                    <a
                      className="product-link"
                      href={String(listing.url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <strong>
                        {String(listing.product_name)}
                        <ExternalLink size={14} />
                      </strong>
                      <small>{String(listing.title)}</small>
                    </a>
                  </td>
                  <td>{String(listing.retailer)}</td>
                  <td>
                    <span className="status-with-source">
                      <StatusBadge
                        value={displayedAvailability(listing)}
                        label={displayedAvailabilityText(listing)}
                      />
                      <small>{availabilityProvenance(listing)}</small>
                    </span>
                  </td>
                  <td>
                    <span className="price-with-source">
                      <strong>
                        {formatMoney(
                          listing.current_price_cents ??
                            listing.expected_price_cents,
                        )}
                      </strong>
                      {listing.current_price_cents !== null &&
                      listing.last_result_status === "SUCCESS" ? (
                        <small>Live observation</small>
                      ) : (
                        <small>Known price · not live</small>
                      )}
                    </span>
                  </td>
                  <td>{formatDate(listing.last_observed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ProductsView({
  products,
  listings,
}: {
  products: Row[];
  listings: Row[];
}) {
  const listingsByProduct = new Map<string, Row[]>();
  for (const listing of listings) {
    const productId = String(listing.product_id);
    const productListings = listingsByProduct.get(productId) ?? [];
    productListings.push(listing);
    listingsByProduct.set(productId, productListings);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Product plan</h2>
          <p>Canonical products remain separate from retailer offers.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Goal</th>
              <th>Expected</th>
              <th>Best visible</th>
              <th>Coverage</th>
              <th>Retailer</th>
              <th>Latest result</th>
              <th>Check status</th>
              <th>Last checked</th>
            </tr>
          </thead>
          <tbody>
            {products.flatMap((product) => {
              const productListings =
                listingsByProduct.get(String(product.id)) ?? [];
              const retailerRows: Array<Row | null> = productListings.length
                ? productListings
                : [null];

              return retailerRows.map((listing, index) => (
                <tr
                  key={
                    listing
                      ? String(listing.id)
                      : `${String(product.id)}-no-listings`
                  }
                  data-testid="product-retailer-row"
                >
                  {index === 0 ? (
                    <>
                      <td className="primary-cell" rowSpan={retailerRows.length}>
                        <Link
                          className="product-link"
                          href={`/products/${String(product.id)}`}
                          aria-label={`View details for ${String(product.canonical_name)}`}
                        >
                          <span className="product-list-identity">
                            <span
                              className="product-list-thumb"
                              style={
                                product.image_local_path || product.image_url
                                  ? {
                                      backgroundImage: `url("${String(product.image_local_path ?? product.image_url)}")`,
                                    }
                                  : undefined
                              }
                              aria-hidden="true"
                            >
                              {product.image_local_path || product.image_url
                                ? ""
                                : String(product.canonical_name).slice(0, 1)}
                            </span>
                            <span>
                              <strong>
                                {String(product.canonical_name)}
                                <ExternalLink size={14} />
                              </strong>
                              <small>
                                {String(product.variant || product.notes)}
                              </small>
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td rowSpan={retailerRows.length}>
                        {Number(product.owned_quantity)} /{" "}
                        {Number(product.target_quantity)}
                      </td>
                      <td rowSpan={retailerRows.length}>
                        {formatMoney(product.expected_price_cents)}
                      </td>
                      <td rowSpan={retailerRows.length}>
                        {formatMoney(product.best_price_cents)}
                      </td>
                      <td rowSpan={retailerRows.length}>
                        {Number(product.listing_count)} listings ·{" "}
                        {Number(product.in_stock_count)} live
                      </td>
                    </>
                  ) : null}
                  <td className="product-retailer-cell">
                    {listing ? (
                      <a
                        className="product-retailer-link"
                        href={String(listing.url)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${String(listing.retailer)} product page for ${String(product.canonical_name)}`}
                      >
                        <strong>
                          {String(listing.retailer)}
                          <ExternalLink size={12} />
                        </strong>
                        <small>{String(listing.title)}</small>
                      </a>
                    ) : (
                      <span className="product-retailer-empty">
                        No retailer listings
                      </span>
                    )}
                  </td>
                  <td className="product-check-cell">
                    <StatusBadge
                      value={
                        listing?.last_result_availability ?? "NOT_CHECKED"
                      }
                      label={
                        listing?.last_result_availability
                          ? listing.last_result_availability_text
                            ? String(listing.last_result_availability_text)
                            : undefined
                          : "Not checked"
                      }
                    />
                  </td>
                  <td className="product-check-cell">
                    <StatusBadge
                      value={listing?.last_result_status ?? "NOT_CHECKED"}
                      label={
                        listing?.last_result_status ? undefined : "Not checked"
                      }
                    />
                  </td>
                  <td className="product-last-checked">
                    {formatDate(listing?.last_result_started_at)}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function listingsUrl(
  projectId: string,
  retailer?: string,
  status?: string,
) {
  const params = new URLSearchParams({ view: "listings" });
  if (retailer) params.set("listingRetailer", retailer);
  if (status) params.set("listingStatus", status);
  return `/projects/${projectId}?${params.toString()}`;
}

function ListingsView({
  projectId,
  listings,
  retailerFilter,
  statusFilter,
}: {
  projectId: string;
  listings: Row[];
  retailerFilter?: string;
  statusFilter?: string;
}) {
  const retailers = [
    ...new Set(listings.map((listing) => String(listing.retailer))),
  ].sort((left, right) => left.localeCompare(right));
  const statuses = [
    ...new Set(listings.map((listing) => displayedAvailability(listing))),
  ].sort((left, right) =>
    formatAvailability(left).localeCompare(formatAvailability(right)),
  );
  const listingsForRetailerCounts = statusFilter
    ? listings.filter(
        (listing) => displayedAvailability(listing) === statusFilter,
      )
    : listings;
  const listingsForStatusCounts = retailerFilter
    ? listings.filter(
        (listing) => String(listing.retailer) === retailerFilter,
      )
    : listings;
  const retailerCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();

  for (const listing of listingsForRetailerCounts) {
    const retailer = String(listing.retailer);
    retailerCounts.set(retailer, (retailerCounts.get(retailer) ?? 0) + 1);
  }

  for (const listing of listingsForStatusCounts) {
    const status = displayedAvailability(listing);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  const filteredListings = listings.filter(
    (listing) =>
      (!retailerFilter || String(listing.retailer) === retailerFilter) &&
      (!statusFilter || displayedAvailability(listing) === statusFilter),
  );
  const hasFilters = Boolean(retailerFilter || statusFilter);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Retailer listings</h2>
          <p>Click any product name to open its retailer page directly.</p>
        </div>
      </div>
      <div className="listing-filter-bar" data-testid="listing-filters">
        <div className="listing-filter-group">
          <span className="listing-filter-label">Retailer</span>
          <div
            className="listing-filter-options"
            aria-label="Filter listings by retailer"
          >
            <Link
              className={
                retailerFilter
                  ? "listing-filter-option"
                  : "listing-filter-option listing-filter-option-active"
              }
              href={listingsUrl(projectId, undefined, statusFilter)}
              scroll={false}
              aria-current={retailerFilter ? undefined : "page"}
              aria-label="Show listings from all retailers"
            >
              <span>All retailers</span>
              <b>{listingsForRetailerCounts.length}</b>
            </Link>
            {retailers.map((retailer) => (
              <Link
                className={
                  retailerFilter === retailer
                    ? "listing-filter-option listing-filter-option-active"
                    : "listing-filter-option"
                }
                href={listingsUrl(projectId, retailer, statusFilter)}
                scroll={false}
                aria-current={
                  retailerFilter === retailer ? "page" : undefined
                }
                aria-label={`Show ${retailer} listings`}
                key={retailer}
              >
                <span>{retailer}</span>
                <b>{retailerCounts.get(retailer) ?? 0}</b>
              </Link>
            ))}
          </div>
        </div>
        <div className="listing-filter-group">
          <span className="listing-filter-label">Status</span>
          <div
            className="listing-filter-options"
            aria-label="Filter listings by status"
          >
            <Link
              className={
                statusFilter
                  ? "listing-filter-option"
                  : "listing-filter-option listing-filter-option-active"
              }
              href={listingsUrl(projectId, retailerFilter)}
              scroll={false}
              aria-current={statusFilter ? undefined : "page"}
              aria-label="Show listings with any status"
            >
              <span>All statuses</span>
              <b>{listingsForStatusCounts.length}</b>
            </Link>
            {statuses.map((status) => (
              <Link
                className={
                  statusFilter === status
                    ? "listing-filter-option listing-filter-option-active"
                    : "listing-filter-option"
                }
                href={listingsUrl(projectId, retailerFilter, status)}
                scroll={false}
                aria-current={statusFilter === status ? "page" : undefined}
                aria-label={`Show ${formatAvailability(status)} listings`}
                key={status}
              >
                <span>{formatAvailability(status)}</span>
                <b>{statusCounts.get(status) ?? 0}</b>
              </Link>
            ))}
          </div>
        </div>
        <div className="listing-filter-summary" aria-live="polite">
          <span>
            Showing <strong>{filteredListings.length}</strong> of{" "}
            <strong>{listings.length}</strong> listings
            {retailerFilter ? ` from ${retailerFilter}` : ""}
            {statusFilter ? ` · ${formatAvailability(statusFilter)}` : ""}
          </span>
          {hasFilters ? (
            <Link
              className="listing-filter-clear"
              href={listingsUrl(projectId)}
              scroll={false}
            >
              Clear filters
            </Link>
          ) : null}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Offer</th>
              <th>Retailer</th>
              <th>Status</th>
              <th>Price</th>
              <th>Mode</th>
              <th>Interval</th>
              <th>Auto cart</th>
              <th>Last check</th>
            </tr>
          </thead>
          <tbody>
            {filteredListings.map((listing) => (
              <tr key={String(listing.id)} data-testid="listing-row">
                <td className="primary-cell">
                  <a
                    className="product-link"
                    href={String(listing.url)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${String(listing.product_name)} at ${String(listing.retailer)}`}
                  >
                    <strong>
                      {String(listing.product_name)}
                      <ExternalLink size={14} />
                    </strong>
                    <small>{String(listing.title)}</small>
                  </a>
                </td>
                <td>{String(listing.retailer)}</td>
                <td>
                  <span className="status-with-source">
                    <StatusBadge
                      value={displayedAvailability(listing)}
                      label={displayedAvailabilityText(listing)}
                    />
                    <small>{availabilityProvenance(listing)}</small>
                  </span>
                </td>
                <td>
                  <span className="price-with-source">
                    <strong>
                      {formatMoney(
                        listing.current_price_cents ??
                          listing.expected_price_cents,
                      )}
                    </strong>
                    {listing.current_price_cents !== null &&
                    listing.last_result_status === "SUCCESS" ? (
                      <small>Live observation</small>
                    ) : (
                      <small>Known price · not live</small>
                    )}
                  </span>
                </td>
                <td>
                  <StatusBadge value={listing.selection_mode} />
                </td>
                <td>
                  <span className="schedule-cell">
                    <strong>
                      {Number(
                        listing.last_interval_seconds ??
                          listing.interval_seconds,
                      )}{" "}
                      sec
                    </strong>
                    <small>
                      {String(listing.schedule_mode ?? "SYSTEM").replaceAll(
                        "_",
                        " ",
                      )}
                    </small>
                  </span>
                </td>
                <td>
                  <form
                    className="auto-cart-form"
                    action={updateListingAutoCartAction}
                  >
                    <input
                      type="hidden"
                      name="listingId"
                      value={String(listing.id)}
                    />
                    <label
                      className="auto-cart-option"
                      htmlFor={`auto-cart-${String(listing.id)}`}
                    >
                      <input
                        id={`auto-cart-${String(listing.id)}`}
                        name="autoAddToCart"
                        type="checkbox"
                        defaultChecked={Boolean(listing.auto_add_to_cart)}
                        data-testid="auto-add-to-cart"
                      />
                      <span>Add one when available</span>
                    </label>
                    <button
                      className="button button-secondary"
                      type="submit"
                      data-testid="save-auto-add-to-cart"
                    >
                      Save
                    </button>
                  </form>
                </td>
                <td>{formatDate(listing.last_observed_at)}</td>
              </tr>
            ))}
            {!filteredListings.length ? (
              <tr>
                <td colSpan={8}>
                  <div className="listing-filter-empty">
                    <strong>No listings match these filters.</strong>
                    <span>
                      Try another retailer or status, or{" "}
                      <Link
                        className="inline-link"
                        href={listingsUrl(projectId)}
                        scroll={false}
                      >
                        show every listing
                      </Link>
                      .
                    </span>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RulesView({
  projectId,
  project,
  rules,
  notificationChannels,
  notificationDeliveries,
}: {
  projectId: string;
  project: Row;
  rules: Row[];
  notificationChannels: Row[];
  notificationDeliveries: Row[];
}) {
  const scheduleMode = String(project.default_schedule_mode ?? "SYSTEM");
  const selectedChannels = notificationChannels.filter(
    (channel) => Number(channel.selected) === 1,
  );
  const scheduleSummary =
    scheduleMode === "FIXED"
      ? `Every ${Number(project.default_interval_seconds ?? 60)} seconds`
      : scheduleMode === "BOUNDED"
        ? `Randomized between ${Number(project.default_interval_min_seconds ?? 60)}-${Number(project.default_interval_max_seconds ?? 120)} seconds`
        : `Adaptive, normally ${Number(project.default_interval_min_seconds ?? 60)}-${Number(project.default_interval_max_seconds ?? 120)} seconds`;

  return (
    <div className="rules-view">
      <section className="rule-pipeline" aria-labelledby="rule-pipeline-title">
        <div className="rule-pipeline-head">
          <div>
            <p className="eyebrow">Detection pipeline</p>
            <h2 id="rule-pipeline-title">How monitoring becomes an alert</h2>
            <p>
              Monitoring determines when DealHunter looks. Alert policies
              determine what qualifies after each successful check.
            </p>
          </div>
          <Link
            className="button button-secondary"
            href={`/projects/${projectId}?view=schedule`}
          >
            <Clock3 size={14} />
            Change monitoring
          </Link>
        </div>
        <div className="rule-pipeline-flow">
          <article className="rule-pipeline-step">
            <span className="rule-pipeline-icon">
              <Radar size={17} />
            </span>
            <div>
              <small>1. Check retailer</small>
              <strong>{scheduleSummary}</strong>
              <span>Each listing follows this default or its own override.</span>
            </div>
          </article>
          <ChevronRight className="rule-pipeline-arrow" size={18} />
          <article className="rule-pipeline-step">
            <span className="rule-pipeline-icon">
              <ShieldAlert size={17} />
            </span>
            <div>
              <small>2. Evaluate policy</small>
              <strong>Can an order be placed?</strong>
              <span>Then apply the optional maximum price.</span>
            </div>
          </article>
          <ChevronRight className="rule-pipeline-arrow" size={18} />
          <article className="rule-pipeline-step">
            <span className="rule-pipeline-icon">
              <Bell size={17} />
            </span>
            <div>
              <small>3. Send alert</small>
              <strong>
                {selectedChannels.length
                  ? `Send to ${selectedChannels.length} project destination${selectedChannels.length === 1 ? "" : "s"}`
                  : "Record in project alerts only"}
              </strong>
              <span>
                No repeat alert until the condition becomes false again.
              </span>
            </div>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Project alert delivery</h2>
            <p>
              Select the system destinations that receive qualifying alerts
              from this project.
            </p>
          </div>
          <Bell size={18} />
        </div>
        <form
          className="panel-body form-grid"
          action={updateProjectAlertDestinationsAction}
        >
          <input type="hidden" name="projectId" value={projectId} />
          {notificationChannels.length ? (
            <div className="destination-list field-wide">
              {notificationChannels.map((channel) => (
                <label className="destination-option" key={String(channel.id)}>
                  <input
                    name="channelId"
                    type="checkbox"
                    value={String(channel.id)}
                    defaultChecked={Number(channel.selected) === 1}
                    data-testid="project-alert-channel"
                  />
                  <span>
                    <strong>{String(channel.name)}</strong>
                    <small>
                      {String(channel.type)} webhook managed in system settings
                    </small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="rule-behavior-note field-wide">
              No external destinations are configured. Alerts will remain in
              this project&apos;s DealHunter history.{" "}
              <Link className="inline-link" href="/settings">
                Add a destination in Settings
              </Link>
              .
            </div>
          )}
          <div className="rule-behavior-note field-wide">
            Qualifying matches are always recorded in DealHunter. With no
            destination selected, this project sends no external notification.
          </div>
          <div className="form-actions">
            <button
              className="button button-amber"
              type="submit"
              data-testid="save-project-alert-delivery"
            >
              Save alert delivery
            </button>
          </div>
        </form>
      </section>

      <div className="section-grid section-grid-balanced">
        <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Alert policies</h2>
            <p>
              These run after every successful retailer check.
            </p>
          </div>
          <ShieldAlert size={18} />
        </div>
        <div className="rule-list">
          {rules.map((rule) => (
            <details
              className="rule-card"
              key={String(rule.id)}
              data-testid="rule-card"
            >
              <summary>
                <span className="rule-summary-main">
                  <span className="rule-icon">
                    <Pencil size={14} />
                  </span>
                  <span>
                    <strong>{String(rule.name)}</strong>
                    <small>
                      Earliest ordering opportunity
                      {rule.max_price_cents === null
                        ? " · no price ceiling"
                        : ` · at or below ${formatMoney(rule.max_price_cents)}`}
                    </small>
                  </span>
                </span>
                <span className="rule-summary-meta">
                  <StatusBadge
                    value={Number(rule.enabled) ? "ENABLED" : "DISABLED"}
                  />
                  <small>Alert on confirmed transition</small>
                </span>
              </summary>
              <div className="rule-editor">
                <form className="form-grid" action={updateRuleAction}>
                  <input type="hidden" name="ruleId" value={String(rule.id)} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <div className="field field-wide">
                    <label htmlFor={`edit-rule-name-${String(rule.id)}`}>
                      Rule name
                    </label>
                    <input
                      id={`edit-rule-name-${String(rule.id)}`}
                      name="name"
                      defaultValue={String(rule.name)}
                      required
                      data-testid="edit-rule-name"
                    />
                  </div>
                  <div className="rule-behavior-note">
                    Match: ordering is open through buy now, preorder,
                    backorder, or limited stock.
                  </div>
                  <div className="field">
                    <label htmlFor={`edit-rule-price-${String(rule.id)}`}>
                      Maximum price (optional)
                    </label>
                    <input
                      id={`edit-rule-price-${String(rule.id)}`}
                      name="maxPrice"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={
                        rule.max_price_cents === null
                          ? ""
                          : Number(rule.max_price_cents) / 100
                      }
                      placeholder="No price ceiling"
                    />
                  </div>
                  <div className="check-row">
                    <label>
                      <input
                        name="enabled"
                        type="checkbox"
                        defaultChecked={Number(rule.enabled) === 1}
                      />
                      Rule enabled
                    </label>
                  </div>
                  <div className="rule-behavior-note">
                    Evaluated after each successful check. Alerts once when the
                    result changes from non-actionable to actionable and the
                    price qualifies.
                  </div>
                  <div className="rule-editor-actions">
                    <span>
                      Last triggered {formatDate(rule.last_triggered_at)}
                    </span>
                    <button
                      className="button button-amber"
                      type="submit"
                      data-testid="save-rule"
                    >
                      Save rule
                    </button>
                  </div>
                </form>
                <form className="rule-delete-form" action={deleteRuleAction}>
                  <input type="hidden" name="ruleId" value={String(rule.id)} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <button
                    className="retailer-delete"
                    type="submit"
                    data-testid="delete-rule"
                  >
                    <Trash2 size={14} />
                    Delete rule
                  </button>
                </form>
              </div>
            </details>
          ))}
          {!rules.length ? (
            <div className="empty-state">No rules configured.</div>
          ) : null}
        </div>
        </section>

        <aside className="panel">
        <div className="panel-head">
          <div>
            <h2>Create alert policy</h2>
            <p>
              Define the price constraint applied after each retailer check.
            </p>
          </div>
        </div>
        <form className="panel-body form-grid" action={createRuleAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <div className="field field-wide">
            <label htmlFor="rule-name">Rule name</label>
            <input
              id="rule-name"
              name="name"
              required
              data-testid="rule-name"
            />
          </div>
          <div className="field">
            <label htmlFor="max-price">Maximum price (optional)</label>
            <input
              id="max-price"
              name="maxPrice"
              type="number"
              min="0"
              step="0.01"
              data-testid="rule-max-price"
              placeholder="No price ceiling"
            />
          </div>
          <div className="rule-behavior-note field-wide">
            This policy does not run on its own timer. It evaluates the result
            produced by{" "}
            <Link
              className="inline-link"
              href={`/projects/${projectId}?view=schedule`}
            >
              Monitoring
            </Link>
            .
          </div>
          <div className="form-actions">
            <button
              className="button button-amber"
              type="submit"
              data-testid="create-rule"
            >
              Activate alert
            </button>
          </div>
        </form>
        </aside>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Delivery ledger</h2>
            <p>
              External notification attempts generated by this project only.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Alert</th>
                <th>Destination</th>
                <th>Status</th>
                <th>HTTP</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {notificationDeliveries.map((delivery) => (
                <tr key={String(delivery.id)} data-testid="delivery-row">
                  <td>{formatDate(delivery.created_at)}</td>
                  <td className="primary-cell">
                    <strong>{String(delivery.alert_title)}</strong>
                    <small>{String(delivery.retailer ?? "Project alert")}</small>
                  </td>
                  <td>
                    {String(delivery.channel_name)}{" "}
                    <small>{String(delivery.channel_type)}</small>
                  </td>
                  <td>
                    <StatusBadge value={delivery.status} />
                  </td>
                  <td>{String(delivery.response_code ?? "—")}</td>
                  <td>{String(delivery.error_message ?? "Delivered")}</td>
                </tr>
              ))}
              {!notificationDeliveries.length ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No external delivery attempts for this project.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ScheduleView({
  project,
  listings,
}: {
  project: Row;
  listings: Row[];
}) {
  const projectId = String(project.id);
  return (
    <div className="section-grid section-grid-balanced">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Project monitoring schedule</h2>
            <p>Default cadence inherited by every listing in this hunt.</p>
          </div>
          <Clock3 size={18} />
        </div>
        <form
          className="panel-body form-grid"
          action={updateProjectScheduleAction}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <div className="field field-wide">
            <label htmlFor="project-schedule-mode">Default mode</label>
            <select
              id="project-schedule-mode"
              name="scheduleMode"
              defaultValue={String(
                project.default_schedule_mode ?? "SYSTEM",
              )}
              data-testid="project-schedule-mode"
            >
              <option value="SYSTEM">Adaptive randomized (recommended)</option>
              <option value="FIXED">Fixed interval (explicit override)</option>
              <option value="BOUNDED">Bounded range</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="project-fixed-seconds">Fixed seconds</label>
            <input
              id="project-fixed-seconds"
              name="fixedSeconds"
              type="number"
              min="60"
              defaultValue={Number(project.default_interval_seconds ?? 60)}
              data-testid="project-fixed-seconds"
            />
          </div>
          <div className="field">
            <label htmlFor="project-minimum-seconds">Minimum seconds</label>
            <input
              id="project-minimum-seconds"
              name="minimumSeconds"
              type="number"
              min="60"
              defaultValue={Number(
                project.default_interval_min_seconds ?? 60,
              )}
              data-testid="project-minimum-seconds"
            />
          </div>
          <div className="field">
            <label htmlFor="project-maximum-seconds">Maximum seconds</label>
            <input
              id="project-maximum-seconds"
              name="maximumSeconds"
              type="number"
              min="60"
              defaultValue={Number(
                project.default_interval_max_seconds ?? 120,
              )}
              data-testid="project-maximum-seconds"
            />
          </div>
          <div className="rule-behavior-note field-wide">
            Adaptive mode randomizes healthy checks within the minimum and
            maximum, then backs off further when recent failure or rate-limit
            rates rise. Retailer safety limits can slow this cadence, but never
            make it faster.
          </div>
          <div className="form-actions">
            <button
              className="button button-amber"
              type="submit"
              data-testid="save-project-schedule"
            >
              Save project schedule
            </button>
          </div>
        </form>
      </section>

      <aside className="panel">
        <div className="panel-head">
          <div>
            <h2>Configuration hierarchy</h2>
            <p>How the effective interval is selected.</p>
          </div>
        </div>
        <div className="panel-body hierarchy-list">
          <article className="hierarchy-step">
            <b>1</b>
            <div>
              <strong>Project default</strong>
              <span>The normal user-facing cadence for this hunt.</span>
            </div>
          </article>
          <article className="hierarchy-step">
            <b>2</b>
            <div>
              <strong>Retailer guardrail</strong>
              <span>
                Minimum interval, challenge cooldown, and concurrency.
              </span>
            </div>
          </article>
          <article className="hierarchy-step">
            <b>3</b>
            <div>
              <strong>Listing override</strong>
              <span>
                Optional exception configured on a product detail page.
              </span>
            </div>
          </article>
          <Link className="button button-secondary" href="/retailers">
            Configure retailer guardrails
          </Link>
        </div>
      </aside>

      <section className="panel schedule-listing-panel">
        <div className="panel-head">
          <div>
            <h2>Listing schedule status</h2>
            <p>Inheritance, overrides, and most recently selected interval.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Retailer</th>
                <th>Policy</th>
                <th>Last interval</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={String(listing.id)}>
                  <td className="primary-cell">
                    <Link
                      className="inline-link"
                      href={`/products/${String(listing.product_id)}`}
                    >
                      {String(listing.product_name)}
                    </Link>
                    <small>{String(listing.title)}</small>
                  </td>
                  <td>{String(listing.retailer)}</td>
                  <td>
                    {String(listing.schedule_mode ?? "INHERIT").replaceAll(
                      "_",
                      " ",
                    )}
                  </td>
                  <td>
                    {Number(
                      listing.last_interval_seconds ??
                        listing.interval_seconds,
                    )}{" "}
                    sec
                  </td>
                  <td className="log-detail">
                    {String(
                      listing.schedule_reason ||
                        "Awaiting the next scheduled observation.",
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function runsUrl(
  projectId: string,
  filters: MonitoringRunFilters,
  page: number,
) {
  const params = new URLSearchParams({ view: "runs", runPage: String(page) });
  if (filters.query) params.set("runQuery", filters.query);
  if (filters.productId) params.set("runProduct", filters.productId);
  if (filters.retailer) params.set("runRetailer", filters.retailer);
  if (filters.status) params.set("runStatus", filters.status);
  if (filters.availability) {
    params.set("runAvailability", filters.availability);
  }
  if (filters.source) params.set("runSource", filters.source);
  if (filters.pageSize) params.set("runPageSize", String(filters.pageSize));
  return `/projects/${projectId}?${params.toString()}`;
}

function RunsView({
  projectId,
  filters,
  data,
}: {
  projectId: string;
  filters: MonitoringRunFilters;
  data: ReturnType<typeof getProjectMonitoringRuns>;
}) {
  const firstResult = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const lastResult = Math.min(data.total, data.page * data.pageSize);
  const pageStart = Math.max(1, data.page - 2);
  const pageEnd = Math.min(data.totalPages, data.page + 2);
  const pageNumbers = Array.from(
    { length: pageEnd - pageStart + 1 },
    (_, index) => pageStart + index,
  );

  return (
    <div className="run-explorer" data-testid="monitoring-log">
      <section className="run-summary-grid">
      <article>
        <span>Matching checks</span>
        <strong>{Number(data.stats.total ?? 0)}</strong>
      </article>
      <article>
        <span>Successful</span>
        <strong>{Number(data.stats.successful ?? 0)}</strong>
      </article>
      <article>
        <span>Needs attention</span>
        <strong>{Number(data.stats.issues ?? 0)}</strong>
      </article>
      <article>
        <span>Average duration</span>
        <strong>{Number(data.stats.average_duration_ms ?? 0)} ms</strong>
      </article>
      </section>

      <section className="panel run-filter-panel">
      <div className="panel-head">
        <div>
          <h2>Filter checks</h2>
          <p>Selections are applied before pagination.</p>
        </div>
        <SlidersHorizontal size={18} />
      </div>
      <form className="run-filter-form" method="get">
        <input type="hidden" name="view" value="runs" />
        <div className="field run-search">
          <label htmlFor="run-query">Search</label>
          <div className="input-with-icon">
            <Search size={14} />
            <input
              id="run-query"
              name="runQuery"
              defaultValue={filters.query}
              placeholder="Product, retailer, or detail"
              data-testid="run-filter-query"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="run-product">Product</label>
          <select
            id="run-product"
            name="runProduct"
            defaultValue={filters.productId ?? ""}
            data-testid="run-filter-product"
          >
            <option value="">All products</option>
            {data.options.products.map((product) => (
              <option key={String(product.id)} value={String(product.id)}>
                {String(product.canonical_name)}
                {product.variant ? ` — ${String(product.variant)}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="run-retailer">Retailer</label>
          <select
            id="run-retailer"
            name="runRetailer"
            defaultValue={filters.retailer ?? ""}
            data-testid="run-filter-retailer"
          >
            <option value="">All retailers</option>
            {data.options.retailers.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="run-status">Result</label>
          <select
            id="run-status"
            name="runStatus"
            defaultValue={filters.status ?? ""}
            data-testid="run-filter-status"
          >
            <option value="">All results</option>
            {data.options.statuses.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="run-availability">Availability</label>
          <select
            id="run-availability"
            name="runAvailability"
            defaultValue={filters.availability ?? ""}
            data-testid="run-filter-availability"
          >
            <option value="">All states</option>
            {data.options.availabilities.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="run-source">Source</label>
          <select
            id="run-source"
            name="runSource"
            defaultValue={filters.source ?? ""}
            data-testid="run-filter-source"
          >
            <option value="">All sources</option>
            {data.options.sources.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="run-page-size">Rows</label>
          <select
            id="run-page-size"
            name="runPageSize"
            defaultValue={String(data.pageSize)}
            data-testid="run-page-size"
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <div className="run-filter-actions">
          <Link
            className="button button-secondary"
            href={`/projects/${projectId}?view=runs`}
          >
            Clear
          </Link>
          <button
            className="button button-amber"
            type="submit"
            data-testid="apply-run-filters"
          >
            Apply filters
          </button>
        </div>
      </form>
      </section>

      <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Monitoring run log</h2>
          <p>
            Showing {firstResult}–{lastResult} of {data.total} matching
            checks.
          </p>
        </div>
        <ScrollText size={18} />
      </div>
      {data.rows.length ? (
        <div className="run-list">
          {data.rows.map((run) => (
            <article className="run-row" key={String(run.id)} data-testid="run-row">
              <span
                className={
                  run.status === "SUCCESS"
                    ? "run-result-bar run-result-success"
                    : "run-result-bar run-result-issue"
                }
              />
              <div className="run-row-main">
                <div className="run-row-identity">
                  <Link href={`/products/${String(run.product_id)}`}>
                    <strong>{String(run.product_name)}</strong>
                  </Link>
                  <small>
                    {String(run.retailer)} · {String(run.title)}
                  </small>
                </div>
                <div className="run-row-badges">
                  <StatusBadge value={run.status} />
                  <StatusBadge
                    value={run.availability}
                    label={
                      run.availability_text
                        ? String(run.availability_text)
                        : null
                    }
                  />
                </div>
                <div className="run-row-price">
                  <strong>{formatMoney(run.price_cents)}</strong>
                  <small>{String(run.source ?? "Unknown source")}</small>
                </div>
                <div className="run-row-time">
                  <strong>{formatDate(run.started_at)}</strong>
                  <small>{Number(run.duration_ms ?? 0)} ms</small>
                </div>
              </div>
              <details className="run-details">
                <summary>View check details</summary>
                <div className="run-details-grid">
                  <div>
                    <span>Run identifier</span>
                    <code>{String(run.id)}</code>
                  </div>
                  <div>
                    <span>Confidence</span>
                    <strong>
                      {run.confidence === null
                        ? "—"
                        : `${Math.round(Number(run.confidence) * 100)}%`}
                    </strong>
                  </div>
                  <div className="run-details-wide">
                    <span>Result detail</span>
                    <p>{String(run.detail || "No additional detail.")}</p>
                  </div>
                  <div className="run-details-wide">
                    <span>Retailer URL</span>
                    <a
                      className="inline-link"
                      href={String(run.url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {String(run.url)}
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          No checks match the selected filters.
        </div>
      )}

      {data.totalPages > 1 ? (
        <nav className="pagination" aria-label="Monitoring log pages">
          <Link
            className={
              data.page === 1
                ? "pagination-link pagination-disabled"
                : "pagination-link"
            }
            href={runsUrl(projectId, filters, Math.max(1, data.page - 1))}
            aria-disabled={data.page === 1}
          >
            <ChevronLeft size={14} />
            Previous
          </Link>
          <div className="pagination-pages">
            {pageNumbers.map((page) => (
              <Link
                key={page}
                className={
                  page === data.page
                    ? "pagination-page pagination-page-active"
                    : "pagination-page"
                }
                href={runsUrl(projectId, filters, page)}
                aria-current={page === data.page ? "page" : undefined}
              >
                {page}
              </Link>
            ))}
          </div>
          <Link
            className={
              data.page === data.totalPages
                ? "pagination-link pagination-disabled"
                : "pagination-link"
            }
            href={runsUrl(
              projectId,
              filters,
              Math.min(data.totalPages, data.page + 1),
            )}
            aria-disabled={data.page === data.totalPages}
          >
            Next
            <ChevronRight size={14} />
          </Link>
        </nav>
      ) : null}
      </section>
    </div>
  );
}

function SetupView({ projectId }: { projectId: string }) {
  return (
    <section className="url-import-panel url-import-panel-only">
      <div>
        <p className="eyebrow">Add product</p>
        <h2>Paste a retailer product URL</h2>
        <p>
          DealHunter identifies the retailer and product, captures metadata and
          imagery, runs dual-model monitor learning, validates the generated
          recipe, and starts monitoring.
        </p>
        <Link className="inline-link" href="/retailers">
          Need another retailer? Manage the retailer registry.
        </Link>
      </div>
      <form className="url-import-form" action={addProductFromUrlAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <div className="field">
          <label htmlFor="url-product-url">Retailer product URL</label>
          <input
            id="url-product-url"
            name="url"
            type="url"
            required
            data-testid="url-product-url"
            placeholder="https://www.retailer.com/product/..."
          />
        </div>
        <div className="field">
          <label htmlFor="url-target-quantity">Desired quantity</label>
          <input
            id="url-target-quantity"
            name="targetQuantity"
            type="number"
            min="0"
            defaultValue="1"
            data-testid="url-target-quantity"
          />
        </div>
        <button
          className="button button-amber"
          type="submit"
          data-testid="add-product-from-url"
        >
          Learn and add product
        </button>
      </form>
    </section>
  );
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    view?: string;
    runQuery?: string;
    runProduct?: string;
    runRetailer?: string;
    runStatus?: string;
    runAvailability?: string;
    runSource?: string;
    runPage?: string;
    runPageSize?: string;
    listingRetailer?: string;
    listingStatus?: string;
  }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const requestedView = query.view;
  const activeView = views.some((view) => view.id === requestedView)
    ? (requestedView as ProjectView)
    : "overview";
  const data = getProject(projectId);
  if (!data) notFound();
  const {
    project,
    products,
    listings,
    rules,
    notificationChannels,
    notificationDeliveries,
    monitoringRuns,
  } = data;
  const retailerFilter = listings.some(
    (listing) => String(listing.retailer) === query.listingRetailer,
  )
    ? query.listingRetailer
    : undefined;
  const statusFilter = listings.some(
    (listing) => displayedAvailability(listing) === query.listingStatus,
  )
    ? query.listingStatus
    : undefined;
  const runFilters: MonitoringRunFilters = {
    query: query.runQuery?.trim() || undefined,
    productId: query.runProduct || undefined,
    retailer: query.runRetailer || undefined,
    status: query.runStatus || undefined,
    availability: query.runAvailability || undefined,
    source: query.runSource || undefined,
    page: Number(query.runPage || "1"),
    pageSize: Number(query.runPageSize || "25"),
  };
  const filteredRuns =
    activeView === "runs"
      ? getProjectMonitoringRuns(projectId, runFilters)
      : null;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Active project</p>
          <h1>{String(project.name)}</h1>
          <p className="lede">{String(project.description)}</p>
        </div>
        <form action={runProjectScanAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <button
            className="button button-amber"
            type="submit"
            data-testid="run-project-scan"
          >
            <Radar size={16} />
            Run all checks
          </button>
        </form>
      </header>

      <ProjectTabs projectId={projectId} activeView={activeView} />

      <div className="project-view">
        {activeView === "overview" ? (
          <OverviewView
            projectId={projectId}
            products={products}
            listings={listings}
            rules={rules}
            monitoringRuns={monitoringRuns}
          />
        ) : null}
        {activeView === "products" ? (
          <ProductsView products={products} listings={listings} />
        ) : null}
        {activeView === "listings" ? (
          <ListingsView
            projectId={projectId}
            listings={listings}
            retailerFilter={retailerFilter}
            statusFilter={statusFilter}
          />
        ) : null}
        {activeView === "rules" ? (
          <RulesView
            projectId={projectId}
            project={project}
            rules={rules}
            notificationChannels={notificationChannels}
            notificationDeliveries={notificationDeliveries}
          />
        ) : null}
        {activeView === "schedule" ? (
          <ScheduleView project={project} listings={listings} />
        ) : null}
        {activeView === "runs" ? (
          <RunsView
            projectId={projectId}
            filters={runFilters}
            data={filteredRuns!}
          />
        ) : null}
        {activeView === "setup" ? (
          <SetupView projectId={projectId} />
        ) : null}
      </div>
    </>
  );
}
