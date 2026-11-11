// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Agents, integrations and audit. Everything here is workspace administration and is
// written to the audit ledger: which agents are connected and what a human must approve, which
// outside MCP servers the assistant may read from, API clients and webhooks (secrets are shown
// once), connectors, the team, and the ledger itself.
import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Bot, Check, Download, KeyRound, Plug, Plus, ShieldCheck, Webhook as WebhookIcon } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { ApiClientIssued, LedgerEvent, McpServer, RemoteTool, Webhook, WebhookCreated } from "../../api/funderMoney.ts";
import { useServices } from "../../app/services.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Field, Loading, PageHeader } from "../../components/ui.tsx";
import { env } from "../../env.ts";
import { downloadCsv } from "../../lib/browser.ts";
import { formatDate } from "../../lib/format.ts";
import { ContactsEditor } from "./ContactsEditor.tsx";
import { DirectorySuggestions, GoogleWorkspaceCard } from "./GoogleWorkspace.tsx";
import { HumanGates } from "./HumanGates.tsx";
import { SettingsNav } from "./SettingsPassport.tsx";
import { actorLabel, dateTime, timeAgo, usePeople } from "./shared.tsx";

const WEBHOOK_EVENTS = ["application.submitted", "application.status.changed", "review.submitted", "decision.committed", "award.created", "award.status.changed", "agreement.executed", "tranche.due", "tranche.status.changed", "disbursement.status.changed", "requirement.due", "submission.received", "submission.accepted", "org.change.pending", "approval.requested"];
const CLIENT_SCOPES = ["programs:read", "opportunities:read", "opportunities:write", "competitions:read", "forms:read", "applications:read", "applications:write", "reviews:read", "awards:read", "payments:read", "requirements:read", "requirements:write", "grantees:read", "analytics:read", "org:read"];
const FUNDER_ROLES = ["admin", "program_officer", "finance", "reviewer", "observer", "auditor"];
const words = (s: string) => s.replace(/_/g, " ");

/** A secret that is shown exactly once, with a copy button. */
function SecretOnce({ title, label, value, extra, onClose }: { title: string; label: string; value: string; extra?: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} labelledBy="secret-title">
      <div className="hd">
        <div>
          <h2 id="secret-title">{title}</h2>
          <p className="small muted">Copy it now. It is shown once and cannot be read again.</p>
        </div>
      </div>
      <div className="bd">
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
          I have copied it
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
          <h3 id="agents-h">Connected agents</h3>
          <p className="small muted">An agent acts as the person who connected it, with that person’s permissions and never more.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {list.status === "loading" && <Loading label="Loading connected agents" />}
        {(list.status === "error" || revoke.error !== null) && <ErrorBanner error={list.error ?? revoke.error} onRetry={list.reload} />}
        {list.data?.map((c) => (
          <div key={c.id} className="apr">
            <div className="hd">
              <Bot className="ic" aria-hidden="true" />
              <span>{c.clientName ?? c.clientId}</span>
              <span className="small" style={{ fontWeight: 400 }}>
                connected by {c.mine ? "you" : (person(c.userId)?.name ?? "a teammate")}
              </span>
              <span className="small" style={{ marginLeft: "auto", fontWeight: 400 }}>
                {c.lastUsedAt ? `last used ${timeAgo(c.lastUsedAt)}` : "never used"}
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
                Revoke
              </button>
              <span className="help">Revoking ends the agent’s access at once. Pending approvals it created stay for a person to decide.</span>
            </div>
          </div>
        ))}
        {list.data && !list.data.length && <p className="muted small">No agents are connected to this workspace.</p>}
      </div>
    </section>
  );
}

