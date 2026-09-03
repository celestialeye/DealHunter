import {
  Bell,
  BrainCircuit,
  LockKeyhole,
  Send,
  ShoppingCart,
} from "lucide-react";

import {
  saveDiscordChannelAction,
  sendDiscordTestAction,
  updateCartAutomationProfileAction,
  updateLearningSettingsAction,
} from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { CART_AUTOMATION_TERMS_VERSION } from "@/lib/cart-actions";
import { formatDate } from "@/lib/format";
import {
  getCartAutomationSettings,
  getLearningSettings,
  getNotificationSettings,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const { channels, captures } = getNotificationSettings();
  const learning = getLearningSettings();
  const cartAutomation = getCartAutomationSettings();
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Workspace controls</p>
          <h1>Settings</h1>
          <p className="lede">
            Configure monitor learning models and reusable alert destinations.
            Each project chooses which destinations it uses.
          </p>
        </div>
        <LockKeyhole size={28} color="var(--amber-deep)" />
      </header>

      <section className="panel learning-settings-panel">
        <div className="panel-head">
          <div>
            <h2>Monitor learning models</h2>
            <p>
              Used only during initial URL learning and explicit relearning.
              Normal monitoring has no LLM calls.
            </p>
          </div>
          <BrainCircuit size={18} />
        </div>
        <form
          className="panel-body learning-settings-form"
          action={updateLearningSettingsAction}
        >
          <div className="field">
            <label htmlFor="dom-model">DOM analysis model</label>
            <select
              id="dom-model"
              name="domModel"
              defaultValue={learning.dom_model}
              data-testid="dom-learning-model"
            >
              <option value="gpt-5-mini">GPT-5 mini — recommended value</option>
              <option value="gpt-5.4-mini">GPT-5.4 mini</option>
              <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
              <option value="auto">Copilot automatic selection</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="visual-model">Screenshot analysis model</label>
            <select
              id="visual-model"
              name="visualModel"
              defaultValue={learning.visual_model}
              data-testid="visual-learning-model"
            >
              <option value="gpt-5-mini">GPT-5 mini — recommended value</option>
              <option value="gpt-5.4-mini">GPT-5.4 mini</option>
              <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
              <option value="auto">Copilot automatic selection</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="learning-effort">Reasoning effort</label>
            <select
              id="learning-effort"
              name="reasoningEffort"
              defaultValue={learning.reasoning_effort}
              data-testid="learning-effort"
            >
              <option value="low">Low — recommended</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="screening-engine">Screening engine</label>
            <select
              id="screening-engine"
              name="screeningEngine"
              defaultValue={learning.screening_engine}
              data-testid="screening-engine"
            >
              <option value="PLAYWRIGHT">Playwright — recommended</option>
              <option value="SELENIUMBASE">
                SeleniumBase — optional Python backend
              </option>
              <option value="AUTO">Automatic fallback</option>
            </select>
          </div>
          <div className="learning-model-note">
            <strong>Default: GPT-5 mini with low effort</strong>
            <span>
              Lowest-cost locally verified option that supports structured DOM
              analysis and screenshot attachments.
            </span>
          </div>
          <button
            className="button button-amber"
            type="submit"
            data-testid="save-learning-models"
          >
            Save learning models
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Automatic cart actions</h2>
            <p>
              Each product has one setting that applies to every retailer
              listing. Automatic cart handling is enabled by default.
            </p>
          </div>
          <ShoppingCart size={18} />
        </div>
        <div className="panel-body">
          <form
            className="form-grid"
            action={updateCartAutomationProfileAction}
          >
            <div className="field field-wide">
              <label htmlFor="chrome-profile-name">
                Signed-in Chrome profile name
              </label>
              <input
                id="chrome-profile-name"
                name="chromeProfileName"
                required
                defaultValue={String(
                  cartAutomation.settings.chrome_profile_name ?? "",
                )}
                placeholder="Peter"
                data-testid="cart-chrome-profile"
              />
              <small>
                The executor opens a dedicated window in this existing profile
                and rejects any profile mismatch.
              </small>
            </div>
            <div className="learning-model-note">
              <strong>Terms {CART_AUTOMATION_TERMS_VERSION}</strong>
              <span>
                Enabled products ensure one unit is present after fresh
                in-stock or preorder confirmation. Existing cart items are not
                duplicated. The executor cannot check out, buy now, place
                orders, or submit payment.
              </span>
            </div>
            <button
              className="button button-amber"
              type="submit"
              data-testid="save-cart-profile"
            >
              Save Chrome profile
            </button>
          </form>
        </div>
        {cartAutomation.actions.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Retailer</th>
                  <th>Status</th>
                  <th>Quantity proof</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {cartAutomation.actions.map((action) => (
                  <tr key={String(action.id)}>
                    <td className="primary-cell">
                      <strong>{String(action.product_name)}</strong>
                      <small>{String(action.listing_title)}</small>
                    </td>
                    <td>{String(action.retailer)}</td>
                    <td>
                      <StatusBadge value={String(action.status)} />
                      {action.error_message ? (
                        <small>{String(action.error_message)}</small>
                      ) : null}
                    </td>
                    <td>
                      {action.final_product_quantity !== null
                        ? `${String(action.baseline_product_quantity)} → ${String(action.final_product_quantity)} product units`
                        : "Not completed"}
                    </td>
                    <td>{formatDate(action.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div className="section-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Discord webhooks</h2>
              <p>
                System-managed destinations available for projects to select.
              </p>
            </div>
            <Bell size={18} />
          </div>
          {channels.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Added</th>
                    <th>Last test</th>
                    <th>Test</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((channel) => (
                    <tr key={String(channel.id)}>
                      <td className="primary-cell">
                        <strong>{String(channel.name)}</strong>
                        <small>Webhook secret encrypted at rest</small>
                      </td>
                      <td>{String(channel.type)}</td>
                      <td>
                        <StatusBadge
                          value={Number(channel.enabled) ? "ENABLED" : "DISABLED"}
                        />
                      </td>
                      <td>{formatDate(channel.created_at)}</td>
                      <td data-testid="channel-test-status">
                        {channel.last_test_status ? (
                          <span className="status-with-source">
                            <StatusBadge value={channel.last_test_status} />
                            <small>
                              {channel.last_test_error
                                ? String(channel.last_test_error)
                                : channel.last_test_response_code
                                  ? `HTTP ${String(channel.last_test_response_code)}`
                                  : "Connection completed"}
                            </small>
                          </span>
                        ) : (
                          "Not tested"
                        )}
                      </td>
                      <td>
                        <form action={sendDiscordTestAction}>
                          <input
                            type="hidden"
                            name="channelId"
                            value={String(channel.id)}
                          />
                          <button
                            className="button button-secondary"
                            type="submit"
                            data-testid="send-discord-test"
                          >
                            <Send size={14} />
                            Send test
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              No Discord destinations configured.
            </div>
          )}
        </section>

        <aside className="panel">
          <div className="panel-head">
            <div>
              <h2>Add destination</h2>
              <p>The webhook URL is sealed before database storage.</p>
            </div>
          </div>
          <form
            className="panel-body form-grid"
            action={saveDiscordChannelAction}
          >
            <div className="field field-wide">
              <label htmlFor="discord-name">Channel name</label>
              <input
                id="discord-name"
                name="name"
                required
                data-testid="discord-name"
                placeholder="Deal alerts"
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="discord-webhook">Discord webhook URL</label>
              <input
                id="discord-webhook"
                name="webhook"
                type="url"
                required
                data-testid="discord-webhook"
                placeholder="https://discord.com/api/webhooks/..."
              />
            </div>
            <div className="form-actions">
              <button
                className="button button-amber"
                type="submit"
                data-testid="save-discord"
              >
                Save encrypted webhook
              </button>
            </div>
          </form>
        </aside>
      </div>

      {captures.length ? (
        <>
          <div className="section-title">
            <div>
              <h2>Local E2E webhook captures</h2>
              <p>Only populated when local webhook testing is enabled.</p>
            </div>
          </div>
          <section className="panel panel-body" data-testid="discord-captures">
            {captures.map((capture) => (
              <pre className="code-block" key={capture.id}>
                {capture.payload}
              </pre>
            ))}
          </section>
        </>
      ) : null}
    </>
  );
}
