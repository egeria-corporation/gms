// SPDX-License-Identifier: AGPL-3.0-only
// Opportunity builder: basics, funding, dates, who can apply, publish, then applications. One draft
// is edited across the steps and saved through `/gms/opportunities`; publishing validates the
// CommonGrants record on the server. The Applications step takes a published opportunity to one
// applicants can apply to (quick setup, the launch checklist, opening). `/opportunities/new` creates; `/opportunities/:id/edit` edits (the id may
// also be the opportunity's slug). Basics also takes the title, summary and eligibility rules in a
// second language ("Add Spanish"), for the public page and its share card (docs/forms.md,
// "Languages"); an assistant draft is reviewed before the opportunity is saved.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Clock, Eye } from "lucide-react";
import { opportunityTranslationStatus, type FormLanguage, type OpportunityTranslation, type OpportunityTranslations } from "@gms/forms";
import type { Rule } from "@gms/rules";
import { useTranslationsApi } from "../../api/translationsHooks.ts";
import type { OpportunityTextDraft } from "../../api/translations.ts";
import { LanguagePicker, RowsHead, TranslateAssist, TranslationRow } from "./TranslationParts.tsx";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { usePassportFlags } from "../../api/launchHooks.ts";
import type { CgEvent, Opportunity, OpportunityInput, OppFunding, Program } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { ApplicationsStep } from "./ApplicationsStep.tsx";
import { EmbedPanel } from "./EmbedPanel.tsx";
import { SocialPanel } from "../../components/SocialPanel.tsx";
import { SyndicationPanel } from "./SyndicationPanel.tsx";
import { competitionOf, offersApply, OpportunityStatusBadge, takingApplications } from "./applicationsStatus.tsx";
import { ErrorBanner, Field, Loading, Notice, PageHeader, problemFor, SaveNote } from "../../components/ui.tsx";
import { applicantTypeLabel, formatAwardCount, formatAwardRange, formatDate, parseDollars, slugify } from "../../lib/format.ts";
import { rowsToRules, rulesToRows, type RuleRow } from "../../lib/rules.ts";
import { ApplicantTypes, EligibilityDryRun, rowProblem, RuleRows } from "./EligibilityEditor.tsx";
import { t, useFunderMessages } from "./i18n.ts";
import { usePublicMessages } from "../../i18n/index.tsx";

const STEPS = [
  { key: "basics", get title() { return t("opportunityBuilder.step.basics.title"); }, get hint() { return t("opportunityBuilder.step.basics.hint"); } },
  { key: "funding", get title() { return t("opportunityBuilder.step.funding.title"); }, get hint() { return t("opportunityBuilder.step.funding.hint"); } },
  { key: "dates", get title() { return t("opportunityBuilder.step.dates.title"); }, get hint() { return t("opportunityBuilder.step.dates.hint"); } },
  { key: "who", get title() { return t("opportunityBuilder.step.who.title"); }, get hint() { return t("opportunityBuilder.step.who.hint"); } },
  { key: "publish", get title() { return t("opportunityBuilder.step.publish.title"); }, get hint() { return t("opportunityBuilder.step.publish.hint"); } },
  { key: "applications", get title() { return t("opportunityBuilder.step.applications.title"); }, get hint() { return t("opportunityBuilder.step.applications.hint"); } },
] as const;
type StepKey = (typeof STEPS)[number]["key"];
const isStep = (v: string): v is StepKey => STEPS.some((s) => s.key === v);
/**
 * The steps the funder has opened. A step is ticked only once it has been visited and is valid,
 * so a default (the 501(c)(3) applicant type) never ticks a step nobody looked at. Every step of
 * an opportunity saved before this visit counts as visited.
 */
type Visited = ReadonlySet<StepKey>;
const ALL_VISITED: Visited = new Set(STEPS.map((s) => s.key));

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
  requirePassport: boolean;
  acceptSelfReported: boolean;
  /** The opportunity's own language, the one added beside it (if any), and the texts in it. */
  languages: { source: FormLanguage; added: FormLanguage | null; texts: OpportunityTranslations };
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
    closesName: o?.keyDates.closeDate?.name ?? t("opportunityBuilder.date.closes"),
    decision: other(o, "decision"),
    periodStart: other(o, "periodStart"),
    types: o?.acceptedApplicantTypes ?? ["non_profit_with_501c3"],
    rows: rulesToRows(o?.eligibilityRules),
    publicPage: o?.publish.publicPage !== false,
    openGrantsIndex: o?.publish.openGrantsIndex !== false,
    sitemap: o?.publish.sitemap !== false,
    requirePassport: o?.publish.requirePassport === true,
    acceptSelfReported: o?.publish.acceptSelfReported === true,
    languages: languagesOf(o?.translations),
  };
}

