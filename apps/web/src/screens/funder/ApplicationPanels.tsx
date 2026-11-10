// SPDX-License-Identifier: AGPL-3.0-only
// Right-rail panels of the funder's application detail that read across the submitted forms: the
// proposed budget, the attached documents, and the drafting assistant. The first two are found in
// the responses themselves (a budget table is a list of category rows with money amounts; a file
// is a reference to an uploaded document or to one in the applicant's Passport locker), so they
// work for any form a funder builds. The assistant only drafts: nothing here is saved or sent.
import { useState } from "react";
import { BadgeCheck, Sparkles } from "lucide-react";
import type { InboxApplication } from "../../api/funder.ts";
import type { ComparisonDraft, SummaryDraft } from "../../api/funderFull.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { ErrorBanner } from "../../components/ui.tsx";
import { formatMinor } from "../../lib/format.ts";

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
      if (rows.every((x): x is BudgetRow => x !== null)) out.push({ form: r.formTitle ?? "Form", field: words(field), rows });
    }
  }
  return out;
}

function documentOf(v: unknown): Omit<FoundDocument, "form" | "field"> | null {
  if (!isObject(v)) return null;
  const passport = typeof v.passportDocumentId === "string";
  if (!passport && typeof v.documentId !== "string") return null;
  return { name: typeof v.name === "string" ? v.name : passport ? "Passport locker document" : "Uploaded document", source: passport ? "passport" : "upload", sha256: typeof v.sha256 === "string" ? v.sha256 : null };
}

