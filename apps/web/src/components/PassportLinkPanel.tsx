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

import { translator } from "../i18n/index.tsx";

const t = translator("shared");
const STATE = {
  pass: {
    icon: CircleCheck,
    cls: "rc-pass",
    get word() {
      return t("passportLinkPanel.state.pass");
    },
  },
  fail: {
    icon: CircleX,
    cls: "rc-fail",
    get word() {
      return t("passportLinkPanel.state.fail");
    },
  },
  unknown: {
    icon: CircleDashed,
    cls: "rc-unk",
    get word() {
      return t("passportLinkPanel.state.unknown");
    },
  },
};

const REQUIRED_SCOPES = ["org:read", "payee:read", "award:write", "disbursement:read", "disbursement:write"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function PassportLinkPanel({ workspaceId, onLinked }: { workspaceId: string; onLinked?: (status: PassportStatus) => void }) {
  const status = useApiQuery((api) => api.passportStatus(workspaceId), [workspaceId]);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [orgId, setOrgId] = useState("");
  const link = useApiMutation((api) => api.linkPassport(workspaceId, { clientId: clientId.trim(), clientSecret, ...(orgId.trim() ? { passportOrgId: orgId.trim() } : {}) }));
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

  if (status.status === "loading") return <Loading label={t("passportLinkPanel.checkingThePassportConnection")} />;
  if (status.status === "error") return <ErrorBanner error={status.error} onRetry={status.reload} title={t("passportLinkPanel.thePassportConnectionCouldNot")} />;
  const s = status.data;
  const look = STATE[s.check.state];
  const consoleUrl = s.passportOrgId ? `${env.passportWebUrl}/funders/${s.passportOrgId}/clients` : env.passportWebUrl;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className={`rc-row ${look.cls}`} style={{ borderTop: 0, padding: 0 }} role="status">
        <look.icon className="ic" role="img" aria-label={look.word} />
        <div>
          <div className="l">{s.linked ? (s.check.state === "pass" ? t("passportLinkPanel.passportIsConnected") : s.check.state === "unknown" ? t("passportLinkPanel.passportConnectionSavedStatusUnknown") : t("passportLinkPanel.passportConnectionNeedsAttention")) : t("passportLinkPanel.passportIsNotConnected")}</div>
          <div className="r">{s.check.reason}</div>
        </div>
        <span />
      </div>

      {s.linked && (
        <>
          <dl className="kv">
            <dt>{t("passportLinkPanel.client")}</dt>
            <dd className="mono">{s.clientId}</dd>
            <dt>{t("passportLinkPanel.linked")}</dt>
            <dd>{formatDate(s.linkedAt)}</dd>
            <dt>{t("passportLinkPanel.lastOk")}</dt>
            <dd>{s.lastOkAt ? formatDate(s.lastOkAt) : t("passportLinkPanel.notYet")}</dd>
            <dt>{t("passportLinkPanel.canReleaseFunds")}</dt>
            <dd>{s.canDebit === null ? t("passportLinkPanel.unknown") : s.canDebit ? t("passportLinkPanel.yesAFundingSourceCan") : t("passportLinkPanel.noFundingSourceYetAdd")}</dd>
          </dl>
          {unlink.error !== null && <ErrorBanner error={unlink.error} />}
          <div className="row" style={{ gap: "8px" }}>
            <button type="button" className="btn btn-secondary" onClick={status.reload}>
              {t("passportLinkPanel.checkAgain")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={unlink.state === "saving"}
              onClick={async () => {
                if (await unlink.run()) status.reload();
              }}
            >
              {t("passportLinkPanel.disconnect")}
            </button>
          </div>
        </>
      )}

      {!s.linked && (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <ol style={{ listStyle: "decimal", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <li>
              {t("passportLinkPanel.openYourOrganizationSClient")}
              <a href={consoleUrl} target="_blank" rel="noopener noreferrer">
                {t("passportLinkPanel.passportFunderConsole")} <ExternalLink className="ic ic-sm" aria-hidden="true" />
              </a>
            </li>
            <li>
              {t.rich("passportLinkPanel.createAClientWithThese", { join: REQUIRED_SCOPES.join(" "), span: (chunks) => <span className="mono">{chunks}</span> })}
            </li>
            <li>{t("passportLinkPanel.pasteItsIdAndSecret")}</li>
          </ol>
          {!s.passportOrgId && (
            <Field id="passport-org-id" label={t("passportLinkPanel.yourOrganizationSPassportId")} required help={t("passportLinkPanel.shownOnYourOrganizationS")}>
              <input className="inp mono" id="passport-org-id" value={orgId} onChange={(e) => setOrgId(e.target.value)} autoComplete="off" placeholder="00000000-0000-0000-0000-000000000000" required />
            </Field>
          )}
          {link.error !== null && <ErrorBanner error={link.error} title={t("passportLinkPanel.passportCouldNotBeConnected")} />}
          <div className="fld-row">
            <Field id="passport-client-id" label={t("passportLinkPanel.clientId")} required>
              <input className="inp mono" id="passport-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" required />
            </Field>
            <Field id="passport-client-secret" label={t("passportLinkPanel.clientSecret")} required help={t("passportLinkPanel.storedEncryptedItIsNever")}>
              <input className="inp mono userback-block userback-ignore" id="passport-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" minLength={8} required />
            </Field>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={link.state === "saving" || !clientId.trim() || clientSecret.length < 8 || (!s.passportOrgId && !UUID.test(orgId.trim()))}>
              {t("passportLinkPanel.connectPassport")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
