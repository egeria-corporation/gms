// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Agents, integrations and audit. Everything here is workspace administration and is
// written to the audit ledger: which agents are connected and what a human must approve, which
// outside MCP servers the assistant may read from, API clients and webhooks (secrets are shown
// once), connectors, the team, and the ledger itself.
import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Bot, Check, Download, KeyRound, Plug, Plus, ShieldCheck, Webhook as WebhookIcon } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { useAppConfig } from "../../api/launchHooks.ts";
import type { ApiClientIssued, LedgerEvent, McpServer, RemoteTool, Webhook, WebhookCreated } from "../../api/funderMoney.ts";
import { useServices } from "../../app/services.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Field, Loading, Notice, PageHeader } from "../../components/ui.tsx";
import { env } from "../../env.ts";
import { downloadCsv } from "../../lib/browser.ts";
import { formatDate } from "../../lib/format.ts";
import { ContactsEditor } from "./ContactsEditor.tsx";
import { DirectorySuggestions, GoogleWorkspaceCard } from "./GoogleWorkspace.tsx";
import { HumanGates } from "./HumanGates.tsx";
import { SettingsNav } from "./SettingsPassport.tsx";
import { actorLabel, dateTime, timeAgo, usePeople } from "./shared.tsx";
import { roleTitle } from "../../api/client.ts";
import { t, useFunderMessages } from "./i18n.ts";

const WEBHOOK_EVENTS = ["application.submitted", "application.status.changed", "review.submitted", "decision.committed", "award.created", "award.status.changed", "agreement.executed", "tranche.due", "tranche.status.changed", "disbursement.status.changed", "requirement.due", "submission.received", "submission.accepted", "org.change.pending", "approval.requested"];
const CLIENT_SCOPES = ["programs:read", "opportunities:read", "opportunities:write", "competitions:read", "forms:read", "applications:read", "applications:write", "reviews:read", "awards:read", "payments:read", "requirements:read", "requirements:write", "grantees:read", "analytics:read", "org:read"];
const FUNDER_ROLES = ["admin", "program_officer", "finance", "reviewer", "observer", "auditor"];
const words = (s: string) => s.replace(/_/g, " ");
/** The shape of an address, the same in every language. */
const URL_EXAMPLE = { any: "https://…", mcp: "https://…/mcp" } as const;
const DELIVERY: Record<string, () => string> = {
  pending: () => t("settingsMcp.delivery.pending"),
  delivered: () => t("settingsMcp.delivery.delivered"),
  failed: () => t("settingsMcp.delivery.failed"),
};
const SUBJECTS = ["application", "award", "agreement", "tranche", "requirement", "submission", "workspace", "grantee"] as const;
const SUBJECT: Record<string, () => string> = {
  application: () => t("settingsMcp.subject.application"),
  award: () => t("settingsMcp.subject.award"),
  agreement: () => t("settingsMcp.subject.agreement"),
  tranche: () => t("settingsMcp.subject.tranche"),
  requirement: () => t("settingsMcp.subject.requirement"),
  submission: () => t("settingsMcp.subject.submission"),
  workspace: () => t("settingsMcp.subject.workspace"),
  grantee: () => t("settingsMcp.subject.grantee"),
};
const subjectLabel = (s: string) => SUBJECT[s]?.() ?? words(s);

/** A secret that is shown exactly once, with a copy button. */
export function SecretOnce({ title, label, value, extra, onClose }: { title: string; label: string; value: string; extra?: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} labelledBy="secret-title">
      <div className="hd">
        <div>
          <h2 id="secret-title">{title}</h2>
          <p className="small muted">{t("settingsMcp.copyItNowIt")}</p>
        </div>
      </div>
      <div className="bd userback-block">
        {extra}
        <Field id="secret-value" label={label}>
          <div className="row">
            <input className="inp mono" id="secret-value" value={value} readOnly style={{ fontSize: "12px" }} />
            <CopyButton value={value} what={label.toLowerCase()} />
          </div>
        </Field>
      </div>
      <div className="ft">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t("settingsMcp.iHaveCopiedIt")}
        </button>
      </div>
    </Dialog>
  );
}

