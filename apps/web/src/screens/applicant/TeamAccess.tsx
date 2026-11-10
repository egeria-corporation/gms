// SPDX-License-Identifier: AGPL-3.0-only
// Team & access: who works in this workspace, which funders can read the Passport record, and
// what connected agents have asked a person to approve.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Bot, Check, ShieldCheck, UserPlus, X } from "lucide-react";
import type { ApplicantApi, ApplicantMember, Approval, Consent } from "../../api/applicant.ts";
import { useApplicantMutation, useApplicantQuery } from "../../api/applicantHooks.ts";
import type { ApplicantMoreApi, McpConnection } from "../../api/applicantMore.ts";
import { useMoreApi, useMoreMutation } from "../../api/applicantMoreHooks.ts";
import { roleTitle } from "../../api/client.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Avatar, FunderChip, Loaded, timeAgo } from "../../components/applicant.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { DataTable, EmptyState, ErrorBanner, Field, problemFor, SaveNote, TabPanel, Tabs, type Column } from "../../components/ui.tsx";
import { canRead } from "./organizationExtras.tsx";
import { formatDate } from "../../lib/format.ts";

const load = async (api: ApplicantApi, more: ApplicantMoreApi) => {
  // Connected agents are a convenience on this screen; a failure there must not hide the team.
  const [members, consents, approvals, agents] = await Promise.all([api.members(), api.consents(), api.approvals(), more.connections().catch(() => [] as McpConnection[])]);
  return { members, consents, approvals, agents: agents.filter((c) => !c.revokedAt) };
};

type TabKey = "members" | "consultants" | "funders" | "agents";

const ROLES = [
  { value: "editor", label: "Editor", help: "Edits applications and reports" },
  { value: "viewer", label: "Viewer", help: "Reads everything, changes nothing" },
  { value: "finance", label: "Finance", help: "Budgets and payment status" },
  { value: "admin", label: "Admin", help: "Manages the team, consents and signing. Needs an authenticator" },
  { value: "consultant", label: "Consultant", help: "Outside help with an end date, scoped to the applications you assign" },
];

const BASIS: Record<Consent["basis"], string> = { application: "You applied to this funder", passport_grant: "Granted in Passport", shared_submission: "You shared a report" };

function InviteForm({ onInvited }: { onInvited: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [days, setDays] = useState("30");
  const invite = useApplicantMutation((api) => api.invite({ email: email.trim(), role, ...(role === "consultant" ? { expiresInDays: Number(days) || 30 } : {}) }));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await invite.run();
    if (r) {
      onInvited(r.email);
      setEmail("");
    }
  };
  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="inv-h">
      <div className="card-h">
        <h2 id="inv-h" style={{ fontSize: "18px" }}>
          Invite someone
        </h2>
        <SaveNote state={invite.state} savedText="Invitation sent" />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {invite.error && !problemFor(invite.error, "email") ? <ErrorBanner error={invite.error} /> : null}
        <Field id="inv-email" label="Email" required error={problemFor(invite.error, "email")}>
          <input className="inp" id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </Field>
        <Field id="inv-role" label="Role" help={ROLES.find((r) => r.value === role)?.help}>
          <select className="sel" id="inv-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        {role === "consultant" && (
          <Field id="inv-days" label="Access ends after (days)" help="A consultant only sees the applications you assign sections of to them.">
            <input className="inp" id="inv-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        <button className="btn btn-primary" type="submit" disabled={invite.state === "saving" || !email.trim()} style={{ alignSelf: "flex-start" }}>
          <UserPlus className="ic" aria-hidden="true" />
          Send invitation
        </button>
      </div>
    </form>
  );
}

