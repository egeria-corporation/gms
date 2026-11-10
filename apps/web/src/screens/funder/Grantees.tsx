// SPDX-License-Identifier: AGPL-3.0-only
// The grantee directory: every organization this funder has funded or heard from, with the
// Passport record it consented to share (read-only here), its level and payee status, the funder's
// own notes and tags, and changes to its Passport record waiting to be acknowledged. Profile
// fields are never edited in the GMS; a funder can only propose a change to the organization.
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { CircleCheck, Clock, Lock, Search, Users } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { GranteeDetail, GranteeSummary, OrgChange } from "../../api/funderMoney.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { LevelBadge, StatusBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, SaveNote } from "../../components/ui.tsx";
import { formatMinor } from "../../lib/format.ts";
import { dateTime } from "./shared.tsx";

/** Payee status in words and shape, never color alone. Bank name and last four digits only. */
function PayeeChip({ pending, active }: { pending: boolean; active: boolean }) {
  if (!active)
    return (
      <span className="pay pay-held">
        <Lock className="ic" aria-hidden="true" />
        Inactive
      </span>
    );
  if (pending)
    return (
      <span className="pay pay-cooling">
        <Clock className="ic" aria-hidden="true" />
        Change pending
      </span>
    );
  return (
    <span className="pay pay-active">
      <CircleCheck className="ic" aria-hidden="true" />
      Payee active
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
        <span>Change at Passport · received {dateTime(change.receivedAt)}</span>
        <span>{change.status === "pending" ? "Pending" : change.status === "accepted" ? "Accepted" : "Dismissed"}</span>
      </div>
      {rows.map((r) => (
        <div className="cols" key={r.path}>
          <div>
            <div className="xs muted">{r.path} · on file here</div>
            <span className="del">{read(organization, r.path)}</span>
          </div>
          <div>
            <div className="xs muted">{r.path} · now at Passport</div>
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
          <button type="button" className="btn btn-sm btn-primary" disabled={accept.state === "saving"} onClick={async () => (await accept.run()) && onDone("Change accepted. Your copy of the record now matches Passport, and eligibility was re-checked.")}>
            Accept change
          </button>
          <button type="button" className="btn btn-sm btn-secondary" disabled={dismiss.state === "saving"} onClick={async () => (await dismiss.run()) && onDone("Change dismissed.")}>
            Dismiss
          </button>
          <span>Accepting updates what this workspace shows; the record itself lives in Passport.</span>
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
            <h2 id="propose-title">Propose a change to {grantee.name}</h2>
            <p className="small muted">The proposal goes to the organization in Passport. Nothing changes unless they accept it.</p>
          </div>
        </div>
        <div className="bd">
          {propose.error !== null && <ErrorBanner error={propose.error} title="The proposal was not sent" />}
          <Field id="propose-field" label="Field" required>
            <select className="sel" id="propose-field" value={field} onChange={(e) => setField(e.target.value)}>
              <option value="emails.primary">Primary email</option>
              <option value="phones.primary.number">Primary phone</option>
              <option value="addresses.primary.street1">Mailing address, street</option>
              <option value="addresses.primary.city">Mailing address, city</option>
              <option value="socials.website">Website</option>
              <option value="mission">Mission</option>
            </select>
          </Field>
          <Field id="propose-value" label="Proposed value" required help="Bank and identity details can never be proposed here; they change only in Passport, by the organization.">
            <input className="inp" id="propose-value" value={value} onChange={(e) => setValue(e.target.value)} required />
          </Field>
          <Field id="propose-note" label="Note to the organization">
            <textarea className="ta" id="propose-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim() || propose.state === "saving"}>
            Send proposal
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
  if (detail.status === "loading") return <Loading label="Loading the grantee record" />;
  if (detail.status === "error") return <ErrorBanner error={detail.error} onRetry={detail.reload} />;
  const g = detail.data;
  const org = g.organization;
  const payee = g.payeeStatus as { bankName?: string | null; last4?: string | null };
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
              <LevelBadge level={g.verificationLevel} />
              <PayeeChip pending={g.payee.pendingDestinationChange} active={g.payee.active} />
            </div>
            <p className="small muted">
              {payee.bankName ? `${payee.bankName} •••• ${payee.last4 ?? "····"}` : "Payee details not available"} · record synced {g.lastSyncedAt ? dateTime(g.lastSyncedAt) : "never"}
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setProposing(true)}>
            Propose a change
          </button>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {message && <Notice tone="ok" title={message} />}
          {!g.consent && <Notice tone="warn" title="No consent to read this organization’s Passport record">You see only what the organization submitted with its applications. Ask them to grant access under Team &amp; access in their workspace.</Notice>}
          {org && (
            <dl className="kv">
              <dt>Legal name</dt>
              <dd>
                {read(org, "name")} <span className="prov prov-passport">From Passport</span>
              </dd>
              <dt>EIN</dt>
              <dd>{read(org, "identifiers.org:us:ein.id")}</dd>
              <dt>Address</dt>
              <dd>
                {read(org, "addresses.primary.street1")}, {read(org, "addresses.primary.city")}, {read(org, "addresses.primary.stateOrProvince")}
              </dd>
              <dt>Email</dt>
              <dd>{read(org, "emails.primary")}</dd>
              <dt>Mission</dt>
              <dd>{read(org, "mission")}</dd>
            </dl>
          )}
          <p className="help">This record is read from Passport and cannot be edited here. To correct something, propose a change; the organization decides.</p>
        </div>
      </section>

      {g.orgChanges.length > 0 && (
        <section className="card" aria-labelledby="changes-h">
          <div className="card-h">
            <h3 id="changes-h">Changes to the Passport record</h3>
            <span className="small muted">{pending.length} pending</span>
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
          <h3 id="notes-h">Relationship notes</h3>
          <SaveNote state={save.state} />
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {save.error !== null && <ErrorBanner error={save.error} />}
          <Field id="grantee-notes" label="Notes" help="Visible to your team only. Never shared with the organization.">
            <textarea className="ta" id="grantee-notes" value={notes ?? g.notes ?? ""} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== (g.notes ?? "") && update({ notes: notes.trim() ? notes : null })} />
          </Field>
          <div className="row wrap" aria-label="Tags">
            {g.tags.map((t) => (
              <span key={t} className="tag">
                {t}
                <button type="button" className="iconbtn" style={{ width: "18px", height: "18px", marginLeft: "4px" }} aria-label={`Remove tag ${t}`} onClick={() => update({ tags: g.tags.filter((x) => x !== t) })}>
                  ×
                </button>
              </span>
            ))}
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const t = tagText.trim();
                if (!t) return;
                setTagText("");
                void update({ tags: [...g.tags, t] });
              }}
            >
              <input className="inp" aria-label="Add a tag" placeholder="Add a tag" value={tagText} onChange={(e) => setTagText(e.target.value)} style={{ height: "28px", width: "140px", fontSize: "12px" }} />
              <button type="submit" className="btn btn-sm btn-secondary" disabled={!tagText.trim()}>
                Add
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="history-h">
        <div className="card-h">
          <h3 id="history-h">Awards and applications</h3>
        </div>
        <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="Awards and applications, scrollable">
          <table className="tbl" aria-label="Awards and applications">
            <thead>
              <tr>
                <th>Record</th>
                <th>Kind</th>
                <th>Status</th>
                <th className="num">Awarded</th>
                <th className="num">Disbursed</th>
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
                  <td>Award</td>
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
                  <td>Application</td>
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
                    No history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
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

export default function Grantees() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const { granteeId } = useParams();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const list = useApiQuery((api) => api.listGrantees(q ? { q } : {}), [q]);
  const rows: GranteeSummary[] = list.data ?? [];
  const selected = rows.find((r) => r.workspaceId === granteeId || `org_${r.handle}` === granteeId || r.handle === granteeId)?.workspaceId ?? (granteeId && !granteeId.startsWith("org_") ? granteeId : rows[0]?.workspaceId);
  const pendingTotal = rows.reduce((n, r) => n + r.pendingChanges, 0);

  return (
    <>
      <title>{`Grantees — ${ws.name}`}</title>
      <FunderShell active="Grantees">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: "Grantees" }]}
            title="Grantees"
            meta={
              <>
                <span>{rows.length} organizations</span>
                <span>·</span>
                <span>{pendingTotal} pending record changes</span>
              </>
            }
          />
          <div className="filterbar">
            <div className="inp-icon" style={{ flex: "1 1 260px", maxWidth: "360px" }}>
              <Search className="ic" aria-hidden="true" />
              <input className="inp" type="search" aria-label="Search grantees" placeholder="Search grantees" defaultValue={q} onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} />
            </div>
          </div>
          {list.status === "loading" && <Loading label="Loading grantees" />}
          {list.status === "error" && <ErrorBanner error={list.error} onRetry={list.reload} />}
          {list.status === "ready" && !rows.length && (
            <div className="card">
              <EmptyState icon={Users} title={q ? "No grantees match" : "No grantees yet"}>
                Organizations appear here once they apply to one of your opportunities.
              </EmptyState>
            </div>
          )}
          {rows.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr)", gap: "20px", alignItems: "start" }}>
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Grantee directory, scrollable">
                <table className="tbl" aria-label="Grantee directory">
                  <thead>
                    <tr>
                      <th>Organization</th>
                      <th>Payee</th>
                      <th className="num">Awards</th>
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
                            <span className="sub">
                              <LevelBadge level={r.verificationLevel} />
                              {r.pendingChanges > 0 && <span className="pill-warn">{r.pendingChanges} record change</span>}
                            </span>
                          </div>
                        </td>
                        <td>
                          <PayeeChip pending={r.payee.pendingDestinationChange} active={r.payee.active} />
                        </td>
                        <td className="num">{r.awards}</td>
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
