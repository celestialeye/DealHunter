import {
  ArrowUpRight,
  BellRing,
  FolderKanban,
  Radar,
  ScanSearch,
  ShoppingCart,
} from "lucide-react";
import Link from "next/link";

import { runProjectScanAction } from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { getDashboardData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const { stats, projects, listings, alerts } = getDashboardData();
  const primaryProjectId = projects[0] ? String(projects[0].id) : null;
  const metrics = [
    {
      label: "Active projects",
      value: stats.active_projects,
      icon: FolderKanban,
      href: "/projects",
      testId: "metric-projects",
    },
    {
      label: "Monitored listings",
      value: stats.monitored_listings,
      icon: Radar,
      href: primaryProjectId
        ? `/projects/${primaryProjectId}?view=listings`
        : "/projects",
      testId: "metric-listings",
    },
    {
      label: "In stock now",
      value: stats.in_stock,
      icon: ScanSearch,
      href: primaryProjectId
        ? `/projects/${primaryProjectId}?view=listings`
        : "/projects",
      testId: "metric-in-stock",
    },
    {
      label: "Open alerts",
      value: stats.open_alerts,
      icon: BellRing,
      href: "/alerts",
      testId: "metric-alerts",
    },
    {
      label: "Purchase approvals",
      value: stats.pending_purchases,
      icon: ShoppingCart,
      href: "/purchases",
      testId: "metric-purchases",
    },
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Live operations</p>
          <h1>Command center</h1>
          <p className="lede">
            See availability signals, monitoring health, and guarded purchase
            decisions across every hunt.
          </p>
        </div>
        <div className="action-row">
          <Link className="button button-secondary" href="/projects">
            Manage projects
          </Link>
          {projects[0] ? (
            <form action={runProjectScanAction}>
              <input
                type="hidden"
                name="projectId"
                value={String(projects[0].id)}
              />
              <button
                className="button button-amber"
                type="submit"
                data-testid="dashboard-scan"
              >
                <ScanSearch size={16} />
                Run priority scan
              </button>
            </form>
          ) : null}
        </div>
      </header>

      <section className="metric-grid" aria-label="Workspace metrics">
        {metrics.map(({ label, value, icon: Icon, href, testId }) => (
          <Link
            className="metric metric-link"
            href={href}
            key={label}
            data-testid={testId}
          >
            <Icon size={17} color="var(--amber-deep)" />
            <span className="metric-label">{label}</span>
            <strong className="metric-value">{Number(value)}</strong>
            <ArrowUpRight className="metric-arrow" size={16} />
          </Link>
        ))}
      </section>

      <div className="dashboard-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Priority watchlist</h2>
                <p>Listings ordered by actionable availability.</p>
              </div>
              <Link className="inline-link" href="/projects">
                View projects
              </Link>
            </div>
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
                  {listings.map((listing) => (
                    <tr key={String(listing.id)}>
                      <td className="primary-cell">
                        <a
                          className="product-link"
                          href={String(listing.url)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${String(listing.product_name)} at ${String(listing.retailer)}`}
                        >
                          <strong>{String(listing.product_name)}</strong>
                          <small>
                            {String(listing.variant || listing.title)}
                          </small>
                        </a>
                      </td>
                      <td>{String(listing.retailer)}</td>
                      <td>
                        <span className="status-with-source">
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
                                ? String(
                                    listing.current_availability_text ?? "",
                                  )
                                : String(listing.availability_hint_text ?? "")
                            }
                          />
                          <small>
                            {listing.last_result_status === "SUCCESS"
                              ? "Live observation"
                              : listing.availability_hint
                                ? "Official page evidence"
                                : "No current live evidence"}
                          </small>
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

          <section>
            <div className="section-title">
              <div>
                <h2>Active hunts</h2>
                <p>Coverage and live inventory by project.</p>
              </div>
            </div>
            <div className="project-grid">
              {projects.map((project) => (
                <Link
                  className="project-card"
                  href={`/projects/${String(project.id)}`}
                  key={String(project.id)}
                >
                  <p className="eyebrow">{String(project.status)}</p>
                  <h2>{String(project.name)}</h2>
                  <p>{String(project.description)}</p>
                  <div className="project-card-foot">
                    <span>{Number(project.product_count)} products</span>
                    <span>{Number(project.in_stock_count)} in stock</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <aside className="panel">
          <div className="panel-head">
            <div>
              <h2>Signal feed</h2>
              <p>Recent rule and monitoring events.</p>
            </div>
            <Link className="inline-link" href="/alerts">
              All alerts
            </Link>
          </div>
          {alerts.length ? (
            <div className="alert-list">
              {alerts.map((alert) => (
                <article className="alert-item" key={String(alert.id)}>
                  <span className="alert-bar" />
                  <div>
                    <h3>{String(alert.title)}</h3>
                    <p>{String(alert.message)}</p>
                    <small>
                      {String(alert.project_name)} ·{" "}
                      {formatDate(alert.created_at)}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              No alerts yet. Run a scan to evaluate active rules.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
