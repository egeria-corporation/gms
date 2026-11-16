// SPDX-License-Identifier: AGPL-3.0-only
// The grantee directory: every organization this funder has funded or heard from, with the
// Passport record it consented to share (read-only here), its level and payee status, the funder's
// own notes and tags, and changes to its Passport record waiting to be acknowledged. Profile
// fields are never edited in the GMS; a funder can only propose a change to the organization.
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { CircleCheck, Clock, EyeOff, Lock, Search, Users } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { GranteeDetail, GranteeSummary, OrgChange } from "../../api/funderMoney.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge, VerificationBadge, WorkspaceName } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, SaveNote } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { dateTime, usePeople } from "./shared.tsx";
import { t, useFunderMessages } from "./i18n.ts";

/** Payee status in words and shape, never color alone. Bank name and last four digits only. */
function PayeeChip({ payee }: { payee: GranteeSummary["payee"] }) {
  // Passport's payee facts show only while the organization shares its record with this funder.
  if (!payee)
    return (
      <span className="pay pay-none">
        <EyeOff className="ic" aria-hidden="true" />
        {t("funderGrantees.notShared")}
      </span>
    );
  const { pendingDestinationChange: pending, active } = payee;
  if (!active)
    return (
      <span className="pay pay-held">
        <Lock className="ic" aria-hidden="true" />
        {t("funderGrantees.inactive")}
      </span>
    );
  if (pending)
    return (
      <span className="pay pay-cooling userback-block">
        <Clock className="ic" aria-hidden="true" />
        {t("funderGrantees.changePending")}
      </span>
    );
  return (
    <span className="pay pay-active userback-block">
      <CircleCheck className="ic" aria-hidden="true" />
      {t("funderGrantees.payeeActive")}
    </span>
  );
}

/** Flattens a nested patch into "addresses.primary.street1 → value" rows. */
export function flattenPatch(patch: unknown, prefix = ""): { path: string; value: string }[] {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return [{ path: prefix, value: patch === null ? "(removed)" : Array.isArray(patch) ? patch.join(", ") : String(patch) }];
  return Object.entries(patch as Record<string, unknown>).flatMap(([k, v]) => flattenPatch(v, prefix ? `${prefix}.${k}` : k));
}
const read = (obj: unknown, path: string): string => {
  const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
  return v === undefined || v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
};

function OrgChangeCard({ change, organization, onDone }: { change: OrgChange; organization: Record<string, unknown> | null; onDone: (note: string) => void }) {
  const accept = useApiMutation((api) => api.acceptOrgChange(change.id));
  const dismiss = useApiMutation((api) => api.dismissOrgChange(change.id));
  const rows = flattenPatch(change.patch);
  return (
    <div className="diff" data-change={change.id}>
      <div className="hd">
        <span>{t("funderGrantees.changeAtPassportReceived", { dateTime: dateTime(change.receivedAt) })}</span>
        <span>{change.status === "pending" ? t("funderGrantees.pending") : change.status === "accepted" ? t("funderGrantees.accepted") : t("funderGrantees.dismissed")}</span>
      </div>
      {rows.map((r) => (
        <div className="cols" key={r.path}>
          <div>
            <div className="xs muted">{t("funderGrantees.onFileHere", { path: r.path })}</div>
            <span className="del">{read(organization, r.path)}</span>
          </div>
          <div>
            <div className="xs muted">{t("funderGrantees.nowAtPassport", { path: r.path })}</div>
            <span className="ins">{r.value}</span>
          </div>
        </div>
      ))}
      {(accept.error !== null || dismiss.error !== null) && (
        <div style={{ padding: "8px 12px" }}>
          <ErrorBanner error={accept.error ?? dismiss.error} />
        </div>
      )}
      {change.status === "pending" && (
        <div className="sum">
          <button type="button" className="btn btn-sm btn-primary" disabled={accept.state === "saving"} onClick={async () => (await accept.run()) && onDone(t("funderGrantees.done.accepted"))}>
            {t("funderGrantees.acceptChange")}
          </button>
          <button type="button" className="btn btn-sm btn-secondary" disabled={dismiss.state === "saving"} onClick={async () => (await dismiss.run()) && onDone(t("funderGrantees.done.dismissed"))}>
            {t("funderGrantees.dismiss")}
          </button>
          <span>{t("funderGrantees.acceptingUpdatesWhatThis")}</span>
        </div>
      )}
    </div>
  );
}

