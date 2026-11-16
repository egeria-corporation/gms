// SPDX-License-Identifier: AGPL-3.0-only
// The workspace-level cards on applicant Settings: API tokens (secret shown once, never submit or
// sign), exports of everything the workspace entered, and leaving the workspace.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useServices } from "../../app/services.tsx";
import { Download, Key } from "lucide-react";
import { APPLICANT_TOKEN_SCOPES, type NewApiToken } from "../../api/applicantFull.ts";
import { useFullMutation, useFullQuery } from "../../api/applicantFullHooks.ts";
import { useMoreMutation } from "../../api/applicantMoreHooks.ts";
import { CopyButton } from "../../components/CopyButton.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Loaded, timeAgo } from "../../components/applicant.tsx";
import { ErrorBanner, Field, Notice } from "../../components/ui.tsx";
import { downloadBlob, downloadCsv } from "../../lib/browser.ts";
import { formatDate } from "../../lib/format.ts";
import { t } from "./i18n.ts";

function CreateTokenDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (token: NewApiToken) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["applications:read"]);
  const create = useFullMutation((api, input: { name: string; scopes: string[] }) => api.createApiToken(input));
  const toggle = (scope: string) => setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  const submit = async () => {
    const token = await create.run({ name, scopes });
    if (token) onCreated(token);
  };
  return (
    <Dialog open onClose={onClose} labelledBy="token-title">
      <div className="hd">
        <div>
          <h2 id="token-title" style={{ fontSize: "18px" }}>
            {t("settingsCards.createAnApiToken")}
          </h2>
          <p className="small muted">{t("settingsCards.forScriptsAndIntegrationsAToken")}</p>
        </div>
      </div>
      <div className="bd">
        <Field id="token-name" label={t("settingsCards.name")} help={t("settingsCards.whatUsesItSoYouCan")} required>
          <input id="token-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
          <legend className="lbl" style={{ marginBottom: "6px" }}>
            {t("settingsCards.whatItMayDo")}
          </legend>
          {APPLICANT_TOKEN_SCOPES.map((s) => (
            <label key={s.scope} className="cb" style={{ alignItems: "center" }}>
              <input type="checkbox" checked={scopes.includes(s.scope)} onChange={() => toggle(s.scope)} />
              <span>
                {s.label} <span className="tag">{s.scope}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {create.error ? <ErrorBanner error={create.error} title={t("settingsCards.theTokenWasNotCreated")} /> : null}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("settingsCards.cancel")}
        </button>
        <button type="button" className="btn btn-primary" disabled={!name.trim() || scopes.length === 0 || create.state === "saving"} onClick={() => void submit()}>
          {t("settingsCards.createToken")}
        </button>
      </div>
    </Dialog>
  );
}

export function TokensCard({ base }: { base: string }) {
  const query = useFullQuery((api) => api.apiTokens(), []);
  const revoke = useFullMutation((api, id: string) => api.revokeApiToken(id));
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<NewApiToken | null>(null);
  return (
    <div className="card" id="tokens">
      <div className="card-h">
        <div>
          <h2 style={{ fontSize: "18px" }}>{t("settingsCards.apiTokens")}</h2>
          <p className="small muted">
            {t.rich("settingsCards.forScripts", { link: (chunks) => <Link to={`${base}/team`}>{chunks}</Link> })}
          </p>
        </div>
      </div>
      {fresh ? (
        <div style={{ padding: "16px 20px 0" }}>
          <Notice tone="ok" title={t("settingsCards.created2", { name: fresh.name })}>
            <div className="row wrap userback-block" style={{ gap: "8px", marginTop: "8px" }}>
              <code className="mono" style={{ wordBreak: "break-all" }}>
                {fresh.clientSecret}
              </code>
              <CopyButton value={fresh.clientSecret} what={t("settingsCards.theSecret")} className="btn btn-sm btn-secondary" />
            </div>
            <div className="small" style={{ marginTop: "6px" }}>
              {t("settingsCards.clientId")} <span className="mono">{fresh.clientId}</span>
            </div>
          </Notice>
        </div>
      ) : null}
      <Loaded query={query} label={t("settingsCards.loadingTokens")}>
        {(tokens) =>
          tokens.length === 0 ? (
            <div className="card-b">
              <p className="muted">{t("settingsCards.noTokensYet")}</p>
            </div>
          ) : (
            <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label={t("settingsCards.apiTokensScrollable")}>
              <table className="tbl" style={{ fontSize: "14px" }}>
                <caption className="sr">{t("settingsCards.apiTokensForThisWorkspace")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("settingsCards.name")}</th>
                    <th scope="col">{t("settingsCards.scopes")}</th>
                    <th scope="col">{t("settingsCards.created")}</th>
                    <th scope="col">{t("settingsCards.lastUsed")}</th>
                    <th scope="col">
                      <span className="sr">{t("settingsCards.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((tok) => (
                    <tr key={tok.id}>
                      <td className="b">{tok.name}</td>
                      <td>
                        <div className="row wrap" style={{ gap: "4px" }}>
                          {tok.scopes.map((s) => (
                            <span key={s} className="tag">
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>{formatDate(tok.createdAt)}</td>
                      <td>{tok.lastUsedAt ? timeAgo(tok.lastUsedAt) : t("settingsCards.never")}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          aria-label={t("settingsCards.revokeName", { name: tok.name })}
                          onClick={async () => {
                            if (await revoke.run(tok.id)) query.reload();
                          }}
                        >
                          {t("settingsCards.revoke")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {revoke.error ? (
        <div style={{ padding: "0 20px 12px" }}>
          <ErrorBanner error={revoke.error} title={t("settingsCards.theTokenWasNotRevoked")} />
        </div>
      ) : null}
      <div className="card-f" style={{ gap: "12px", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Key className="ic" aria-hidden="true" />
          {t("settingsCards.createToken")}
        </button>
        <span className="help">{t("settingsCards.theSecretIsShownOnceAt")}</span>
      </div>
      {creating ? (
        <CreateTokenDialog
          onClose={() => setCreating(false)}
          onCreated={(token) => {
            setCreating(false);
            setFresh(token);
            query.reload();
          }}
        />
      ) : null}
    </div>
  );
}

export function ExportsCard({ handle }: { handle: string }) {
  const bundle = useFullMutation((api) => api.exportWorkspace());
  const reports = useMoreMutation((api) => api.requirements());
  const [done, setDone] = useState<string | null>(null);
  const exportAll = async () => {
    const data = await bundle.run();
    if (!data) return;
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `${handle}-export.json`);
    setDone(t("settingsCards.exportedJson"));
  };
  const exportReports = async () => {
    const rows = await reports.run();
    if (!rows) return;
    downloadCsv([[t("settingsCards.csv.report"), t("settingsCards.csv.grant"), t("settingsCards.csv.funder"), t("settingsCards.csv.due"), t("settingsCards.csv.status")], ...rows.map((r) => [r.title, r.award?.title ?? "", r.funder?.name ?? "", r.dueAt ? r.dueAt.slice(0, 10) : "", r.status])], `${handle}-reports.csv`);
    setDone(t("settingsCards.exportedCsv"));
  };
  return (
    <div className="card" id="exports">
      <div className="card-h">
        <div>
          <h2 style={{ fontSize: "18px" }}>{t("settingsCards.exports")}</h2>
          <p className="small muted">{t("settingsCards.everythingYouHaveEnteredIsYours")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <button type="button" className="btn btn-secondary" style={{ justifyContent: "flex-start" }} disabled={bundle.state === "saving"} onClick={() => void exportAll()}>
          <Download className="ic" aria-hidden="true" />
          {t("settingsCards.exportAllApplicationsCommongrantsJson")}
        </button>
        <button type="button" className="btn btn-secondary" style={{ justifyContent: "flex-start" }} disabled={reports.state === "saving"} onClick={() => void exportReports()}>
          <Download className="ic" aria-hidden="true" />
          {t("settingsCards.exportReportsCsv")}
        </button>
        <span className="help">{t("settingsCards.yourOrganizationRecordLivesInPassport")}</span>
        {done ? (
          <span className="help" role="status">
            {done}
          </span>
        ) : null}
        {bundle.error || reports.error ? <ErrorBanner error={bundle.error ?? reports.error} title={t("settingsCards.theExportDidNotFinish")} /> : null}
      </div>
    </div>
  );
}

export function DangerZone({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const leave = useFullMutation((api) => api.leaveWorkspace(workspaceId));
  const navigate = useNavigate();
  const { reloadMe } = useServices();
  const confirm = async () => {
    const r = await leave.run();
    if (!r?.left) return;
    // The switcher lists memberships: read them again so the workspace just left is gone.
    reloadMe();
    void navigate("/workspaces");
  };
  return (
    <div className="card" style={{ borderColor: "var(--s-dng-bd)" }}>
      <div className="card-h">
        <h2 style={{ fontSize: "18px", color: "var(--s-dng-fg)" }}>{t("settingsCards.dangerZone")}</h2>
      </div>
      <div className="card-b" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
        <div>
          <div className="b">{t("settingsCards.leaveThisWorkspace")}</div>
          <div className="help">{t("settingsCards.loseAccess", { name })}</div>
        </div>
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
          {t("settingsCards.leaveWorkspace")}
        </button>
      </div>
      {confirming ? (
        <Dialog open onClose={() => setConfirming(false)} labelledBy="leave-title">
          <div className="hd">
            <h2 id="leave-title" style={{ fontSize: "18px" }}>
              {t("settingsCards.leaveName", { name })}
            </h2>
          </div>
          <div className="bd">
            <p>{t("settingsCards.youWillNoLongerSeeThis")}</p>
            {leave.error ? <ErrorBanner error={leave.error} title={t("settingsCards.youAreStillAMember")} /> : null}
          </div>
          <div className="ft">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
              {t("settingsCards.stay")}
            </button>
            <button type="button" className="btn btn-danger-solid" disabled={leave.state === "saving"} onClick={() => void confirm()}>
              {t("settingsCards.leaveWorkspace")}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
