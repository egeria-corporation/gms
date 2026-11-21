// SPDX-License-Identifier: AGPL-3.0-only
// Team & access: who works in this workspace, which funders can read the Passport record, and
// what connected agents have asked a person to approve.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Bot, Check, ShieldCheck, UserPlus, X } from "lucide-react";
import type { ApplicantApi, ApplicantMember, Approval, Consent } from "../../api/applicant.ts";
import { ApiError } from "../../api/client.ts";
import { useApplicantMutation, useApplicantQuery } from "../../api/applicantHooks.ts";
import type { ApplicantMoreApi, McpConnection } from "../../api/applicantMore.ts";
import { useMoreApi, useMoreMutation } from "../../api/applicantMoreHooks.ts";
import { roleTitle } from "../../api/client.ts";
import { useLaunchQuery } from "../../api/launchHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Avatar, FunderChip, Loaded, timeAgo } from "../../components/applicant.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { DataTable, EmptyState, ErrorBanner, Field, problemFor, SaveNote, TabPanel, Tabs, type Column } from "../../components/ui.tsx";
import { applicantAccess } from "../../lib/roles.ts";
import { canRead } from "./organizationExtras.tsx";
import { formatDate } from "../../lib/format.ts";
import { t, useApplicantText } from "./i18n.ts";

const emptyIfForbidden = <T,>(empty: T) => (e: unknown) => (e instanceof ApiError && e.status === 403 ? empty : Promise.reject(e));

const load = async (api: ApplicantApi, more: ApplicantMoreApi) => {
  // Connected agents are a convenience on this screen; a failure there must not hide the team.
  // Consents and approvals need scopes a consultant does not have; the roster still loads.
  const [members, consents, approvals, agents] = await Promise.all([
    api.members(),
    api.consents().catch(emptyIfForbidden([] as Consent[])),
    api.approvals().catch(emptyIfForbidden([] as Approval[])),
    more.connections().catch(() => [] as McpConnection[]),
  ]);
  return { members, consents, approvals, agents: agents.filter((c) => !c.revokedAt) };
};

type TabKey = "members" | "consultants" | "funders" | "agents";

// A function and getters, so the words follow the page's language (docs/i18n.md).
const ROLES = () => [
  { value: "editor", label: t("teamAccess.roleOpt.editor"), help: t("teamAccess.roleOpt.editorHelp") },
  { value: "viewer", label: t("teamAccess.roleOpt.viewer"), help: t("teamAccess.roleOpt.viewerHelp") },
  { value: "finance", label: t("teamAccess.roleOpt.finance"), help: t("teamAccess.roleOpt.financeHelp") },
  { value: "admin", label: t("teamAccess.roleOpt.admin"), help: t("teamAccess.roleOpt.adminHelp") },
  { value: "consultant", label: t("teamAccess.roleOpt.consultant"), help: t("teamAccess.roleOpt.consultantHelp") },
];

const BASIS: Record<Consent["basis"], string> = {
  get application() { return t("teamAccess.basis.application"); },
  get passport_grant() { return t("teamAccess.basis.passport"); },
  get shared_submission() { return t("teamAccess.basis.shared"); },
};