function languagesOf(tr: OpportunityTranslations | undefined): Draft["languages"] {
  const source: FormLanguage = tr?.source === "es" ? "es" : "en";
  const added = (["en", "es"] as const).find((l) => l !== source && !!tr?.[l]) ?? null;
  return { source, added, texts: tr ?? {} };
}

/** The eligibility rules' labels, each once: what a funder translates. */
function ruleLabels(rule: Rule, out: string[] = []): string[] {
  if ("all" in rule) rule.all.forEach((r) => ruleLabels(r, out));
  else if ("any" in rule) rule.any.forEach((r) => ruleLabels(r, out));
  else if (rule.label?.trim() && !out.includes(rule.label)) out.push(rule.label);
  return out;
}

/** The opportunity's texts as they will be saved, and where their translation stands. */
const textStatus = (d: Draft, language: FormLanguage) =>
  opportunityTranslationStatus({ title: d.title.trim(), description: d.description.trim(), eligibility: ruleLabels(rowsToRules(d.rows)) }, d.languages.texts, language);

type OppTextKind = "title" | "description" | "eligibility";
/** Sets (or, empty, removes) one translated text; a person's text is reviewed, an assistant's is a draft. */
function setText(texts: OpportunityTranslations, language: FormLanguage, kind: OppTextKind, key: string, source: string, text: string, draft = false): OpportunityTranslations {
  const tr: OpportunityTranslation = { ...(texts[language] ?? {}), eligibility: { ...(texts[language]?.eligibility ?? {}) } };
  const value = text.trim() ? { text, source, ...(draft ? { draft: true as const } : {}) } : undefined;
  if (kind === "eligibility") {
    if (value) tr.eligibility![key] = value;
    else delete tr.eligibility![key];
  } else if (value) tr[kind] = value;
  else delete tr[kind];
  if (!Object.keys(tr.eligibility!).length) delete tr.eligibility;
  return { ...texts, [language]: tr };
}
const entryOf = (texts: OpportunityTranslations, language: FormLanguage, kind: OppTextKind, key: string) => (kind === "eligibility" ? texts[language]?.eligibility?.[key] : texts[language]?.[kind]);

type Errors = Partial<Record<keyof Draft, string>>;

function check(d: Draft): Errors {
  const e: Errors = {};
  if (!d.title.trim()) e.title = t("opportunityBuilder.problem.titleRequired");
  if (d.slug && !/^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/.test(d.slug)) e.slug = t("opportunityBuilder.problem.slugFormat");
  for (const key of ["total", "min", "max"] as const) if (d[key].trim() && parseDollars(d[key]) === null) e[key] = t("opportunityBuilder.problem.amount");
  const min = parseDollars(d.min);
  const max = parseDollars(d.max);
  if (min !== null && max !== null && d.min.trim() && d.max.trim() && min > max) e.max = t("opportunityBuilder.problem.maxBelowMin");
  for (const key of ["minCount", "maxCount"] as const) if (d[key].trim() && !/^\d+$/.test(d[key].trim())) e[key] = t("opportunityBuilder.problem.wholeNumber");
  if (d.opens && d.closes && d.opens >= d.closes) e.closes = t("opportunityBuilder.problem.closesBeforeOpens");
  // An assistant draft is never saved: the public page would show it at once.
  if (d.languages.added && textStatus(d, d.languages.added).drafts > 0) e.languages = t("translation.assist.reviewFirst");
  return e;
}

