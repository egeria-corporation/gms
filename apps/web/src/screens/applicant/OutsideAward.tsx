// SPDX-License-Identifier: AGPL-3.0-only
// An outside award (v1.7): a grant from a funder outside this GMS, as the organization keeps it.
// The amount per year and grant period, the award letter, what the grant asks for (reports,
// conditions, payments expected) with reports written here, payments received against the award,
// and closeout once every obligation is done or received. Amounts are the organization's own
// records; nothing here moves money or holds a bank detail.
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Award, Banknote, CircleCheck, Plus, Upload } from "lucide-react";
import type { ApplicantApi } from "../../api/applicant.ts";
import { useApplicantApi } from "../../api/applicantHooks.ts";
import { useFullQuery } from "../../api/applicantFullHooks.ts";
import { minorOf, type OutsideApi } from "../../api/outside.ts";
import { useOutsideQuery } from "../../api/outsideHooks.ts";
import { libraryWithMeta, type Obligation, type ObligationInput, type WriteKeepApi } from "../../api/writeKeep.ts";
import { useWKMutation, useWriteKeepApi } from "../../api/writeKeepHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { isNotFound, Loaded } from "../../components/applicant.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { DataTable, EmptyState, ErrorBanner, Notice, PageHeader } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { DocumentRow, useUpload } from "./outside/ChecklistTab.tsx";
import { ObligationDialog, ObligationRow, ReportQuestions, SubmitReportDialog } from "./outside/obligations.tsx";
import { useCanApprove } from "./outside/QuestionsTab.tsx";
import { moneyFrom, moneyText } from "./outside/shared.tsx";
import { t, useApplicantText } from "./i18n.ts";

const load = async (api: OutsideApi, applicant: ApplicantApi, wk: WriteKeepApi, id: string) => {
  const detail = await api.get(id);
  const [obligations, members, library, org] = await Promise.all([wk.obligations(id), applicant.members().catch(() => []), libraryWithMeta(() => applicant.answers(), wk).catch(() => []), applicant.organization().catch(() => null)]);
  return { detail, obligations, members, library, org };
};
const today = () => new Date().toISOString().slice(0, 10);
const isPayment = (o: Obligation) => o.kind === "payment_expected" || o.kind === "payment_received";

