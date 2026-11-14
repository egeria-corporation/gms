// SPDX-License-Identifier: AGPL-3.0-only
// The Submission, Notes and Activity tabs of an outside application, and the dialog that edits
// its details (title, funder, program, ask, owner, links).
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bot, Clock, ExternalLink, Hash, Plus, Send, User, X } from "lucide-react";
import type { ApplicantMember } from "../../../api/applicant.ts";
import type { FunderRecord, OutsideApplication, OutsideDetail, OutsideEvent, OutsidePatch, YearAmount } from "../../../api/outside.ts";
import { useOutsideMutation } from "../../../api/outsideHooks.ts";
import { actorOf } from "../../../components/ActivityTimeline.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { timeAgo } from "../../../components/applicant.tsx";
import { ErrorBanner, Field, Notice, SaveNote } from "../../../components/ui.tsx";
import { formatDate, formatMinor } from "../../../lib/format.ts";
import { canMarkSubmitted, STAGE_LABELS, webAddress, type OutsideStage } from "../../../lib/outside.ts";
import { DocumentRow } from "./ChecklistTab.tsx";
import { dollarsOf, METHOD_LABELS, moneyFrom, moneyText } from "./shared.tsx";

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer noopener" style={{ overflowWrap: "anywhere" }}>
    {children} <ExternalLink className="ic ic-sm" aria-hidden="true" />
    <span className="sr"> (opens in a new tab)</span>
  </a>
);

// ------------------------------------------------------------------------------------ submission