const STEP_FIELDS: Record<StepKey, (keyof Draft)[]> = {
  basics: ["title", "slug", "description", "programId", "languages"],
  funding: ["total", "min", "max", "minCount", "maxCount"],
  dates: ["opens", "closes"],
  who: ["rows"],
  publish: [],
  applications: [],
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
  // Date names are written into the opportunity, in the language the funder works in.
  if (d.decision) otherDates.decision = day(t("opportunityBuilder.date.decision"), d.decision);
  if (d.periodStart) otherDates.periodStart = day(t("opportunityBuilder.date.periodStart"), d.periodStart);
  return {
    title: d.title.trim(),
    ...(d.slug ? { slug: d.slug } : {}),
    description: d.description.trim(),
    programId: d.programId || null,
    funding,
    keyDates: { ...(d.opens ? { postDate: day(t("opportunityBuilder.date.opens"), d.opens) } : {}), ...(d.closes ? { closeDate: day(d.closesName.trim() || t("opportunityBuilder.date.closes"), d.closes) } : {}), ...(Object.keys(otherDates).length ? { otherDates } : {}) },
    acceptedApplicantTypes: d.types,
    eligibilityRules: rowsToRules(d.rows),
    publish: { publicPage: d.publicPage, openGrantsIndex: d.openGrantsIndex, sitemap: d.sitemap, requirePassport: d.requirePassport, acceptSelfReported: d.acceptSelfReported },
    translations: { ...(d.languages.source !== "en" ? { source: d.languages.source } : {}), ...(d.languages.added ? { [d.languages.added]: d.languages.texts[d.languages.added] ?? {} } : {}) },
  };
}