function ProposeDialog({ grantee, onClose, onDone }: { grantee: GranteeDetail; onClose: () => void; onDone: (note: string) => void }) {
  const [field, setField] = useState("emails.primary");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const propose = useApiMutation((api) => {
    const patch = field
      .split(".")
      .reverse()
      .reduce<unknown>((acc, key) => ({ [key]: acc }), value.trim()) as Record<string, unknown>;
    return api.proposeOrgChange(grantee.workspaceId, { patch, ...(note.trim() ? { note: note.trim() } : {}) });
  });
  return (
    <Dialog open onClose={onClose} labelledBy="propose-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const out = await propose.run();
          if (out) onDone(out.message);
        }}
      >
        <div className="hd">
          <div>
            <h2 id="propose-title">{t("funderGrantees.proposeAChangeTo", { name: grantee.name })}</h2>
            <p className="small muted">{t("funderGrantees.theProposalGoesTo")}</p>
          </div>
        </div>
        <div className="bd">
          {propose.error !== null && <ErrorBanner error={propose.error} title={t("funderGrantees.theProposalWasNot")} />}
          <Field id="propose-field" label={t("funderGrantees.field")} required>
            <select className="sel" id="propose-field" value={field} onChange={(e) => setField(e.target.value)}>
              <option value="emails.primary">{t("funderGrantees.primaryEmail")}</option>
              <option value="phones.primary.number">{t("funderGrantees.primaryPhone")}</option>
              <option value="addresses.primary.street1">{t("funderGrantees.mailingAddressStreet")}</option>
              <option value="addresses.primary.city">{t("funderGrantees.mailingAddressCity")}</option>
              <option value="socials.website">{t("funderGrantees.website")}</option>
              <option value="mission">{t("funderGrantees.mission")}</option>
            </select>
          </Field>
          <Field id="propose-value" label={t("funderGrantees.proposedValue")} required help={t("funderGrantees.bankAndIdentityDetails")}>
            <input className="inp" id="propose-value" value={value} onChange={(e) => setValue(e.target.value)} required />
          </Field>
          <Field id="propose-note" label={t("funderGrantees.noteToTheOrganization")}>
            <textarea className="ta" id="propose-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("funderGrantees.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim() || propose.state === "saving"}>
            {t("funderGrantees.sendProposal")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Record({ workspaceId, base, onChanged }: { workspaceId: string; base: string; onChanged: () => void }) {
  const detail = useApiQuery((api) => api.getGrantee(workspaceId), [workspaceId]);
  const [notes, setNotes] = useState<string | null>(null);
  const [tagText, setTagText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const save = useApiMutation((api, patch: { notes?: string | null; tags?: string[] }) => api.updateGrantee(workspaceId, patch));
  if (detail.status === "loading") return <Loading label={t("funderGrantees.loadingTheGranteeRecord")} />;
  if (detail.status === "error") return <ErrorBanner error={detail.error} onRetry={detail.reload} />;
  const g = detail.data;
  const org = g.organization;
  const payee = (g.payeeStatus ?? {}) as { bankName?: string | null; last4?: string | null };
  const pending = g.orgChanges.filter((c) => c.status === "pending");
  const done = (text: string) => {
    setMessage(text);
    detail.reload();
    onChanged();
  };
  const update = async (patch: { notes?: string | null; tags?: string[] }) => {
    const out = await save.run(patch);
    if (out) detail.set(out);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <section className="card" aria-labelledby="grantee-h">
        <div className="card-h">
          <div className="col" style={{ gap: "4px" }}>
            <div className="row wrap">
              <h2 id="grantee-h" style={{ fontSize: "18px" }}>
                {g.name}
              </h2>
              <VerificationBadge verification={g.verification} level={g.verificationLevel} />
              <WorkspaceName name={g.workspaceName} />
              <PayeeChip payee={g.payee} />
            </div>
            <p className="small muted userback-block">
              {payee.bankName ? `${payee.bankName} •••• ${payee.last4 ?? "····"}` : t("funderGrantees.payeeDetailsNotAvailable")}
              {" · "}
              {g.lastSyncedAt ? t("funderGrantees.recordSyncedAt", { date: dateTime(g.lastSyncedAt) }) : t("funderGrantees.recordNeverSynced")}
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setProposing(true)}>
            {t("funderGrantees.proposeAChange")}
          </button>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {message && <Notice tone="ok" title={message} />}
          {!g.consent && <Notice tone="warn" title={t("funderGrantees.noConsentToRead")}>{t("funderGrantees.youSeeOnlyWhat")}</Notice>}
          {org && (
            <dl className="kv">
              <dt>{t("funderGrantees.legalName")}</dt>
              <dd>
                {read(org, "name")} <span className="prov prov-passport">{t("funderGrantees.fromPassport")}</span>
              </dd>
              <dt>EIN</dt>
              <dd>{read(org, "identifiers.org:us:ein.id")}</dd>
              <dt>{t("funderGrantees.address")}</dt>
              <dd>
                {read(org, "addresses.primary.street1")}, {read(org, "addresses.primary.city")}, {read(org, "addresses.primary.stateOrProvince")}
              </dd>
              <dt>{t("funderGrantees.email")}</dt>
              <dd>{read(org, "emails.primary")}</dd>
              <dt>{t("funderGrantees.mission")}</dt>
              <dd>{read(org, "mission")}</dd>
            </dl>
          )}
          <p className="help">{t("funderGrantees.thisRecordIsRead")}</p>
        </div>
      </section>

      {g.orgChanges.length > 0 && (
        <section className="card" aria-labelledby="changes-h">
          <div className="card-h">
            <h3 id="changes-h">{t("funderGrantees.changesToThePassport")}</h3>
            <span className="small muted">{t("funderGrantees.pending2", { count: pending.length })}</span>
          </div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {g.orgChanges.map((c) => (
              <OrgChangeCard key={c.id} change={c} organization={org} onDone={done} />
            ))}
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="notes-h">
        <div className="card-h">
          <h3 id="notes-h">{t("funderGrantees.relationshipNotes")}</h3>
          <SaveNote state={save.state} />
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {save.error !== null && <ErrorBanner error={save.error} />}
          <Field id="grantee-notes" label={t("funderGrantees.notes")} help={t("funderGrantees.visibleToYourTeam")}>
            <textarea className="ta" id="grantee-notes" value={notes ?? g.notes ?? ""} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== (g.notes ?? "") && update({ notes: notes.trim() ? notes : null })} />
          </Field>
          <div className="row wrap" role="group" aria-label={t("funderGrantees.tags")}>
            {g.tags.map((tag) => (
              <span key={tag} className="tag">
                {tag}
                <button type="button" className="iconbtn" style={{ width: "18px", height: "18px", marginLeft: "4px" }} aria-label={t("funderGrantees.removeTag", { tag })} onClick={() => update({ tags: g.tags.filter((x) => x !== tag) })}>
                  ×
                </button>
              </span>
            ))}
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const item = tagText.trim();
                if (!item) return;
                setTagText("");
                void update({ tags: [...g.tags, item] });
              }}
            >
              <input className="inp" aria-label={t("funderGrantees.addATag")} placeholder={t("funderGrantees.addATag")} value={tagText} onChange={(e) => setTagText(e.target.value)} style={{ height: "28px", width: "140px", fontSize: "12px" }} />
              <button type="submit" className="btn btn-sm btn-secondary" disabled={!tagText.trim()}>
                {t("funderGrantees.add")}
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="history-h">
        <div className="card-h">
          <h3 id="history-h">{t("funderGrantees.awardsAndApplications")}</h3>
        </div>
        <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("funderGrantees.awardsAndApplicationsScrollable")}>
          <table className="tbl" aria-label={t("funderGrantees.awardsAndApplications")}>
            <thead>
              <tr>
                <th>{t("funderGrantees.record")}</th>
                <th>{t("funderGrantees.kind")}</th>
                <th>{t("funderGrantees.status")}</th>
                <th className="num">{t("funderGrantees.awarded")}</th>
                <th className="num">{t("funderGrantees.disbursed")}</th>
              </tr>
            </thead>
            <tbody>
              {g.awardList.map((a) => (
                <tr key={String(a.id)}>
                  <td>
                    <Link to={`${base}/awards/${String(a.id)}/payments`} className="b">
                      {String(a.title)}
                    </Link>
                  </td>
                  <td>{t("funderGrantees.award")}</td>
                  <td>
                    <StatusBadge kind="award" status={String(a.status)} />
                  </td>
                  <td className="num">{formatMinor(typeof a.awardedAmountMinor === "number" ? a.awardedAmountMinor : null)}</td>
                  <td className="num">{formatMinor(typeof a.disbursedAmountMinor === "number" ? a.disbursedAmountMinor : null)}</td>
                </tr>
              ))}
              {g.applicationList.map((a) => (
                <tr key={String(a.id)}>
                  <td>
                    <Link to={`${base}/applications/${String(a.id)}`} className="b">
                      {String(a.title)}
                    </Link>
                  </td>
                  <td>{t("funderGrantees.application")}</td>
                  <td>
                    <StatusBadge kind="application" status={String(a.status)} />
                  </td>
                  <td className="num" />
                  <td className="num" />
                </tr>
              ))}
              {!g.awardList.length && !g.applicationList.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t("funderGrantees.noHistoryYet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <GranteeReports awardIds={g.awardList.map((a) => String(a.id))} base={base} />
      {proposing && (
        <ProposeDialog
          grantee={g}
          onClose={() => setProposing(false)}
          onDone={(text) => {
            setProposing(false);
            done(text);
          }}
        />
      )}
    </div>
  );
}

/** Reports this grantee has sent on its awards, newest first. */
function GranteeReports({ awardIds, base }: { awardIds: string[]; base: string }) {
  const submissions = useApiQuery((api) => api.listSubmissions(), []);
  const mine = (submissions.data ?? []).filter((s) => s.awardId && awardIds.includes(s.awardId)).sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  return (
    <section className="card" aria-labelledby="grantee-reports-h">
      <div className="card-h">
        <h3 id="grantee-reports-h">{t("funderGrantees.reports")}</h3>
        <Link to={`${base}/reporting`} className="small b">
          {t("funderGrantees.reporting")}
        </Link>
      </div>
      {submissions.status === "error" && (
        <div className="card-b">
          <ErrorBanner error={submissions.error} onRetry={submissions.reload} />
        </div>
      )}
      {submissions.status === "ready" && !mine.length && <div className="card-b muted small">{t("funderGrantees.noReportsYet")}</div>}
      {mine.length > 0 && (
        <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("funderGrantees.reportsFromThisGrantee")}>
          <table className="tbl" aria-label={t("funderGrantees.reportsFromThisGrantee2")}>
            <thead>
              <tr>
                <th>{t("funderGrantees.report")}</th>
                <th>{t("funderGrantees.due")}</th>
                <th>{t("funderGrantees.received")}</th>
                <th>{t("funderGrantees.status")}</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td className="b">
                    {r.requirement?.title ?? t("funderGrantees.report")}
                    {r.shared && <span className="tag" style={{ marginLeft: "6px" }}>{t("funderGrantees.sharedByGrantee")}</span>}
                  </td>
                  <td>{formatDate(r.requirement?.dueAt)}</td>
                  <td>{formatDate(r.submittedAt)}</td>
                  <td>
                    <StatusBadge kind="submission" status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Grantees() {
  useFunderMessages();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const { granteeId } = useParams();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const list = useApiQuery((api) => api.listGrantees(q ? { q } : {}), [q]);
  const rows: GranteeSummary[] = list.data ?? [];
  const selected = rows.find((r) => r.workspaceId === granteeId || `org_${r.handle}` === granteeId || r.handle === granteeId)?.workspaceId ?? (granteeId && !granteeId.startsWith("org_") ? granteeId : rows[0]?.workspaceId);
  const pendingTotal = rows.reduce((n, r) => n + r.pendingChanges, 0);
  const { person } = usePeople();
  const awards = useApiQuery((api) => api.listAwards(), []);
  const awardedTo = (workspaceId: string) => (awards.data ?? []).filter((a) => a.recipient?.workspaceId === workspaceId && a.status !== "cancelled").reduce((n, a) => n + (a.awardedAmountMinor ?? 0), 0);

  return (
    <>
      <title>{t("funderGrantees.grantees", { name: ws.name })}</title>
      <FunderShell active="Grantees">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: t("funderGrantees.grantees2") }]}
            title={t("funderGrantees.grantees2")}
            meta={
              <>
                <span>{t("funderGrantees.organizations", { count: rows.length })}</span>
                <span>·</span>
                <span>{t("funderGrantees.pendingRecordChanges", { pendingTotal })}</span>
              </>
            }
          />
          <div className="filterbar">
            <div className="inp-icon" style={{ flex: "1 1 260px", maxWidth: "360px" }}>
              <Search className="ic" aria-hidden="true" />
              <input className="inp" type="search" aria-label={t("funderGrantees.searchGrantees")} placeholder={t("funderGrantees.searchGrantees")} defaultValue={q} onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} />
            </div>
          </div>
          {list.status === "loading" && <Loading label={t("funderGrantees.loadingGrantees")} />}
          {list.status === "error" && <ErrorBanner error={list.error} onRetry={list.reload} />}
          {list.status === "ready" && !rows.length && (
            <div className="card">
              <EmptyState icon={Users} title={q ? t("funderGrantees.noGranteesMatch") : t("funderGrantees.noGranteesYet")}>
                {t("funderGrantees.organizationsAppearHereOnce")}
              </EmptyState>
            </div>
          )}
          {rows.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr)", gap: "20px", alignItems: "start" }}>
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("funderGrantees.granteeDirectoryScrollable")}>
                <table className="tbl" aria-label={t("funderGrantees.granteeDirectory")}>
                  <thead>
                    <tr>
                      <th>{t("funderGrantees.organization")}</th>
                      <th>{t("funderGrantees.level")}</th>
                      <th>{t("funderGrantees.payee")}</th>
                      <th className="num">{t("funderGrantees.awards")}</th>
                      <th className="num">{t("funderGrantees.totalAwarded")}</th>
                      <th>{t("funderGrantees.owner")}</th>
                      <th>{t("funderGrantees.tags")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.workspaceId} className={r.workspaceId === selected ? "sel" : undefined}>
                        <td>
                          <div className="ent">
                            <Link to={`${base}/grantees/${r.workspaceId}${q ? `?q=${encodeURIComponent(q)}` : ""}`} className="nm" aria-current={r.workspaceId === selected ? "true" : undefined}>
                              {r.name}
                            </Link>
                            {r.pendingChanges > 0 && (
                              <span className="sub">
                                <span className="pill-warn">{t("funderGrantees.recordChange", { pendingChanges: r.pendingChanges })}</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <VerificationBadge verification={r.verification} level={r.verificationLevel} />
                          <WorkspaceName name={r.workspaceName} />
                        </td>
                        <td>
                          <PayeeChip payee={r.payee} />
                        </td>
                        <td className="num">{r.awards}</td>
                        <td className="num">{awards.status === "ready" ? formatMinor(awardedTo(r.workspaceId)) : "—"}</td>
                        <td>{r.ownerUserId ? (person(r.ownerUserId)?.name ?? t("funderGrantees.aTeammate")) : <span className="muted">—</span>}</td>
                        <td>
                          <span className="row wrap" style={{ gap: "4px" }}>
                            {r.tags.map((item) => (
                              <span key={item} className="tag">
                                {item}
                              </span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selected && <Record key={selected} workspaceId={selected} base={base} onChanged={list.reload} />}
            </div>
          )}
        </main>
      </FunderShell>
    </>
  );
}
