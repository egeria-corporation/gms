// SPDX-License-Identifier: AGPL-3.0-only
// Right-rail panels of the funder's application detail that read across the submitted forms: the
// proposed budget, the attached documents, and the drafting assistant. The first two are found in
// the responses themselves (a budget table is a list of category rows with money amounts; a file
// is a reference to an uploaded document or to one in the applicant's Passport locker), so they
// work for any form a funder builds. The assistant only drafts: nothing here is saved or sent.
import { useState } from "react";
import { BadgeCheck, Sparkles, TriangleExclamationPoint } from "lucide-react";
import type { InboxApplication } from "../../api/funder.ts";
import type { AiSummary, ComparisonDraft } from "../../api/funderFull.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { ErrorBanner } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { intlLocale } from "../../i18n/index.tsx";
import { t } from "./i18n.ts";

interface BudgetRow {
  category: string;
  label?: string;
  amountMinor: number;
  currency: string;
  notes?: string;
}
interface FoundBudget {
  form: string;
  field: string;
  rows: BudgetRow[];
}
export interface FoundDocument {
  form: string;
  field: string;
  name: string;
  source: "upload" | "passport";
  sha256: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

function budgetRow(v: unknown): BudgetRow | null {
  if (!isObject(v) || typeof v.category !== "string" || !isObject(v.amount)) return null;
  const amount = Number(v.amount.amount);
  if (!Number.isFinite(amount) || typeof v.amount.currency !== "string") return null;
  return { category: v.category, ...(typeof v.label === "string" ? { label: v.label } : {}), amountMinor: Math.round(amount * 100), currency: v.amount.currency, ...(typeof v.notes === "string" ? { notes: v.notes } : {}) };
}

/** Every budget table in the application's responses. */
export function findBudgets(app: InboxApplication): FoundBudget[] {
  const out: FoundBudget[] = [];
  for (const r of app.formResponses ?? []) {
    for (const [field, value] of Object.entries(r.response ?? {})) {
      if (!Array.isArray(value) || !value.length) continue;
      const rows = value.map(budgetRow);
      if (rows.every((x): x is BudgetRow => x !== null)) out.push({ form: r.formTitle ?? t("applicationPanels.form"), field: words(field), rows });
    }
  }
  return out;
}

function documentOf(v: unknown): Omit<FoundDocument, "form" | "field"> | null {
  if (!isObject(v)) return null;
  const passport = typeof v.passportDocumentId === "string";
  if (!passport && typeof v.documentId !== "string") return null;
  return { name: typeof v.name === "string" ? v.name : passport ? t("applicationPanels.passportLockerDocument") : t("applicationPanels.uploadedDocument"), source: passport ? "passport" : "upload", sha256: typeof v.sha256 === "string" ? v.sha256 : null };
}

/** Every file reference in the application's responses, whether a single field or a list. */
export function findDocuments(app: InboxApplication): FoundDocument[] {
  const out: FoundDocument[] = [];
  for (const r of app.formResponses ?? []) {
    for (const [field, value] of Object.entries(r.response ?? {})) {
      for (const candidate of Array.isArray(value) ? value : [value]) {
        const doc = documentOf(candidate);
        if (doc) out.push({ form: r.formTitle ?? t("applicationPanels.form"), field: words(field), ...doc });
      }
    }
  }
  return out;
}

export function BudgetPanel({ app }: { app: InboxApplication }) {
  const budgets = findBudgets(app);
  const requested = app.requestedAmountMinor;
  return (
    <div className="card">
      <div className="card-h">
        <h3>{t("applicationPanels.budget")}</h3>
        {requested !== null && <span className="small muted">{t("applicationPanels.requested", { amount: formatMinor(requested, app.currency) })}</span>}
      </div>
      {!budgets.length && (
        <div className="card-b">
          <p className="muted small">{requested !== null ? t("applicationPanels.noBudgetTableRequestedOnly") : t("applicationPanels.noBudgetTable")}</p>
        </div>
      )}
      {budgets.map((b) => {
        const total = b.rows.reduce((n, r) => n + r.amountMinor, 0);
        const over = requested !== null && total > requested;
        return (
          <div key={`${b.form}-${b.field}`}>
            <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("applicationPanels.scrollable", { field: b.field })}>
              <table className="tbl bud" aria-label={`${b.field} · ${b.form}`}>
                <thead>
                  <tr>
                    <th>{t("applicationPanels.category")}</th>
                    <th className="num">{t("applicationPanels.amount")}</th>
                    <th>{t("applicationPanels.notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.label ?? words(r.category)}</td>
                      <td className="num">{formatMinor(r.amountMinor, r.currency)}</td>
                      <td style={{ whiteSpace: "normal" }}>{r.notes ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{t("applicationPanels.total")}</td>
                    <td className={over ? "num over" : "num"}>{formatMinor(total, b.rows[0]?.currency ?? app.currency)}</td>
                    <td>{over ? t("applicationPanels.exceedsTheRequestedAmount", { amount: formatMinor(total - requested, app.currency) }) : ""}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="card-f small muted">{t("applicationPanels.from", { form: b.form })}</div>
          </div>
        );
      })}
    </div>
  );
}

const shortHash = (sha: string) => `${sha.slice(0, 4)}…${sha.slice(-4)}`;

export function DocumentsPanel({ app }: { app: InboxApplication }) {
  const docs = findDocuments(app);
  return (
    <div className="card">
      <div className="card-h">
        <h3>{t("applicationPanels.documents")}</h3>
        <span className="small muted">{t("applicationPanels.fileCount", { count: docs.length })}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {!docs.length && <p className="muted small">{t("applicationPanels.noFilesAreAttached")}</p>}
        {docs.map((d, i) => {
          const ext = /\.([a-z0-9]{2,4})$/i.exec(d.name)?.[1]?.toLowerCase() ?? "";
          const kind = ext === "pdf" ? "ft-pdf" : ["xls", "xlsx", "csv"].includes(ext) ? "ft-xls" : ["doc", "docx"].includes(ext) ? "ft-doc" : "";
          return (
            <div key={i} className="doc">
              <span className={`ft ${kind}`.trim()}>{ext ? ext.slice(0, 3).toUpperCase() : t("applicationPanels.file")}</span>
              <div className="grow">
                <div className="nm">{d.name}</div>
                <div className="mt">
                  <span>{d.field}</span>
                  <span>·</span>
                  {d.source === "passport" ? (
                    <span className="prov prov-passport">
                      <BadgeCheck className="ic" aria-hidden="true" />
                      {t("applicationPanels.passportLocker")}
                    </span>
                  ) : (
                    <span className="prov prov-entered">{t("applicationPanels.uploaded")}</span>
                  )}
                  {d.sha256 && (
                    <>
                      <span>·</span>
                      <span className="mono">{t("applicationPanels.sha256", { shortHash: shortHash(d.sha256) })}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {docs.some((d) => d.source === "passport") && <p className="small muted">{t("applicationPanels.passportLockerFilesAre")}</p>}
      </div>
    </div>
  );
}

/**
 * The AI summary (v1.7.0), open on the review screen whenever the assistant is on, and gone when
 * it is off. It is written once for this version of the answers, on the first request, and every
 * reviewer then reads the same one without spending the month's quota again. It describes the
 * application; it never scores, ranks or decides, and it says to review it before relying on it.
 */
export function AiSummaryPanel({ applicationId }: { applicationId: string }) {
  const status = useApiQuery((api) => api.assistStatus(), []);
  const enabled = status.status === "ready" && status.data.enabled;
  const kept = useApiQuery((api) => (enabled ? api.aiSummary(applicationId) : Promise.resolve(null)), [applicationId, enabled]);
  const write = useApiMutation((api) => api.writeAiSummary(applicationId));
  const [written, setWritten] = useState<AiSummary | null>(null);
  if (!enabled) return null;
  const view = written ?? (kept.status === "ready" ? kept.data : null);
  const s = view?.summary ?? null;
  const spent = !!view && view.quota.remaining <= 0;
  return (
    <section className="assist" aria-labelledby="ai-summary-h">
      <div className="hd">
        <Sparkles className="ic" aria-hidden="true" style={{ color: "var(--s-agent-fg)" }} />
        <span id="ai-summary-h">{t("applicationPanels.aiSummary")}</span>
        <span className="draft-mark">
          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
          {view?.label ?? t("applicationPanels.reviewBeforeRelyingOn")}
        </span>
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
        {kept.status === "loading" && !written ? <p className="muted small" role="status">{t("applicationPanels.lookingForThisApplications")}</p> : null}
        {kept.status === "error" ? <ErrorBanner error={kept.error} onRetry={kept.reload} title={t("applicationPanels.theSummaryCouldNot")} /> : null}
        {s ? (
          <div className="col" style={{ gap: "8px" }} aria-label={t("applicationPanels.aiSummaryOfThis")} role="group">
            <p>{s.summary}</p>
            {s.strengths.length > 0 && <DraftList title={t("applicationPanels.strengths")} items={s.strengths} />}
            {s.openQuestions.length > 0 && <DraftList title={t("applicationPanels.openQuestions")} items={s.openQuestions} />}
            {s.quotes.map((q, i) => (
              <blockquote key={i} className="cmt" style={{ margin: 0 }}>
                <span className="fld-ref">{t("applicationPanels.applicantSupplied", { field: q.field })}</span>
                <span className="bd">“{q.text}”</span>
              </blockquote>
            ))}
            {s.fromExternalSystems.map((x, i) => (
              <p key={i} className="small">
                <span className="tag">{x.server}</span> {x.note}
              </p>
            ))}
            <Cautions items={s.cautions} />
            <p className="small muted">
              {view?.generatedAt ? t("applicationPanels.writtenOnFromThisVersion", { date: formatDate(view.generatedAt) }) : t("applicationPanels.writtenFromThisVersion")}
            </p>
          </div>
        ) : view ? (
          <>
            <p className="muted small">{t("applicationPanels.noSummaryYetFor", { remaining: view.quota.remaining })}</p>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ alignSelf: "flex-start" }}
              disabled={spent || write.state === "saving"}
              onClick={async () => {
                const r = await write.run();
                if (r) setWritten(r);
              }}
            >
              <Sparkles className="ic" aria-hidden="true" />
              {write.state === "saving" ? t("applicationPanels.writing") : t("applicationPanels.writeTheSummary")}
            </button>
            {spent && <p className="help">{t("applicationPanels.thisMonthsDraftsAre", { date: new Date(view.quota.resetsAt).toLocaleDateString(intlLocale(), { month: "short", day: "numeric", timeZone: "UTC" }) })}</p>}
          </>
        ) : null}
        {write.error !== null && <ErrorBanner error={write.error} title={t("applicationPanels.theAssistantCouldNot")} />}
      </div>
    </section>
  );
}

/**
 * The drafting assistant. Rendered only when the install has it switched on. Each draft counts
 * against the workspace's monthly quota and is shown with a "review before use" mark; applicant
 * text appears only as attributed quotes. The summary lives in the AI summary panel above.
 */
export function AssistantPanel({ app, rubricId, criterionLabel }: { app: InboxApplication; rubricId: string | null; criterionLabel: (key: string) => string }) {
  const status = useApiQuery((api) => api.assistStatus(), []);
  const [comparison, setComparison] = useState<ComparisonDraft | null>(null);
  const compare = useApiMutation((api) => api.assistCompareRubric(app.id, rubricId!));
  if (!status.data?.enabled) return null;
  const latest = comparison?.quota ?? status.data.quota;
  const spent = !!latest && latest.remaining <= 0;
  return (
    <section className="assist" aria-labelledby="assist-h">
      <div className="hd">
        <Sparkles className="ic" aria-hidden="true" style={{ color: "var(--s-agent-fg)" }} />
        <span id="assist-h">{t("applicationPanels.assistant")}</span>
        <span className="draft-mark">{t("applicationPanels.draftReviewBeforeUse")}</span>
        {latest && (
          <span className="quota">
            {t("applicationPanels.ofThisMonth", { used: latest.used, limit: latest.limit })}
          </span>
        )}
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
        <p className="muted small">{t("applicationPanels.draftsAreWrittenFrom")}</p>
        <div className="row wrap" style={{ gap: "8px" }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={spent || !rubricId || compare.state === "saving"}
            title={rubricId ? undefined : t("applicationPanels.thisStageHasNo")}
            onClick={async () => {
              const r = await compare.run();
              if (r) setComparison(r);
            }}
          >
            {compare.state === "saving" ? t("applicationPanels.drafting") : t("applicationPanels.compareToRubric")}
          </button>
        </div>
        {spent && <p className="help">{t("applicationPanels.thisMonthsDraftsAre", { date: new Date(latest.resetsAt).toLocaleDateString(intlLocale(), { month: "short", day: "numeric", timeZone: "UTC" }) })}</p>}
        {compare.error !== null && <ErrorBanner error={compare.error} title={t("applicationPanels.theAssistantCouldNot2")} />}
        {comparison && (
          <div className="col" style={{ gap: "8px" }} aria-label={t("applicationPanels.rubricComparisonDraft")} role="group">
            <h4>{t("applicationPanels.againstTheRubric")}</h4>
            {comparison.criteria.map((c) => (
              <div key={c.key} className="col" style={{ gap: "4px" }}>
                <div className="b">{criterionLabel(c.key)}</div>
                <p>{c.observations}</p>
                {c.evidence.map((q, i) => (
                  <blockquote key={i} className="cmt" style={{ margin: 0 }}>
                    <span className="fld-ref">{t("applicationPanels.applicantSupplied", { field: q.field })}</span>
                    <span className="bd">“{q.text}”</span>
                  </blockquote>
                ))}
                {c.gaps.length > 0 && <DraftList title={t("applicationPanels.notAddressed")} items={c.gaps} />}
              </div>
            ))}
            <Cautions items={comparison.cautions} />
          </div>
        )}
      </div>
    </section>
  );
}

function DraftList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="eyebrow">{title}</div>
      <ul style={{ listStyle: "disc", paddingLeft: "18px", marginTop: "4px" }}>
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function Cautions({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <p className="small muted">{items.join(" ")}</p>;
}
