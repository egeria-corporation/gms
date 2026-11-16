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
import { canMarkSubmitted, webAddress } from "../../../lib/outside.ts";
import { stageLabel } from "../labels.ts";
import { DocumentRow } from "./ChecklistTab.tsx";
import { dollarsOf, METHOD_LABELS, moneyFrom, moneyText } from "./shared.tsx";
import { t } from "../i18n.ts";

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer noopener" style={{ overflowWrap: "anywhere" }}>
    {children} <ExternalLink className="ic ic-sm" aria-hidden="true" />
    <span className="sr"> {t("outsideTabs.opensInANewTab")}</span>
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
              {t("outsideTabs.whereToSubmit")}
            </h2>
            <p className="small muted">{t("outsideTabs.youSubmitOnTheFundersOwn")}</p>
          </div>
        </div>
        <div className="card-b">
          <dl className="kv" style={{ fontSize: "15px" }}>
            <dt>{t("outsideTabs.fundersPortal")}</dt>
            <dd>{detail.portalUrl ? <Ext href={detail.portalUrl}>{detail.portalUrl}</Ext> : <span className="muted">{t("outsideTabs.noPortalLinkYetAddOne")}</span>}</dd>
            <dt>{t("outsideTabs.portalLogin")}</dt>
            <dd>
              {record?.portalLoginHolder ? (
                <>
                  {t("outsideTabs.heldBy", { name: record.portalLoginHolder })}
                  <span className="small muted"> · </span>
                </>
              ) : (
                <span className="muted">{t("outsideTabs.notRecorded")} </span>
              )}
              {record ? (
                <Link to={`${base}/funders/${record.id}`} className="small b">
                  {record.portalLoginHolder ? t("outsideTabs.change") : t("outsideTabs.recordWhoHoldsIt")}
                </Link>
              ) : (
                <span className="small muted">{t("outsideTabs.keepItOnAFunderRecord")}</span>
              )}
            </dd>
            <dt>{t("outsideTabs.theListing")}</dt>
            <dd>{detail.listingUrl ? <Ext href={detail.listingUrl}>{detail.listingUrl}</Ext> : <span className="muted">—</span>}</dd>
          </dl>
        </div>
      </section>
      <section className="card" aria-labelledby="osb-state">
        <div className="card-h">
          <h2 id="osb-state" style={{ fontSize: "18px" }}>
            {t("outsideTabs.submission")}
          </h2>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {detail.submittedAt ? (
            <>
              <dl className="kv" style={{ fontSize: "15px" }}>
                <dt>{t("outsideTabs.submitted")}</dt>
                <dd>{formatDate(detail.submittedAt)}</dd>
                <dt>{t("outsideTabs.how")}</dt>
                <dd>{detail.submissionMethod ? METHOD_LABELS[detail.submissionMethod] : "—"}</dd>
                <dt>{t("outsideTabs.confirmationNumber")}</dt>
                <dd className={detail.confirmationRef ? "mono" : "muted"}>{detail.confirmationRef ?? t("outsideTabs.noneRecorded")}</dd>
              </dl>
              {receipt && <DocumentRow doc={receipt} applicationId={detail.id} note={t("outsideTabs.receiptNote")} />}
              {snapshot ? (
                <>
                  <DocumentRow doc={snapshot} applicationId={detail.id} note={t("outsideTabs.asSubmitted")} />
                  {detail.snapshotSha256 && (
                    <p className="small muted row" style={{ gap: "6px", alignItems: "flex-start" }}>
                      <Hash className="ic ic-sm" aria-hidden="true" />
                      <span>
                        {t("outsideTabs.fingerprintSha256OfTheAs")} <span className="mono" style={{ overflowWrap: "anywhere" }}>{detail.snapshotSha256}</span>
                      </span>
                    </p>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <>
              <p>{t("outsideTabs.notSubmittedYet")}</p>
              {!readOnly && canMarkSubmitted(detail.stage) ? (
                <button type="button" className="btn btn-primary" style={{ alignSelf: "flex-start" }} aria-haspopup="dialog" onClick={onMarkSubmitted}>
                  <Send className="ic" aria-hidden="true" />
                  {t("outsideTabs.markAsSubmitted")}
                </button>
              ) : (
                <p className="small muted">{detail.stage === "drafting" ? "" : t("outsideTabs.moveToDraftingFirst", { stage: stageLabel(detail.stage) })}</p>
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
            {detail.funderName ? t("outsideTabs.aboutFunder", { funder: detail.funderName }) : t("outsideTabs.aboutThisFunder")}
          </h2>
          <p className="small muted">{t("outsideTabs.keptOnTheFunderRecordSo")}</p>
        </div>
        {record && <SaveNote state={save.state === "saved" && notes === (record.notes ?? "") ? "saved" : "idle"} />}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {record ? (
          <>
            <label className="sr" htmlFor="ont-notes">
              {t("outsideTabs.notesAbout", { name: record.name })}
            </label>
            <textarea id="ont-notes" className="ta" style={{ minHeight: "120px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" disabled={notes === (record.notes ?? "") || save.state === "saving"} onClick={async () => (await save.run()) && onChanged()}>
                {t("outsideTabs.saveNotes")}
              </button>
              <Link to={`${base}/funders/${record.id}`} className="small b">
                {t("outsideTabs.openTheFunderRecordContactsPast")}
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="muted">{detail.funderName ? t("outsideTabs.noRecordFor", { funder: detail.funderName }) : t("outsideTabs.noRecordForThisFunder")}</p>
            <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={!detail.funderName || create.state === "saving"} onClick={async () => (await create.run()) && onChanged()}>
              <Plus className="ic" aria-hidden="true" />
              {t("outsideTabs.createAFunderRecord")}
            </button>
          </>
        )}
        {save.error ? <ErrorBanner error={save.error} title={t("outsideTabs.theNotesWereNotSaved")} /> : null}
        {create.error ? <ErrorBanner error={create.error} title={t("outsideTabs.theFunderRecordWasNotCreated")} /> : null}
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
            {t("outsideTabs.yourOwnFields")}
          </h2>
          <p className="small muted">{t("outsideTabs.anythingElseToKeepWithThis")}</p>
        </div>
        <SaveNote state={save.state === "saved" && !dirty ? "saved" : "idle"} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {rows.length === 0 && <p className="muted">{t("outsideTabs.noFieldsYet")}</p>}
        {rows.map((r, i) => (
          <div key={i} className="row" style={{ gap: "8px" }}>
            <label className="sr" htmlFor={`ocf-k-${i}`}>
              {t("outsideTabs.fieldName", { n: i + 1 })}
            </label>
            <input id={`ocf-k-${i}`} className={dupes.has(r.k.trim().toLowerCase()) ? "inp err" : "inp"} placeholder={t("outsideTabs.name")} readOnly={readOnly} value={r.k} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
            <label className="sr" htmlFor={`ocf-v-${i}`}>
              {r.k ? t("outsideTabs.valueOf", { name: r.k }) : t("outsideTabs.valueOfField", { n: i + 1 })}
            </label>
            <input id={`ocf-v-${i}`} className="inp" placeholder={t("outsideTabs.value")} readOnly={readOnly} value={r.v} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
            {!readOnly && (
              <button type="button" className="iconbtn" aria-label={r.k ? t("outsideTabs.removeName", { name: r.k }) : t("outsideTabs.removeField", { n: i + 1 })} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <X className="ic" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {dupes.size > 0 && <span className="err-msg" role="alert">{t("outsideTabs.eachFieldNeedsItsOwnName")}</span>}
        {!readOnly && (
          <div className="row" style={{ gap: "8px" }}>
            <button type="button" className="btn btn-sm btn-secondary" disabled={rows.length >= 30} onClick={() => setRows([...rows, { k: "", v: "" }])}>
              <Plus className="ic" aria-hidden="true" />
              {t("outsideTabs.addAField")}
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || dupes.size > 0 || save.state === "saving"} onClick={async () => (await save.run()) && onChanged()}>
              {t("outsideTabs.saveFields")}
            </button>
          </div>
        )}
        {save.error ? <ErrorBanner error={save.error} title={t("outsideTabs.theFieldsWereNotSaved")} /> : null}
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
          <Notice tone="neu" title={t("outsideTabs.decisionNotes")}>
            {detail.decisionNotes}
            {detail.nextCycleOn ? ` ${t("outsideTabs.nextCycle", { date: formatDate(detail.nextCycleOn) })}` : ""}
          </Notice>
        )}
      </div>
      <CustomFields detail={detail} readOnly={readOnly} onChanged={onChanged} />
    </div>
  );
}

// ------------------------------------------------------------------------------------ activity

const stageWord = (s: unknown) => (typeof s === "string" ? stageLabel(s) : "");
/** What someone did, as one sentence with their name in it. */
function describe(e: OutsideEvent, who: string): string {
  const d = e.data ?? {};
  switch (e.type.replace(/^outside_application\./, "")) {
    case "created":
      return d.source === "opengrants" ? t("outsideTabs.event.createdListing", { who }) : d.source === "import" ? t("outsideTabs.event.imported", { who }) : t("outsideTabs.event.created", { who });
    case "stage_changed":
      return t("outsideTabs.event.moved", { who, from: stageWord(d.from), to: stageWord(d.to) });
    case "submitted":
      return t("outsideTabs.event.submitted", { who });
    case "decided":
      return t("outsideTabs.event.decided", { who, outcome: stageWord(d.outcome) });
    case "reopened":
      return d.to ? t("outsideTabs.event.reopenedAt", { who, stage: stageWord(d.to) }) : t("outsideTabs.event.reopened", { who });
    case "archived":
      return t("outsideTabs.event.archived", { who });
    case "unarchived":
      return t("outsideTabs.event.unarchived", { who });
    case "consulting_requested":
      return t("outsideTabs.event.consulting", { who });
    default:
      return `${who} ${e.type.replace(/^outside_application\./, "").replace(/_/g, " ")}`;
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
            {t("outsideTabs.activity")}
          </h2>
          <p className="small muted">{t("outsideTabs.whoMovedThisApplicationAndWhen")}</p>
        </div>
      </div>
      <div className="card-b">
        {events.length === 0 ? (
          <p className="muted">{t("outsideTabs.nothingRecordedYet")}</p>
        ) : (
          <ol className="tl" aria-label={t("outsideTabs.activity")}>
            {events.map((e) => {
              const who = e.actor ? actorOf(e.actor, personName) : { kind: "person" as const, name: t("outsideTabs.yourTeam") };
              const Icon = who.kind === "agent" ? Bot : who.kind === "system" ? Clock : User;
              return (
                <li key={e.id} className={`tl-i ${who.kind === "agent" ? "tl-agent" : who.kind === "person" ? "tl-person" : ""}`}>
                  <span className="dot">
                    <Icon className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">
                      {describe(e, who.name)}
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
          {t("outsideTabs.editDetails")}
        </h3>
        <button className="iconbtn" type="button" aria-label={t("outsideTabs.close")} onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <Field id="oed-t" label={t("outsideTabs.title")} required>
          <input id="oed-t" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
          <Field id="oed-rec" label={t("outsideTabs.funderRecord")}>
            <select id="oed-rec" className="sel" value={recordId} onChange={(e) => setRecordId(e.target.value)}>
              <option value="">{t("outsideTabs.noRecordTypeTheName")}</option>
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="oed-f" label={t("outsideTabs.funderName")} required>
            <input id="oed-f" className="inp" disabled={!!recordId} value={recordId ? (records.find((r) => r.id === recordId)?.name ?? funder) : funder} onChange={(e) => setFunder(e.target.value)} />
          </Field>
          <Field id="oed-p" label={t("outsideTabs.program")}>
            <input id="oed-p" className="inp" value={program} onChange={(e) => setProgram(e.target.value)} />
          </Field>
          <Field id="oed-o" label={t("outsideTabs.owner")} help={t("outsideTabs.getsTheDeadlineReminders")}>
            <select id="oed-o" className="sel" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t("outsideTabs.noOwner")}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </Field>
          <Field id="oed-a" label={t("outsideTabs.askUsd")} error={askBad ? t("outsideTabs.badAmount") : null}>
            <input id="oed-a" className="inp" inputMode="decimal" value={ask} onChange={(e) => setAsk(e.target.value)} />
          </Field>
          <div className="fld">
            <span className="lbl">{t("outsideTabs.askByYear")}</span>
            {years.map((y, i) => (
              <div key={i} className="row" style={{ gap: "6px" }}>
                <label className="sr" htmlFor={`oed-y-${i}`}>
                  {t("outsideTabs.yearN", { n: i + 1 })}
                </label>
                <input id={`oed-y-${i}`} className="inp" inputMode="numeric" style={{ maxWidth: "90px" }} value={y.year} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
                <label className="sr" htmlFor={`oed-ya-${i}`}>
                  {t("outsideTabs.askForYear", { n: i + 1 })}
                </label>
                <input id={`oed-ya-${i}`} className="inp" inputMode="decimal" value={y.amount} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <button type="button" className="iconbtn" aria-label={t("outsideTabs.removeYear", { n: i + 1 })} onClick={() => setYears(years.filter((_, j) => j !== i))}>
                  <X className="ic" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setYears([...years, { year: String(new Date().getUTCFullYear() + years.length), amount: "" }])}>
              {t("outsideTabs.addAYear")}
            </button>
            {byYear.length > 0 && <span className="help">{t("outsideTabs.totalByYear", { amount: formatMinor(byYear.reduce((s, y) => s + y.amountMinor, 0)) })}</span>}
          </div>
          <Field id="oed-l" label={t("outsideTabs.listingLink")} error={linkBad(listing) ? t("outsideTabs.badAddress") : null}>
            <input id="oed-l" className="inp" type="url" value={listing} onChange={(e) => setListing(e.target.value)} />
          </Field>
          <Field id="oed-po" label={t("outsideTabs.fundersPortalLink")} error={linkBad(portal) ? t("outsideTabs.badAddress") : null}>
            <input id="oed-po" className="inp" type="url" value={portal} onChange={(e) => setPortal(e.target.value)} />
          </Field>
        </div>
        {save.error ? <ErrorBanner error={save.error} title={t("outsideTabs.theDetailsWereNotSaved")} /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("outsideTabs.cancel")}
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
          {save.state === "saving" ? t("outsideTabs.saving") : t("outsideTabs.saveDetails")}
        </button>
      </div>
    </Dialog>
  );
}

export const askText = (d: OutsideApplication) => moneyText(d.askAmount);
