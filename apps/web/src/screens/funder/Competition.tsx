// SPDX-License-Identifier: AGPL-3.0-only
// Competition: the stages an opportunity runs through, the forms and rubric pinned to each, and
// the launch checklist that gates opening. Reached by competition id, by the opportunity's slug,
// or from `/opportunities/:oppId/competition`. Application counts per stage join with phase 2.
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Check, ExternalLink, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { ReviewerPool } from "./ReviewerPool.tsx";
import type { Checklist, Competition as CompetitionRecord, FormSummary, Opportunity, Rubric, Stage } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Loading, PageHeader, problemFor, ReadinessChecklist } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { ShareToGalleryButton } from "./ShareToGallery.tsx";
import { formatList } from "@gms/i18n";
import { getLocale } from "../../i18n/index.tsx";
import { t } from "./i18n.ts";

const dateOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const opensAt = (date: string) => (date ? `${date}T00:00:00Z` : null);
const closesAt = (date: string) => (date ? `${date}T23:59:59Z` : null);
const keyFrom = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 40) || "stage";

/** A stage with a stable editor id, so rows keep their identity while keys are retyped. */
type StageRow = Stage & { rowId: string; isNew: boolean };

function newStage(n: number, previous: StageRow | undefined): StageRow {
  const label = n === 1 ? t("funderCompetition.newStage.application") : t("funderCompetition.newStage.numbered", { n: String(n) });
  return { rowId: `new-${n}-${Date.now()}`, isNew: true, key: n === 1 ? "application" : `stage_${n}`, label, forms: {}, opens: null, closes: null, rubricId: null, reviewers: null, entryFrom: previous ? [previous.key] : [], requiresSubmission: true, decisionRequired: true };
}