export function SubmissionTab({ detail, record, base, readOnly, onMarkSubmitted }: { detail: OutsideDetail; record: FunderRecord | null; base: string; readOnly: boolean; onMarkSubmitted: () => void }) {
  const receipt = detail.documents.find((d) => d.id === detail.receiptDocumentId);
  const snapshot = detail.documents.find((d) => d.id === detail.snapshotDocumentId);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
      <section className="card" aria-labelledby="osb-where">
        <div className="card-h">
          <div>
            <h2 id="osb-where" style={{ fontSize: "18px" }}>
              Where to submit
            </h2>
            <p className="small muted">You submit on the funder’s own site; this page keeps the record.</p>
          </div>
        </div>
        <div className="card-b">
          <dl className="kv" style={{ fontSize: "15px" }}>
            <dt>Funder’s portal</dt>
            <dd>{detail.portalUrl ? <Ext href={detail.portalUrl}>{detail.portalUrl}</Ext> : <span className="muted">No portal link yet. Add one under Edit details.</span>}</dd>
            <dt>Portal login</dt>
            <dd>
              {record?.portalLoginHolder ? (
                <>
                  Held by {record.portalLoginHolder}
                  <span className="small muted"> · </span>
                </>
              ) : (
                <span className="muted">Not recorded · </span>
              )}
              {record ? (
                <Link to={`${base}/funders/${record.id}`} className="small b">
                  {record.portalLoginHolder ? "Change" : "Record who holds it"}
                </Link>
              ) : (
                <span className="small muted">Keep it on a funder record (Notes tab).</span>
              )}
            </dd>
            <dt>The listing</dt>
            <dd>{detail.listingUrl ? <Ext href={detail.listingUrl}>{detail.listingUrl}</Ext> : <span className="muted">—</span>}</dd>
          </dl>
        </div>
      </section>
      <section className="card" aria-labelledby="osb-state">
        <div className="card-h">
          <h2 id="osb-state" style={{ fontSize: "18px" }}>
            Submission
          </h2>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {detail.submittedAt ? (
            <>
              <dl className="kv" style={{ fontSize: "15px" }}>
                <dt>Submitted</dt>
                <dd>{formatDate(detail.submittedAt)}</dd>
                <dt>How</dt>
                <dd>{detail.submissionMethod ? METHOD_LABELS[detail.submissionMethod] : "—"}</dd>
                <dt>Confirmation number</dt>
                <dd className={detail.confirmationRef ? "mono" : "muted"}>{detail.confirmationRef ?? "None recorded"}</dd>
              </dl>
              {receipt && <DocumentRow doc={receipt} applicationId={detail.id} note="receipt" />}
              {snapshot ? (
                <>
                  <DocumentRow doc={snapshot} applicationId={detail.id} note="as submitted" />
                  {detail.snapshotSha256 && (
                    <p className="small muted row" style={{ gap: "6px", alignItems: "flex-start" }}>
                      <Hash className="ic ic-sm" aria-hidden="true" />
                      <span>
                        Fingerprint (SHA-256) of the “as submitted” copy: <span className="mono" style={{ overflowWrap: "anywhere" }}>{detail.snapshotSha256}</span>
                      </span>
                    </p>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <>
              <p>Not submitted yet.</p>
              {!readOnly && canMarkSubmitted(detail.stage) ? (
                <button type="button" className="btn btn-primary" style={{ alignSelf: "flex-start" }} aria-haspopup="dialog" onClick={onMarkSubmitted}>
                  <Send className="ic" aria-hidden="true" />
                  Mark as submitted
                </button>
              ) : (
                <p className="small muted">{detail.stage === "drafting" ? "" : `Move the application to Drafting before you mark it submitted. It is at ${STAGE_LABELS[detail.stage]}.`}</p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------ notes

function FunderNotes({ detail, record, base, onChanged }: { detail: OutsideDetail; record: FunderRecord | null; base: string; onChanged: () => void }) {
  const [notes, setNotes] = useState(record?.notes ?? "");
  const save = useOutsideMutation((api) => api.updateFunderRecord(record!.id, { notes: notes.trim() || null }));
  const create = useOutsideMutation(async (api) => {
    const r = await api.createFunderRecord({ name: detail.funderName });
    await api.update(detail.id, { funderRecordId: r.id });
    return r;
  });
  return (
    <section className="card" aria-labelledby="ont-funder">
      <div className="card-h">
        <div>
          <h2 id="ont-funder" style={{ fontSize: "18px" }}>
            About {detail.funderName || "this funder"}
          </h2>
          <p className="small muted">Kept on the funder record, so every application to this funder shares them.</p>
        </div>
        {record && <SaveNote state={save.state === "saved" && notes === (record.notes ?? "") ? "saved" : "idle"} />}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {record ? (
          <>
            <label className="sr" htmlFor="ont-notes">
              Notes about {record.name}
            </label>
            <textarea id="ont-notes" className="ta" style={{ minHeight: "120px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" disabled={notes === (record.notes ?? "") || save.state === "saving"} onClick={async () => (await save.run()) && onChanged()}>
                Save notes
              </button>
              <Link to={`${base}/funders/${record.id}`} className="small b">
                Open the funder record (contacts, past asks)
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="muted">There is no funder record for {detail.funderName || "this funder"} yet. A record keeps contacts, notes, who holds the portal login, and every ask you have made.</p>
            <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={!detail.funderName || create.state === "saving"} onClick={async () => (await create.run()) && onChanged()}>
              <Plus className="ic" aria-hidden="true" />
              Create a funder record
            </button>
          </>
        )}
        {save.error ? <ErrorBanner error={save.error} title="The notes were not saved" /> : null}
        {create.error ? <ErrorBanner error={create.error} title="The funder record was not created" /> : null}
      </div>
    </section>
  );
}

function CustomFields({ detail, readOnly, onChanged }: { detail: OutsideDetail; readOnly: boolean; onChanged: () => void }) {
  const initial = Object.entries(detail.customFields).map(([k, v]) => ({ k, v: v === null ? "" : String(v) }));
  const [rows, setRows] = useState(initial);
  const save = useOutsideMutation((api) => api.update(detail.id, { customFields: Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])) }));
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const dupes = new Set(rows.map((r) => r.k.trim().toLowerCase()).filter((k, i, all) => k && all.indexOf(k) !== i));
  return (
    <section className="card" aria-labelledby="ont-fields">
      <div className="card-h">
        <div>
          <h2 id="ont-fields" style={{ fontSize: "18px" }}>
            Your own fields
          </h2>
          <p className="small muted">Anything else to keep with this application: a program officer, an internal code. Up to 30.</p>
        </div>
        <SaveNote state={save.state === "saved" && !dirty ? "saved" : "idle"} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {rows.length === 0 && <p className="muted">No fields yet.</p>}
        {rows.map((r, i) => (
          <div key={i} className="row" style={{ gap: "8px" }}>
            <label className="sr" htmlFor={`ocf-k-${i}`}>
              Field name {i + 1}
            </label>
            <input id={`ocf-k-${i}`} className={dupes.has(r.k.trim().toLowerCase()) ? "inp err" : "inp"} placeholder="Name" readOnly={readOnly} value={r.k} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
            <label className="sr" htmlFor={`ocf-v-${i}`}>
              Value of {r.k || `field ${i + 1}`}
            </label>
            <input id={`ocf-v-${i}`} className="inp" placeholder="Value" readOnly={readOnly} value={r.v} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
            {!readOnly && (
              <button type="button" className="iconbtn" aria-label={`Remove ${r.k || `field ${i + 1}`}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <X className="ic" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {dupes.size > 0 && <span className="err-msg" role="alert">Each field needs its own name.</span>}
        {!readOnly && (
          <div className="row" style={{ gap: "8px" }}>
            <button type="button" className="btn btn-sm btn-secondary" disabled={rows.length >= 30} onClick={() => setRows([...rows, { k: "", v: "" }])}>
              <Plus className="ic" aria-hidden="true" />
              Add a field
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || dupes.size > 0 || save.state === "saving"} onClick={async () => (await save.run()) && onChanged()}>
              Save fields
            </button>
          </div>
        )}
        {save.error ? <ErrorBanner error={save.error} title="The fields were not saved" /> : null}
      </div>
    </section>
  );
}

export function NotesTab({ detail, record, base, readOnly, onChanged }: { detail: OutsideDetail; record: FunderRecord | null; base: string; readOnly: boolean; onChanged: () => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <FunderNotes key={record?.id ?? "none"} detail={detail} record={record} base={base} onChanged={onChanged} />
        {(detail.decisionNotes || detail.nextCycleOn) && (
          <Notice tone="neu" title="Decision notes">
            {detail.decisionNotes}
            {detail.nextCycleOn ? ` Next cycle: ${formatDate(detail.nextCycleOn)}.` : ""}
          </Notice>
        )}
      </div>
      <CustomFields detail={detail} readOnly={readOnly} onChanged={onChanged} />
    </div>
  );
}

// ------------------------------------------------------------------------------------ activity

const stageWord = (s: unknown) => (typeof s === "string" ? (STAGE_LABELS[s as OutsideStage] ?? s.replace(/_/g, " ")) : "");
function describe(e: OutsideEvent): string {
  const d = e.data ?? {};
  switch (e.type.replace(/^outside_application\./, "")) {
    case "created":
      return d.source === "opengrants" ? "added it from an OpenGrants listing" : d.source === "import" ? "imported it" : "added it to your applications";
    case "stage_changed":
      return `moved it from ${stageWord(d.from)} to ${stageWord(d.to)}`;
    case "submitted":
      return "marked it as submitted";
    case "decided":
      return `recorded the decision: ${stageWord(d.outcome)}`;
    case "reopened":
      return `reopened it${d.to ? ` at ${stageWord(d.to)}` : ""}`;
    case "archived":
      return "archived it";
    case "unarchived":
      return "brought it back from the archive";
    case "consulting_requested":
      return "asked OpenGrants consulting for help";
    default:
      return e.type.replace(/^outside_application\./, "").replace(/_/g, " ");
  }
}

/** Events from the server when it sends them, else what the record's own dates say. */
export function activityOf(d: OutsideDetail): OutsideEvent[] {
  if (d.activity?.length) return [...d.activity].sort((a, b) => b.at.localeCompare(a.at));
  const out: OutsideEvent[] = [];
  if (d.createdAt) out.push({ id: "created", type: "outside_application.created", at: d.createdAt, data: { source: d.source } });
  if (d.submittedAt) out.push({ id: "submitted", type: "outside_application.submitted", at: d.submittedAt });
  if (d.decidedAt) out.push({ id: "decided", type: "outside_application.decided", at: d.decidedAt, data: { outcome: d.stage } });
  if (d.archivedAt) out.push({ id: "archived", type: "outside_application.archived", at: d.archivedAt });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function ActivityTab({ detail, members }: { detail: OutsideDetail; members: ApplicantMember[] }) {
  const events = activityOf(detail);
  const personName = (id: string) => members.find((m) => m.userId === id)?.name ?? undefined;
  return (
    <section className="card" aria-labelledby="oac-h">
      <div className="card-h">
        <div>
          <h2 id="oac-h" style={{ fontSize: "18px" }}>
            Activity
          </h2>
          <p className="small muted">Who moved this application and when. Answer text is never logged here.</p>
        </div>
      </div>
      <div className="card-b">
        {events.length === 0 ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <ol className="tl" aria-label="Activity">
            {events.map((e) => {
              const who = e.actor ? actorOf(e.actor, personName) : { kind: "person" as const, name: "Your team" };
              const Icon = who.kind === "agent" ? Bot : who.kind === "system" ? Clock : User;
              return (
                <li key={e.id} className={`tl-i ${who.kind === "agent" ? "tl-agent" : who.kind === "person" ? "tl-person" : ""}`}>
                  <span className="dot">
                    <Icon className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">
                      {who.name} {describe(e)}
                    </div>
                    <div className="who">
                      {formatDate(e.at)} · {timeAgo(e.at)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------ details

export function EditDetailsDialog({ app, members, records, onClose, onDone }: { app: OutsideApplication; members: ApplicantMember[]; records: FunderRecord[]; onClose: () => void; onDone: (a: OutsideApplication) => void }) {
  const [title, setTitle] = useState(app.title);
  const [program, setProgram] = useState(app.programName ?? "");
  const [recordId, setRecordId] = useState(app.funderRecordId ?? "");
  const [funder, setFunder] = useState(app.funderName);
  const [ask, setAsk] = useState(dollarsOf(app.askAmount));
  const [years, setYears] = useState(app.askByYear.map((y) => ({ year: String(y.year), amount: String(y.amountMinor / 100) })));
  const [owner, setOwner] = useState(app.owner?.userId ?? "");
  const [listing, setListing] = useState(app.listingUrl ?? "");
  const [portal, setPortal] = useState(app.portalUrl ?? "");
  const save = useOutsideMutation((api, patch: OutsidePatch) => api.update(app.id, patch));
  const askMoney = ask.trim() ? moneyFrom(ask, app.currency) : null;
  const askBad = !!ask.trim() && !askMoney;
  const linkBad = (v: string) => !!v.trim() && !webAddress(v);
  const byYear: YearAmount[] = years.flatMap((y) => {
    const m = moneyFrom(y.amount);
    const year = Number.parseInt(y.year, 10);
    return m && year > 1900 ? [{ year, amountMinor: Math.round(Number(m.amount) * 100) }] : [];
  });
  const ok = title.trim() && (recordId || funder.trim()) && !askBad && !linkBad(listing) && !linkBad(portal);
  return (
    <Dialog open onClose={onClose} labelledBy="oed-title" size="lg">
      <div className="hd">
        <h3 id="oed-title" style={{ fontSize: "16px" }}>
          Edit details
        </h3>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <Field id="oed-t" label="Title" required>
          <input id="oed-t" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
          <Field id="oed-rec" label="Funder record">
            <select id="oed-rec" className="sel" value={recordId} onChange={(e) => setRecordId(e.target.value)}>
              <option value="">No record (type the name)</option>
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="oed-f" label="Funder name" required>
            <input id="oed-f" className="inp" disabled={!!recordId} value={recordId ? (records.find((r) => r.id === recordId)?.name ?? funder) : funder} onChange={(e) => setFunder(e.target.value)} />
          </Field>
          <Field id="oed-p" label="Program">
            <input id="oed-p" className="inp" value={program} onChange={(e) => setProgram(e.target.value)} />
          </Field>
          <Field id="oed-o" label="Owner" help="Gets the deadline reminders.">
            <select id="oed-o" className="sel" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">No owner</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </Field>
          <Field id="oed-a" label="Ask (USD)" error={askBad ? "Enter the amount in dollars, such as 25000" : null}>
            <input id="oed-a" className="inp" inputMode="decimal" value={ask} onChange={(e) => setAsk(e.target.value)} />
          </Field>
          <div className="fld">
            <span className="lbl">Ask by year</span>
            {years.map((y, i) => (
              <div key={i} className="row" style={{ gap: "6px" }}>
                <label className="sr" htmlFor={`oed-y-${i}`}>
                  Year {i + 1}
                </label>
                <input id={`oed-y-${i}`} className="inp" inputMode="numeric" style={{ maxWidth: "90px" }} value={y.year} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
                <label className="sr" htmlFor={`oed-ya-${i}`}>
                  Ask for year {i + 1}
                </label>
                <input id={`oed-ya-${i}`} className="inp" inputMode="decimal" value={y.amount} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <button type="button" className="iconbtn" aria-label={`Remove year ${i + 1}`} onClick={() => setYears(years.filter((_, j) => j !== i))}>
                  <X className="ic" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setYears([...years, { year: String(new Date().getUTCFullYear() + years.length), amount: "" }])}>
              Add a year
            </button>
            {byYear.length > 0 && <span className="help">Total by year: {formatMinor(byYear.reduce((s, y) => s + y.amountMinor, 0))}</span>}
          </div>
          <Field id="oed-l" label="Listing link" error={linkBad(listing) ? "Enter a full web address, starting with https://" : null}>
            <input id="oed-l" className="inp" type="url" value={listing} onChange={(e) => setListing(e.target.value)} />
          </Field>
          <Field id="oed-po" label="Funder’s portal link" error={linkBad(portal) ? "Enter a full web address, starting with https://" : null}>
            <input id="oed-po" className="inp" type="url" value={portal} onChange={(e) => setPortal(e.target.value)} />
          </Field>
        </div>
        {save.error ? <ErrorBanner error={save.error} title="The details were not saved" /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!ok || save.state === "saving"}
          onClick={async () => {
            const a = await save.run({
              title: title.trim(),
              programName: program.trim() || null,
              funderRecordId: recordId || null,
              ...(recordId ? {} : { funderName: funder.trim() }),
              askAmount: askMoney,
              askByYear: byYear,
              ownerUserId: owner || null,
              listingUrl: listing.trim() ? webAddress(listing) : null,
              portalUrl: portal.trim() ? webAddress(portal) : null,
            });
            if (a) onDone(a);
          }}
        >
          {save.state === "saving" ? "Saving…" : "Save details"}
        </button>
      </div>
    </Dialog>
  );
}

export const askText = (d: OutsideApplication) => moneyText(d.askAmount);
