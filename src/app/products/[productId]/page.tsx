/* eslint-disable @next/next/no-img-element */
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageIcon,
  Radar,
  RefreshCw,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  deleteListingAction,
  refreshProductDetailsAction,
  relearnListingAction,
  updateProductAutoCartAction,
  updateListingScheduleAction,
} from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import {
  getProduct,
  getProductMonitoringTimeline,
  type ProductTimelineFilters,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;

function searchValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{
    timelineRetailer?: SearchValue;
    timelineStatus?: SearchValue;
    timelineAvailability?: SearchValue;
    timelineSource?: SearchValue;
    timelineRange?: SearchValue;
    timelinePage?: SearchValue;
    timelinePageSize?: SearchValue;
  }>;
}) {
  const { productId } = await params;
  const rawQuery = await searchParams;
  const query = Object.fromEntries(
    Object.entries(rawQuery).map(([key, value]) => [key, searchValue(value)]),
  ) as Record<string, string | undefined>;
  const data = getProduct(productId);
  if (!data) notFound();
  const { product, listings, learningRuns } = data;
  const range = ["24h", "7d", "30d", "all"].includes(
    query.timelineRange ?? "",
  )
    ? (query.timelineRange as ProductTimelineFilters["range"])
    : "7d";
  const timelineFilters: ProductTimelineFilters = {
    retailer: query.timelineRetailer || undefined,
    status: query.timelineStatus || undefined,
    availability: query.timelineAvailability || undefined,
    source: query.timelineSource || undefined,
    range,
    page: Number(query.timelinePage || "1"),
    pageSize: Number(query.timelinePageSize || "25"),
  };
  const timeline = getProductMonitoringTimeline(productId, timelineFilters);
  const image = product.image_local_path ?? product.image_url;
  const firstResult =
    timeline.total === 0 ? 0 : (timeline.page - 1) * timeline.pageSize + 1;
  const lastResult = Math.min(
    timeline.total,
    timeline.page * timeline.pageSize,
  );

  function timelineUrl(page: number) {
    const params = new URLSearchParams({ timelinePage: String(page) });
    if (timelineFilters.retailer) {
      params.set("timelineRetailer", timelineFilters.retailer);
    }
    if (timelineFilters.status) {
      params.set("timelineStatus", timelineFilters.status);
    }
    if (timelineFilters.availability) {
      params.set("timelineAvailability", timelineFilters.availability);
    }
    if (timelineFilters.source) {
      params.set("timelineSource", timelineFilters.source);
    }
    if (timelineFilters.range) {
      params.set("timelineRange", timelineFilters.range);
    }
    if (timelineFilters.pageSize) {
      params.set("timelinePageSize", String(timelineFilters.pageSize));
    }
    return `/products/${productId}?${params.toString()}`;
  }

  return (
    <>
      <Link
        className="back-link"
        href={`/projects/${String(product.project_id)}?view=products`}
      >
        <ArrowLeft size={14} />
        Back to {String(product.project_name)}
      </Link>

      <section className="product-hero">
        <div className="product-image-frame">
          {image ? (
            <img
              src={String(image)}
              alt={String(product.canonical_name)}
              data-testid="product-image"
            />
          ) : (
            <div className="product-image-placeholder">
              <ImageIcon size={34} />
              <span>No cached image</span>
            </div>
          )}
        </div>

        <div className="product-hero-content">
          <p className="eyebrow">Canonical product</p>
          <h1>{String(product.canonical_name)}</h1>
          {product.variant ? (
            <p className="product-variant">{String(product.variant)}</p>
          ) : null}
          <p className="lede">
            {String(
              product.description ||
                product.notes ||
                "Product details will be enriched from its retailer source.",
            )}
          </p>

          <div className="product-facts">
            <div>
              <span>Acquisition goal</span>
              <strong>
                {Number(product.owned_quantity)} /{" "}
                {Number(product.target_quantity)}
              </strong>
            </div>
            <div>
              <span>Expected price</span>
              <strong>{formatMoney(product.expected_price_cents)}</strong>
            </div>
            <div>
              <span>Best monitored</span>
              <strong>{formatMoney(product.best_price_cents)}</strong>
            </div>
            <div>
              <span>Retailer coverage</span>
              <strong>{Number(product.listing_count)} listings</strong>
            </div>
          </div>

          <div className="action-row">
            <form action={refreshProductDetailsAction}>
              <input type="hidden" name="productId" value={productId} />
              <button className="button button-amber" type="submit">
                <RefreshCw size={15} />
                Refresh retailer details
              </button>
            </form>
            {product.source_url ? (
              <a
                className="button button-secondary"
                href={String(product.source_url)}
                target="_blank"
                rel="noreferrer"
              >
                Open source page
                <ExternalLink size={14} />
              </a>
            ) : null}
          </div>
          <form
            className="product-auto-cart-control"
            action={updateProductAutoCartAction}
          >
            <input type="hidden" name="productId" value={productId} />
            <div className="product-auto-cart-copy">
              <span className="product-auto-cart-icon" aria-hidden="true">
                <ShoppingCart size={18} />
              </span>
              <span>
                <strong>Keep one in cart automatically</strong>
                <small>
                  Applies to every retailer listing. After confirmed
                  availability, DealHunter adds one only when the exact item is
                  not already in that retailer cart.
                </small>
              </span>
            </div>
            <div className="product-auto-cart-actions">
              <label
                className="product-auto-cart-toggle"
                htmlFor="product-auto-add-to-cart"
              >
                <input
                  id="product-auto-add-to-cart"
                  name="autoAddToCart"
                  type="checkbox"
                  defaultChecked={Boolean(product.auto_add_to_cart)}
                  data-testid="auto-add-to-cart"
                />
                <span className="product-auto-cart-switch" aria-hidden="true" />
                <span>Auto-add</span>
              </label>
              <button
                className="button button-secondary"
                type="submit"
                data-testid="save-auto-add-to-cart"
              >
                Save setting
              </button>
            </div>
          </form>
          {product.image_url ? (
            <small className="source-note">
              Image cached for private monitoring from the retailer-provided
              source.{" "}
              <a
                className="inline-link"
                href={String(product.image_source_url ?? product.image_url)}
                target="_blank"
                rel="noreferrer"
              >
                Image source
              </a>
            </small>
          ) : null}
          {product.metadata_status === "FAILED" ? (
            <div className="metadata-warning">
              The last automatic metadata crawl could not complete:{" "}
              {String(product.metadata_error)}. Monitoring continues with the
              existing listing data.
            </div>
          ) : null}
        </div>
      </section>

      <div className="section-title">
        <div>
          <h2>Retail monitoring</h2>
          <p>Current normalized state across every listing for this product.</p>
        </div>
        <Store size={19} />
      </div>
      <section className="retailer-card-grid">
        {listings.map((listing) => (
          <article className="retailer-card" key={String(listing.id)}>
            <div className="retailer-card-head">
              <div>
                <span>{String(listing.retailer)}</span>
                <small>
                  {String(listing.authenticity_status ?? "UNVERIFIED").replaceAll(
                    "_",
                    " ",
                  )}
                </small>
              </div>
              <StatusBadge
                value={
                  listing.current_availability !== "UNKNOWN"
                    ? listing.current_availability
                    : listing.availability_hint ||
                      (listing.last_result_status === "CHALLENGE"
                        ? "CHALLENGE"
                        : "UNKNOWN")
                }
                label={
                  listing.current_availability !== "UNKNOWN"
                    ? String(listing.current_availability_text ?? "")
                    : String(listing.availability_hint_text ?? "")
                }
              />
            </div>
            <strong className="retailer-price">
              {formatMoney(
                listing.current_price_cents ?? product.expected_price_cents,
              )}
            </strong>
            {listing.last_result_status !== "SUCCESS" ? (
              <small className="retailer-price-source">
                Known price · live monitoring is currently challenged
              </small>
            ) : null}
            <p>{String(listing.title)}</p>
            <div className="retailer-card-meta">
              <span>
                {String(listing.schedule_mode ?? "SYSTEM").replaceAll("_", " ")}
                {listing.last_interval_seconds
                  ? ` · last ${Number(listing.last_interval_seconds)} sec`
                  : ""}
              </span>
              <span>{formatDate(listing.last_observed_at)}</span>
            </div>
            {listing.last_result_status &&
            listing.last_result_status !== "SUCCESS" ? (
              <div className="listing-health-warning">
                <StatusBadge value={listing.last_result_status} />
                <span>
                  {String(
                    listing.last_result_detail ||
                      "The last monitoring attempt did not complete.",
                  )}
                </span>
              </div>
            ) : null}
            {listing.availability_hint ? (
              <div className="listing-availability-hint">
                <strong>
                  Indexed hint:{" "}
                  {String(listing.availability_hint).replaceAll("_", " ")}
                </strong>
                <span>
                  Non-live evidence from{" "}
                  {String(listing.availability_hint_source).replaceAll(
                    "_",
                    " ",
                  )}
                  {listing.availability_hint_observed_at
                    ? ` · recorded ${formatDate(listing.availability_hint_observed_at)}`
                    : ""}
                </span>
              </div>
            ) : null}
            <div className="recipe-status">
              <div>
                <span>Monitor recipe</span>
                <strong>
                  {listing.active_recipe_id
                    ? `v${Number(listing.active_recipe_version)} · ${String(
                        listing.active_recipe_strategy,
                      ).replaceAll("_", " ")}`
                    : "Not learned"}
                </strong>
              </div>
              {listing.active_recipe_status ? (
                <StatusBadge value={listing.active_recipe_status} />
              ) : null}
            </div>
            <form action={relearnListingAction}>
              <input
                type="hidden"
                name="listingId"
                value={String(listing.id)}
              />
              <input type="hidden" name="productId" value={productId} />
              <button
                className="button button-secondary retailer-open"
                type="submit"
                data-testid="relearn-listing"
              >
                <RefreshCw size={14} />
                {listing.active_recipe_id
                  ? "Relearn monitoring"
                  : "Learn monitoring"}
              </button>
            </form>
            <details className="schedule-editor">
              <summary>Monitoring schedule</summary>
              <form
                className="schedule-form"
                action={updateListingScheduleAction}
              >
                <input
                  type="hidden"
                  name="listingId"
                  value={String(listing.id)}
                />
                <input type="hidden" name="productId" value={productId} />
                <div className="field">
                  <label htmlFor={`schedule-mode-${String(listing.id)}`}>
                    Mode
                  </label>
                  <select
                    id={`schedule-mode-${String(listing.id)}`}
                    name="scheduleMode"
                    defaultValue={String(listing.schedule_mode ?? "SYSTEM")}
                    data-testid="schedule-mode"
                  >
                    <option value="INHERIT">Use project default</option>
                    <option value="SYSTEM">
                      Adaptive randomized (recommended)
                    </option>
                    <option value="FIXED">
                      Fixed interval (explicit override)
                    </option>
                    <option value="BOUNDED">Bounded range</option>
                  </select>
                </div>
                <div className="schedule-number-grid">
                  <div className="field">
                    <label htmlFor={`fixed-seconds-${String(listing.id)}`}>
                      Fixed seconds
                    </label>
                    <input
                      id={`fixed-seconds-${String(listing.id)}`}
                      name="fixedSeconds"
                      type="number"
                      min="60"
                      defaultValue={Number(listing.interval_seconds ?? 60)}
                      data-testid="schedule-fixed"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`minimum-seconds-${String(listing.id)}`}>
                      Minimum
                    </label>
                    <input
                      id={`minimum-seconds-${String(listing.id)}`}
                      name="minimumSeconds"
                      type="number"
                      min="60"
                      defaultValue={Number(
                        listing.interval_min_seconds ?? 60,
                      )}
                      data-testid="schedule-minimum"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`maximum-seconds-${String(listing.id)}`}>
                      Maximum
                    </label>
                    <input
                      id={`maximum-seconds-${String(listing.id)}`}
                      name="maximumSeconds"
                      type="number"
                      min="60"
                      defaultValue={Number(
                        listing.interval_max_seconds ?? 120,
                      )}
                      data-testid="schedule-maximum"
                    />
                  </div>
                </div>
                <p className="schedule-reason">
                  {String(
                    listing.schedule_reason ||
                      "Adaptive mode randomizes healthy checks and backs off when retailer failure or rate-limit rates rise.",
                  )}
                </p>
                <button
                  className="button button-secondary"
                  type="submit"
                  data-testid="save-schedule"
                >
                  Save schedule
                </button>
              </form>
            </details>
            <a
              className="button button-secondary retailer-open"
              href={String(listing.url)}
              target="_blank"
              rel="noreferrer"
            >
              Open product page
              <ExternalLink size={14} />
            </a>
            <form className="listing-remove-form" action={deleteListingAction}>
              <input
                type="hidden"
                name="listingId"
                value={String(listing.id)}
              />
              <input type="hidden" name="productId" value={productId} />
              <button
                className="retailer-delete listing-remove"
                type="submit"
                data-testid="remove-listing"
              >
                <Trash2 size={14} />
                Remove monitoring
              </button>
            </form>
          </article>
        ))}
        {!listings.length ? (
          <div className="empty-state retailer-card-empty">
            No retailer listings are being monitored for this product.
          </div>
        ) : null}
      </section>

      {learningRuns.length ? (
        <>
          <div className="section-title">
            <div>
              <h2>Learning history</h2>
              <p>Dual DOM and screenshot analysis used to compile recipes.</p>
            </div>
          </div>
          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Retailer</th>
                    <th>Trigger</th>
                    <th>Provider and models</th>
                    <th>Screening</th>
                    <th>Page state</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {learningRuns.map((run) => (
                    <tr key={String(run.id)} data-testid="learning-run-row">
                      <td>{formatDate(run.started_at)}</td>
                      <td>{String(run.retailer)}</td>
                      <td>{String(run.trigger_type).replaceAll("_", " ")}</td>
                      <td className="primary-cell">
                        <strong>{String(run.provider)}</strong>
                        <small>{String(run.model)}</small>
                      </td>
                      <td>{String(run.screening_engine ?? "—")}</td>
                      <td>{String(run.page_state ?? "—")}</td>
                      <td>
                        <StatusBadge value={run.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      <div className="section-title">
        <div>
          <h2>Monitoring timeline</h2>
          <p>
            Observed price and availability merged with execution status,
            duration, confidence, and parser details.
          </p>
        </div>
        <Radar size={19} />
      </div>

      <section
        className="run-explorer"
        data-testid="product-monitoring-timeline"
      >
        <div className="run-summary-grid">
          <article>
            <span>Matching events</span>
            <strong>{Number(timeline.stats.total ?? 0)}</strong>
          </article>
          <article>
            <span>Successful checks</span>
            <strong>{Number(timeline.stats.successful ?? 0)}</strong>
          </article>
          <article>
            <span>Needs attention</span>
            <strong>{Number(timeline.stats.issues ?? 0)}</strong>
          </article>
          <article>
            <span>Average duration</span>
            <strong>
              {Number(timeline.stats.average_duration_ms ?? 0)} ms
            </strong>
          </article>
        </div>

        <section className="panel run-filter-panel">
          <div className="panel-head">
            <div>
              <h2>Filter timeline</h2>
              <p>Filter before pagination to isolate a retailer or outcome.</p>
            </div>
            <SlidersHorizontal size={18} />
          </div>
          <form className="product-timeline-filters" method="get">
            <div className="field">
              <label htmlFor="timeline-retailer">Retailer</label>
              <select
                id="timeline-retailer"
                name="timelineRetailer"
                defaultValue={timelineFilters.retailer ?? ""}
                data-testid="timeline-filter-retailer"
              >
                <option value="">All retailers</option>
                {timeline.options.retailers.map((retailer) => (
                  <option key={retailer} value={retailer}>
                    {retailer}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="timeline-status">Check result</label>
              <select
                id="timeline-status"
                name="timelineStatus"
                defaultValue={timelineFilters.status ?? ""}
                data-testid="timeline-filter-status"
              >
                <option value="">All results</option>
                {timeline.options.statuses.map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="timeline-availability">Availability</label>
              <select
                id="timeline-availability"
                name="timelineAvailability"
                defaultValue={timelineFilters.availability ?? ""}
                data-testid="timeline-filter-availability"
              >
                <option value="">All states</option>
                {timeline.options.availabilities.map((availability) => (
                  <option key={availability} value={availability}>
                    {availability.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="timeline-source">Source</label>
              <select
                id="timeline-source"
                name="timelineSource"
                defaultValue={timelineFilters.source ?? ""}
                data-testid="timeline-filter-source"
              >
                <option value="">All sources</option>
                {timeline.options.sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="timeline-range">Time range</label>
              <select
                id="timeline-range"
                name="timelineRange"
                defaultValue={timelineFilters.range}
                data-testid="timeline-filter-range"
              >
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All history</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="timeline-size">Rows</label>
              <select
                id="timeline-size"
                name="timelinePageSize"
                defaultValue={String(timeline.pageSize)}
                data-testid="timeline-page-size"
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
                href={`/products/${productId}`}
              >
                Clear
              </Link>
              <button
                className="button button-amber"
                type="submit"
                data-testid="apply-timeline-filters"
              >
                Apply filters
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Monitoring events</h2>
              <p>
                Showing {firstResult}–{lastResult} of {timeline.total} events.
              </p>
            </div>
          </div>
          {timeline.rows.length ? (
            <div className="run-list">
              {timeline.rows.map((event) => (
                <article
                  className="run-row"
                  key={String(event.id)}
                  data-testid="timeline-row"
                >
                  <span
                    className={
                      event.run_status === "SUCCESS"
                        ? "run-result-bar run-result-success"
                        : "run-result-bar run-result-issue"
                    }
                  />
                  <div className="timeline-row-main">
                    <div className="run-row-identity">
                      <strong>{String(event.retailer)}</strong>
                      <small>{String(event.title)}</small>
                    </div>
                    <div className="run-row-badges">
                      <StatusBadge value={event.run_status} />
                      <StatusBadge
                        value={event.availability}
                        label={
                          event.availability_text
                            ? String(event.availability_text)
                            : null
                        }
                      />
                    </div>
                    <div className="run-row-price">
                      <strong>{formatMoney(event.price_cents)}</strong>
                      <small>{String(event.source ?? "Unknown source")}</small>
                    </div>
                    <div className="run-row-time">
                      <strong>
                        {formatDate(event.observed_at ?? event.started_at)}
                      </strong>
                      <small>{Number(event.duration_ms ?? 0)} ms</small>
                    </div>
                  </div>
                  <details className="run-details">
                    <summary>View execution details</summary>
                    <div className="run-details-grid">
                      <div>
                        <span>Run identifier</span>
                        <code>{String(event.id)}</code>
                      </div>
                      <div>
                        <span>Confidence</span>
                        <strong>
                          {event.confidence === null
                            ? "—"
                            : `${Math.round(Number(event.confidence) * 100)}%`}
                        </strong>
                      </div>
                      <div className="run-details-wide">
                        <span>Execution detail</span>
                        <p>
                          {String(
                            event.run_detail || "No additional detail.",
                          )}
                        </p>
                      </div>
                      <div className="run-details-wide">
                        <span>Retailer page</span>
                        <a
                          className="inline-link"
                          href={String(event.url)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {String(event.url)}
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
              No monitoring events match the selected filters.
            </div>
          )}

          {timeline.totalPages > 1 ? (
            <nav className="pagination" aria-label="Product monitoring pages">
              <Link
                className={
                  timeline.page === 1
                    ? "pagination-link pagination-disabled"
                    : "pagination-link"
                }
                href={timelineUrl(Math.max(1, timeline.page - 1))}
                aria-disabled={timeline.page === 1}
              >
                <ChevronLeft size={14} />
                Previous
              </Link>
              <span className="pagination-status">
                Page {timeline.page} of {timeline.totalPages}
              </span>
              <Link
                className={
                  timeline.page === timeline.totalPages
                    ? "pagination-link pagination-disabled"
                    : "pagination-link"
                }
                href={timelineUrl(
                  Math.min(timeline.totalPages, timeline.page + 1),
                )}
                aria-disabled={timeline.page === timeline.totalPages}
              >
                Next
                <ChevronRight size={14} />
              </Link>
            </nav>
          ) : null}
        </section>
      </section>
    </>
  );
}
