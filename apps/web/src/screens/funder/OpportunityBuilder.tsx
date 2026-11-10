// SPDX-License-Identifier: AGPL-3.0-only
// Opportunity builder: basics, funding, dates, who can apply, then publish. One draft is edited
// across the steps and saved through `/gms/opportunities`; publishing validates the CommonGrants
// record on the server. `/opportunities/new` creates; `/opportunities/:id/edit` edits (the id may
// also be the opportunity's slug).
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Clock, Eye } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { CgEvent, Opportunity, OpportunityInput, OppFunding, Program } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { ErrorBanner, Field, Loading, Notice, PageHeader, problemFor, SaveNote } from "../../components/ui.tsx";
import { applicantTypeLabel, formatAwardCount, formatAwardRange, formatDate, parseDollars, slugify } from "../../lib/format.ts";
import { rowsToRules, rulesToRows, type RuleRow } from "../../lib/rules.ts";
import { ApplicantTypes, EligibilityDryRun, rowProblem, RuleRows } from "./EligibilityEditor.tsx";

const STEPS = [
  { key: "basics", title: "Basics", hint: "Title, summary, program" },
  { key: "funding", title: "Funding", hint: "Award range and count" },
  { key: "dates", title: "Dates", hint: "Opens, closes, decision" },
  { key: "who", title: "Who can apply", hint: "Applicant types and rules" },
  { key: "publish", title: "Publish", hint: "Targets and public page" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];
const isStep = (v: string): v is StepKey => STEPS.some((s) => s.key === v);

interface Draft {
  title: string;
  slug: string;
  description: string;
  programId: string;
  total: string;
  min: string;
  max: string;
  minCount: string;
  maxCount: string;
  fundingDetails: string;
  opens: string;
  closes: string;
  closesName: string;
  decision: string;
  periodStart: string;
  types: string[];
  rows: RuleRow[];
  publicPage: boolean;
  openGrantsIndex: boolean;
  sitemap: boolean;
}

const dollars = (m: { amount: string } | undefined) => (m ? String(Number(m.amount)) : "");
const other = (o: Opportunity | undefined, key: string) => o?.keyDates.otherDates?.[key]?.date ?? "";

function draftOf(o: Opportunity | undefined, programId: string): Draft {
  return {
    title: o?.title ?? "",
    slug: o?.slug ?? "",
    description: o?.description ?? "",
    programId: o?.programId ?? programId,
    total: dollars(o?.funding.totalAmountAvailable),
    min: dollars(o?.funding.minAwardAmount),
    max: dollars(o?.funding.maxAwardAmount),
    minCount: o?.funding.minAwardCount ? String(o.funding.minAwardCount) : "",
    maxCount: o?.funding.maxAwardCount ? String(o.funding.maxAwardCount) : "",
    fundingDetails: o?.funding.details ?? "",
    opens: o?.keyDates.postDate?.date ?? "",
    closes: o?.keyDates.closeDate?.date ?? "",
    closesName: o?.keyDates.closeDate?.name ?? "Closes",
    decision: other(o, "decision"),
    periodStart: other(o, "periodStart"),
    types: o?.acceptedApplicantTypes ?? ["non_profit_with_501c3"],
    rows: rulesToRows(o?.eligibilityRules),
    publicPage: o?.publish.publicPage !== false,
    openGrantsIndex: o?.publish.openGrantsIndex !== false,
    sitemap: o?.publish.sitemap !== false,
  };
}

type Errors = Partial<Record<keyof Draft, string>>;

function check(d: Draft): Errors {
  const e: Errors = {};
  if (!d.title.trim()) e.title = "Give the opportunity a title";
  if (d.slug && !/^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/.test(d.slug)) e.slug = "Use lowercase letters, digits and hyphens";
  for (const key of ["total", "min", "max"] as const) if (d[key].trim() && parseDollars(d[key]) === null) e[key] = "Enter an amount in dollars";
  const min = parseDollars(d.min);
  const max = parseDollars(d.max);
  if (min !== null && max !== null && d.min.trim() && d.max.trim() && min > max) e.max = "The largest award is smaller than the smallest";
  for (const key of ["minCount", "maxCount"] as const) if (d[key].trim() && !/^\d+$/.test(d[key].trim())) e[key] = "Enter a whole number";
  if (d.opens && d.closes && d.opens >= d.closes) e.closes = "The closing date must be after the opening date";
  return e;
}

const STEP_FIELDS: Record<StepKey, (keyof Draft)[]> = {
  basics: ["title", "slug", "description", "programId"],
  funding: ["total", "min", "max", "minCount", "maxCount"],
  dates: ["opens", "closes"],
  who: ["rows"],
  publish: [],
};

function toInput(d: Draft): OpportunityInput {
  const money = (text: string) => {
    const minor = text.trim() ? parseDollars(text) : null;
    return minor === null ? undefined : { amount: String(minor / 100), currency: "USD" };
  };
  const funding: OppFunding = {};
  const total = money(d.total);
  const min = money(d.min);
  const max = money(d.max);
  if (total) funding.totalAmountAvailable = total;
  if (min) funding.minAwardAmount = min;
  if (max) funding.maxAwardAmount = max;
  if (d.minCount.trim()) funding.minAwardCount = Number(d.minCount);
  if (d.maxCount.trim()) funding.maxAwardCount = Number(d.maxCount);
  if (d.fundingDetails.trim()) funding.details = d.fundingDetails.trim();
  const day = (name: string, date: string): CgEvent => ({ name, eventType: "singleDate", date });
  const otherDates: Record<string, CgEvent> = {};
  if (d.decision) otherDates.decision = day("Decisions announced", d.decision);
  if (d.periodStart) otherDates.periodStart = day("Grant period starts", d.periodStart);
  return {
    title: d.title.trim(),
    ...(d.slug ? { slug: d.slug } : {}),
    description: d.description.trim(),
    programId: d.programId || null,
    funding,
    keyDates: { ...(d.opens ? { postDate: day("Opens", d.opens) } : {}), ...(d.closes ? { closeDate: day(d.closesName.trim() || "Closes", d.closes) } : {}), ...(Object.keys(otherDates).length ? { otherDates } : {}) },
    acceptedApplicantTypes: d.types,
    eligibilityRules: rowsToRules(d.rows),
    publish: { publicPage: d.publicPage, openGrantsIndex: d.openGrantsIndex, sitemap: d.sitemap },
  };
}

function PreviewCard({ draft, brand }: { draft: Draft; brand: { accent: string; onAccent: string } }) {
  const input = toInput(draft);
  const count = formatAwardCount(input.funding);
  return (
    <section className="card" aria-labelledby="preview-card-title">
      <div className="card-h" style={{ padding: "12px 16px" }}>
        <h3 id="preview-card-title" style={{ fontSize: "14px" }}>
          Live preview · public card
        </h3>
      </div>
      <div className="card-b" style={{ padding: "14px 16px" }}>
        <div className="pub" style={{ fontSize: "15px", "--tenant": brand.accent, "--on-tenant": brand.onAccent, background: "transparent" } as CSSProperties}>
          <div className="oc" style={{ padding: "18px" }}>
            <span className="eyebrow">{draft.closes ? `${draft.closesName} ${formatDate(draft.closes)}` : "No closing date"}</span>
            <h3 style={{ fontSize: "17px" }}>{draft.title || "Untitled opportunity"}</h3>
            <div className="amt" style={{ fontSize: "18px" }}>
              {formatAwardRange(input.funding)}
            </div>
            <div className="meta" style={{ fontSize: "13px" }}>
              {count && <span>{count}</span>}
              <span>{draft.types.map(applicantTypeLabel).join(", ") || "No applicant types chosen"}</span>
            </div>
            <span className="btn btn-tenant btn-sm" style={{ alignSelf: "flex-start" }} aria-hidden="true">
              Apply with Passport
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Builder({ opportunity, programs, onSaved }: { opportunity: Opportunity | undefined; programs: Program[]; onSaved: (o: Opportunity) => void }) {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const [draft, setDraft] = useState<Draft>(() => draftOf(opportunity, search.get("program") ?? ""));
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const hash = location.hash.slice(1);
  const step: StepKey = isStep(hash) ? hash : "basics";
  const goto = (key: StepKey) => navigate({ hash: key }, { replace: true });

  const errors = useMemo(() => {
    const e = check(draft);
    if (draft.rows.some((r) => rowProblem(r))) e.rows = "Finish or remove the incomplete rule";
    return e;
  }, [draft]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const text = (key: keyof Draft) => ({ value: draft[key] as string, onChange: (e: { target: { value: string } }) => set(key, e.target.value as never) });
  const err = (key: keyof Draft) => (showErrors ? (errors[key] ?? null) : null);

  const save = useApiMutation((api, input: OpportunityInput) => (opportunity ? api.updateOpportunity(opportunity.id, input) : api.createOpportunity(input)));
  const publish = useApiMutation((api, id: string, status: "forecasted" | "open") => api.publishOpportunity(id, status));
  const close = useApiMutation((api, id: string) => api.closeOpportunity(id));

  async function saveDraft(): Promise<Opportunity | undefined> {
    setShowErrors(true);
    if (Object.keys(errors).length) {
      const firstBad = STEPS.find((s) => STEP_FIELDS[s.key].some((f) => errors[f]));
      if (firstBad) goto(firstBad.key);
      return undefined;
    }
    const saved = await save.run(toInput(draft));
    if (saved) {
      setDirty(false);
      setDraft((d) => ({ ...d, slug: saved.slug }));
      onSaved(saved);
    }
    return saved;
  }
  async function publishAs(status: "forecasted" | "open") {
    const saved = dirty || !opportunity ? await saveDraft() : opportunity;
    if (!saved) return;
    const live = await publish.run(saved.id, status);
    if (live) onSaved(live);
  }

  const stepDone = (key: StepKey) => {
    if (STEP_FIELDS[key].some((f) => errors[f])) return false;
    if (key === "basics") return !!draft.title.trim() && !!draft.description.trim();
    if (key === "funding") return !!draft.max.trim() || !!draft.min.trim();
    if (key === "dates") return !!draft.closes;
    if (key === "who") return draft.types.length > 0;
    return !!opportunity?.published;
  };
  const index = STEPS.findIndex((s) => s.key === step);
  const prev = STEPS[index - 1];
  const next = STEPS[index + 1];
  const program = programs.find((p) => p.id === draft.programId);
  const publicPath = opportunity ? `/f/${ws.handle}/o/${opportunity.slug}` : null;
  const writeError = save.error ?? publish.error ?? close.error;

  return (
    <main className="main">
      <PageHeader
        crumbs={[{ label: ws.name, to: base }, { label: "Opportunities", to: `${base}/opportunities` }, { label: opportunity?.title ?? "New opportunity" }]}
        title="Opportunity builder"
        badge={
          <>
            {opportunity ? <StatusBadge kind="opportunity" status={opportunity.status} label={opportunity.published ? undefined : "Draft"} /> : <StatusBadge kind="form" status="draft" />}
            {dirty && (
              <span className="pill-warn">
                <Clock className="ic ic-sm" aria-hidden="true" />
                Unsaved changes
              </span>
            )}
          </>
        }
        meta={
          <>
            <span>{draft.title || "Untitled opportunity"}</span>
            {program && (
              <>
                <span>·</span>
                <span>Program: {program.name}</span>
              </>
            )}
            <SaveNote state={save.state === "saving" ? "saving" : !dirty && save.state === "saved" ? "saved" : "idle"} />
          </>
        }
        actions={
          <>
            {publicPath && opportunity?.published && (
              <Link to={publicPath} className="btn btn-secondary">
                <Eye className="ic" aria-hidden="true" />
                Open public page
              </Link>
            )}
            <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={save.state === "saving"}>
              Save draft
            </button>
            {opportunity && (
              <Link to={`${base}/opportunities/${opportunity.id}/competition`} className="btn btn-primary">
                Competition &amp; stages
                <ArrowRight className="ic" aria-hidden="true" />
              </Link>
            )}
          </>
        }
      />
      {writeError !== null && <ErrorBanner error={writeError} />}

      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr) 360px", gap: "20px", alignItems: "start" }}>
        <nav className="card" style={{ padding: "18px 16px" }} aria-label="Builder steps">
          <div className="eyebrow" style={{ marginBottom: "14px" }}>
            Steps
          </div>
          <ol className="stp-v">
            {STEPS.map((s, i) => {
              const done = stepDone(s.key);
              const on = s.key === step;
              return (
                <li key={s.key} className={on ? "s on" : done ? "s done" : "s"}>
                  <span className="n">{done && !on ? <Check className="ic ic-sm" role="img" aria-label="Complete" /> : i + 1}</span>
                  <div>
                    <Link to={{ hash: `#${s.key}` }} replace className="t" aria-current={on ? "step" : undefined} style={{ display: "block", textDecoration: "none" }}>
                      {s.title}
                    </Link>
                    <div className="d">{s.hint}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="card" id={step} aria-labelledby="step-title">
          <div className="card-h">
            <div>
              <h2 id="step-title">{STEPS[index]!.title}</h2>
              <p className="small muted">
                {step === "basics" && "What the opportunity is called and what it funds. The summary appears on your public page and in the CommonGrants record."}
                {step === "funding" && "How much is available and the size of a typical award. Amounts are in US dollars."}
                {step === "dates" && "Key dates shown to applicants. Stage dates are set on the competition."}
                {step === "who" && "Applicant types come from the CommonGrants list. Rules are evaluated against each organization's Passport record and shown to applicants in plain language."}
                {step === "publish" && "Where the opportunity is listed once it is published."}
              </p>
            </div>
          </div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {step === "basics" && (
              <>
                <Field id="opp-title" label="Title" required error={err("title") ?? problemFor(save.error, "title")}>
                  <input className={err("title") ? "inp err" : "inp"} id="opp-title" {...text("title")} required aria-invalid={!!err("title")} />
                </Field>
                <Field id="opp-description" label="Summary" help="One or two paragraphs. Required before publishing.">
                  <textarea className="ta" id="opp-description" style={{ minHeight: "140px" }} {...text("description")} />
                </Field>
                <div className="fld-row">
                  <Field id="opp-program" label="Program" help="The budget this opportunity awards from.">
                    <select className="sel" id="opp-program" value={draft.programId} onChange={(e) => set("programId", e.target.value)}>
                      <option value="">No program</option>
                      {programs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="opp-slug" label="Public address" help={`/f/${ws.handle}/o/${draft.slug || slugify(draft.title || "your-title")}`} error={err("slug") ?? problemFor(save.error, "slug")}>
                    <input className={err("slug") ? "inp err" : "inp"} id="opp-slug" placeholder={slugify(draft.title || "your-title")} {...text("slug")} />
                  </Field>
                </div>
              </>
            )}
            {step === "funding" && (
              <>
                <Field id="opp-total" label="Total available" error={err("total")}>
                  <input className={err("total") ? "inp err" : "inp"} id="opp-total" inputMode="decimal" placeholder="1,200,000" {...text("total")} />
                </Field>
                <div className="fld-row">
                  <Field id="opp-min" label="Smallest award" error={err("min")}>
                    <input className={err("min") ? "inp err" : "inp"} id="opp-min" inputMode="decimal" placeholder="50,000" {...text("min")} />
                  </Field>
                  <Field id="opp-max" label="Largest award" error={err("max")}>
                    <input className={err("max") ? "inp err" : "inp"} id="opp-max" inputMode="decimal" placeholder="150,000" {...text("max")} />
                  </Field>
                </div>
                <div className="fld-row">
                  <Field id="opp-min-count" label="Fewest awards expected" error={err("minCount")}>
                    <input className={err("minCount") ? "inp err" : "inp"} id="opp-min-count" inputMode="numeric" {...text("minCount")} />
                  </Field>
                  <Field id="opp-max-count" label="Most awards expected" error={err("maxCount")}>
                    <input className={err("maxCount") ? "inp err" : "inp"} id="opp-max-count" inputMode="numeric" {...text("maxCount")} />
                  </Field>
                </div>
                <Field id="opp-funding-details" label="Notes on funding" help="For example: reviewed monthly, or matching funds required.">
                  <input className="inp" id="opp-funding-details" {...text("fundingDetails")} />
                </Field>
              </>
            )}
            {step === "dates" && (
              <>
                <div className="fld-row">
                  <Field id="opp-opens" label="Opens">
                    <input className="inp" id="opp-opens" type="date" {...text("opens")} />
                  </Field>
                  <Field id="opp-closes" label="Closes" help="Leave empty for a rolling opportunity." error={err("closes")}>
                    <input className={err("closes") ? "inp err" : "inp"} id="opp-closes" type="date" {...text("closes")} />
                  </Field>
                </div>
                <Field id="opp-closes-name" label="What closes on that date" help="Shown next to the date, e.g. “LOI closes”.">
                  <input className="inp" id="opp-closes-name" {...text("closesName")} />
                </Field>
                <div className="fld-row">
                  <Field id="opp-decision" label="Decisions announced">
                    <input className="inp" id="opp-decision" type="date" {...text("decision")} />
                  </Field>
                  <Field id="opp-period" label="Grant period starts">
                    <input className="inp" id="opp-period" type="date" {...text("periodStart")} />
                  </Field>
                </div>
              </>
            )}
            {step === "who" && (
              <>
                <ApplicantTypes value={draft.types} onChange={(v) => set("types", v)} />
                <RuleRows rows={draft.rows} onChange={(rows) => set("rows", rows)} />
              </>
            )}
            {step === "publish" && (
              <>
                <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                  <legend className="lbl" style={{ marginBottom: "8px" }}>
                    Publish targets
                  </legend>
                  {(
                    [
                      ["publicPage", "Public page", `Listed on /f/${ws.handle}`],
                      ["openGrantsIndex", "OpenGrants index", "Pulled by the OpenGrants importer from the CommonGrants feed"],
                      ["sitemap", "Sitemap", "Listed in sitemap.xml for search engines"],
                    ] as const
                  ).map(([key, label, help]) => (
                    <label key={key} className="cb" htmlFor={`target-${key}`}>
                      <input type="checkbox" id={`target-${key}`} checked={draft[key]} onChange={(e) => set(key, e.target.checked)} style={{ marginTop: "3px" }} />
                      <span>
                        <span className="b">{label}</span>
                        <span className="help" style={{ display: "block" }}>
                          {help}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {opportunity?.published && opportunity.status !== "closed" && publicPath && (
                  <div className="bnr bnr-ok" role="status">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div className="grow">
                      <div className="t">
                        Published · live at{" "}
                        <Link to={publicPath} className="mono" style={{ fontSize: "13px" }}>
                          {publicPath}
                        </Link>
                      </div>
                      <div className="d">Published {formatDate(opportunity.publishedAt)}. Saved changes appear on the public page at once.</div>
                    </div>
                  </div>
                )}
                {opportunity?.status === "closed" && <Notice tone="neu" title="This opportunity is closed">It no longer accepts applications and cannot be reopened.</Notice>}
                {!draft.description.trim() && <Notice tone="warn" title="Add a summary before publishing">The public page and the CommonGrants record both need one.</Notice>}
                {opportunity?.status !== "closed" && (
                  <div className="row wrap" style={{ gap: "8px" }}>
                    <button type="button" className="btn btn-primary" disabled={!draft.description.trim() || publish.state === "saving"} onClick={() => publishAs("open")}>
                      {opportunity?.published && opportunity.status === "open" ? "Publish changes" : "Publish as open"}
                    </button>
                    {!(opportunity?.published && opportunity.status === "open") && (
                      <button type="button" className="btn btn-secondary" disabled={!draft.description.trim() || publish.state === "saving"} onClick={() => publishAs("forecasted")}>
                        Publish as forecasted
                      </button>
                    )}
                    {opportunity?.published && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={close.state === "saving"}
                        onClick={async () => {
                          const closed = await close.run(opportunity.id);
                          if (closed) onSaved(closed);
                        }}
                      >
                        Close opportunity
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="card-f" style={{ justifyContent: "space-between" }}>
            {prev ? (
              <Link to={{ hash: `#${prev.key}` }} replace className="btn btn-ghost">
                <ArrowLeft className="ic" aria-hidden="true" />
                {prev.title}
              </Link>
            ) : (
              <span />
            )}
            <div className="row" style={{ gap: "8px" }}>
              <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={save.state === "saving"}>
                Save draft
              </button>
              {next && (
                <Link to={{ hash: `#${next.key}` }} replace className="btn btn-primary">
                  {next.title}
                  <ArrowRight className="ic" aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
          <PreviewCard draft={draft} brand={ws.brand} />
          {step === "who" && <EligibilityDryRun rows={draft.rows} />}
        </div>
      </div>
    </main>
  );
}

export default function OpportunityBuilder() {
  const ws = useWorkspace("funder");
  const { oppId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const data = useApiQuery(async (api) => {
    const [programs, opportunities] = await Promise.all([api.listPrograms(), oppId ? api.listOpportunities() : Promise.resolve([])]);
    // The URL may carry the id or the public slug.
    return { programs, opportunity: opportunities.find((o) => o.id === oppId || o.slug === oppId) };
  }, [ws.id, oppId]);
  const [saved, setSaved] = useState<Opportunity | null>(null);
  useEffect(() => setSaved(null), [oppId]);

  if (data.status === "ready" && oppId && !data.data.opportunity) return <NotFound />;
  const opportunity = saved ?? (data.status === "ready" ? data.data.opportunity : undefined);

  return (
    <FunderShell active="Opportunities">
      <title>{`${opportunity?.title ?? "New opportunity"} — Opportunity builder`}</title>
      {data.status === "loading" && (
        <main className="main">
          <Loading label="Loading the opportunity" />
        </main>
      )}
      {data.status === "error" && (
        <main className="main">
          <ErrorBanner error={data.error} onRetry={data.reload} title="The opportunity could not be loaded" />
        </main>
      )}
      {data.status === "ready" && (
        <Builder
          key={data.data.opportunity?.id ?? "new"}
          opportunity={opportunity}
          programs={data.data.programs}
          onSaved={(o) => {
            setSaved(o);
            // A new opportunity gets its own address once it exists.
            if (!oppId) navigate({ pathname: `/w/${ws.handle}/opportunities/${o.id}/edit`, hash: location.hash }, { replace: true });
          }}
        />
      )}
    </FunderShell>
  );
}