function InviteForm({ onInvited }: { onInvited: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [days, setDays] = useState("30");
  const [firm, setFirm] = useState("");
  const invite = useApplicantMutation((api) => api.invite({ email: email.trim(), role, ...(role === "consultant" ? { expiresInDays: Number(days) || 30, ...(firm.trim() ? { organizationName: firm.trim() } : {}) } : {}) }));
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
          {t("teamAccess.inviteSomeone")}
        </h2>
        <SaveNote state={invite.state} savedText={t("teamAccess.invitationSent")} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {invite.error && !problemFor(invite.error, "email") ? <ErrorBanner error={invite.error} /> : null}
        <Field id="inv-email" label={t("teamAccess.email")} required error={problemFor(invite.error, "email")}>
          <input className="inp" id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </Field>
        <Field id="inv-role" label={t("teamAccess.role")} help={ROLES().find((r) => r.value === role)?.help}>
          <select className="sel" id="inv-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES().map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        {role === "consultant" && (
          <Field id="inv-firm" label={t("teamAccess.consultantsOrganizationOptional")} help={t("teamAccess.theFirmTheyWorkForShown")}>
            <input className="inp" id="inv-firm" value={firm} maxLength={200} onChange={(e) => setFirm(e.target.value)} autoComplete="off" />
          </Field>
        )}
        {role === "consultant" && (
          <Field id="inv-days" label={t("teamAccess.accessEndsAfterDays")} help={t("teamAccess.aConsultantOnlySeesTheApplications")}>
            <input className="inp" id="inv-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        <button className="btn btn-primary" type="submit" disabled={invite.state === "saving" || !email.trim()} style={{ alignSelf: "flex-start" }}>
          <UserPlus className="ic" aria-hidden="true" />
          {t("teamAccess.sendInvitation")}
        </button>
      </div>
    </form>
  );
}