/** Every file reference in the application's responses, whether a single field or a list. */
export function findDocuments(app: InboxApplication): FoundDocument[] {
  const out: FoundDocument[] = [];
  for (const r of app.formResponses ?? []) {
    for (const [field, value] of Object.entries(r.response ?? {})) {
      for (const candidate of Array.isArray(value) ? value : [value]) {
        const doc = documentOf(candidate);
        if (doc) out.push({ form: r.formTitle ?? "Form", field: words(field), ...doc });
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
        <h3>Budget</h3>
        {requested !== null && <span className="small muted">Requested {formatMinor(requested, app.currency)}</span>}
      </div>
      {!budgets.length && (
        <div className="card-b">
          <p className="muted small">None of this application’s forms has a budget table{requested !== null ? "; the requested amount is the only figure." : "."}</p>
        </div>
      )}
      {budgets.map((b) => {
        const total = b.rows.reduce((n, r) => n + r.amountMinor, 0);
        const over = requested !== null && total > requested;
        return (
          <div key={`${b.form}-${b.field}`}>
            <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={`${b.field}, scrollable`}>
              <table className="tbl bud" aria-label={`${b.field} · ${b.form}`}>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Amount</th>
                    <th>Notes</th>
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
                    <td>Total</td>
                    <td className={over ? "num over" : "num"}>{formatMinor(total, b.rows[0]?.currency ?? app.currency)}</td>
                    <td>{over ? `Exceeds the requested amount by ${formatMinor(total - requested, app.currency)}` : ""}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="card-f small muted">From “{b.form}”</div>
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
        <h3>Documents</h3>
        <span className="small muted">{docs.length === 1 ? "1 file" : `${docs.length} files`}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {!docs.length && <p className="muted small">No files are attached to this application.</p>}
        {docs.map((d, i) => {
          const ext = /\.([a-z0-9]{2,4})$/i.exec(d.name)?.[1]?.toLowerCase() ?? "";
          const kind = ext === "pdf" ? "ft-pdf" : ["xls", "xlsx", "csv"].includes(ext) ? "ft-xls" : ["doc", "docx"].includes(ext) ? "ft-doc" : "";
          return (
            <div key={i} className="doc">
              <span className={`ft ${kind}`.trim()}>{ext ? ext.slice(0, 3).toUpperCase() : "FILE"}</span>
              <div className="grow">
                <div className="nm">{d.name}</div>
                <div className="mt">
                  <span>{d.field}</span>
                  <span>·</span>
                  {d.source === "passport" ? (
                    <span className="prov prov-passport">
                      <BadgeCheck className="ic" aria-hidden="true" />
                      Passport locker
                    </span>
                  ) : (
                    <span className="prov prov-entered">Uploaded</span>
                  )}
                  {d.sha256 && (
                    <>
                      <span>·</span>
                      <span className="mono">sha256 {shortHash(d.sha256)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {docs.some((d) => d.source === "passport") && <p className="small muted">Passport locker files are referenced, not copied. The applicant keeps them current in Passport.</p>}
      </div>
    </div>
  );
}

/**
 * The drafting assistant. Rendered only when the install has it switched on. Each draft counts
 * against the workspace's monthly quota and is shown with a "review before use" mark; applicant
 * text appears only as attributed quotes.
 */
export function AssistantPanel({ app, rubricId, criterionLabel }: { app: InboxApplication; rubricId: string | null; criterionLabel: (key: string) => string }) {
  const status = useApiQuery((api) => api.assistStatus(), []);
  const [summary, setSummary] = useState<SummaryDraft | null>(null);
  const [comparison, setComparison] = useState<ComparisonDraft | null>(null);
  const summarize = useApiMutation((api) => api.assistSummarize(app.id));
  const compare = useApiMutation((api) => api.assistCompareRubric(app.id, rubricId!));
  if (!status.data?.enabled) return null;
  const quota = comparison?.quota ?? summary?.quota ?? status.data.quota;
  const latest = summary && comparison ? (summary.quota.used >= comparison.quota.used ? summary.quota : comparison.quota) : quota;
  const spent = !!latest && latest.remaining <= 0;
  return (
    <section className="assist" aria-labelledby="assist-h">
      <div className="hd">
        <Sparkles className="ic" aria-hidden="true" style={{ color: "var(--s-agent-fg)" }} />
        <span id="assist-h">Assistant</span>
        <span className="draft-mark">Draft — review before use</span>
        {latest && (
          <span className="quota">
            {latest.used} of {latest.limit} this month
          </span>
        )}
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
        <p className="muted small">Drafts are written from this application’s answers. Nothing is saved, sent or scored; applicant text is quoted as written and has not been verified.</p>
        <div className="row wrap" style={{ gap: "8px" }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={spent || summarize.state === "saving"}
            onClick={async () => {
              const r = await summarize.run();
              if (r) setSummary(r);
            }}
          >
            {summarize.state === "saving" ? "Drafting…" : "Summarize"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={spent || !rubricId || compare.state === "saving"}
            title={rubricId ? undefined : "This stage has no rubric"}
            onClick={async () => {
              const r = await compare.run();
              if (r) setComparison(r);
            }}
          >
            {compare.state === "saving" ? "Drafting…" : "Compare to rubric"}
          </button>
        </div>
        {spent && <p className="help">This month’s drafts are used up. The count resets on {new Date(latest.resetsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.</p>}
        {(summarize.error !== null || compare.error !== null) && <ErrorBanner error={summarize.error ?? compare.error} title="The assistant could not draft this" />}
        {summary && (
          <div className="col" style={{ gap: "8px" }} aria-label="Summary draft" role="group">
            <h4>Summary</h4>
            <p>{summary.summary}</p>
            {summary.strengths.length > 0 && <DraftList title="Strengths" items={summary.strengths} />}
            {summary.openQuestions.length > 0 && <DraftList title="Open questions" items={summary.openQuestions} />}
            {summary.quotes.map((q, i) => (
              <blockquote key={i} className="cmt" style={{ margin: 0 }}>
                <span className="fld-ref">Applicant-supplied · {q.field}</span>
                <span className="bd">“{q.text}”</span>
              </blockquote>
            ))}
            {summary.fromExternalSystems.map((x, i) => (
              <p key={i} className="small">
                <span className="tag">{x.server}</span> {x.note}
              </p>
            ))}
            <Cautions items={summary.cautions} />
          </div>
        )}
        {comparison && (
          <div className="col" style={{ gap: "8px" }} aria-label="Rubric comparison draft" role="group">
            <h4>Against the rubric</h4>
            {comparison.criteria.map((c) => (
              <div key={c.key} className="col" style={{ gap: "4px" }}>
                <div className="b">{criterionLabel(c.key)}</div>
                <p>{c.observations}</p>
                {c.evidence.map((q, i) => (
                  <blockquote key={i} className="cmt" style={{ margin: 0 }}>
                    <span className="fld-ref">Applicant-supplied · {q.field}</span>
                    <span className="bd">“{q.text}”</span>
                  </blockquote>
                ))}
                {c.gaps.length > 0 && <DraftList title="Not addressed" items={c.gaps} />}
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