function StagesDialog({ competition, forms, rubrics, onClose, onSaved }: { competition: CompetitionRecord; forms: FormSummary[]; rubrics: Rubric[]; onClose: () => void; onSaved: (c: CompetitionRecord) => void }) {
  const [rows, setRows] = useState<StageRow[]>(() => (competition.stages.length ? competition.stages.map((s, i) => ({ ...s, rowId: `s${i}`, isNew: false })) : [newStage(1, undefined)]));
  const save = useApiMutation((api, stages: Stage[]) => api.putStages(competition.id, stages));
  const patch = (rowId: string, change: Partial<StageRow>) => setRows((rs) => rs.map((r) => (r.rowId === rowId ? { ...r, ...change } : r)));
  const published = forms.filter((f) => f.status === "published");
  const formName = (id: string) => forms.find((f) => f.id === id)?.title ?? t("funderCompetition.unknownForm");

  async function submit() {
    // Entry rules follow the order: each stage is entered from the one before it.
    const stages = rows.map(({ rowId: _r, isNew: _n, ...s }, i) => ({ ...s, entryFrom: i === 0 ? [] : [rows[i - 1]!.key] }));
    const saved = await save.run(stages);
    if (saved) onSaved(saved);
  }

  return (
    <Dialog open onClose={onClose} labelledBy="stages-title" size="lg">
      <div className="hd">
        <div>
          <h2 id="stages-title" style={{ fontSize: "16px" }}>
            {t("funderCompetition.editStages")}
          </h2>
          <p className="small muted" style={{ marginTop: "4px" }}>
            {t("funderCompetition.mostCompetitionsHaveOne")}
          </p>
        </div>
      </div>
      <div className="bd">
        {save.error !== null && <ErrorBanner error={save.error} title={t("funderCompetition.theStagesCouldNot")} />}
        <ol style={{ display: "flex", flexDirection: "column", gap: "14px" }} aria-label={t("funderCompetition.stages")}>
          {rows.map((s, i) => {
            const n = i + 1;
            const pinned = Object.entries(s.forms);
            const addable = published.filter((f) => !(f.id in s.forms));
            return (
              <li key={s.rowId} className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 32px", gap: "10px", alignItems: "end" }}>
                  <div className="fld">
                    <label className="lbl" htmlFor={`${s.rowId}-label`}>
                      {t("funderCompetition.stageName", { n })}
                    </label>
                    <input
                      className={problemFor(save.error, `stages.${i}.label`) ? "inp err" : "inp"}
                      id={`${s.rowId}-label`}
                      value={s.label}
                      onChange={(e) => patch(s.rowId, { label: e.target.value, ...(s.isNew ? { key: keyFrom(e.target.value) } : {}) })}
                    />
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor={`${s.rowId}-opens`}>
                      {t("funderCompetition.opens")}
                    </label>
                    <input className="inp" id={`${s.rowId}-opens`} type="date" value={dateOf(s.opens)} onChange={(e) => patch(s.rowId, { opens: opensAt(e.target.value) })} />
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor={`${s.rowId}-closes`}>
                      {t("funderCompetition.closes")}
                    </label>
                    <input className="inp" id={`${s.rowId}-closes`} type="date" value={dateOf(s.closes)} onChange={(e) => patch(s.rowId, { closes: closesAt(e.target.value) })} />
                  </div>
                  <button type="button" className="iconbtn" aria-label={t("funderCompetition.removeStage", { n })} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((r) => r.rowId !== s.rowId))}>
                    <Trash2 className="ic" aria-hidden="true" />
                  </button>
                </div>
                <div className="fld-row">
                  <div className="fld">
                    <span className="lbl" id={`${s.rowId}-forms-label`}>
                      {t("funderCompetition.forms")}
                    </span>
                    <ul aria-labelledby={`${s.rowId}-forms-label`} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {pinned.map(([id, version]) => (
                        <li key={id} className="row" style={{ justifyContent: "space-between" }}>
                          <span>
                            {formName(id)} <span className="tag">{t("funderCompetition.v", { version })}</span>
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            aria-label={t("funderCompetition.unpinFromStage", { formName: formName(id), n })}
                            onClick={() => patch(s.rowId, { forms: Object.fromEntries(pinned.filter(([f]) => f !== id)) })}
                          >
                            {t("funderCompetition.unpin")}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <label className="sr" htmlFor={`${s.rowId}-add-form`}>
                      {t("funderCompetition.pinAFormTo", { n })}
                    </label>
                    <select
                      className="sel"
                      id={`${s.rowId}-add-form`}
                      value=""
                      onChange={(e) => {
                        const f = published.find((x) => x.id === e.target.value);
                        if (f) patch(s.rowId, { forms: { ...s.forms, [f.id]: f.version } });
                      }}
                    >
                      <option value="">{addable.length ? t("funderCompetition.pinAPublishedForm") : t("funderCompetition.noMorePublishedForms")}</option>
                      {addable.map((f) => (
                        <option key={f.id} value={f.id}>
                          {t("funderCompetition.v2", { title: f.title, version: f.version })}
                        </option>
                      ))}
                    </select>
                    <span className="help">{t("funderCompetition.onlyPublishedVersionsCan")}</span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor={`${s.rowId}-rubric`}>
                      {t("funderCompetition.rubric")}
                    </label>
                    <select className="sel" id={`${s.rowId}-rubric`} value={s.rubricId ?? ""} onChange={(e) => patch(s.rowId, { rubricId: e.target.value || null })}>
                      <option value="">{t("funderCompetition.noRubric")}</option>
                      {rubrics.map((r) => (
                        <option key={r.id} value={r.id}>
                          {t("funderCompetition.v3", { name: r.name, version: r.version })}
                        </option>
                      ))}
                    </select>
                    <label className="cb" htmlFor={`${s.rowId}-submission`} style={{ marginTop: "6px" }}>
                      <input type="checkbox" id={`${s.rowId}-submission`} checked={s.requiresSubmission} onChange={(e) => patch(s.rowId, { requiresSubmission: e.target.checked })} style={{ marginTop: "3px" }} />
                      <span>{t("funderCompetition.applicantsSubmitFormsIn")}</span>
                    </label>
                    <label className="cb" htmlFor={`${s.rowId}-decision`}>
                      <input type="checkbox" id={`${s.rowId}-decision`} checked={s.decisionRequired} onChange={(e) => patch(s.rowId, { decisionRequired: e.target.checked })} style={{ marginTop: "3px" }} />
                      <span>{t("funderCompetition.reviewersScoreAndA")}</span>
                    </label>
                  </div>
                </div>
                {i > 0 && <span className="help">{t("funderCompetition.enteredByInvitationFrom", { label: rows[i - 1]!.label })}</span>}
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setRows((rs) => [...rs, newStage(rs.length + 1, rs[rs.length - 1])])}>
          <Plus className="ic" aria-hidden="true" />
          {t("funderCompetition.addStage")}
        </button>
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("funderCompetition.cancel")}
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={save.state === "saving"}>
          {t("funderCompetition.saveStages")}
        </button>
      </div>
    </Dialog>
  );
}

function StageTimeline({ stages }: { stages: Stage[] }) {
  const now = Date.now();
  return (
    <ol className="stp" aria-label={t("funderCompetition.stageTimeline")} style={{ flexWrap: "wrap", rowGap: "12px" }}>
      {stages.map((s, i) => {
        const done = !!s.closes && Date.parse(s.closes) < now;
        const on = !done && (!s.opens || Date.parse(s.opens) <= now) && (!!s.opens || !!s.closes);
        return (
          <li key={s.key} style={{ display: "contents" }}>
            {i > 0 && <span className={done || on ? "ln done" : "ln"} aria-hidden="true"></span>}
            <div className={done ? "s done" : on ? "s on" : "s"} aria-current={on ? "step" : undefined}>
              <span className="n">{done ? <Check className="ic ic-sm" role="img" aria-label={t("funderCompetition.closed")} /> : i + 1}</span>
              <div>
                <div>{s.label}</div>
                <div className="small muted" style={{ fontWeight: 400 }}>
                  {s.opens || s.closes ? t("funderCompetition.dateRange", { opens: formatDate(s.opens), closes: formatDate(s.closes) }) : t("funderCompetition.noDatesYet")} · {done ? t("funderCompetition.closed2") : on ? t("funderCompetition.open") : t("funderCompetition.upcoming")}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

interface Loaded {
  opportunity: Opportunity;
  competition: CompetitionRecord | null;
  forms: FormSummary[];
  rubrics: Rubric[];
  checklist: Checklist | null;
}

export default function Competition() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const { compId, oppId } = useParams();
  const [editing, setEditing] = useState(false);

  const data = useApiQuery<Loaded | null>(async (api) => {
    const [opportunities, competitions, own, library, rubrics] = await Promise.all([api.listOpportunities(), api.listCompetitions(), api.listForms(), api.listFormLibrary(), api.listRubrics()]);
    // Accept the competition id, or the id or slug of its opportunity.
    const wanted = compId ?? oppId;
    const byId = competitions.find((c) => c.id === wanted);
    const opportunity = byId ? opportunities.find((o) => o.id === byId.opportunityId) : opportunities.find((o) => o.id === wanted || o.slug === wanted);
    if (!opportunity) return null;
    const competition = byId ?? competitions.find((c) => c.opportunityId === opportunity.id) ?? null;
    const checklist = competition ? await api.launchCheck(competition.id) : null;
    return { opportunity, competition, forms: [...own, ...library], rubrics, checklist };
  }, [ws.id, compId, oppId]);

  const create = useApiMutation((api, o: Opportunity) => api.createCompetition({ opportunityId: o.id, title: o.title }));
  const open = useApiMutation((api, id: string) => api.openCompetition(id));
  const close = useApiMutation((api, id: string) => api.closeCompetition(id));

  if (data.status === "ready" && data.data === null) return <NotFound />;
  const loaded = data.status === "ready" ? data.data : null;
  const competition = loaded?.competition ?? null;
  const opportunity = loaded?.opportunity;
  const checklist = loaded?.checklist ?? null;
  const formOf = (id: string) => loaded?.forms.find((f) => f.id === id);
  const rubricOf = (id: string | null | undefined) => loaded?.rubrics.find((r) => r.id === id);
  const publicPath = opportunity ? `/f/${ws.handle}/o/${opportunity.slug}` : "";
  const writeError = create.error ?? open.error ?? close.error;

  return (
    <FunderShell active="Opportunities">
      <title>{t("funderCompetition.competition", { title: opportunity?.title ?? t("funderCompetition.competition2") })}</title>
      <main className="main">
        {data.status === "loading" && <Loading label={t("funderCompetition.loadingTheCompetition")} />}
        {data.status === "error" && <ErrorBanner error={data.error} onRetry={data.reload} title={t("funderCompetition.theCompetitionCouldNot")} />}
        {loaded && opportunity && (
          <>
            <PageHeader
              crumbs={[{ label: ws.name, to: base }, { label: t("funderCompetition.opportunities"), to: `${base}/opportunities` }, { label: opportunity.title, to: `${base}/opportunities/${opportunity.id}/edit` }, { label: t("funderCompetition.competition2") }]}
              title={competition?.title ?? opportunity.title}
              badge={competition && <StatusBadge kind="competition" status={competition.status} />}
              meta={
                <>
                  {opportunity.published ? (
                    <Link to={publicPath} className="row" style={{ gap: "5px" }}>
                      <ExternalLink className="ic ic-sm" aria-hidden="true" />
                      {publicPath}
                    </Link>
                  ) : (
                    <span>{t("funderCompetition.opportunityNotPublishedYet")}</span>
                  )}
                  {competition && (
                    <>
                      <span>·</span>
                      <span>
                        {t("funderCompetition.stageCount", { count: competition.stages.length })}
                      </span>
                    </>
                  )}
                </>
              }
              actions={
                competition && (
                  <>
                    <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)} disabled={competition.status === "closed"}>
                      <Pencil className="ic" aria-hidden="true" />
                      {t("funderCompetition.editStages")}
                    </button>
                    {competition.status === "open" && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={close.state === "saving"}
                        onClick={async () => {
                          if (await close.run(competition.id)) data.reload();
                        }}
                      >
                        {t("funderCompetition.closeCompetition")}
                      </button>
                    )}
                  </>
                )
              }
            />
            {writeError !== null && <ErrorBanner error={writeError} />}

            {!competition && (
              <div className="card">
                <EmptyState
                  icon={Layers}
                  title={t("funderCompetition.noCompetitionYet")}
                  actions={
                    <>
                      <Link to={`${base}/opportunities/${opportunity.id}/edit#applications`} className="btn btn-primary">
                        {t("funderCompetition.quickSetup")}
                      </Link>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={create.state === "saving"}
                        onClick={async () => {
                          if (await create.run(opportunity)) {
                            data.reload();
                            setEditing(true);
                          }
                        }}
                      >
                        {t("funderCompetition.setUpTheCompetition")}
                      </button>
                    </>
                  }
                >
                  {t("funderCompetition.aCompetitionIsHow", { title: opportunity.title })}
                </EmptyState>
              </div>
            )}

            {competition && (
              <>
                <div className="card" style={{ padding: "18px 20px" }}>
                  {competition.stages.length ? <StageTimeline stages={competition.stages} /> : <span className="muted">{t("funderCompetition.noStagesYetEdit")}</span>}
                </div>

                {competition.stages.length > 0 && (
                  <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("funderCompetition.stagesScrollable")}>
                    <table className="tbl" aria-label={t("funderCompetition.stages")}>
                      <thead>
                        <tr>
                          <th>{t("funderCompetition.stage2")}</th>
                          <th>{t("funderCompetition.opens")}</th>
                          <th>{t("funderCompetition.closes")}</th>
                          <th>{t("funderCompetition.form")}</th>
                          <th>{t("funderCompetition.rubric")}</th>
                          <th>{t("funderCompetition.entryRule")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {competition.stages.map((s, i) => (
                          <tr key={s.key}>
                            <td className="b">{s.label}</td>
                            <td>{s.opens ? formatDate(s.opens) : "—"}</td>
                            <td>{s.closes ? formatDate(s.closes) : "—"}</td>
                            <td style={{ whiteSpace: "normal" }}>
                              {Object.entries(s.forms)
                                .map(([id, version]) => t("funderCompetition.formVersion", { title: formOf(id)?.title ?? t("funderCompetition.unknownForm"), version }))
                                .join(", ") || <span className="muted">{t("funderCompetition.noForm")}</span>}
                            </td>
                            <td>{rubricOf(s.rubricId)?.name ?? <span className="muted">{s.decisionRequired ? t("funderCompetition.noneYet") : t("funderCompetition.notScored")}</span>}</td>
                            <td style={{ whiteSpace: "normal" }}>{i === 0 ? t("funderCompetition.openToEveryEligible") : s.entryFrom.length ? t("funderCompetition.advancedFrom", { stages: formatList(getLocale(), s.entryFrom.map((k) => competition.stages.find((x) => x.key === k)?.label ?? k), "disjunction") }) : t("funderCompetition.advancedFromPrevious")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px" }}>
                    <section className="card" aria-labelledby="comp-forms-title">
                      <div className="card-h" style={{ padding: "12px 16px" }}>
                        <h3 id="comp-forms-title" style={{ fontSize: "14px" }}>
                          {t("funderCompetition.forms")}
                        </h3>
                        <Link to={`${base}/forms`} className="small b">
                          {t("funderCompetition.allForms")}
                        </Link>
                      </div>
                      <div className="card-b" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                        {competition.stages.flatMap((s) =>
                          Object.entries(s.forms).map(([id, version]) => {
                            const f = formOf(id);
                            return (
                              <div key={`${s.key}-${id}`}>
                                {f && !f.shared ? (
                                  <Link to={`${base}/forms/${id}/edit`} className="b" style={{ color: "#0D2A43" }}>
                                    {f.title}
                                  </Link>
                                ) : (
                                  <span className="b" style={{ color: "#0D2A43" }}>
                                    {f?.title ?? t("funderCompetition.unknownForm")}
                                  </span>
                                )}
                                <div className="row small muted" style={{ gap: "6px" }}>
                                  {t.rich("funderCompetition.vPinned", { version, label: s.label, span: (chunks) => <span className="tag">{chunks}</span> })}
                                  {f && f.version > version ? t(f.status === "draft" ? "funderCompetition.newerDraft" : "funderCompetition.newerAvailable", { version: f.version }) : ""}
                                </div>
                              </div>
                            );
                          }),
                        )}
                        {competition.stages.every((s) => !Object.keys(s.forms).length) && <span className="muted">{t("funderCompetition.noFormsPinnedYet")}</span>}
                      </div>
                    </section>

                    <section className="card" aria-labelledby="comp-rubric-title">
                      <div className="card-h" style={{ padding: "12px 16px" }}>
                        <h3 id="comp-rubric-title" style={{ fontSize: "14px" }}>
                          {t("funderCompetition.rubrics")}
                        </h3>
                      </div>
                      <div className="card-b" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
                        {competition.stages.map((s) => {
                          const r = rubricOf(s.rubricId);
                          const total = r?.criteria.reduce((sum, c) => sum + c.weight, 0) ?? 0;
                          return (
                            <div key={s.key} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              <div className="b" style={{ color: "#0D2A43" }}>
                                {s.label}
                                <span className="muted" style={{ fontWeight: 400 }}>
                                  {" "}
                                  · {r ? t("funderCompetition.v5", { name: r.name, version: r.version }) : s.decisionRequired ? t("funderCompetition.noRubricYet") : t("funderCompetition.notScored2")}
                                </span>
                              </div>
                              {r?.criteria.map((c) => (
                                <div key={c.key} className="row" style={{ justifyContent: "space-between" }}>
                                  <span>{c.label}</span>
                                  <span className="tag">{total ? Math.round((c.weight / total) * 100) : 0}%</span>
                                </div>
                              ))}
                              {r && !r.shared && (
                                <div>
                                  <ShareToGalleryButton small source={{ type: "rubric", id: r.id, version: r.version }} name={r.name} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!competition.stages.length && <span className="muted">{t("funderCompetition.rubricsAreChosenPer")}</span>}
                      </div>
                    </section>
                    <ReviewerPool competitionId={competition.id} stages={competition.stages} base={base} />
                  </div>

                  <section className="card" aria-labelledby="launch-title">
                    <div className="card-h">
                      <h3 id="launch-title">{t("funderCompetition.launchChecklist")}</h3>
                    </div>
                    <div className="card-b" style={{ padding: "8px 20px 16px" }}>
                      {checklist && <ReadinessChecklist checklist={checklist} />}
                    </div>
                    <div className="card-f" style={{ justifyContent: "space-between" }}>
                      <span className="small muted">
                        {competition.status === "draft"
                          ? checklist?.ready
                            ? t("funderCompetition.everythingIsReady")
                            : t("funderCompetition.openingIsAvailableWhen")
                          : competition.status === "open"
                            ? t("funderCompetition.thisCompetitionIsOpen")
                            : t("funderCompetition.thisCompetitionIsClosed")}
                      </span>
                      {competition.status === "draft" && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={!checklist?.ready || open.state === "saving"}
                          aria-describedby="launch-title"
                          onClick={async () => {
                            if (await open.run(competition.id)) data.reload();
                          }}
                        >
                          {t("funderCompetition.openCompetition")}
                        </button>
                      )}
                      {competition.status !== "draft" && opportunity.published && (
                        <Link to={publicPath} className="btn btn-sm btn-primary">
                          {t("funderCompetition.viewPublicPage")}
                        </Link>
                      )}
                    </div>
                  </section>
                </div>
              </>
            )}

            {editing && competition && (
              <StagesDialog
                competition={competition}
                forms={loaded.forms}
                rubrics={loaded.rubrics}
                onClose={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  data.reload();
                }}
              />
            )}
          </>
        )}
      </main>
    </FunderShell>
  );
}