function ConnectedAgents() {
  const list = useApiQuery((api) => api.listMcpConnections(), []);
  const revoke = useApiMutation(async (api, id: string) => {
    await api.revokeMcpConnection(id);
    return true;
  });
  const { person } = usePeople();
  return (
    <section id="agents" className="card" aria-labelledby="agents-h">
      <div className="card-h">
        <div>
          <h3 id="agents-h">{t("settingsMcp.connectedAgents")}</h3>
          <p className="small muted">{t("settingsMcp.anAgentActsAs")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {list.status === "loading" && <Loading label={t("settingsMcp.loadingConnectedAgents")} />}
        {(list.status === "error" || revoke.error !== null) && <ErrorBanner error={list.error ?? revoke.error} onRetry={list.reload} />}
        {list.data?.map((c) => (
          <div key={c.id} className="apr">
            <div className="hd">
              <Bot className="ic" aria-hidden="true" />
              <span>{c.clientName ?? c.clientId}</span>
              <span className="small" style={{ fontWeight: 400 }}>
                {c.mine ? t("settingsMcp.connectedByYou") : t("settingsMcp.connectedBy", { name: person(c.userId)?.name ?? t("settingsMcp.aTeammate") })}
              </span>
              <span className="small" style={{ marginLeft: "auto", fontWeight: 400 }}>
                {c.lastUsedAt ? t("settingsMcp.lastUsed", { timeAgo: timeAgo(c.lastUsedAt) }) : t("settingsMcp.neverUsed")}
              </span>
            </div>
            <div className="bd">
              <div className="row wrap" style={{ gap: "4px" }}>
                {c.scopes.map((s) => (
                  <span key={s} className="tag">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="ft">
              <button type="button" className="btn btn-sm btn-danger" disabled={revoke.state === "saving"} onClick={async () => (await revoke.run(c.id)) && list.reload()}>
                {t("settingsMcp.revoke")}
              </button>
              <span className="help">{t("settingsMcp.revokingEndsTheAgents")}</span>
            </div>
          </div>
        ))}
        {list.data && !list.data.length && <p className="muted small">{t("settingsMcp.noAgentsAreConnected")}</p>}
      </div>
    </section>
  );
}

function ServerTools({ server, onSaved }: { server: McpServer; onSaved: () => void }) {
  const tools = useApiQuery((api) => api.listMcpServerTools(server.id), [server.id]);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const save = useApiMutation((api, names: string[]) => api.updateMcpServer(server.id, names));
  const current = allowed ?? server.allowedTools;
  const toggle = (item: RemoteTool) => setAllowed(current.includes(item.name) ? current.filter((n) => n !== item.name) : [...current, item.name]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {tools.status === "loading" && <Loading label={t("settingsMcp.listingTools")} />}
      {(tools.status === "error" || save.error !== null) && <ErrorBanner error={tools.error ?? save.error} />}
      {tools.data?.map((item) => (
        <label key={item.name} className="cb">
          <input type="checkbox" checked={current.includes(item.name)} disabled={!item.readOnly} onChange={() => toggle(item)} />
          <span>
            <span className="mono">{item.name}</span>
            {item.description ? ` · ${item.description}` : ""}
            {!item.readOnly && <span className="small muted"> {t("settingsMcp.writesDataCannotBe")}</span>}
          </span>
        </label>
      ))}
      {allowed !== null && (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          style={{ alignSelf: "flex-start" }}
          disabled={save.state === "saving"}
          onClick={async () => {
            if (await save.run(allowed)) {
              setAllowed(null);
              onSaved();
            }
          }}
        >
          {t("settingsMcp.saveAllowedTools")}
        </button>
      )}
    </div>
  );
}

function McpServers() {
  const list = useApiQuery((api) => api.listMcpServers(), []);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const register = useApiMutation((api) => api.registerMcpServer({ name: name.trim(), url: url.trim(), ...(auth.trim() ? { authHeader: auth.trim() } : {}) }));
  const remove = useApiMutation(async (api, id: string) => {
    await api.removeMcpServer(id);
    return true;
  });
  const config = useAppConfig();
  // The flag is absent while config is loading, and a missing flag used to look like "available".
  if (!config.ready) {
    return (
      <section id="servers" className="card" aria-labelledby="servers-h">
        <div className="card-h">
          <h3 id="servers-h">{t("settingsMcp.customMcpServers")}</h3>
        </div>
        <div className="card-b">
          <Loading label={t("settingsMcp.loadingServers")} />
        </div>
      </section>
    );
  }
  // Where this server cannot store a server's credentials, the form could only fail: say so instead.
  if (config.available?.customMcp === false) {
    return (
      <section id="servers" className="card" aria-labelledby="servers-h">
        <div className="card-h">
          <h3 id="servers-h">{t("settingsMcp.customMcpServers")}</h3>
        </div>
        <div className="card-b">
          <Notice tone="neu" title={t("settingsMcp.notAvailableOnThis")}>
            {t("settingsMcp.customMcpServersNeed")}
          </Notice>
        </div>
      </section>
    );
  }
  return (
    <section id="servers" className="card" aria-labelledby="servers-h">
      <div className="card-h">
        <div>
          <h3 id="servers-h">{t("settingsMcp.customMcpServers")}</h3>
          <p className="small muted">{t("settingsMcp.sourcesTheAssistantMay")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {list.status === "loading" && <Loading label={t("settingsMcp.loadingServers")} />}
        {(list.status === "error" || remove.error !== null) && <ErrorBanner error={list.error ?? remove.error} onRetry={list.reload} />}
        {list.data?.map((s) => (
          <div key={s.id} className="cmt">
            <div className="row wrap" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="b">{s.name}</div>
                <div className="small muted mono">{s.url}</div>
              </div>
              <div className="row">
                <span className="tag">{t("settingsMcp.toolsAllowed", { count: s.allowedTools.length })}</span>
                <button type="button" className="btn btn-sm btn-secondary" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {t("settingsMcp.tools")}
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await remove.run(s.id)) && list.reload()} aria-label={t("settingsMcp.remove", { name: s.name })}>
                  {t("settingsMcp.remove2")}
                </button>
              </div>
            </div>
            {open === s.id && <ServerTools server={s} onSaved={list.reload} />}
          </div>
        ))}
        {list.data && !list.data.length && <p className="muted small">{t("settingsMcp.noServersRegistered")}</p>}
        <form
          className="col"
          style={{ gap: "12px" }}
          onSubmit={async (e) => {
            e.preventDefault();
            const out = await register.run();
            if (out) {
              setName("");
              setUrl("");
              setAuth("");
              setOpen(out.id);
              list.reload();
            }
          }}
        >
          {register.error !== null && <ErrorBanner error={register.error} />}
          <div className="fld-row">
            <Field id="srv-name" label={t("settingsMcp.name")} required>
              <input className="inp" id="srv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settingsMcp.eGStateGrants")} />
            </Field>
            <Field id="srv-url" label={t("settingsMcp.serverUrl")} required>
              <input className="inp mono" id="srv-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={URL_EXAMPLE.mcp} style={{ fontSize: "12px" }} />
            </Field>
          </div>
          <Field id="srv-auth" label={t("settingsMcp.authorizationHeaderOptional")} help={t("settingsMcp.storedEncryptedAndNever")}>
            <input className="inp" id="srv-auth" type="password" autoComplete="off" value={auth} onChange={(e) => setAuth(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={!name.trim() || !url.trim() || register.state === "saving"}>
            <Plus className="ic" aria-hidden="true" />
            {t("settingsMcp.registerServer")}
          </button>
        </form>
      </div>
    </section>
  );
}

function Connectors() {
  const page = useApiQuery(async (api) => Promise.all([api.getConnector("mercury")]), []);
  const [token, setToken] = useState("");
  const connect = useApiMutation((api) => api.connectConnector("mercury", token.trim()));
  const sync = useApiMutation((api) => api.syncConnector("mercury"));
  const disconnect = useApiMutation((api) => api.disconnectConnector("mercury"));
  const config = useAppConfig();
  const [mercury] = page.data ?? [];
  if (!config.ready) {
    return (
      <section id="integrations" className="card" aria-labelledby="integrations-h">
        <div className="card-h">
          <h3 id="integrations-h">{t("settingsMcp.integrations")}</h3>
        </div>
        <div className="card-b">
          <Loading label={t("settingsMcp.loadingIntegrations")} />
        </div>
      </section>
    );
  }
  const mercuryOff = config.available?.mercury === false;
  return (
    <section id="integrations" className="card" aria-labelledby="integrations-h">
      <div className="card-h">
        <h3 id="integrations-h">{t("settingsMcp.integrations")}</h3>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {mercuryOff ? (
          <Notice tone="neu" title={t("settingsMcp.mercuryReconciliationIsNot")}>
            {t("settingsMcp.itNeedsToBe")}
          </Notice>
        ) : (
          <>
        {page.status === "loading" && <Loading label={t("settingsMcp.loadingIntegrations")} />}
        {(page.status === "error" || connect.error !== null || sync.error !== null || disconnect.error !== null) && <ErrorBanner error={page.error ?? connect.error ?? sync.error ?? disconnect.error} onRetry={page.reload} />}
        {mercury && (
          <div className="cmt">
            <div className="row wrap" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="b">{t("settingsMcp.mercuryReadOnlyReconciliation")}</div>
                <div className="small muted">{t("settingsMcp.listsOutboundTransactionsSo")}</div>
              </div>
              <span className={mercury.connected ? "bdg bdg-ok" : "bdg bdg-neutral"}>
                <Plug className="ic" aria-hidden="true" />
                {mercury.connected ? t("settingsMcp.connected") : t("settingsMcp.notConnected")}
              </span>
            </div>
            {mercury.connected ? (
              <div className="row wrap">
                <span className="small muted">{mercury.lastSyncAt ? t("settingsMcp.lastSynced", { dateTime: dateTime(mercury.lastSyncAt) }) : t("settingsMcp.notSyncedYet")}</span>
                <button type="button" className="btn btn-sm btn-secondary" disabled={sync.state === "saving"} onClick={async () => (await sync.run()) && page.reload()}>
                  {t("settingsMcp.syncNow")}
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await disconnect.run()) && page.reload()}>
                  {t("settingsMcp.disconnect")}
                </button>
              </div>
            ) : (
              <form
                className="row wrap"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await connect.run()) {
                    setToken("");
                    page.reload();
                  }
                }}
              >
                <input className="inp" type="password" autoComplete="off" aria-label={t("settingsMcp.mercuryReadOnlyApi")} placeholder={t("settingsMcp.readOnlyApiToken")} value={token} onChange={(e) => setToken(e.target.value)} style={{ maxWidth: "320px" }} />
                <button type="submit" className="btn btn-secondary" disabled={token.trim().length < 8 || connect.state === "saving"}>
                  {t("settingsMcp.connectMercury")}
                </button>
              </form>
            )}
          </div>
        )}
          </>
        )}
        <GoogleWorkspaceCard />
      </div>
    </section>
  );
}