function PaymentsReceived({ appId, currency, awardedMinor, obligations, readOnly, onChanged }: { appId: string; currency: string; awardedMinor: number | null; obligations: Obligation[]; readOnly: boolean; onChanged: () => void }) {
  const received = obligations.filter((o) => isPayment(o) && o.status === "received");
  const total = received.reduce((n, o) => n + (minorOf(o.amount) ?? 0), 0);
  const [form, setForm] = useState({ date: today(), amount: "" });
  const money = moneyFrom(form.amount, currency);
  const add = useWKMutation((api, input: ObligationInput) => api.createObligation(appId, input));
  const pct = awardedMinor ? Math.min(100, Math.round((total / awardedMinor) * 100)) : 0;
  return (
    <section className="card" aria-labelledby="pay-h">
      <div className="card-h">
        <div>
          <h2 id="pay-h" style={{ fontSize: "18px" }}>
            {t("outsideAward.paymentsReceived")}
          </h2>
          <p className="small muted">{t("outsideAward.theAmountsAndDatesTheFunder")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="mtr">
          <div className="lbls">
            <span>
              {t("outsideAward.received")} <b>{formatMinor(total, currency)}</b>
            </span>
            <span>{t.rich("outsideAward.ofAwarded", { amount: formatMinor(awardedMinor, currency), b: (chunks) => <b>{chunks}</b> })}</span>
          </div>
          <div className="track" role="img" aria-label={t("outsideAward.pctReceived", { pct })}>
            <div className="fill" style={{ width: `${pct}%` }}></div>
          </div>
        </div>
        {received.length === 0 ? (
          <p className="muted">{t("outsideAward.noPaymentsRecordedYet")}</p>
        ) : (
          <ul aria-label={t("outsideAward.paymentsReceived")} style={{ display: "flex", flexDirection: "column", gap: "6px", listStyle: "none", padding: 0, margin: 0 }}>
            {received.map((o) => (
              <li key={o.id} className="row" style={{ gap: "10px", justifyContent: "space-between", fontSize: "14px" }}>
                <span className="row" style={{ gap: "6px" }}>
                  <CircleCheck className="ic ic-sm" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} />
                  {o.title}
                </span>
                <span>
                  {formatDate(o.completedOn ?? o.dueOn)} · <span className="b">{moneyText(o.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form
            className="row"
            style={{ gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!money) return;
              if (await add.run({ kind: "payment_received", title: t("outsideAward.paymentReceived"), dueOn: form.date, amount: money })) {
                setForm({ date: today(), amount: "" });
                onChanged();
              }
            }}
          >
            <div className="fld" style={{ flex: "1 1 140px" }}>
              <label className="lbl" htmlFor="pay-amount">
                {t("outsideAward.amountReceivedIn", { currency })}
              </label>
              <input id="pay-amount" className={form.amount && !money ? "inp err" : "inp"} inputMode="decimal" value={form.amount} aria-invalid={form.amount && !money ? true : undefined} aria-describedby={form.amount && !money ? "pay-amount-err" : undefined} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="fld" style={{ flex: "1 1 140px" }}>
              <label className="lbl" htmlFor="pay-date">
                {t("outsideAward.dateItArrived")}
              </label>
              <input id="pay-date" type="date" className="inp" max={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={!money || !form.date || form.date > today() || add.state === "saving"}>
              <Banknote className="ic" aria-hidden="true" />
              {t("outsideAward.recordAPayment")}
            </button>
          </form>
        )}
        {form.amount && !money && (
          <span className="err-msg" id="pay-amount-err" role="alert">
            {t("outsideAward.enterTheAmountInDollarsSuch")}
          </span>
        )}
        {add.error ? <ErrorBanner error={add.error} title={t("outsideAward.thePaymentWasNotRecorded")} /> : null}
      </div>
    </section>
  );
}

export default function OutsideAward() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { outsideId = "" } = useParams();
  const applicant = useApplicantApi();
  const wk = useWriteKeepApi();
  const query = useOutsideQuery((api) => load(api, applicant, wk, outsideId), [outsideId, applicant, wk]);
  const assist = useFullQuery((api) => api.assistStatus(), []);
  const [dialog, setDialog] = useState<null | "add" | { edit: Obligation } | { submit: Obligation }>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const close = useWKMutation((api) => api.closeOut(outsideId));
  // The award letter is a document of the application typed "award_letter"; the latest one counts.
  const letter = useUpload(outsideId, "award_letter");
  const owner = query.status === "ready" ? query.data.detail.owner?.userId : null;
  const canApprove = useCanApprove(owner);
  const changed = (message?: string) => {
    setDialog(null);
    if (message) setNote(message);
    query.reload();
  };

  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  return (
    <>
      <title>{query.status === "ready" ? `${query.data.detail.title} — ${ws.name}` : t("outsideAward.pageTitle", { workspace: ws.name })}</title>
      <ApplicantShell active="Awarded funding">
        <main className="main">
          <Loaded query={query} label={t("outsideAward.openingTheAward")}>
            {({ detail, obligations, members, library, org }) => {
              if (detail.stage !== "awarded") {
                return (
                  <Notice tone="neu" title={t("outsideAward.thisApplicationHasNoAwardOn")}>
                    {t.rich("outsideAward.openToRecord", { link: (chunks) => <Link to={`${base}/outside/${detail.id}`}>{chunks}</Link> })}
                  </Notice>
                );
              }
              const readOnly = !!detail.archivedAt || !!detail.closedOutAt;
              const awardedMinor = minorOf(detail.awardedAmount);
              const receivedMinor = obligations.filter((o) => isPayment(o) && o.status === "received").reduce((n, o) => n + (minorOf(o.amount) ?? 0), 0);
              const duties = obligations.filter((o) => o.kind !== "payment_received");
              const allSettled = obligations.every((o) => o.status === "done" || o.status === "received");
              const awardLetter = [...detail.documents].reverse().find((d) => (d as { docType?: string | null }).docType === "award_letter" || d.id === detail.awardLetterDocumentId);
              const period = detail.grantStart && detail.grantEnd ? `${formatDate(detail.grantStart)} – ${formatDate(detail.grantEnd)}` : detail.grantStart ? t("outsideAward.fromDate", { date: formatDate(detail.grantStart) }) : null;
              return (
                <>
                  <PageHeader
                    crumbs={[{ label: t("outsideAward.awardedFunding"), to: `${base}/grants` }, { label: detail.title }]}
                    title={detail.title}
                    badge={
                      <>
                        <span className="bdg bdg-ok bdg-lg">
                          <Award className="ic" aria-hidden="true" />
                          {detail.closedOutAt ? t("outsideAward.closedOut") : t("outsideAward.awarded")}
                        </span>
                        <span className="tag">{t("outsideAward.outsideAward")}</span>
                      </>
                    }
                    meta={
                      <>
                        <span className="b">{detail.funderName}</span>
                        {detail.programName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{detail.programName}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{period ? t("outsideAward.grantPeriod", { period }) : t("outsideAward.noGrantPeriodRecorded")}</span>
                      </>
                    }
                    actions={
                      <>
                        <Link to={`${base}/outside/${detail.id}`} className="btn btn-secondary">
                          {t("outsideAward.openTheApplication")}
                        </Link>
                        {!readOnly && (
                          <button type="button" className="btn btn-primary" aria-haspopup="dialog" onClick={() => setDialog("add")}>
                            <Plus className="ic" aria-hidden="true" />
                            {t("outsideAward.addAnObligation")}
                          </button>
                        )}
                      </>
                    }
                  />
                  {note && <Notice tone="ok" title={note} />}
                  {detail.closedOutAt && (
                    <Notice tone="ok" title={t("outsideAward.closedOutOn", { date: formatDate(detail.closedOutAt) })}>
                      {t("outsideAward.everyObligationWasDoneOrReceived")}
                    </Notice>
                  )}
                  {!detail.closedOutAt && !detail.archivedAt && allSettled && (
                    <div className="bnr bnr-ok" role="region" aria-label={t("outsideAward.closeOut")}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div className="grow">
                        <div className="t">{t("outsideAward.everythingThisGrantAskedForIs")}</div>
                        <div className="d">{t("outsideAward.closeOutTheAwardToMark")}</div>
                        {close.error ? <ErrorBanner error={close.error} title={t("outsideAward.theAwardWasNotClosedOut")} /> : null}
                      </div>
                      <button type="button" className="btn btn-primary act" disabled={close.state === "saving"} onClick={async () => (await close.run()) && changed(t("outsideAward.closedOutNote"))}>
                        {close.state === "saving" ? t("outsideAward.closingOut") : t("outsideAward.closeOutThisAward")}
                      </button>
                    </div>
                  )}

                  <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="amounts" style={{ flexWrap: "wrap" }}>
                      <div>
                        <div className="stat-l">{t("outsideAward.awarded")}</div>
                        <div className="stat-v">{moneyText(detail.awardedAmount)}</div>
                      </div>
                      <div>
                        <div className="stat-l">{t("outsideAward.received")}</div>
                        <div className="stat-v">{formatMinor(receivedMinor, detail.currency)}</div>
                      </div>
                      <div>
                        <div className="stat-l">{t("outsideAward.stillToCome")}</div>
                        <div className="stat-v">{awardedMinor === null ? "—" : formatMinor(Math.max(0, awardedMinor - receivedMinor), detail.currency)}</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                    <section className="card" aria-labelledby="yr-h">
                      <div className="card-h">
                        <h2 id="yr-h" style={{ fontSize: "18px" }}>
                          {t("outsideAward.amountByYear")}
                        </h2>
                      </div>
                      <DataTable
                        label={t("outsideAward.amountByYear")}
                        rows={detail.awardByYear}
                        rowKey={(y) => String(y.year)}
                        columns={[
                          { key: "y", header: t("outsideAward.col.year"), cell: (y) => y.year },
                          { key: "a", header: t("outsideAward.col.amount"), numeric: true, cell: (y) => formatMinor(y.amountMinor, detail.currency) },
                        ]}
                        empty={<p className="muted" style={{ padding: "12px 16px" }}>{t("outsideAward.notSplit", { amount: moneyText(detail.awardedAmount) })}</p>}
                      />
                    </section>
                    <section className="card" aria-labelledby="ltr-h">
                      <div className="card-h">
                        <div>
                          <h2 id="ltr-h" style={{ fontSize: "18px" }}>
                            {t("outsideAward.awardLetter")}
                          </h2>
                          <p className="small muted">{t("outsideAward.keepTheFundersLetterOrAgreement")}</p>
                        </div>
                      </div>
                      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {awardLetter ? <DocumentRow doc={awardLetter} applicationId={detail.id} note={t("outsideAward.awardLetterNote")} /> : <p className="muted">{t("outsideAward.noAwardLetterYet")}</p>}
                        {!readOnly && (
                          <label className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
                            <Upload className="ic" aria-hidden="true" />
                            {letter.state === "saving" ? t("outsideAward.uploading") : awardLetter ? t("outsideAward.replaceTheAwardLetter") : t("outsideAward.uploadTheAwardLetter")}
                            <input
                              type="file"
                              className="sr"
                              aria-label={t("outsideAward.uploadTheAwardLetter")}
                              onChange={async (e) => {
                                const doc = await letter.run(e.target.files?.[0]);
                                e.target.value = "";
                                if (doc) changed(t("outsideAward.letterKept"));
                              }}
                            />
                          </label>
                        )}
                        {letter.tooBig && <p className="err-msg" role="alert">{letter.tooBig}</p>}
                        {letter.error ? <ErrorBanner error={letter.error} title={t("outsideAward.theLetterWasNotUploaded")} /> : null}
                      </div>
                    </section>
                  </div>

                  <section className="card" aria-labelledby="obl-h">
                    <div className="card-h">
                      <div>
                        <h2 id="obl-h" style={{ fontSize: "18px" }}>
                          {t("outsideAward.whatTheGrantAsksFor")}
                        </h2>
                        <p className="small muted">{t("outsideAward.reportsConditionsAndPaymentsExpectedReminders")}</p>
                      </div>
                    </div>
                    <div className="card-b">
                      {duties.length === 0 ? (
                        <EmptyState
                          icon={Award}
                          title={t("outsideAward.nothingRecordedYet")}
                          actions={
                            !readOnly ? (
                              <button type="button" className="btn btn-primary" onClick={() => setDialog("add")}>
                                {t("outsideAward.addAnObligation")}
                              </button>
                            ) : undefined
                          }
                        >
                          {t("outsideAward.addTheReportsTheFunderAsks")}
                        </EmptyState>
                      ) : (
                        <ul aria-label={t("outsideAward.obligations")} style={{ display: "flex", flexDirection: "column", gap: "10px", listStyle: "none", padding: 0, margin: 0 }}>
                          {duties.map((o) => (
                            <ObligationRow
                              key={o.id}
                              o={o}
                              app={detail}
                              readOnly={readOnly}
                              open={open === o.id}
                              onToggle={() => setOpen(open === o.id ? null : o.id)}
                              onEdit={() => setDialog({ edit: o })}
                              onSubmit={() => setDialog({ submit: o })}
                              onChanged={() => changed()}
                            >
                              <ReportQuestions app={detail} obligation={o} members={members} library={library} org={org} assist={assist.status === "ready" ? assist.data : null} onAssistUsed={assist.reload} canApprove={canApprove} onChanged={() => query.reload()} />
                            </ObligationRow>
                          ))}
                        </ul>
                      )}
                    </div>
                  </section>

                  <PaymentsReceived appId={detail.id} currency={detail.currency} awardedMinor={awardedMinor} obligations={obligations} readOnly={readOnly} onChanged={() => changed(t("outsideAward.paymentRecorded"))} />

                  {dialog === "add" && <ObligationDialog app={detail} onClose={() => setDialog(null)} onDone={changed} />}
                  {dialog && typeof dialog === "object" && "edit" in dialog && <ObligationDialog app={detail} obligation={dialog.edit} onClose={() => setDialog(null)} onDone={changed} />}
                  {dialog && typeof dialog === "object" && "submit" in dialog && <SubmitReportDialog obligation={dialog.submit} onClose={() => setDialog(null)} onDone={() => changed(t("outsideAward.reportSubmitted"))} />}
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
