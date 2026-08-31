import {
  ArrowUpRight,
  BadgeCheck,
  Plus,
  Store,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import {
  createRetailerAction,
  deleteRetailerAction,
  updateRetailerAction,
} from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { getRetailers } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Row = Record<string, string | number | null>;

function domainList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.join(", ") : "";
  } catch {
    return "";
  }
}

function RetailerForm({
  retailer,
  create,
}: {
  retailer?: Row;
  create?: boolean;
}) {
  const action = create ? createRetailerAction : updateRetailerAction;
  return (
    <form className="retailer-detail-form" action={action}>
      {retailer ? (
        <input
          type="hidden"
          name="retailerId"
          value={String(retailer.id)}
        />
      ) : null}
      <div className="field field-wide">
        <label htmlFor="retailer-detail-name">Display name</label>
        <input
          id="retailer-detail-name"
          name="name"
          defaultValue={retailer ? String(retailer.name) : ""}
          required
          data-testid={create ? "new-retailer-name" : "edit-retailer-name"}
        />
      </div>
      <div className="field field-wide">
        <label htmlFor="retailer-detail-domains">
          Product domains, comma separated
        </label>
        <input
          id="retailer-detail-domains"
          name="domains"
          defaultValue={domainList(retailer?.domains_json)}
          required
          data-testid={create ? "new-retailer-domains" : undefined}
        />
      </div>
      <div className="field field-wide">
        <label htmlFor="retailer-detail-images">
          Image and CDN domains
        </label>
        <input
          id="retailer-detail-images"
          name="imageDomains"
          defaultValue={domainList(retailer?.image_domains_json)}
          data-testid={create ? "new-retailer-image-domains" : undefined}
        />
      </div>
      <div className="retailer-guardrail-grid">
        <div className="field">
          <label htmlFor="retailer-detail-minimum">
            Minimum interval
          </label>
          <input
            id="retailer-detail-minimum"
            name="minimumIntervalSeconds"
            type="number"
            min="60"
            defaultValue={Number(retailer?.minimum_interval_seconds ?? 60)}
          />
        </div>
        <div className="field">
          <label htmlFor="retailer-detail-concurrency">
            Browser concurrency
          </label>
          <input
            id="retailer-detail-concurrency"
            name="maxBrowserConcurrency"
            type="number"
            min="1"
            defaultValue={Number(retailer?.max_browser_concurrency ?? 2)}
          />
        </div>
        <div className="field">
          <label htmlFor="retailer-detail-cooldown">
            Challenge cooldown
          </label>
          <input
            id="retailer-detail-cooldown"
            name="challengeCooldownSeconds"
            type="number"
            min="60"
            defaultValue={Number(
              retailer?.challenge_cooldown_seconds ?? 900,
            )}
          />
        </div>
      </div>
      {!create ? (
        <div className="check-row">
          <label>
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={Number(retailer?.enabled) === 1}
            />
            Crawling enabled
          </label>
        </div>
      ) : null}
      <div className="retailer-detail-actions">
        <Link className="button button-secondary" href="/retailers">
          Cancel
        </Link>
        <button
          className="button button-amber"
          type="submit"
          data-testid={create ? "create-retailer" : "save-retailer"}
        >
          {create ? "Add retailer" : "Save retailer"}
        </button>
      </div>
    </form>
  );
}

export default async function RetailersPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  const query = await searchParams;
  const retailers = getRetailers();
  const selected = query.edit
    ? retailers.find((retailer) => String(retailer.id) === query.edit)
    : undefined;
  const creating = query.new === "1";

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Source registry</p>
          <h1>Retailers</h1>
          <p className="lede">
            Review retailer identity and safety guardrails without opening
            every record as an edit form.
          </p>
        </div>
        <div className="action-row">
          <Link className="button button-amber" href="/retailers?new=1">
            <Plus size={15} />
            Add retailer
          </Link>
        </div>
      </header>

      <div className="callout">
        <strong>Domain authenticity:</strong> built-in status verifies the
        retailer domain, not an individual marketplace seller.
      </div>

      <div className="retailer-master-layout">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Retailer registry</h2>
              <p>{retailers.length} configured sources.</p>
            </div>
            <Store size={18} />
          </div>
          <div className="table-wrap">
            <table className="retailer-table">
              <thead>
                <tr>
                  <th>Retailer</th>
                  <th>Domains</th>
                  <th>Listings</th>
                  <th>Guardrails</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {retailers.map((retailer) => (
                  <tr
                    key={String(retailer.id)}
                    data-testid="retailer-row"
                  >
                    <td className="primary-cell">
                      <strong>{String(retailer.name)}</strong>
                      <small>
                        {String(retailer.authenticity_status).replaceAll(
                          "_",
                          " ",
                        )}
                      </small>
                    </td>
                    <td className="retailer-domain-cell">
                      {domainList(retailer.domains_json)}
                    </td>
                    <td>{Number(retailer.listing_count)}</td>
                    <td>
                      <span className="retailer-guardrail-summary">
                        <strong>
                          ≥ {Number(retailer.minimum_interval_seconds)} sec
                        </strong>
                        <small>
                          {Number(retailer.max_browser_concurrency)} browser ·{" "}
                          {Number(retailer.challenge_cooldown_seconds)} sec
                          cooldown
                        </small>
                      </span>
                    </td>
                    <td>
                      <StatusBadge
                        value={Number(retailer.enabled) ? "ENABLED" : "DISABLED"}
                      />
                    </td>
                    <td>
                      <Link
                        className="table-action"
                        href={`/retailers?edit=${String(retailer.id)}`}
                        data-testid="edit-retailer"
                      >
                        Edit
                        <ArrowUpRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="panel retailer-detail-panel">
          <div className="panel-head">
            <div>
              <h2>
                {creating
                  ? "Add retailer"
                  : selected
                    ? `Edit ${String(selected.name)}`
                    : "Retailer details"}
              </h2>
              <p>
                {creating
                  ? "Register a custom product source."
                  : selected
                    ? "Update identity and safety guardrails."
                    : "Select Edit beside one retailer."}
              </p>
            </div>
            {selected?.authenticity_status === "BUILT_IN" ? (
              <BadgeCheck size={18} />
            ) : null}
          </div>
          <div className="panel-body">
            {creating ? <RetailerForm create /> : null}
            {selected ? <RetailerForm retailer={selected} /> : null}
            {!creating && !selected ? (
              <div className="retailer-detail-empty">
                <Store size={30} />
                <strong>No retailer selected</strong>
                <span>
                  The registry stays compact until you choose a record to edit.
                </span>
              </div>
            ) : null}
            {selected &&
            selected.authenticity_status !== "BUILT_IN" ? (
              <form
                className="retailer-detail-delete"
                action={deleteRetailerAction}
              >
                <input
                  type="hidden"
                  name="retailerId"
                  value={String(selected.id)}
                />
                <button
                  className="retailer-delete"
                  type="submit"
                  data-testid="delete-retailer"
                >
                  <Trash2 size={14} />
                  Delete custom retailer
                </button>
              </form>
            ) : null}
          </div>
        </aside>
      </div>
    </>
  );
}