function ApiClients() {
  const list = useApiQuery((api) => api.listApiClients(), []);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [issued, setIssued] = useState<ApiClientIssued | null>(null);
  const create = useApiMutation((api) => api.createApiClient({ name: name.trim(), scopes }));
  const revoke = useApiMutation(async (api, id: string) => {
    await api.revokeApiClient(id);
    return true;
  });
  return (
    <section id="api" className="card" aria-labelledby="api-h">
      <div className="card-h">
        <div>
          <h3 id="api-h">{t("settingsMcp.apiClients")}</h3>
          <p className="small muted">{t("settingsMcp.forScriptsAndIntegrations")}</p>
        </div>
      </div>
      {(list.status === "error" || revoke.error !== null) && (
        <div className="card-b">
          <ErrorBanner error={list.error ?? revoke.error} onRetry={list.reload} />
        </div>
      )}
      <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("settingsMcp.apiClientsScrollable")}>
        <table className="tbl" aria-label={t("settingsMcp.apiClients")}>
          <thead>
            <tr>
              <th>{t("settingsMcp.name")}</th>
              <th>{t("settingsMcp.scopes")}</th>
              <th>{t("settingsMcp.created")}</th>
              <th>{t("settingsMcp.lastUsed2")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.map((c) => (
              <tr key={c.id}>
                <td className="b">{c.name}</td>
                <td>
                  <div className="row wrap" style={{ gap: "4px" }}>
                    {c.scopes.map((s) => (
                      <span key={s} className="tag">
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{formatDate(c.createdAt)}</td>
                <td>{c.lastUsedAt ? timeAgo(c.lastUsedAt) : t("settingsMcp.never")}</td>
                <td>
                  {c.revokedAt ? (
                    <span className="muted small">{t("settingsMcp.revoked")}</span>
                  ) : (
                    <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await revoke.run(c.id)) && list.reload()} aria-label={t("settingsMcp.revoke2", { name: c.name })}>
                      {t("settingsMcp.revoke")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.data && !list.data.length && (
              <tr>
                <td colSpan={5} className="muted">
                  {t("settingsMcp.noApiClients")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <form
        className="card-b col"
        style={{ gap: "12px", borderTop: "1px solid var(--og-gray-200)" }}
        onSubmit={async (e) => {
          e.preventDefault();
          const out = await create.run();
          if (out) {
            setIssued(out);
            setName("");
            setScopes([]);
            list.reload();
          }
        }}
      >
        {create.error !== null && <ErrorBanner error={create.error} />}
        <Field id="client-name" label={t("settingsMcp.newClientName")} required>
          <input className="inp" id="client-name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: "360px" }} />
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="lbl">{t("settingsMcp.scopes")}</legend>
          <div className="row wrap" style={{ gap: "6px 14px", marginTop: "6px" }}>
            {CLIENT_SCOPES.map((s) => (
              <label key={s} className="cb" style={{ fontSize: "12px" }}>
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))} />
                <span className="mono">{s}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={!name.trim() || !scopes.length || create.state === "saving"}>
          <KeyRound className="ic" aria-hidden="true" />
          {t("settingsMcp.createClient")}
        </button>
      </form>
      {issued && (
        <SecretOnce
          title={t("settingsMcp.clientSecretFor", { name: issued.name })}
          label={t("settingsMcp.clientSecret")}
          value={issued.clientSecret}
          extra={
            <dl className="kv">
              <dt>{t("settingsMcp.clientId")}</dt>
              <dd className="mono">{issued.clientId}</dd>
            </dl>
          }
          onClose={() => setIssued(null)}
        />
      )}
    </section>
  );
}

function Deliveries({ hook }: { hook: Webhook }) {
  const list = useApiQuery((api) => api.listWebhookDeliveries(hook.id), [hook.id]);
  if (list.status === "loading") return <Loading label={t("settingsMcp.loadingDeliveries")} />;
  if (list.status === "error") return <ErrorBanner error={list.error} onRetry={list.reload} />;
  if (!list.data.length) return <p className="muted small">{t("settingsMcp.noDeliveriesYet")}</p>;
  return (
    <table className="tbl tbl-compact" aria-label={t("settingsMcp.deliveriesTo", { url: hook.url })}>
      <thead>
        <tr>
          <th>{t("settingsMcp.event")}</th>
          <th>{t("settingsMcp.status")}</th>
          <th className="num">{t("settingsMcp.attempts")}</th>
          <th>{t("settingsMcp.when")}</th>
        </tr>
      </thead>
      <tbody>
        {list.data.map((d) => (
          <tr key={d.id}>
            <td className="mono">{d.eventType}</td>
            <td>
              {DELIVERY[d.status]?.() ?? words(d.status)}
              {d.lastStatusCode ? t("settingsMcp.http", { lastStatusCode: d.lastStatusCode }) : ""}
              {d.lastError ? ` · ${d.lastError}` : ""}
            </td>
            <td className="num">{d.attempts}</td>
            <td>{dateTime(d.deliveredAt ?? d.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Webhooks() {
  const list = useApiQuery((api) => api.listWebhooks(), []);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [created, setCreated] = useState<WebhookCreated | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const create = useApiMutation((api) => api.createWebhook({ url: url.trim(), ...(events.length ? { events } : {}) }));
  const remove = useApiMutation(async (api, id: string) => {
    await api.deleteWebhook(id);
    return true;
  });
  return (
    <section id="webhooks" className="card" aria-labelledby="webhooks-h">
      <div className="card-h">
        <div>
          <h3 id="webhooks-h">{t("settingsMcp.webhooks")}</h3>
          <p className="small muted">{t("settingsMcp.signedWithHmacSha256")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {list.status === "loading" && <Loading label={t("settingsMcp.loadingWebhooks")} />}
        {(list.status === "error" || remove.error !== null) && <ErrorBanner error={list.error ?? remove.error} onRetry={list.reload} />}
        {list.data?.map((h) => (
          <div key={h.id} className="cmt">
            <div className="row wrap" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="b mono">{h.url}</div>
                <div className="small muted">{h.events.length ? h.events.join(", ") : t("settingsMcp.allEvents")}</div>
              </div>
              <div className="row">
                <button type="button" className="btn btn-sm btn-secondary" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>
                  {t("settingsMcp.deliveries")}
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await remove.run(h.id)) && list.reload()} aria-label={t("settingsMcp.deleteWebhook", { url: h.url })}>
                  {t("settingsMcp.delete")}
                </button>
              </div>
            </div>
            {open === h.id && <Deliveries hook={h} />}
          </div>
        ))}
        {list.data && !list.data.length && <p className="muted small">{t("settingsMcp.noWebhooks")}</p>}
        <form
          className="col"
          style={{ gap: "12px" }}
          onSubmit={async (e) => {
            e.preventDefault();
            const out = await create.run();
            if (out) {
              setCreated(out);
              setUrl("");
              setEvents([]);
              list.reload();
            }
          }}
        >
          {create.error !== null && <ErrorBanner error={create.error} />}
          <Field id="hook-url" label={t("settingsMcp.endpointUrl")} required>
            <input className="inp mono" id="hook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={URL_EXAMPLE.any} style={{ fontSize: "12px", maxWidth: "480px" }} />
          </Field>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="lbl">{t("settingsMcp.eventsNoneSelectedSends")}</legend>
            <div className="row wrap" style={{ gap: "6px 14px", marginTop: "6px" }}>
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev} className="cb" style={{ fontSize: "12px" }}>
                  <input type="checkbox" checked={events.includes(ev)} onChange={() => setEvents((cur) => (cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]))} />
                  <span className="mono">{ev}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={!url.trim() || create.state === "saving"}>
            <WebhookIcon className="ic" aria-hidden="true" />
            {t("settingsMcp.addWebhook")}
          </button>
        </form>
      </div>
      {created && <SecretOnce title={t("settingsMcp.webhookSigningSecret")} label={t("settingsMcp.signingSecret")} value={created.secret} onClose={() => setCreated(null)} />}
    </section>
  );
}

function Team({ workspaceId }: { workspaceId: string }) {
  const list = useApiQuery((api) => api.listMembers(workspaceId), [workspaceId]);
  const { person } = usePeople();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("program_officer");
  const [sent, setSent] = useState<string | null>(null);
  const invite = useApiMutation((api) => api.createInvitation(workspaceId, { email: email.trim(), role }));
  const change = useApiMutation((api, userId: string, next: string) => api.updateMemberRole(workspaceId, userId, next));
  return (
    <section id="team" className="card" aria-labelledby="team-h">
      <div className="card-h">
        <div>
          <h3 id="team-h">{t("settingsMcp.teamRoles")}</h3>
          <p className="small muted">{t("settingsMcp.adminsAndFinanceMust")}</p>
        </div>
      </div>
      {(list.status === "error" || change.error !== null) && (
        <div className="card-b">
          <ErrorBanner error={list.error ?? change.error} onRetry={list.reload} />
        </div>
      )}
      <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("settingsMcp.teamMembersScrollable")}>
        <table className="tbl" aria-label={t("settingsMcp.teamMembers")}>
          <thead>
            <tr>
              <th>{t("settingsMcp.member")}</th>
              <th>{t("settingsMcp.role")}</th>
              <th>{t("settingsMcp.authenticator")}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((m) => {
              const label = person(m.userId)?.name ?? m.email ?? t("settingsMcp.member");
              return (
                <tr key={m.userId}>
                  <td>
                    <div className="ent">
                      <span className="nm">{label}</span>
                      {m.email && <span className="small muted">{m.email}</span>}
                    </div>
                  </td>
                  <td>
                    <select className="sel" aria-label={t("settingsMcp.roleFor", { label })} value={m.role} disabled={change.state === "saving"} onChange={async (e) => (await change.run(m.userId, e.target.value)) && list.reload()} style={{ height: "30px", maxWidth: "200px" }}>
                      {[...new Set([...FUNDER_ROLES, m.role])].map((r) => (
                        <option key={r} value={r}>
                          {roleTitle(r)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{m.mfaEnrolledAt ? t("settingsMcp.enrolled", { date: formatDate(m.mfaEnrolledAt) }) : <span className="muted">{t("settingsMcp.notEnrolled")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form
        className="card-f"
        style={{ flexWrap: "wrap" }}
        onSubmit={async (e) => {
          e.preventDefault();
          const out = await invite.run();
          if (out) {
            setSent(out.email);
            setEmail("");
          }
        }}
      >
        <input className="inp" type="email" aria-label={t("settingsMcp.emailToInvite")} placeholder={t("settingsMcp.nameOrganizationOrg")} value={email} onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: "280px" }} />
        <select className="sel" aria-label={t("settingsMcp.roleForTheInvitation")} value={role} onChange={(e) => setRole(e.target.value)} style={{ maxWidth: "180px" }}>
          {FUNDER_ROLES.map((r) => (
            <option key={r} value={r}>
              {roleTitle(r)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary" disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || invite.state === "saving"}>
          {t("settingsMcp.invite")}
        </button>
        <DirectorySuggestions query={email} onChoose={(p) => setEmail(p.email)} />
        {sent && (
          <span className="notice" role="status">
            {t("settingsMcp.invitationCreatedFor", { sent })}
          </span>
        )}
        {invite.error !== null && <span className="err-msg">{invite.error instanceof Error ? invite.error.message : t("settingsMcp.theInvitationWasNot")}</span>}
      </form>
    </section>
  );
}

function Ledger() {
  const [subjectType, setSubjectType] = useState("");
  const [page, setPage] = useState(1);
  const list = useApiQuery((api) => api.listLedger({ ...(subjectType ? { subjectType } : {}), page, pageSize: 25 }), [subjectType, page]);
  const { person } = usePeople();
  const exportCsv = (rows: LedgerEvent[]) => {
    const lines = [["occurredAt", "actor", "eventType", "subjectType", "subjectId"], ...rows.map((e) => [e.occurredAt, e.actor, e.eventType, e.subjectType, e.subjectId])];
    downloadCsv(lines, "ledger.csv");
  };
  return (
    <section id="audit" className="card" aria-labelledby="audit-h">
      <div className="card-h">
        <div>
          <h3 id="audit-h">{t("settingsMcp.auditLedger")}</h3>
          <p className="small muted">{t("settingsMcp.appendOnlyEveryChange")}</p>
        </div>
        <div className="row">
          <select
            className="sel"
            aria-label={t("settingsMcp.filterBySubject")}
            value={subjectType}
            onChange={(e) => {
              setSubjectType(e.target.value);
              setPage(1);
            }}
            style={{ height: "30px", width: "170px" }}
          >
            <option value="">{t("settingsMcp.allSubjects")}</option>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {subjectLabel(s)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-secondary" disabled={!list.data?.items.length} onClick={() => list.data && exportCsv(list.data.items)}>
            <Download className="ic" aria-hidden="true" />
            {t("settingsMcp.exportPage")}
          </button>
        </div>
      </div>
      <div className="card-b">
        {list.status === "loading" && <Loading label={t("settingsMcp.loadingTheLedger")} />}
        {list.status === "error" && <ErrorBanner error={list.error} onRetry={list.reload} />}
        {list.data && (
          <div className="tl tl-sm">
            {list.data.items.map((e) => {
              const who = actorLabel(e.actor, person);
              return (
                <div key={e.id} className={`tl-i ${who.agent ? "tl-agent" : e.actor === "passport" ? "tl-passport" : "tl-person"}`}>
                  <span className="dot">{who.agent ? <Bot className="ic" aria-hidden="true" /> : <ShieldCheck className="ic" aria-hidden="true" />}</span>
                  <div>
                    <div className="what mono">{e.eventType}</div>
                    <div className="who">
                      {who.name}
                      {who.agent ? t("settingsMcp.agent") : ""} · {subjectLabel(e.subjectType)} {e.subjectId.slice(0, 8)} · {dateTime(e.occurredAt)}
                    </div>
                  </div>
                </div>
              );
            })}
            {!list.data.items.length && <p className="muted small">{t("settingsMcp.nothingRecordedForThis")}</p>}
          </div>
        )}
      </div>
      {list.data && list.data.total > 25 && (
        <div className="card-f">
          <button type="button" className="btn btn-sm btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            {t("settingsMcp.newer")}
          </button>
          <button type="button" className="btn btn-sm btn-secondary" disabled={page * 25 >= list.data.total} onClick={() => setPage((p) => p + 1)}>
            {t("settingsMcp.older")}
          </button>
          <span className="small muted">
            {t("settingsMcp.pageOf", { page, ceil: Math.ceil(list.data.total / 25) })}
          </span>
        </div>
      )}
    </section>
  );
}

/**
 * How an agent gets connected. The steps are informational: the connection is started from the
 * agent's own client, which sends the person through sign-in and the consent screen.
 */
function ConnectAgent({ workspaceName }: { workspaceName: string }) {
  const mine = useApiQuery((api) => api.listMcpConnections(), []);
  const connected = !!mine.data?.some((c) => c.mine);
  // The real consent screen is opened by the agent's client. In mock mode there is no client, so the
  // card links to the screen directly, as the design's click-through does.
  const { mock } = useServices();
  const mcpUrl = `${env.apiBaseUrl || "https://gms.opengrants.io"}/mcp`;
  const [copied, setCopied] = useState(false);
  const stepOne = copied || connected;
  return (
    <section id="connect" className="card" aria-labelledby="connect-h">
      <div className="card-h">
        <h3 id="connect-h">{t("settingsMcp.connectAnAgent")}</h3>
        <span className="tag">{t("settingsMcp.mcpStreamableHttp")}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div className="fld">
          <label className="lbl" htmlFor="mcp-url">
            {t("settingsMcp.serverUrl")}
          </label>
          <div className="row" style={{ gap: "8px" }}>
            <input className="inp mono" id="mcp-url" value={mcpUrl} readOnly style={{ fontSize: "12px" }} />
            <CopyButton value={mcpUrl} what={t("settingsMcp.copyWhat.serverUrl")} onCopied={() => setCopied(true)} />
          </div>
        </div>
        <ol className="stp-v" style={{ gap: "0" }}>
          <li className={stepOne ? "s done" : "s on"}>
            <span className="n">{stepOne ? <Check className="ic ic-sm" aria-hidden="true" /> : 1}</span>
            <div>
              <div className="t">{t("settingsMcp.addTheServerTo")}</div>
              <div className="d">{t("settingsMcp.pasteTheUrlInto")}</div>
            </div>
          </li>
          <li className={connected ? "s done" : stepOne ? "s on" : "s"}>
            <span className="n">{connected ? <Check className="ic ic-sm" aria-hidden="true" /> : 2}</span>
            <div>
              <div className="t">{t("settingsMcp.signIn")}</div>
              <div className="d">{t("settingsMcp.theClientOpensThe")}</div>
            </div>
          </li>
          <li className={connected ? "s done" : "s"}>
            <span className="n">{connected ? <Check className="ic ic-sm" aria-hidden="true" /> : 3}</span>
            <div>
              <div className="t">{t("settingsMcp.chooseWorkspaceAndScopes")}</div>
              <div className="d">{t("settingsMcp.pickGrantScopesBy", { workspaceName })}</div>
            </div>
          </li>
        </ol>
        <div className="row wrap" style={{ gap: "12px" }}>
          <Link to="/agents" className="btn btn-primary">
            {t("settingsMcp.howAgentsConnect")}
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <a href="#gates" className="small b">
            {t("settingsMcp.seeWhichActionsNeed")}
          </a>
          {mock && (
            <Link to="/consent?req=preview" className="small b">
              {t("settingsMcp.previewTheConsentScreen")}
            </Link>
          )}
        </div>
        <span className="help">
          {t("settingsMcp.theConsentScreenOpens")}
        </span>
      </div>
    </section>
  );
}

export default function SettingsMcp() {
  useFunderMessages();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  return (
    <>
      <title>{t("settingsMcp.settingsAgentsIntegrationsAnd", { name: ws.name })}</title>
      <FunderShell active="Settings">
        <main className="main">
          <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("settingsMcp.settings") }, { label: t("settingsMcp.agentsMcp") }]} title={t("settingsMcp.settings")} meta={<span>{t("settingsMcp.workspaceAdministrationChangesAre")}</span>} />
          <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div className="col stick-side" style={{ gap: "12px" }}>
              <SettingsNav base={base} active="mcp" />
              <nav className="card snav" style={{ padding: "8px" }} aria-label={t("settingsMcp.onThisPage")}>
                {[
                  ["agents", t("settingsMcp.nav.agents")],
                  ["connect", t("settingsMcp.nav.connect")],
                  ["gates", t("settingsMcp.nav.gates")],
                  ["servers", t("settingsMcp.nav.servers")],
                  ["integrations", t("settingsMcp.nav.integrations")],
                  ["api", t("settingsMcp.nav.api")],
                  ["webhooks", t("settingsMcp.nav.webhooks")],
                  ["team", t("settingsMcp.nav.team")],
                  ["contacts", t("settingsMcp.nav.contacts")],
                  ["audit", t("settingsMcp.nav.audit")],
                ].map(([id, label]) => (
                  <a key={id} href={`#${id}`}>
                    {label}
                  </a>
                ))}
              </nav>
              <Link to={`${base}/approvals`} className="small b">
                {t("settingsMcp.pendingApprovals")}
              </Link>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <ConnectedAgents />
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                <ConnectAgent workspaceName={ws.name} />
                <div id="gates">
                  <HumanGates />
                </div>
              </div>
              <McpServers />
              <Connectors />
              <ApiClients />
              <Webhooks />
              <Team workspaceId={ws.id} />
              <ContactsEditor canEdit={ws.member.role === "admin"} />
              <Ledger />
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
