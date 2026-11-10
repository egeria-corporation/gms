// SPDX-License-Identifier: AGPL-3.0-only
// Connect a funder workspace to OpenGrants Passport (build spec §11.1). The admin creates an OAuth
// client in Passport's funder console and pastes its id and secret here; the secret is sent once
// and stored encrypted by the API. The GMS never holds bank details: Passport does.
import { useState, type FormEvent } from "react";
import { CircleCheck, CircleDashed, CircleX, ExternalLink } from "lucide-react";
import { useApiMutation, useApiQuery } from "../api/hooks.ts";
import type { PassportStatus } from "../api/types.ts";
import { env } from "../env.ts";
import { formatDate } from "../lib/format.ts";
import { ErrorBanner, Field, Loading } from "./ui.tsx";

const STATE = {
  pass: { icon: CircleCheck, cls: "rc-pass", word: "Connected" },
  fail: { icon: CircleX, cls: "rc-fail", word: "Not connected" },
  unknown: { icon: CircleDashed, cls: "rc-unk", word: "Unknown" },
} as const;

const REQUIRED_SCOPES = ["org:read", "payee:read", "award:write", "disbursement:read", "disbursement:write"];

export function PassportLinkPanel({ workspaceId, onLinked }: { workspaceId: string; onLinked?: (status: PassportStatus) => void }) {
  const status = useApiQuery((api) => api.passportStatus(workspaceId), [workspaceId]);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const link = useApiMutation((api) => api.linkPassport(workspaceId, { clientId: clientId.trim(), clientSecret }));
  const unlink = useApiMutation((api) => api.unlinkPassport(workspaceId));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = await link.run();
    if (!result) return;
    // The secret never stays in the page once it has been sent.
    setClientSecret("");
    status.set(result);
    if (result.linked) {
      setClientId("");
      onLinked?.(result);
    }
  }

  if (status.status === "loading") return <Loading label="Checking the Passport connection" />;
  if (status.status === "error") return <ErrorBanner error={status.error} onRetry={status.reload} title="The Passport connection could not be checked" />;
  const s = status.data;
  const look = STATE[s.check.state];
  const consoleUrl = s.passportOrgId ? `${env.passportBaseUrl}/funders/${s.passportOrgId}/clients` : env.passportBaseUrl;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className={`rc-row ${look.cls}`} style={{ borderTop: 0, padding: 0 }} role="status">
        <look.icon className="ic" role="img" aria-label={look.word} />
        <div>
          <div className="l">{s.linked ? (s.check.state === "pass" ? "Passport is connected" : s.check.state === "unknown" ? "Passport connection saved; status unknown" : "Passport connection needs attention") : "Passport is not connected"}</div>
          <div className="r">{s.check.reason}</div>
        </div>
        <span />
      </div>

      {s.linked && (
        <>
          <dl className="kv">
            <dt>Client</dt>
            <dd className="mono">{s.clientId}</dd>
            <dt>Linked</dt>
            <dd>{formatDate(s.linkedAt)}</dd>
            <dt>Last OK</dt>
            <dd>{s.lastOkAt ? formatDate(s.lastOkAt) : "Not yet"}</dd>
            <dt>Can release funds</dt>
            <dd>{s.canDebit === null ? "Unknown" : s.canDebit ? "Yes, a funding source can be debited" : "No funding source yet; add one in Passport"}</dd>
          </dl>
          {unlink.error !== null && <ErrorBanner error={unlink.error} />}
          <div className="row" style={{ gap: "8px" }}>
            <button type="button" className="btn btn-secondary" onClick={status.reload}>
              Check again
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={unlink.state === "saving"}
              onClick={async () => {
                if (await unlink.run()) status.reload();
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      )}

      {!s.linked && (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <ol style={{ listStyle: "decimal", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <li>
              Open your organization's client page in Passport.{" "}
              <a href={consoleUrl} target="_blank" rel="noopener noreferrer">
                Passport funder console <ExternalLink className="ic ic-sm" aria-hidden="true" />
              </a>
            </li>
            <li>
              Create a client with these scopes: <span className="mono">{REQUIRED_SCOPES.join(" ")}</span>
            </li>
            <li>Paste its id and secret below. Passport shows the secret once.</li>
          </ol>
          {link.error !== null && <ErrorBanner error={link.error} title="Passport could not be connected" />}
          <div className="fld-row">
            <Field id="passport-client-id" label="Client id" required>
              <input className="inp mono" id="passport-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" required />
            </Field>
            <Field id="passport-client-secret" label="Client secret" required help="Stored encrypted. It is never shown again.">
              <input className="inp mono" id="passport-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" minLength={8} required />
            </Field>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={link.state === "saving" || !clientId.trim() || clientSecret.length < 8}>
              Connect Passport
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