export default function TeamAccess() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const access = applicantAccess(ws.member.role);
  const canDecide = access.admin || access.applications || access.reports || access.messages;
  const more = useMoreApi();
  const query = useApplicantQuery((api) => load(api, more), [ws.id, more]);
  const activity = useLaunchQuery((api) => api.memberActivity(ws.id), [ws.id]);
  const [tab, setTab] = useState<TabKey>("members");
  const disconnect = useMoreMutation((api, id: string) => api.revokeConnection(id));
  const [revoking, setRevoking] = useState<Consent | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const revoke = useApplicantMutation((api, id: string) => api.revokeConsent(id));
  const decide = useApplicantMutation((api, id: string, approve: boolean) => api.decideApproval(id, approve));

  const who: Column<ApplicantMember> = {
    key: "who",
    header: t("teamAccess.col.person"),
    sort: (m) => m.name ?? m.email ?? "",
    cell: (m) => (
      <span className="row" style={{ gap: "8px" }}>
        <Avatar name={m.name ?? m.email ?? "?"} size="sm" />
        <span className="nm">{m.name ?? m.email ?? t("teamAccess.member")}</span>
      </span>
    ),
  };
  const activityOf = new Map((activity.data ?? []).map((a) => [a.userId, a]));
  const lastActive = (userId: string) => {
    const at = activityOf.get(userId)?.lastActiveAt;
    return at ? timeAgo(at) : <span className="muted">{t("teamAccess.notRecorded")}</span>;
  };
  const mfa: Column<ApplicantMember> = {
    key: "mfa",
    header: t("teamAccess.col.mfa"),
    cell: (m) =>
      m.mfaEnrolledAt ? (
        <span className="row" style={{ gap: "5px", color: "var(--s-ok-fg)", fontWeight: 700 }}>
          <ShieldCheck className="ic" aria-hidden="true" />
          {t("teamAccess.enrolled")}
        </span>
      ) : (
        <span className="muted">{m.requiresMfa ? t("teamAccess.requiredNotEnrolled") : t("teamAccess.notRequired")}</span>
      ),
  };
  const memberColumns: Column<ApplicantMember>[] = [
    who,
    { key: "email", header: t("teamAccess.email"), cell: (m) => m.email ?? "—", sort: (m) => m.email ?? "" },
    { key: "role", header: t("teamAccess.role"), cell: (m) => <span className="role">{roleTitle(m.role)}</span>, sort: (m) => m.role },
    mfa,
    { key: "active", header: t("teamAccess.col.lastActive"), cell: (m) => lastActive(m.userId), sort: (m) => activityOf.get(m.userId)?.lastActiveAt ?? null },
    { key: "since", header: t("teamAccess.col.memberSince"), cell: (m) => formatDate(m.createdAt), sort: (m) => m.createdAt },
  ];
  const consultantColumns: Column<ApplicantMember>[] = [
    who,
    { key: "firm", header: t("teamAccess.col.organization"), cell: (m) => activityOf.get(m.userId)?.organization ?? <span className="muted">{t("teamAccess.notRecorded")}</span>, sort: (m) => activityOf.get(m.userId)?.organization ?? null },
    { key: "role", header: t("teamAccess.role"), cell: (m) => <span className="role">{roleTitle(m.role)}</span> },
    {
      key: "scope",
      header: t("teamAccess.col.scope"),
      cell: (m) => {
        const apps = (m.scope as { applicationIds?: unknown[] }).applicationIds;
        return t("teamAccess.applicationsCount", { count: Array.isArray(apps) ? apps.length : 0 });
      },
    },
    { key: "expires", header: t("teamAccess.col.expires"), cell: (m) => (m.expiresAt ? formatDate(m.expiresAt) : t("teamAccess.noEndDate")), sort: (m) => m.expiresAt },
    { key: "active", header: t("teamAccess.col.lastActive"), cell: (m) => lastActive(m.userId), sort: (m) => activityOf.get(m.userId)?.lastActiveAt ?? null },
    mfa,
  ];
  const agentColumns: Column<McpConnection>[] = [
    { key: "agent", header: t("teamAccess.col.agent"), cell: (c) => <span className="nm">{c.clientName ?? t("teamAccess.connectedAgent")}</span>, sort: (c) => c.clientName ?? "" },
    { key: "client", header: t("teamAccess.col.client"), cell: (c) => <span className="mono">{c.clientUri ?? c.clientId}</span> },
    {
      key: "scopes",
      header: t("teamAccess.col.scopes"),
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
    { key: "used", header: t("teamAccess.col.lastUsed"), cell: (c) => (c.lastUsedAt ? timeAgo(c.lastUsedAt) : t("teamAccess.never")), sort: (c) => c.lastUsedAt },
    { key: "by", header: t("teamAccess.col.connectedBy"), cell: (c) => (c.mine ? t("teamAccess.you") : t("teamAccess.aTeammate")) },
    {
      key: "act",
      header: "",
      cell: (c) =>
        access.admin || c.mine ? (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            aria-label={c.clientName ? t("teamAccess.disconnectName", { name: c.clientName }) : t("teamAccess.disconnectAgent")}
            onClick={async () => {
              if (await disconnect.run(c.id)) query.reload();
            }}
          >
            {t("teamAccess.disconnect")}
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <title>{t("teamAccess.pageTitle", { workspace: ws.name })}</title>
      <ApplicantShell active="Team & access">
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>{t("teamAccess.teamAccess")}</h1>
              </div>
              <div className="meta">
                <span>{t("teamAccess.peopleInThisWorkspaceFundersWho")}</span>
              </div>
            </div>
          </div>
          <Loaded query={query} label={t("teamAccess.loadingTeamAndAccess")}>
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
                        <div className="t">{t("teamAccess.sentTo", { email: invited })}</div>
                        <div className="d">{t("teamAccess.theyJoinWhenTheySignIn")}</div>
                      </div>
                    </div>
                  )}
                  <Tabs
                    label={t("teamAccess.accessSections")}
                    idPrefix="team"
                    active={tab}
                    onChange={setTab}
                    tabs={[
                      { key: "members", label: t("teamAccess.members"), count: staff.length },
                      { key: "consultants", label: t("teamAccess.consultants"), count: consultants.length },
                      { key: "funders", label: t("teamAccess.fundersWithAccess"), count: consents.filter((c) => !c.revokedAt).length },
                      { key: "agents", label: t("teamAccess.agents"), count: agents.length },
                    ]}
                  />

                  <TabPanel idPrefix="team" tab="members" active={tab}>
                    <div className="team-split">
                      <section aria-labelledby="team-h" style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
                        <h2 id="team-h" style={{ fontSize: "18px" }}>
                          {t("teamAccess.members")}
                        </h2>
                        <DataTable label={t("teamAccess.teamMembers")} columns={memberColumns} rows={staff} rowKey={(m) => m.userId} empty={<EmptyState icon={UserPlus} title={t("teamAccess.justYouSoFar")} />} />
                      </section>
                      {access.admin ? <InviteForm onInvited={setInvited} /> : <p className="small muted">{t("access.adminInvites")}</p>}
                    </div>
                  </TabPanel>

                  <TabPanel idPrefix="team" tab="consultants" active={tab}>
                    <div className="team-split">
                      <section aria-labelledby="cons-h" style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
                        <h2 id="cons-h" style={{ fontSize: "18px" }}>
                          {t("teamAccess.consultants")}
                        </h2>
                        <p className="small muted">{t("teamAccess.outsideHelpSeesOnlyTheApplications")}</p>
                        <DataTable
                          label={t("teamAccess.consultants")}
                          columns={consultantColumns}
                          rows={consultants}
                          rowKey={(m) => m.userId}
                          empty={
                            <EmptyState icon={UserPlus} title={t("teamAccess.noConsultants")}>
                              {access.admin ? t("teamAccess.inviteOneWithTheConsultantRole") : t("access.adminInvites")}
                            </EmptyState>
                          }
                        />
                      </section>
                      {access.admin ? <InviteForm onInvited={setInvited} /> : <p className="small muted">{t("access.adminInvites")}</p>}
                    </div>
                  </TabPanel>

                  <TabPanel idPrefix="team" tab="funders" active={tab}>
                    <section className="card" aria-labelledby="access-h">
                      <div className="card-h">
                        <div>
                          <h2 id="access-h" style={{ fontSize: "18px" }}>
                            {t("teamAccess.fundersWithAccess")}
                          </h2>
                          <p className="small muted">{t("teamAccess.fundersThatCanReadTheRecord")}</p>
                        </div>
                      </div>
                      {revoke.error ? (
                        <div className="card-b">
                          <ErrorBanner error={revoke.error} title={t("teamAccess.accessWasNotRemoved")} />
                        </div>
                      ) : null}
                      {consents.length === 0 ? (
                        <div className="card-b muted">{t("teamAccess.noFunderHasAccessYetSubmitting")}</div>
                      ) : (
                        <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label={t("teamAccess.fundersWithAccessScrollable")}>
                          <table className="tbl" style={{ fontSize: "14px" }}>
                            <caption className="sr">{t("teamAccess.fundersThatCanReadYourPassport")}</caption>
                            <thead>
                              <tr>
                                <th scope="col">{t("teamAccess.funder")}</th>
                                <th scope="col">{t("teamAccess.canRead")}</th>
                                <th scope="col">{t("teamAccess.grantedVia")}</th>
                                <th scope="col">{t("teamAccess.since")}</th>
                                <th scope="col">
                                  <span className="sr">{t("teamAccess.actions")}</span>
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
                                      <span className="tag">{t("teamAccess.removed")}</span>
                                    ) : access.admin ? (
                                      <button className="btn btn-sm btn-danger" type="button" aria-haspopup="dialog" onClick={() => setRevoking(c)}>
                                        {t("teamAccess.removeAccess")}
                                      </button>
                                    ) : (
                                      <span className="small muted">{t("access.adminRemovesAccess")}</span>
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
                            {t("teamAccess.agents")}
                          </h2>
                          {!access.admin && <p className="small muted">{t("access.adminDisconnects")}</p>}
                          {disconnect.error ? <ErrorBanner error={disconnect.error} title={t("teamAccess.theAgentIsStillConnected")} /> : null}
                          <DataTable
                            label={t("teamAccess.connectedAgents")}
                            columns={agentColumns}
                            rows={agents}
                            rowKey={(c) => c.id}
                            empty={
                              <EmptyState icon={Bot} title={t("teamAccess.noAgentsConnected")}>
                                {t("teamAccess.connectOneFromYourMcpClient")}
                              </EmptyState>
                            }
                          />
                        </section>
                        <section className="card" aria-labelledby="agent-h">
                          <div className="card-h">
                            <div>
                              <h2 id="agent-h" style={{ fontSize: "18px" }}>
                                {t("teamAccess.agentRequests")}
                              </h2>
                              <p className="small muted">{t("teamAccess.agentsCanDraftAndFillSubmitting")}</p>
                            </div>
                            {pending.length > 0 && <span className="bdg bdg-agent">{t("teamAccess.waitingCount", { count: pending.length })}</span>}
                          </div>
                          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {decide.error ? <ErrorBanner error={decide.error} /> : null}
                            {approvals.length === 0 && <p className="muted">{t("teamAccess.nothingIsWaitingForApproval")}</p>}
                            {approvals.map((a) => (
                              <div className="apr" key={a.id}>
                                <div className="hd">
                                  <Bot className="ic" aria-hidden="true" />
                                  <span>{a.requestedBy.clientId ?? t("teamAccess.connectedAgent")}</span>
                                  <span style={{ marginLeft: "auto", fontWeight: 400 }}>{timeAgo(a.createdAt)}</span>
                                </div>
                                <div className="bd">
                                  <div>
                                    <span className="b">{t("teamAccess.requestedAction")}</span> {a.description ?? a.tool.replace(/_/g, " ")}
                                  </div>
                                  {a.status !== "pending" && (
                                    <div className="small muted">
                                      {a.status === "rejected" ? t("teamAccess.rejected") : a.status === "failed" ? (a.error ? t("teamAccess.failedWith", { error: a.error }) : t("teamAccess.failed")) : t("teamAccess.approved")}
                                      {a.decidedAt ? ` · ${formatDate(a.decidedAt)}` : ""}
                                    </div>
                                  )}
                                </div>
                                {a.status === "pending" && canDecide && (
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
                                      {t("teamAccess.approve")}
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
                                      {t("teamAccess.reject")}
                                    </button>
                                  </div>
                                )}
                                {a.status === "pending" && !canDecide && <p className="small muted">{t("access.adminOnly")}</p>}
                              </div>
                            ))}
                          </div>
                        </section>
                      </div>
                      <section className="card" aria-labelledby="let-agent-h">
                        <div className="card-h">
                          <h3 id="let-agent-h">{t("teamAccess.letYourAgentApply")}</h3>
                        </div>
                        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          <p>{t("teamAccess.anAgentCanFindFundingStart")}</p>
                          <p className="help">{t("teamAccess.submittingAnApplicationAcceptingAnAward")}</p>
                          <Link to="/agents" className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                            {t("teamAccess.howAgentsConnect")}
                          </Link>
                        </div>
                      </section>
                    </div>
                  </TabPanel>

                  <Dialog open={!!revoking} onClose={() => setRevoking(null)} labelledBy="rv-title">
                    <div className="hd">
                      <h3 id="rv-title" style={{ fontSize: "16px" }}>
                        {revoking?.funder.name ? t("teamAccess.removeAccessQ", { funder: revoking.funder.name }) : t("teamAccess.removeAccessQThisFunder")}
                      </h3>
                      <button className="iconbtn" type="button" aria-label={t("teamAccess.close")} onClick={() => setRevoking(null)}>
                        <X className="ic ic-md" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="bd">
                      <p>{t("teamAccess.theyKeepWhatYouAlreadySubmitted")}</p>
                    </div>
                    <div className="ft">
                      <button className="btn btn-secondary" type="button" onClick={() => setRevoking(null)}>
                        {t("teamAccess.keepAccess")}
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
                        {t("teamAccess.removeAccess")}
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
