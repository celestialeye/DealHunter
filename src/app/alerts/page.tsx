import { BellRing, ExternalLink } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import { getAlerts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const alerts = getAlerts();
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Signal inbox</p>
          <h1>Alerts</h1>
          <p className="lede">
            Deal matches, monitoring degradation, account action, and purchase
            decisions remain visible even if an external delivery fails.
          </p>
        </div>
        <BellRing size={28} color="var(--amber-deep)" />
      </header>

      <section className="panel">
        {alerts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Alert</th>
                  <th>Project</th>
                  <th>Retailer</th>
                  <th>Status</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={String(alert.id)} data-testid="alert-row">
                    <td>{formatDate(alert.created_at)}</td>
                    <td className="primary-cell">
                      <strong>{String(alert.title)}</strong>
                      <small>{String(alert.message)}</small>
                    </td>
                    <td>{String(alert.project_name)}</td>
                    <td>{String(alert.retailer ?? "—")}</td>
                    <td>
                      <StatusBadge value={alert.status} />
                    </td>
                    <td>
                      {alert.url ? (
                        <a
                          className="inline-link"
                          href={String(alert.url)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Retailer <ExternalLink size={12} />
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">No alerts have been generated.</div>
        )}
      </section>
    </>
  );
}
