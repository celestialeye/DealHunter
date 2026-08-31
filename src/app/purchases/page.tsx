import { ShieldCheck, ShoppingBag } from "lucide-react";

import { updatePurchaseIntentAction } from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { getPurchaseIntents } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function PurchasesPage() {
  const intents = getPurchaseIntents();
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Guarded execution</p>
          <h1>Purchase center</h1>
          <p className="lede">
            Matching rules create reviewable intents. Approval reserves the
            decision for assisted checkout; this build never submits a retailer
            order.
          </p>
        </div>
        <ShoppingBag size={28} color="var(--amber-deep)" />
      </header>

      <div className="callout">
        <strong>Safety boundary:</strong> approval verifies intent and quantity
        policy only. Retailer login, cart verification, final totals, and order
        submission remain disabled until a compliant retailer adapter is
        explicitly enabled.
      </div>

      <div className="section-title">
        <div>
          <h2>Purchase intents</h2>
          <p>Exact item, quantity, price, and retailer context are preserved.</p>
        </div>
        <ShieldCheck size={19} />
      </div>

      <section className="panel">
        {intents.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Product</th>
                  <th>Retailer</th>
                  <th>Quantity</th>
                  <th>Observed total</th>
                  <th>Ceiling</th>
                  <th>State</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {intents.map((intent) => (
                  <tr
                    key={String(intent.id)}
                    data-testid="purchase-intent-row"
                  >
                    <td>{formatDate(intent.created_at)}</td>
                    <td className="primary-cell">
                      <strong>{String(intent.product_name)}</strong>
                      <small>
                        {String(intent.variant || intent.listing_title)} ·{" "}
                        {String(intent.selection_mode)}
                      </small>
                    </td>
                    <td>{String(intent.retailer)}</td>
                    <td>{Number(intent.quantity)}</td>
                    <td>{formatMoney(intent.observed_total_cents)}</td>
                    <td>{formatMoney(intent.max_total_cents)}</td>
                    <td>
                      <StatusBadge value={intent.state} />
                    </td>
                    <td>
                      {intent.state === "AWAITING_APPROVAL" ? (
                        <div className="action-row">
                          <form action={updatePurchaseIntentAction}>
                            <input
                              type="hidden"
                              name="intentId"
                              value={String(intent.id)}
                            />
                            <input
                              type="hidden"
                              name="decision"
                              value="approve"
                            />
                            <button
                              className="button button-amber"
                              type="submit"
                              data-testid="approve-intent"
                            >
                              Approve
                            </button>
                          </form>
                          <form action={updatePurchaseIntentAction}>
                            <input
                              type="hidden"
                              name="intentId"
                              value={String(intent.id)}
                            />
                            <input
                              type="hidden"
                              name="decision"
                              value="reject"
                            />
                            <button
                              className="button button-secondary"
                              type="submit"
                            >
                              Reject
                            </button>
                          </form>
                        </div>
                      ) : (
                        "Decision recorded"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            No purchase intents. Purchase automation is separate from alert
            rules and is not currently enabled.
          </div>
        )}
      </section>
    </>
  );
}