function ServerTools({ server, onSaved }: { server: McpServer; onSaved: () => void }) {
  const tools = useApiQuery((api) => api.listMcpServerTools(server.id), [server.id]);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const save = useApiMutation((api, names: string[]) => api.updateMcpServer(server.id, names));
  const current = allowed ?? server.allowedTools;
  const toggle = (t: RemoteTool) => setAllowed(current.includes(t.name) ? current.filter((n) => n !== t.name) : [...current, t.name]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {tools.status === "loading" && <Loading label="Listing tools" />}
      {(tools.status === "error" || save.error !== null) && <ErrorBanner error={tools.error ?? save.error} />}
      {tools.data?.map((t) => (
        <label key={t.name} className="cb">
          <input type="checkbox" checked={current.includes(t.name)} disabled={!t.readOnly} onChange={() => toggle(t)} />
          <span>
            <span className="mono">{t.name}</span>
            {t.description ? ` · ${t.description}` : ""}
            {!t.readOnly && <span className="small muted"> · writes data, cannot be allowed</span>}
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
          Save allowed tools
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
  return (
    <section id="servers" className="card" aria-labelledby="servers-h">
      <div className="card-h">
        <div>
          <h3 id="servers-h">Custom MCP servers</h3>
          <p className="small muted">Sources the assistant may read when it summarizes an application, such as your CRM. Read-only tools only.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {list.status === "loading" && <Loading label="Loading servers" />}
        {(list.status === "error" || remove.error !== null) && <ErrorBanner error={list.error ?? remove.error} onRetry={list.reload} />}
        {list.data?.map((s) => (
          <div key={s.id} className="cmt">
            <div className="row wrap" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="b">{s.name}</div>
                <div className="small muted mono">{s.url}</div>
              </div>
              <div className="row">
                <span className="tag">{s.allowedTools.length} tools allowed</span>
                <button type="button" className="btn btn-sm btn-secondary" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                  Tools
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await remove.run(s.id)) && list.reload()} aria-label={`Remove ${s.name}`}>
                  Remove
                </button>
              </div>
            </div>
            {open === s.id && <ServerTools server={s} onSaved={list.reload} />}
          </div>
        ))}
        {list.data && !list.data.length && <p className="muted small">No servers registered.</p>}
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
            <Field id="srv-name" label="Name" required>
              <input className="inp" id="srv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. State grants registry" />
            </Field>
            <Field id="srv-url" label="Server URL" required>
              <input className="inp mono" id="srv-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/mcp" style={{ fontSize: "12px" }} />
            </Field>
          </div>
          <Field id="srv-auth" label="Authorization header (optional)" help="Stored encrypted and never shown again.">
            <input className="inp" id="srv-auth" type="password" autoComplete="off" value={auth} onChange={(e) => setAuth(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={!name.trim() || !url.trim() || register.state === "saving"}>
            <Plus className="ic" aria-hidden="true" />
            Register server
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
  const [mercury] = page.data ?? [];
  return (
    <section id="integrations" className="card" aria-labelledby="integrations-h">
      <div className="card-h">
        <h3 id="integrations-h">Integrations</h3>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {page.status === "loading" && <Loading label="Loading integrations" />}
        {(page.status === "error" || connect.error !== null || sync.error !== null || disconnect.error !== null) && <ErrorBanner error={page.error ?? connect.error ?? sync.error ?? disconnect.error} onRetry={page.reload} />}
        {mercury && (
          <div className="cmt">
            <div className="row wrap" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="b">Mercury · read-only reconciliation</div>
                <div className="small muted">Lists outbound transactions so payments made outside Passport can be matched to tranches. The GMS never moves money through Mercury.</div>
              </div>
              <span className={mercury.connected ? "bdg bdg-ok" : "bdg bdg-neutral"}>
                <Plug className="ic" aria-hidden="true" />
                {mercury.connected ? "Connected" : "Not connected"}
              </span>
            </div>
            {mercury.connected ? (
              <div className="row wrap">
                <span className="small muted">{mercury.lastSyncAt ? `Last synced ${dateTime(mercury.lastSyncAt)}` : "Not synced yet"}</span>
                <button type="button" className="btn btn-sm btn-secondary" disabled={sync.state === "saving"} onClick={async () => (await sync.run()) && page.reload()}>
                  Sync now
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await disconnect.run()) && page.reload()}>
                  Disconnect
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
                <input className="inp" type="password" autoComplete="off" aria-label="Mercury read-only API token" placeholder="Read-only API token" value={token} onChange={(e) => setToken(e.target.value)} style={{ maxWidth: "320px" }} />
                <button type="submit" className="btn btn-secondary" disabled={token.trim().length < 8 || connect.state === "saving"}>
                  Connect Mercury
                </button>
              </form>
            )}
          </div>
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
          <h3 id="api-h">API clients</h3>
          <p className="small muted">For scripts and integrations. Clients never carry sign, release or commit rights; those stay with people.</p>
        </div>
      </div>
      {(list.status === "error" || revoke.error !== null) && (
        <div className="card-b">
          <ErrorBanner error={list.error ?? revoke.error} onRetry={list.reload} />
        </div>
      )}
      <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="API clients, scrollable">
        <table className="tbl" aria-label="API clients">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scopes</th>
              <th>Created</th>
              <th>Last used</th>
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
                <td>{c.lastUsedAt ? timeAgo(c.lastUsedAt) : "Never"}</td>
                <td>
                  {c.revokedAt ? (
                    <span className="muted small">Revoked</span>
                  ) : (
                    <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await revoke.run(c.id)) && list.reload()} aria-label={`Revoke ${c.name}`}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.data && !list.data.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No API clients.
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
        <Field id="client-name" label="New client name" required>
          <input className="inp" id="client-name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: "360px" }} />
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="lbl">Scopes</legend>
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
          Create client
        </button>
      </form>
      {issued && (
        <SecretOnce
          title={`Client secret for “${issued.name}”`}
          label="Client secret"
          value={issued.clientSecret}
          extra={
            <dl className="kv">
              <dt>Client id</dt>
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
  if (list.status === "loading") return <Loading label="Loading deliveries" />;
  if (list.status === "error") return <ErrorBanner error={list.error} onRetry={list.reload} />;
  if (!list.data.length) return <p className="muted small">No deliveries yet.</p>;
  return (
    <table className="tbl tbl-compact" aria-label={`Deliveries to ${hook.url}`}>
      <thead>
        <tr>
          <th>Event</th>
          <th>Status</th>
          <th className="num">Attempts</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        {list.data.map((d) => (
          <tr key={d.id}>
            <td className="mono">{d.eventType}</td>
            <td>
              {words(d.status)}
              {d.lastStatusCode ? ` · HTTP ${d.lastStatusCode}` : ""}
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
          <h3 id="webhooks-h">Webhooks</h3>
          <p className="small muted">Signed with HMAC-SHA256 (X-GMS-Signature, X-GMS-Timestamp) and retried for 24 hours.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {list.status === "loading" && <Loading label="Loading webhooks" />}
        {(list.status === "error" || remove.error !== null) && <ErrorBanner error={list.error ?? remove.error} onRetry={list.reload} />}
        {list.data?.map((h) => (
          <div key={h.id} className="cmt">
            <div className="row wrap" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="b mono">{h.url}</div>
                <div className="small muted">{h.events.length ? h.events.join(", ") : "All events"}</div>
              </div>
              <div className="row">
                <button type="button" className="btn btn-sm btn-secondary" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>
                  Deliveries
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await remove.run(h.id)) && list.reload()} aria-label={`Delete webhook ${h.url}`}>
                  Delete
                </button>
              </div>
            </div>
            {open === h.id && <Deliveries hook={h} />}
          </div>
        ))}
        {list.data && !list.data.length && <p className="muted small">No webhooks.</p>}
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
          <Field id="hook-url" label="Endpoint URL" required>
            <input className="inp mono" id="hook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={{ fontSize: "12px", maxWidth: "480px" }} />
          </Field>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="lbl">Events (none selected sends all)</legend>
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
            Add webhook
          </button>
        </form>
      </div>
      {created && <SecretOnce title="Webhook signing secret" label="Signing secret" value={created.secret} onClose={() => setCreated(null)} />}
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
          <h3 id="team-h">Team &amp; roles</h3>
          <p className="small muted">Admins and finance must use an authenticator. Finance releases payments; program officers cannot.</p>
        </div>
      </div>
      {(list.status === "error" || change.error !== null) && (
        <div className="card-b">
          <ErrorBanner error={list.error ?? change.error} onRetry={list.reload} />
        </div>
      )}
      <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="Team members, scrollable">
        <table className="tbl" aria-label="Team members">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Authenticator</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((m) => {
              const label = person(m.userId)?.name ?? m.email ?? "Member";
              return (
                <tr key={m.userId}>
                  <td>
                    <div className="ent">
                      <span className="nm">{label}</span>
                      {m.email && <span className="small muted">{m.email}</span>}
                    </div>
                  </td>
                  <td>
                    <select className="sel" aria-label={`Role for ${label}`} value={m.role} disabled={change.state === "saving"} onChange={async (e) => (await change.run(m.userId, e.target.value)) && list.reload()} style={{ height: "30px", maxWidth: "200px" }}>
                      {[...new Set([...FUNDER_ROLES, m.role])].map((r) => (
                        <option key={r} value={r}>
                          {words(r)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{m.mfaEnrolledAt ? `Enrolled ${formatDate(m.mfaEnrolledAt)}` : <span className="muted">Not enrolled</span>}</td>
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
        <input className="inp" type="email" aria-label="Email to invite" placeholder="name@organization.example" value={email} onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: "280px" }} />
        <select className="sel" aria-label="Role for the invitation" value={role} onChange={(e) => setRole(e.target.value)} style={{ maxWidth: "180px" }}>
          {FUNDER_ROLES.map((r) => (
            <option key={r} value={r}>
              {words(r)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary" disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || invite.state === "saving"}>
          Invite
        </button>
        <DirectorySuggestions query={email} onChoose={(p) => setEmail(p.email)} />
        {sent && (
          <span className="notice" role="status">
            Invitation created for {sent}.
          </span>
        )}
        {invite.error !== null && <span className="err-msg">{invite.error instanceof Error ? invite.error.message : "The invitation was not created."}</span>}
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
          <h3 id="audit-h">Audit ledger</h3>
          <p className="small muted">Append-only. Every change of status, money, consent or access, with who or what did it.</p>
        </div>
        <div className="row">
          <select
            className="sel"
            aria-label="Filter by subject"
            value={subjectType}
            onChange={(e) => {
              setSubjectType(e.target.value);
              setPage(1);
            }}
            style={{ height: "30px", width: "170px" }}
          >
            <option value="">All subjects</option>
            {["application", "award", "agreement", "tranche", "requirement", "submission", "workspace", "grantee"].map((s) => (
              <option key={s} value={s}>
                {words(s)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-secondary" disabled={!list.data?.items.length} onClick={() => list.data && exportCsv(list.data.items)}>
            <Download className="ic" aria-hidden="true" />
            Export page
          </button>
        </div>
      </div>
      <div className="card-b">
        {list.status === "loading" && <Loading label="Loading the ledger" />}
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
                      {who.agent ? " (agent)" : ""} · {words(e.subjectType)} {e.subjectId.slice(0, 8)} · {dateTime(e.occurredAt)}
                    </div>
                  </div>
                </div>
              );
            })}
            {!list.data.items.length && <p className="muted small">Nothing recorded for this filter.</p>}
          </div>
        )}
      </div>
      {list.data && list.data.total > 25 && (
        <div className="card-f">
          <button type="button" className="btn btn-sm btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </button>
          <button type="button" className="btn btn-sm btn-secondary" disabled={page * 25 >= list.data.total} onClick={() => setPage((p) => p + 1)}>
            Older
          </button>
          <span className="small muted">
            Page {page} of {Math.ceil(list.data.total / 25)}
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
        <h3 id="connect-h">Connect an agent</h3>
        <span className="tag">MCP · streamable HTTP</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div className="fld">
          <label className="lbl" htmlFor="mcp-url">
            Server URL
          </label>
          <div className="row" style={{ gap: "8px" }}>
            <input className="inp mono" id="mcp-url" value={mcpUrl} readOnly style={{ fontSize: "12px" }} />
            <CopyButton value={mcpUrl} what="server URL" onCopied={() => setCopied(true)} />
          </div>
        </div>
        <ol className="stp-v" style={{ gap: "0" }}>
          <li className={stepOne ? "s done" : "s on"}>
            <span className="n">{stepOne ? <Check className="ic ic-sm" aria-hidden="true" /> : 1}</span>
            <div>
              <div className="t">Add the server to your client</div>
              <div className="d">Paste the URL into Claude, Cursor, or any MCP client that supports OAuth.</div>
            </div>
          </li>
          <li className={connected ? "s done" : stepOne ? "s on" : "s"}>
            <span className="n">{connected ? <Check className="ic ic-sm" aria-hidden="true" /> : 2}</span>
            <div>
              <div className="t">Sign in</div>
              <div className="d">The client opens the GMS sign-in; you authenticate as yourself, with MFA.</div>
            </div>
          </li>
          <li className={connected ? "s done" : "s"}>
            <span className="n">{connected ? <Check className="ic ic-sm" aria-hidden="true" /> : 3}</span>
            <div>
              <div className="t">Choose workspace and scopes</div>
              <div className="d">Pick {workspaceName}, grant scopes by area, and see which tools are gated by a human.</div>
            </div>
          </li>
        </ol>
        <div className="row wrap" style={{ gap: "12px" }}>
          <Link to="/agents" className="btn btn-primary">
            How agents connect
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <a href="#gates" className="small b">
            See which actions need a person
          </a>
          {mock && (
            <Link to="/oauth/consent?req=preview" className="small b">
              Preview the consent screen
            </Link>
          )}
        </div>
        <span className="help">
          The consent screen opens from the agent’s client once it starts the OAuth flow; it cannot be started from here. The agent inherits the connecting
          user’s permissions and never more. Scopes can be narrowed later; widening requires a new consent.
        </span>
      </div>
    </section>
  );
}

export default function SettingsMcp() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  return (
    <>
      <title>{`Settings — agents, integrations and audit — ${ws.name}`}</title>
      <FunderShell active="Settings">
        <main className="main">
          <PageHeader crumbs={[{ label: ws.name, to: base }, { label: "Settings" }, { label: "Agents & MCP" }]} title="Settings" meta={<span>Workspace administration · changes are written to the audit ledger</span>} />
          <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div className="col" style={{ gap: "12px", position: "sticky", top: "16px" }}>
              <SettingsNav base={base} active="mcp" />
              <nav className="card snav" style={{ padding: "8px" }} aria-label="On this page">
                {[
                  ["agents", "Connected agents"],
                  ["connect", "Connect an agent"],
                  ["gates", "Human gates"],
                  ["servers", "Custom MCP servers"],
                  ["integrations", "Integrations"],
                  ["api", "API clients"],
                  ["webhooks", "Webhooks"],
                  ["team", "Team & roles"],
                  ["contacts", "Contacts for applicants"],
                  ["audit", "Audit ledger"],
                ].map(([id, label]) => (
                  <a key={id} href={`#${id}`}>
                    {label}
                  </a>
                ))}
              </nav>
              <Link to={`${base}/approvals`} className="small b">
                Pending approvals →
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
              <ContactsEditor />
              <Ledger />
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
