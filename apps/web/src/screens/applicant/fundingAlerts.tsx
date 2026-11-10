// SPDX-License-Identifier: AGPL-3.0-only
// Funding alerts: searches OpenGrants keeps watching for the organization. Creating one registers
// it with OpenGrants; the list is kept with the workspace's saved listings.
import { useState, type FormEvent } from "react";
import { BellRing, Check } from "lucide-react";
import { useFullMutation, useFullQuery } from "../../api/applicantFullHooks.ts";
import { Loaded } from "../../components/applicant.tsx";
import { EmptyState, ErrorBanner, Field } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

export function FundingAlerts() {
  const query = useFullQuery((api) => api.alerts(), []);
  const [text, setText] = useState("");
  const create = useFullMutation((api, q: string) => api.createAlert(q));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await create.run(text.trim())) {
      setText("");
      query.reload();
    }
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
      <section className="card" aria-labelledby="alerts-h">
        <div className="card-h">
          <div>
            <h2 id="alerts-h" style={{ fontSize: "18px" }}>
              Alerts
            </h2>
            <p className="small muted">OpenGrants watches for new funding that matches, using your organization's type, region and mission.</p>
          </div>
        </div>
        <Loaded query={query} label="Loading your alerts">
          {(alerts) =>
            alerts.length === 0 ? (
              <EmptyState icon={BellRing} title="No alerts yet">
                Create one for a topic you search for often, and new matches will be sent to you.
              </EmptyState>
            ) : (
              <ul>
                {alerts.map((a, i) => (
                  <li key={a.id} className="row" style={{ gap: "12px", padding: "14px 20px", borderTop: i ? "1px solid var(--og-gray-100)" : 0, flexWrap: "wrap" }}>
                    <BellRing className="ic" aria-hidden="true" style={{ color: "var(--og-teal-dark)" }} />
                    <div className="grow">
                      <div className="b">{a.query}</div>
                      {a.createdAt ? <div className="small muted">Watching since {formatDate(a.createdAt)}</div> : null}
                    </div>
                    <span className="bdg bdg-ok">
                      <Check className="ic" aria-hidden="true" />
                      Active
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </Loaded>
      </section>
      <form className="card" onSubmit={onSubmit} aria-labelledby="new-alert-h">
        <div className="card-h">
          <h3 id="new-alert-h">New alert</h3>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <Field id="alert-query" label="Watch for" help="For example: rural health navigation, housing stability.">
            <input id="alert-query" className="inp" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {create.error ? <ErrorBanner error={create.error} title="The alert was not created" /> : null}
          <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={!text.trim() || create.state === "saving"}>
            <BellRing className="ic" aria-hidden="true" />
            Create alert
          </button>
        </div>
      </form>
    </div>
  );
}