export default function TeamAccess() {
  const ws = useWorkspace("applicant");
  const more = useMoreApi();
  const query = useApplicantQuery((api) => load(api, more), [ws.id, more]);
  const [tab, setTab] = useState<TabKey>("members");
  const disconnect = useMoreMutation((api, id: string) => api.revokeConnection(id));
  const [revoking, setRevoking] = useState<Consent | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const revoke = useApplicantMutation((api, id: string) => api.revokeConsent(id));
  const decide = useApplicantMutation((api, id: string, approve: boolean) => api.decideApproval(id, approve));

  const who: Column<ApplicantMember> = {
    key: "who",
    header: "Person",
    sort: (m) => m.name ?? m.email ?? "",
    cell: (m) => (
      <span className="row" style={{ gap: "8px" }}>
        <Avatar name={m.name ?? m.email ?? "?"} size="sm" />
        <span className="nm">{m.name ?? m.email ?? "Member"}</span>
      </span>
    ),
  };
  const mfa: Column<ApplicantMember> = {
    key: "mfa",
    header: "MFA",
    cell: (m) =>
      m.mfaEnrolledAt ? (
        <span className="row" style={{ gap: "5px", color: "var(--s-ok-fg)", fontWeight: 700 }}>
          <ShieldCheck className="ic" aria-hidden="true" />
          Enrolled
        </span>
      ) : (
        <span className="muted">{m.requiresMfa ? "Required, not enrolled" : "Not required"}</span>
      ),
  };
  const memberColumns: Column<ApplicantMember>[] = [
    who,
    { key: "email", header: "Email", cell: (m) => m.email ?? "—", sort: (m) => m.email ?? "" },
    { key: "role", header: "Role", cell: (m) => <span className="role">{roleTitle(m.role)}</span>, sort: (m) => m.role },
    mfa,
    { key: "since", header: "Member since", cell: (m) => formatDate(m.createdAt), sort: (m) => m.createdAt },
  ];
  const consultantColumns: Column<ApplicantMember>[] = [
    who,
    { key: "role", header: "Role", cell: (m) => <span className="role">{roleTitle(m.role)}</span> },
    {
      key: "scope",
      header: "Scope",
      cell: (m) => {
        const apps = (m.scope as { applicationIds?: unknown[] }).applicationIds;
        const n = Array.isArray(apps) ? apps.length : 0;
        return `${n} application${n === 1 ? "" : "s"}`;
      },
    },
    { key: "expires", header: "Expires", cell: (m) => (m.expiresAt ? formatDate(m.expiresAt) : "No end date"), sort: (m) => m.expiresAt },
    mfa,
  ];
  const agentColumns: Column<McpConnection>[] = [
    { key: "agent", header: "Agent", cell: (c) => <span className="nm">{c.clientName ?? "Connected agent"}</span>, sort: (c) => c.clientName ?? "" },
    { key: "client", header: "Client", cell: (c) => <span className="mono">{c.clientUri ?? c.clientId}</span> },
    {
      key: "scopes",
      header: "Scopes",
      cell: (c) => (
        <span className="row wrap" style={{ gap: "4px", whiteSpace: "normal" }}>
          {c.scopes.map((sc) => (
            <span key={sc} className="tag">
              {sc}
            </span>
          ))}
        </span>
      ),
    },
    { key: "used", header: "Last used", cell: (c) => (c.lastUsedAt ? timeAgo(c.lastUsedAt) : "Never"), sort: (c) => c.lastUsedAt },
    { key: "by", header: "Connected by", cell: (c) => (c.mine ? "You" : "A teammate") },
    {
      key: "act",
      header: "",
      cell: (c) => (
        <button
          type="button"
          className="btn btn-sm btn-danger"
          aria-label={`Disconnect ${c.clientName ?? "agent"}`}
          onClick={async () => {
            if (await disconnect.run(c.id)) query.reload();
          }}
        >
          Disconnect
        </button>
      ),
    },
  ];

  return (
    <>
      <title>{`Team & access — ${ws.name}`}</title>
      <ApplicantShell active="Team & access">
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>Team &amp; access</h1>
              </div>
              <div className="meta">
                <span>People in this workspace, funders who can read your Passport record, and requests from connected agents.</span>
              </div>
            </div>
          </div>
          <Loaded query={query} label="Loading team and access">
            {({ members, consents, approvals, agents }) => {
              const staff = members.filter((m) => m.role !== "consultant");
              const consultants = members.filter((m) => m.role === "consultant");
              const pending = approvals.filter((a) => a.status === "pending");
              const setApproval = (next: Approval) => query.set({ members, consents, agents, approvals: approvals.map((a) => (a.id === next.id ? next : a)) });
              return (
                <>
                  {invited && (
                    <div className="bnr bnr-ok" role="status">
                      <Check className="ic" aria-hidden="true" />
                      <div>
                        <div className="t">Invitation sent to {invited}</div>
                        <div className="d">They join when they sign in with that address.</div>
                      </div>
                    </div>
                  )}
                  <Tabs
                    label="Access sections"
                    idPrefix="team"
                    active={tab}
                    onChange={setTab}
                    tabs={[
                      { key: "members", label: "Members", count: staff.length },
                      { key: "consultants", label: "Consultants", count: consultants.length },
                      { key: "funders", label: "Funders with access", count: consents.filter((c) => !c.revokedAt).length },
                      { key: "agents", label: "Agents", count: agents.length },
                    ]}
                  />

                  <TabPanel idPrefix="team" tab="members" active={tab}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                      <section aria-labelledby="team-h" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <h2 id="team-h" style={{ fontSize: "18px" }}>
                          Members
                        </h2>
                        <DataTable label="Team members" columns={memberColumns} rows={staff} rowKey={(m) => m.userId} empty={<EmptyState icon={UserPlus} title="Just you so far" />} />
                      </section>
                      <InviteForm onInvited={setInvited} />
                    </div>
                  </TabPanel>

                  <TabPanel idPrefix="team" tab="consultants" active={tab}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                      <section aria-labelledby="cons-h" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <h2 id="cons-h" style={{ fontSize: "18px" }}>
                          Consultants
                        </h2>
                        <p className="small muted">Outside help sees only the applications you assign, and access ends on the date you set.</p>
                        <DataTable
                          label="Consultants"
                          columns={consultantColumns}
                          rows={consultants}
                          rowKey={(m) => m.userId}
                          empty={
                            <EmptyState icon={UserPlus} title="No consultants">
                              Invite one with the Consultant role and an end date.
                            </EmptyState>
                          }
                        />
                      </section>
                      <InviteForm onInvited={setInvited} />
                    </div>
                  </TabPanel>

                  <TabPanel idPrefix="team" tab="funders" active={tab}>
                    <section className="card" aria-labelledby="access-h">
                      <div className="card-h">
                        <div>
                          <h2 id="access-h" style={{ fontSize: "18px" }}>
                            Funders with access
                          </h2>
                          <p className="small muted">Funders that can read the record cached from Passport. Bank details are never part of it.</p>
                        </div>
                      </div>
                      {revoke.error ? (
                        <div className="card-b">
                          <ErrorBanner error={revoke.error} title="Access was not removed" />
                        </div>
                      ) : null}
                      {consents.length === 0 ? (
                        <div className="card-b muted">No funder has access yet. Submitting an application grants that funder access for it.</div>
                      ) : (
                        <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label="Funders with access, scrollable">
                          <table className="tbl" style={{ fontSize: "14px" }}>
                            <caption className="sr">Funders that can read your Passport record</caption>
                            <thead>
                              <tr>
                                <th scope="col">Funder</th>
                                <th scope="col">Can read</th>
                                <th scope="col">Granted via</th>
                                <th scope="col">Since</th>
                                <th scope="col">
                                  <span className="sr">Actions</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {consents.map((c) => (
                                <tr key={c.id} style={{ opacity: c.revokedAt ? 0.7 : 1 }}>
                                  <td>
                                    <FunderChip name={c.funder.name} />
                                  </td>
                                  <td style={{ whiteSpace: "normal" }}>{canRead(c)}</td>
                                  <td style={{ whiteSpace: "normal" }}>{BASIS[c.basis]}</td>
                                  <td>{formatDate(c.grantedAt)}</td>
                                  <td>
                                    {c.revokedAt ? (
                                      <span className="tag">Removed</span>
                                    ) : (
                                      <button className="btn btn-sm btn-danger" type="button" aria-haspopup="dialog" onClick={() => setRevoking(c)}>
                                        Remove access
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </TabPanel>

                  <TabPanel idPrefix="team" tab="agents" active={tab}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                        <section aria-labelledby="agents-h" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          <h2 id="agents-h" style={{ fontSize: "18px" }}>
                            Agents
                          </h2>
                          {disconnect.error ? <ErrorBanner error={disconnect.error} title="The agent is still connected" /> : null}
                          <DataTable
                            label="Connected agents"
                            columns={agentColumns}
                            rows={agents}
                            rowKey={(c) => c.id}
                            empty={
                              <EmptyState icon={Bot} title="No agents connected">
                                Connect one from your MCP client; it signs in as you and asks before anything is submitted or signed.
                              </EmptyState>
                            }
                          />
                        </section>
                        <section className="card" aria-labelledby="agent-h">
                          <div className="card-h">
                            <div>
                              <h2 id="agent-h" style={{ fontSize: "18px" }}>
                                Agent requests
                              </h2>
                              <p className="small muted">Agents can draft and fill; submitting, accepting and signing wait for a person.</p>
                            </div>
                            {pending.length > 0 && <span className="bdg bdg-agent">{pending.length} waiting</span>}
                          </div>
                          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {decide.error ? <ErrorBanner error={decide.error} /> : null}
                            {approvals.length === 0 && <p className="muted">Nothing is waiting for approval.</p>}
                            {approvals.map((a) => (
                              <div className="apr" key={a.id}>
                                <div className="hd">
                                  <Bot className="ic" aria-hidden="true" />
                                  <span>{a.requestedBy.clientId ?? "Connected agent"}</span>
                                  <span style={{ marginLeft: "auto", fontWeight: 400 }}>{timeAgo(a.createdAt)}</span>
                                </div>
                                <div className="bd">
                                  <div>
                                    <span className="b">Requested action:</span> {a.description ?? a.tool.replace(/_/g, " ")}
                                  </div>
                                  {a.status !== "pending" && (
                                    <div className="small muted">
                                      {a.status === "rejected" ? "Rejected" : a.status === "failed" ? `Failed${a.error ? `: ${a.error}` : ""}` : "Approved"}
                                      {a.decidedAt ? ` · ${formatDate(a.decidedAt)}` : ""}
                                    </div>
                                  )}
                                </div>
                                {a.status === "pending" && (
                                  <div className="ft">
                                    <button
                                      className="btn btn-primary btn-sm"
                                      type="button"
                                      disabled={decide.state === "saving"}
                                      onClick={async () => {
                                        const r = await decide.run(a.id, true);
                                        if (r) setApproval(r);
                                      }}
                                    >
                                      Approve
                                    </button>
                                    <button
                                      className="btn btn-danger btn-sm"
                                      type="button"
                                      disabled={decide.state === "saving"}
                                      onClick={async () => {
                                        const r = await decide.run(a.id, false);
                                        if (r) setApproval(r);
                                      }}
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </section>
                      </div>
                      <section className="card" aria-labelledby="let-agent-h">
                        <div className="card-h">
                          <h3 id="let-agent-h">Let your agent apply</h3>
                        </div>
                        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          <p>An agent can find funding, start applications, fill forms from your Passport record and the answer library, and draft reports.</p>
                          <p className="help">Submitting an application, accepting an award and signing an agreement always wait for a person here.</p>
                          <Link to="/agents" className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                            How agents connect
                          </Link>
                        </div>
                      </section>
                    </div>
                  </TabPanel>

                  <Dialog open={!!revoking} onClose={() => setRevoking(null)} labelledBy="rv-title">
                    <div className="hd">
                      <h3 id="rv-title" style={{ fontSize: "16px" }}>
                        Remove {revoking?.funder.name ?? "this funder"}’s access?
                      </h3>
                      <button className="iconbtn" type="button" aria-label="Close" onClick={() => setRevoking(null)}>
                        <X className="ic ic-md" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="bd">
                      <p>They keep what you already submitted, but can no longer read updates to your Passport record. Open applications with them may stall until you grant access again.</p>
                    </div>
                    <div className="ft">
                      <button className="btn btn-secondary" type="button" onClick={() => setRevoking(null)}>
                        Keep access
                      </button>
                      <button
                        className="btn btn-danger-solid"
                        type="button"
                        disabled={revoke.state === "saving"}
                        onClick={async () => {
                          const target = revoking;
                          if (!target) return;
                          const r = await revoke.run(target.id);
                          setRevoking(null);
                          if (r) query.set({ members, approvals, agents, consents: consents.map((c) => (c.id === target.id ? { ...c, revokedAt: new Date().toISOString() } : c)) });
                        }}
                      >
                        Remove access
                      </button>
                    </div>
                  </Dialog>
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