/** The public card as applicants will see it: Apply only when the public page offers it, else "Not taking applications yet". */
export function PreviewCard({ draft, brand, apply, closed = false }: { draft: Draft; brand: { accent: string; onAccent: string }; apply: boolean; closed?: boolean }) {
  const input = toInput(draft);
  const count = formatAwardCount(input.funding);
  return (
    <section className="card" aria-labelledby="preview-card-title">
      <div className="card-h" style={{ padding: "12px 16px" }}>
        <h3 id="preview-card-title" style={{ fontSize: "14px" }}>
          {t("opportunityBuilder.livePreviewPublicCard")}
        </h3>
      </div>
      <div className="card-b" style={{ padding: "14px 16px" }}>
        <div className="pub" style={{ fontSize: "15px", "--tenant": brand.accent, "--on-tenant": brand.onAccent, background: "transparent" } as CSSProperties}>
          <div className="oc" style={{ padding: "18px" }}>
            <span className="eyebrow">{draft.closes ? t("opportunityBuilder.closesOn", { name: draft.closesName, date: formatDate(draft.closes) }) : t("opportunityBuilder.noClosingDate")}</span>
            <h3 style={{ fontSize: "17px" }}>{draft.title || t("opportunityBuilder.untitledOpportunity")}</h3>
            <div className="amt" style={{ fontSize: "18px" }}>
              {formatAwardRange(input.funding)}
            </div>
            <div className="meta" style={{ fontSize: "13px" }}>
              {count && <span>{count}</span>}
              <span>{draft.types.map(applicantTypeLabel).join(", ") || t("opportunityBuilder.noApplicantTypesChosen")}</span>
            </div>
            {apply ? (
              <span className="btn btn-tenant btn-sm" style={{ alignSelf: "flex-start" }} aria-hidden="true">
                {t("opportunityBuilder.apply")}
              </span>
            ) : !closed ? (
              <span className="bdg bdg-neutral" style={{ alignSelf: "flex-start" }}>
                <Clock className="ic" aria-hidden="true" />
                {t("opportunityBuilder.notTakingApplicationsYet")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/** "Add Spanish" for the title, summary and eligibility rules, side by side with the funder's own text. */
function LanguagesSection({ draft, error, onChange, assist }: { draft: Draft; error: string | null; onChange: (languages: Draft["languages"]) => void; assist: ReactNode }) {
  const { source, added, texts } = draft.languages;
  const status = added ? textStatus(draft, added) : null;
  const kindOf = { title: "oppTitle", description: "oppSummary", eligibility: "oppEligibility" } as const;
  return (
    <section aria-labelledby="opp-languages-h" style={{ display: "flex", flexDirection: "column", gap: "12px", borderTop: "1px solid var(--og-gray-100)", paddingTop: "16px" }}>
      <h3 id="opp-languages-h" style={{ fontSize: "15px" }}>
        {t("opportunityBuilder.translate.heading")}
      </h3>
      <LanguagePicker
        idPrefix="opp"
        source={source}
        added={added}
        progress={status}
        readOnly={false}
        onSource={(l) => onChange({ ...draft.languages, source: l })}
        onAdd={(l) => onChange({ source, added: l, texts: { ...texts, [l]: texts[l] ?? {} } })}
        onRemove={(l) => {
          const { [l]: _gone, ...rest } = texts;
          onChange({ source, added: null, texts: rest });
        }}
      />
      {added && status && (
        <>
          <p className="small muted">{t("opportunityBuilder.translate.intro", { language: added })}</p>
          {assist}
          <RowsHead source={source} language={added} />
          <ul style={{ display: "flex", flexDirection: "column" }} aria-label={t("opportunityBuilder.translate.heading")}>
            {status.items.map((item) => (
              <TranslationRow
                key={`${item.kind}:${item.key}`}
                kind={kindOf[item.kind]}
                source={item.source}
                sourceLanguage={source}
                language={added}
                text={item.text}
                state={item.state}
                {...(item.was !== undefined ? { was: item.was } : {})}
                multiline={item.kind === "description"}
                readOnly={false}
                onText={(text) => onChange({ ...draft.languages, texts: setText(texts, added, item.kind, item.key, item.source, text) })}
                onConfirm={() => onChange({ ...draft.languages, texts: setText(texts, added, item.kind, item.key, item.source, entryOf(texts, added, item.kind, item.key)?.text ?? "") })}
              />
            ))}
          </ul>
          {error && (
            <span className="err-msg" role="alert">
              {error}
            </span>
          )}
        </>
      )}
    </section>
  );
}

/** The assistant's drafts, marked as drafts, for the texts still missing or stale (a person's text is never replaced). */
function withDrafts(d: Draft, items: readonly OpportunityTextDraft[]): { languages: Draft["languages"]; applied: number } {
  const added = d.languages.added;
  if (!added) return { languages: d.languages, applied: 0 };
  const open = new Map(textStatus(d, added).items.filter((i) => i.state === "missing" || i.state === "stale").map((i) => [`${i.kind}:${i.key}`, i]));
  let texts = d.languages.texts;
  let applied = 0;
  for (const item of items) {
    const row = open.get(`${item.kind}:${item.key}`);
    if (!row || row.source !== item.source || !item.text.trim()) continue;
    texts = setText(texts, added, item.kind, item.key, item.source, item.text, true);
    applied++;
  }
  return { languages: { ...d.languages, texts }, applied };
}

function Builder({ opportunity, programs, initialVisited, onSaved }: { opportunity: Opportunity | undefined; programs: Program[]; initialVisited: Visited; onSaved: (o: Opportunity, visited: Visited) => void }) {
  const ws = useWorkspace("funder");
  const passportFlags = usePassportFlags();
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
  const [visited, setVisited] = useState<Visited>(() => new Set(initialVisited));
  useEffect(() => setVisited((v) => (v.has(step) ? v : new Set([...v, step]))), [step]);

  const errors = useMemo(() => {
    const e = check(draft);
    if (draft.rows.some((r) => rowProblem(r))) e.rows = t("opportunityBuilder.problem.incompleteRule");
    return e;
  }, [draft]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const text = (key: keyof Draft) => ({ value: draft[key] as string, onChange: (e: { target: { value: string } }) => set(key, e.target.value as never) });
  const err = (key: keyof Draft) => (showErrors ? (errors[key] ?? null) : null);

  const comps = useApiQuery(async (api) => (opportunity ? api.listCompetitions({ opportunityId: opportunity.id }) : []), [opportunity?.id]);
  const competitions = comps.status === "ready" ? comps.data : undefined;
  const competition = opportunity && competitions ? competitionOf(opportunity.id, competitions) : undefined;
  const taking = !!opportunity && !!competitions && takingApplications(opportunity.id, competitions);

  const save = useApiMutation((api, input: OpportunityInput) => (opportunity ? api.updateOpportunity(opportunity.id, input) : api.createOpportunity(input)));
  const publish = useApiMutation((api, id: string, status: "forecasted" | "open") => api.publishOpportunity(id, status));
  const close = useApiMutation((api, id: string) => api.closeOpportunity(id));
  const assistStatus = useApiQuery((api) => api.assistStatus(), []);
  const translationsApi = useTranslationsApi();
  const [assist, setAssist] = useState<{ busy: boolean; error: unknown; drafted: number | null }>({ busy: false, error: null, drafted: null });

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
      onSaved(saved, visited);
    }
    return saved;
  }
  /** Saves first when needed (the server drafts from the saved record), then marks each draft for review. */
  async function draftTranslations() {
    const language = draft.languages.added;
    if (!language) return;
    const saved = dirty || !opportunity ? await saveDraft() : opportunity;
    if (!saved) return;
    setAssist({ busy: true, error: null, drafted: null });
    try {
      const result = await translationsApi.draftOpportunity(ws.id, saved.id, language);
      // Saving changed only the slug: the texts the drafts were made for are the draft's own.
      const next = withDrafts(draft, result.items);
      setDraft((d) => ({ ...d, languages: next.languages }));
      if (next.applied) setDirty(true);
      setAssist({ busy: false, error: null, drafted: next.applied });
      assistStatus.reload();
    } catch (e) {
      setAssist({ busy: false, error: e, drafted: null });
    }
  }

  async function publishAs(status: "forecasted" | "open") {
    const saved = dirty || !opportunity ? await saveDraft() : opportunity;
    if (!saved) return;
    const live = await publish.run(saved.id, status);
    if (live) onSaved(live, visited);
  }

  const stepDone = (key: StepKey) => {
    if (!visited.has(key)) return false;
    if (STEP_FIELDS[key].some((f) => errors[f])) return false;
    if (key === "basics") return !!draft.title.trim() && !!draft.description.trim();
    if (key === "funding") return !!draft.max.trim() || !!draft.min.trim();
    if (key === "dates") return !!draft.closes;
    if (key === "who") return draft.types.length > 0;
    if (key === "applications") return taking;
    return !!opportunity?.published;
  };
  const index = STEPS.findIndex((s) => s.key === step);
  const prev = STEPS[index - 1];
  const next = STEPS[index + 1];
  const program = programs.find((p) => p.id === draft.programId);
  const publicPath = opportunity ? `/f/${ws.handle}/o/${opportunity.slug}` : null;
  const writeError = save.error ?? publish.error ?? close.error;
  const languageStatus = draft.languages.added ? textStatus(draft, draft.languages.added) : null;

  return (
    <main className="main">
      <PageHeader
        crumbs={[{ label: ws.name, to: base }, { label: t("opportunityBuilder.opportunities"), to: `${base}/opportunities` }, { label: opportunity?.title ?? t("opportunityBuilder.newOpportunity") }]}
        title={t("opportunityBuilder.opportunityBuilder")}
        badge={
          <>
            {opportunity ? <OpportunityStatusBadge opportunity={opportunity} competitions={competitions} /> : <StatusBadge kind="form" status="draft" />}
            {dirty && (
              <span className="pill-warn">
                <Clock className="ic ic-sm" aria-hidden="true" />
                {t("opportunityBuilder.unsavedChanges")}
              </span>
            )}
          </>
        }
        meta={
          <>
            <span>{draft.title || t("opportunityBuilder.untitledOpportunity")}</span>
            {program && (
              <>
                <span>·</span>
                <span>{t("opportunityBuilder.program", { name: program.name })}</span>
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
                {t("opportunityBuilder.openPublicPage")}
              </Link>
            )}
            <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={save.state === "saving"}>
              {t("opportunityBuilder.saveDraft")}
            </button>
            {opportunity && (
              <Link to={`${base}/opportunities/${opportunity.id}/competition`} className="btn btn-primary">
                {t("opportunityBuilder.competitionStages")}
                <ArrowRight className="ic" aria-hidden="true" />
              </Link>
            )}
          </>
        }
      />
      {writeError !== null && <ErrorBanner error={writeError} />}

      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr) 360px", gap: "20px", alignItems: "start" }}>
        <nav className="card" style={{ padding: "18px 16px" }} aria-label={t("opportunityBuilder.builderSteps")}>
          <div className="eyebrow" style={{ marginBottom: "14px" }}>
            {t("opportunityBuilder.steps")}
          </div>
          <ol className="stp-v">
            {STEPS.map((s, i) => {
              const done = stepDone(s.key);
              const on = s.key === step;
              return (
                <li key={s.key} className={on ? "s on" : done ? "s done" : "s"}>
                  <span className="n">{done && !on ? <Check className="ic ic-sm" role="img" aria-label={t("opportunityBuilder.complete")} /> : i + 1}</span>
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
                {step === "basics" && t("opportunityBuilder.whatTheOpportunityIs")}
                {step === "funding" && t("opportunityBuilder.howMuchIsAvailable")}
                {step === "dates" && t("opportunityBuilder.keyDatesShownTo")}
                {step === "who" && t("opportunityBuilder.applicantTypesComeFrom")}
                {step === "publish" && t("opportunityBuilder.whereTheOpportunityIs")}
                {step === "applications" && t("opportunityBuilder.applicantsCanApplyOnly")}
              </p>
            </div>
          </div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {step === "basics" && (
              <>
                <Field id="opp-title" label={t("opportunityBuilder.title")} required error={err("title") ?? problemFor(save.error, "title")}>
                  <input className={err("title") ? "inp err" : "inp"} id="opp-title" {...text("title")} required aria-invalid={!!err("title")} />
                </Field>
                <Field id="opp-description" label={t("opportunityBuilder.summary")} help={t("opportunityBuilder.oneOrTwoParagraphs")}>
                  <textarea className="ta" id="opp-description" style={{ minHeight: "140px" }} {...text("description")} />
                </Field>
                <div className="fld-row">
                  <Field id="opp-program" label={t("opportunityBuilder.program2")} help={t("opportunityBuilder.theBudgetThisOpportunity")}>
                    <select className="sel" id="opp-program" value={draft.programId} onChange={(e) => set("programId", e.target.value)}>
                      <option value="">{t("opportunityBuilder.noProgram")}</option>
                      {programs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="opp-slug" label={t("opportunityBuilder.publicAddress")} help={["", "f", ws.handle, "o", draft.slug || slugify(draft.title || t("opportunityBuilder.yourTitle"))].join("/")} error={err("slug") ?? problemFor(save.error, "slug")}>
                    <input className={err("slug") ? "inp err" : "inp"} id="opp-slug" placeholder={slugify(draft.title || t("opportunityBuilder.yourTitle"))} {...text("slug")} />
                  </Field>
                </div>
                <LanguagesSection
                  draft={draft}
                  error={err("languages") ?? problemFor(save.error, "translations")}
                  onChange={(languages) => set("languages", languages)}
                  assist={
                    assistStatus.status === "ready" && assistStatus.data.enabled ? (
                      <TranslateAssist
                        id="opp-translate-assist"
                        help={t("translation.assist.opportunityHelp")}
                        quota={assistStatus.data.quota}
                        busy={assist.busy || save.state === "saving"}
                        disabled={!languageStatus || !draft.title.trim() || languageStatus.missing + languageStatus.stale === 0}
                        result={assist.drafted}
                        error={assist.error !== null ? <ErrorBanner error={assist.error} /> : null}
                        onDraft={() => void draftTranslations()}
                      />
                    ) : null
                  }
                />
              </>
            )}
            {step === "funding" && (
              <>
                <Field id="opp-total" label={t("opportunityBuilder.totalAvailable")} error={err("total")}>
                  <input className={err("total") ? "inp err" : "inp"} id="opp-total" inputMode="decimal" placeholder="1,200,000" {...text("total")} />
                </Field>
                <div className="fld-row">
                  <Field id="opp-min" label={t("opportunityBuilder.smallestAward")} error={err("min")}>
                    <input className={err("min") ? "inp err" : "inp"} id="opp-min" inputMode="decimal" placeholder="50,000" {...text("min")} />
                  </Field>
                  <Field id="opp-max" label={t("opportunityBuilder.largestAward")} error={err("max")}>
                    <input className={err("max") ? "inp err" : "inp"} id="opp-max" inputMode="decimal" placeholder="150,000" {...text("max")} />
                  </Field>
                </div>
                <div className="fld-row">
                  <Field id="opp-min-count" label={t("opportunityBuilder.fewestAwardsExpected")} error={err("minCount")}>
                    <input className={err("minCount") ? "inp err" : "inp"} id="opp-min-count" inputMode="numeric" {...text("minCount")} />
                  </Field>
                  <Field id="opp-max-count" label={t("opportunityBuilder.mostAwardsExpected")} error={err("maxCount")}>
                    <input className={err("maxCount") ? "inp err" : "inp"} id="opp-max-count" inputMode="numeric" {...text("maxCount")} />
                  </Field>
                </div>
                <Field id="opp-funding-details" label={t("opportunityBuilder.notesOnFunding")} help={t("opportunityBuilder.forExampleReviewedMonthly")}>
                  <input className="inp" id="opp-funding-details" {...text("fundingDetails")} />
                </Field>
              </>
            )}
            {step === "dates" && (
              <>
                <div className="fld-row">
                  <Field id="opp-opens" label={t("opportunityBuilder.opens")}>
                    <input className="inp" id="opp-opens" type="date" {...text("opens")} />
                  </Field>
                  <Field id="opp-closes" label={t("opportunityBuilder.closes")} help={t("opportunityBuilder.leaveEmptyForA")} error={err("closes")}>
                    <input className={err("closes") ? "inp err" : "inp"} id="opp-closes" type="date" {...text("closes")} />
                  </Field>
                </div>
                <Field id="opp-closes-name" label={t("opportunityBuilder.whatClosesOnThat")} help={t("opportunityBuilder.shownNextToThe")}>
                  <input className="inp" id="opp-closes-name" {...text("closesName")} />
                </Field>
                <div className="fld-row">
                  <Field id="opp-decision" label={t("opportunityBuilder.decisionsAnnounced")}>
                    <input className="inp" id="opp-decision" type="date" {...text("decision")} />
                  </Field>
                  <Field id="opp-period" label={t("opportunityBuilder.grantPeriodStarts")}>
                    <input className="inp" id="opp-period" type="date" {...text("periodStart")} />
                  </Field>
                </div>
              </>
            )}
            {step === "who" && (
              <>
                <ApplicantTypes value={draft.types} onChange={(v) => set("types", v)} />
                <RuleRows rows={draft.rows} onChange={(rows) => set("rows", rows)} />
                <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                  <legend className="lbl" style={{ marginBottom: "8px" }}>
                    {t("opportunityBuilder.verification")}
                  </legend>
                  {(
                    [
                      ...(passportFlags.linking ? [["requirePassport", t("opportunityBuilder.verify.requirePassport"), t("opportunityBuilder.verify.requirePassportHelp")] as const] : []),
                      ["acceptSelfReported", t("opportunityBuilder.verify.acceptSelfReported"), t("opportunityBuilder.verify.acceptSelfReportedHelp")] as const,
                    ] as const
                  ).map(([key, label, help]) => (
                    <label key={key} className="cb" htmlFor={`verify-${key}`}>
                      <input type="checkbox" id={`verify-${key}`} checked={draft[key]} onChange={(e) => set(key, e.target.checked)} style={{ marginTop: "3px" }} />
                      <span>
                        <span className="b">{label}</span>
                        <span className="help" style={{ display: "block" }}>
                          {help}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            {step === "publish" && (
              <>
                <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                  <legend className="lbl" style={{ marginBottom: "8px" }}>
                    {t("opportunityBuilder.publishTargets")}
                  </legend>
                  {(
                    [
                      ["publicPage", t("opportunityBuilder.target.publicPage"), t("opportunityBuilder.target.publicPageHelp", { handle: ws.handle })],
                      ["openGrantsIndex", t("opportunityBuilder.target.index"), t("opportunityBuilder.target.indexHelp")],
                      ["sitemap", t("opportunityBuilder.target.sitemap"), t("opportunityBuilder.target.sitemapHelp")],
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
                        {t.rich("opportunityBuilder.publishedLiveAt", { publicPath, link: (chunks) => <Link to={publicPath} className="mono" style={{ fontSize: "13px" }}>{chunks}</Link> })}
                      </div>
                      <div className="d">{t("opportunityBuilder.publishedSavedChangesAppear", { date: formatDate(opportunity.publishedAt) })}</div>
                    </div>
                  </div>
                )}
                {opportunity?.published && opportunity.status !== "closed" && competitions && !taking && (
                  <Notice tone="warn" title={t("opportunityBuilder.notTakingApplicationsYet")}>
                    {t.rich("opportunityBuilder.applicantsCanFindThis", { link: (chunks) => <Link to={{ hash: "#applications" }} replace>{chunks}</Link> })}
                  </Notice>
                )}
                {opportunity?.status === "closed" && <Notice tone="neu" title={t("opportunityBuilder.thisOpportunityIsClosed")}>{t("opportunityBuilder.itNoLongerAccepts")}</Notice>}
                {!draft.description.trim() && <Notice tone="warn" title={t("opportunityBuilder.addASummaryBefore")}>{t("opportunityBuilder.thePublicPageAnd")}</Notice>}
                {opportunity?.status !== "closed" && (
                  <div className="row wrap" style={{ gap: "8px" }}>
                    <button type="button" className="btn btn-primary" disabled={!draft.description.trim() || publish.state === "saving"} onClick={() => publishAs("open")}>
                      {opportunity?.published && opportunity.status === "open" ? t("opportunityBuilder.publishChanges") : t("opportunityBuilder.publishAsOpen")}
                    </button>
                    {!(opportunity?.published && opportunity.status === "open") && (
                      <button type="button" className="btn btn-secondary" disabled={!draft.description.trim() || publish.state === "saving"} onClick={() => publishAs("forecasted")}>
                        {t("opportunityBuilder.publishAsForecasted")}
                      </button>
                    )}
                    {opportunity?.published && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={close.state === "saving"}
                        onClick={async () => {
                          const closed = await close.run(opportunity.id);
                          if (closed) onSaved(closed, visited);
                        }}
                      >
                        {t("opportunityBuilder.closeOpportunity")}
                      </button>
                    )}
                  </div>
                )}
                <EmbedPanel handle={ws.handle} funderName={ws.name} opportunity={opportunity} listed={opportunity?.publish.publicPage !== false} taking={taking} />
                {opportunity && <SocialPanel key={`${opportunity.id}-${opportunity.updatedAt}`} subject={{ type: "opportunity", id: opportunity.id }} />}
                {opportunity && <SyndicationPanel opportunity={opportunity} />}
              </>
            )}
            {step === "applications" && <ApplicationsStep opportunity={opportunity} competition={competition} base={base} publicPath={publicPath} onChanged={comps.reload} />}
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
                {t("opportunityBuilder.saveDraft")}
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
          <PreviewCard draft={draft} brand={ws.brand} apply={offersApply(opportunity, competitions)} closed={opportunity?.status === "closed"} />
          {step === "who" && <EligibilityDryRun rows={draft.rows} />}
        </div>
      </div>
    </main>
  );
}

export default function OpportunityBuilder() {
  useFunderMessages();
  // The embed panel shows the public widget's card: its messages load with the screen, not when the panel opens.
  usePublicMessages();
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
  // An opportunity created in this visit keeps the steps actually visited when it gets its own address.
  const carried = useRef<{ id: string; visited: Visited } | null>(null);

  if (data.status === "ready" && oppId && !data.data.opportunity) return <NotFound />;
  const opportunity = saved ?? (data.status === "ready" ? data.data.opportunity : undefined);

  return (
    <FunderShell active="Opportunities">
      <title>{t("opportunityBuilder.opportunityBuilder2", { title: opportunity?.title ?? t("opportunityBuilder.newOpportunity") })}</title>
      {data.status === "loading" && (
        <main className="main">
          <Loading label={t("opportunityBuilder.loadingTheOpportunity")} />
        </main>
      )}
      {data.status === "error" && (
        <main className="main">
          <ErrorBanner error={data.error} onRetry={data.reload} title={t("opportunityBuilder.theOpportunityCouldNot")} />
        </main>
      )}
      {data.status === "ready" && (
        <Builder
          key={data.data.opportunity?.id ?? "new"}
          opportunity={opportunity}
          programs={data.data.programs}
          initialVisited={data.data.opportunity ? (carried.current?.id === data.data.opportunity.id ? carried.current.visited : ALL_VISITED) : new Set()}
          onSaved={(o, visited) => {
            setSaved(o);
            if (!oppId) carried.current = { id: o.id, visited };
            // A new opportunity gets its own address once it exists.
            if (!oppId) navigate({ pathname: `/w/${ws.handle}/opportunities/${o.id}/edit`, hash: location.hash }, { replace: true });
          }}
        />
      )}
    </FunderShell>
  );
}
