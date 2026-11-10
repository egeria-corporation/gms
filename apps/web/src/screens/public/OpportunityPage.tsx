// SPDX-License-Identifier: AGPL-3.0-only
// `/f/:handle/o/:slug` — a published opportunity in the funder's brand. Data comes from
// `GET /gms/public/funders/{handle}/opportunities/{slug}`; the forms preview reads the
// CommonGrants competition record. The page links its CommonGrants JSON as an alternate.
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { BadgeCheck, Calendar, Check, ChevronDown, CircleCheck, CodeXml, Info, ShieldCheck } from "lucide-react";
import { collectControls, type FormDefinition } from "@gms/forms";
import { ApiError } from "../../api/client.ts";
import { useApiQuery } from "../../api/hooks.ts";
import type { CgForm, OpportunityPageData, PublicStage } from "../../api/types.ts";
import { signInPath } from "../../auth/RequireAuth.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { FormView } from "../../forms/FormView.tsx";
import { formatAwardRange, formatDate } from "../../lib/format.ts";
import { DeadlineBadge } from "./FunderPage.tsx";
import { PublicFrame, PublicState } from "./PublicFrame.tsx";

/** schema.org description of the opportunity for search engines and the OpenGrants importer. */
export function jsonLd(data: OpportunityPageData, pageUrl: string) {
  const { opportunity: o, funder } = data;
  return {
    "@context": "https://schema.org",
    "@type": "MonetaryGrant",
    name: o.title,
    description: o.description,
    url: pageUrl,
    funder: { "@type": "Organization", name: funder.name, ...(funder.website ? { url: funder.website } : {}) },
    ...(o.funding.maxAwardAmount ? { amount: { "@type": "MonetaryAmount", currency: o.funding.maxAwardAmount.currency, minValue: o.funding.minAwardAmount?.amount, maxValue: o.funding.maxAwardAmount.amount } } : {}),
    ...(o.keyDates.closeDate?.date ? { applicationDeadline: o.keyDates.closeDate.date } : {}),
  };
}

type StageState = "done" | "on" | "todo";
function stageState(s: PublicStage, now: number): StageState {
  if (s.closes && Date.parse(s.closes) < now) return "done";
  if (s.opens && Date.parse(s.opens) > now) return "todo";
  return s.opens || s.closes ? "on" : "todo";
}

function Stages({ stages }: { stages: PublicStage[] }) {
  const now = Date.now();
  return (
    <ol className="stp" aria-label="Stages" style={{ flexWrap: "wrap", rowGap: "12px" }}>
      {stages.map((s, i) => {
        const state = stageState(s, now);
        return (
          <li key={s.key} style={{ display: "contents" }}>
            {i > 0 && <span className={state === "todo" ? "ln" : "ln done"} aria-hidden="true"></span>}
            <div className={state === "done" ? "s done" : state === "on" ? "s on" : "s"} aria-current={state === "on" ? "step" : undefined}>
              <span className="n">{state === "done" ? <Check className="ic ic-sm" role="img" aria-label="Closed" /> : i + 1}</span>
              <div>
                <div>{s.label}</div>
                <div className="muted" style={{ fontWeight: 400, fontSize: "12px" }}>
                  {s.opens || s.closes ? `${formatDate(s.opens)} – ${formatDate(s.closes)}` : s.requiresSubmission ? "Dates to be announced" : "By invitation"}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FormPreview({ form }: { form: CgForm }) {
  const definition = useMemo<FormDefinition>(() => ({ id: form.id, version: Number(form.version ?? 1), title: form.title, jsonSchema: form.jsonSchema, uiSchema: form.uiSchema }), [form]);
  const controls = useMemo(() => collectControls(form.uiSchema), [form.uiSchema]);
  const prefilled = controls.filter((c) => c.options?.widget === "passportField").length;
  return (
    <details>
      <summary>
        <span>
          {form.title} <span className="muted" style={{ fontWeight: 400 }}>· v{form.version ?? "1"}</span>
        </span>
        <ChevronDown className="ic" aria-hidden="true" />
      </summary>
      <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
        {controls.length} question{controls.length === 1 ? "" : "s"}.
        {prefilled > 0 && (
          <>
            {" "}
            {prefilled} {prefilled === 1 ? "is" : "are"}{" "}
            <span className="prov prov-passport">
              <BadgeCheck className="ic" aria-hidden="true" />
              pre-filled from Passport
            </span>
            .
          </>
        )}{" "}
        {form.description}
      </p>
      <div style={{ marginTop: "12px" }}>
        <FormView form={definition} response={{}} mode="print" />
      </div>
    </details>
  );
}

export default function OpportunityPage() {
  const { handle = "", slug = "" } = useParams();
  const page = useApiQuery((api) => api.publicOpportunity(handle, slug), [handle, slug]);
  const competitionId = page.status === "ready" ? page.data.competitions[0]?.id : undefined;
  const forms = useApiQuery(async (api) => (competitionId ? Object.values((await api.publicCompetition(competitionId)).forms.forms) : []), [competitionId]);

  if (page.status === "loading") return <PublicState title="Loading…" />;
  if (page.status === "error") {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFound />;
    return (
      <PublicState title="This opportunity could not be loaded">
        <ErrorBanner error={page.error} onRetry={page.reload} />
      </PublicState>
    );
  }

  const data = page.data;
  const { funder, opportunity: o, competitions } = data;
  const home = `/f/${funder.handle}`;
  const here = `/f/${funder.handle}/o/${o.slug}`;
  const competition = competitions[0];
  const dates = [o.keyDates.postDate, ...Object.values(o.keyDates.otherDates ?? {}), o.keyDates.closeDate].filter((d): d is NonNullable<typeof d> => !!d?.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const awards = o.funding.minAwardCount && o.funding.maxAwardCount ? `${o.funding.minAwardCount} – ${o.funding.maxAwardCount}` : o.funding.estimatedAwardCount ? String(o.funding.estimatedAwardCount) : "—";

  return (
    <>
      <title>{`${o.title} — ${funder.name}`}</title>
      <link rel="alternate" type="application/json" href={data.links.json} title="CommonGrants record" />
      <link rel="canonical" href={data.links.page} />
      <script type="application/ld+json">{JSON.stringify(jsonLd(data, data.links.page))}</script>
      <PublicFrame funder={funder} jsonHref={data.links.json} nav={<Link to={home}>All opportunities</Link>}>
        <div className="sticky-cta">
          <div className="wrap-c" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <h1 style={{ fontSize: "24px" }}>{o.title}</h1>
                <DeadlineBadge opp={o} />
              </div>
              <div className="muted" style={{ fontSize: "14px" }}>
                {funder.name}
                {o.publishedAt ? ` · Published ${formatDate(o.publishedAt)}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <a href={data.links.json} className="btn btn-secondary">
                <CodeXml className="ic" aria-hidden="true" />
                View as CommonGrants JSON
              </a>
              {o.status === "open" && (
                <Link to={signInPath(here)} className="btn btn-tenant btn-lg">
                  <ShieldCheck className="ic" aria-hidden="true" />
                  Apply with Passport
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="wrap-c" style={{ display: "flex", flexDirection: "column" }}>
          <section style={{ paddingTop: "32px" }}>
            {o.status === "forecasted" && (
              <div className="bnr bnr-neu" role="status" style={{ marginBottom: "20px" }}>
                <Calendar className="ic" aria-hidden="true" />
                <div>
                  <div className="t">This opportunity is forecasted</div>
                  <div className="d">Details below may change before applications open.</div>
                </div>
              </div>
            )}
            {o.status === "closed" && (
              <div className="bnr bnr-neu" role="status" style={{ marginBottom: "20px" }}>
                <CircleCheck className="ic" aria-hidden="true" />
                <div>
                  <div className="t">This opportunity is closed</div>
                  <div className="d">
                    Applications are no longer accepted. <Link to={home}>See what {funder.name} has open.</Link>
                  </div>
                </div>
              </div>
            )}
            <dl className="band" style={{ margin: 0 }}>
              <div>
                <dt className="k">Funding range</dt>
                <dd className="v" style={{ marginLeft: 0 }}>
                  {formatAwardRange(o.funding)}
                </dd>
              </div>
              <div>
                <dt className="k">Estimated awards</dt>
                <dd className="v" style={{ marginLeft: 0 }}>
                  {awards}
                </dd>
              </div>
              {dates.slice(0, 3).map((d) => (
                <div key={`${d.name}-${d.date}`}>
                  <dt className="k">{d.name}</dt>
                  <dd className="v" style={{ fontSize: "17px", marginLeft: 0 }}>
                    {formatDate(d.date)}
                  </dd>
                </div>
              ))}
            </dl>
            <p style={{ maxWidth: "720px", marginTop: "24px", fontSize: "17px" }}>{o.description}</p>
            {o.funding.details && <p style={{ maxWidth: "720px", fontSize: "15px", color: "#4A5C5A" }}>{o.funding.details}</p>}
          </section>

          <section>
            <span className="eyebrow">Generated from this opportunity's rules</span>
            <h2 style={{ marginTop: "6px" }}>Who Can Apply</h2>
            <ul className="elig">
              {o.eligibility.map((label) => (
                <li key={label}>
                  <ShieldCheck className="ic" aria-hidden="true" />
                  <div>
                    <b>{label}</b>
                  </div>
                </li>
              ))}
              {o.eligibility.length === 0 && (
                <li>
                  <ShieldCheck className="ic" aria-hidden="true" />
                  <div>
                    <b>This opportunity lists no eligibility rules.</b> Check the description for who it is meant for.
                  </div>
                </li>
              )}
              <li style={{ background: "#F7FAFA" }}>
                <Info className="ic" aria-hidden="true" />
                <div>When you apply with Passport, each rule is checked against your record and shown as Pass, Fail, or Unknown before you start writing.</div>
              </li>
            </ul>
          </section>

          {competition && competition.stages.length > 0 && (
            <section>
              <span className="eyebrow">
                {competition.stages.length === 1 ? "One stage" : `${competition.stages.length} stages`}
              </span>
              <h2 style={{ marginTop: "6px" }}>How the Competition Runs</h2>
              <div className="card" style={{ padding: "24px 28px" }}>
                <Stages stages={competition.stages} />
                {(competition.instructions ?? competition.description) && (
                  <p style={{ marginTop: "18px", fontSize: "15px", color: "#4A5C5A" }}>{competition.instructions ?? competition.description}</p>
                )}
              </div>
            </section>
          )}

          {forms.status === "ready" && forms.data.length > 0 && (
            <section>
              <span className="eyebrow">Prepare ahead</span>
              <h2 style={{ marginTop: "6px" }}>What You'll Need</h2>
              <p className="muted" style={{ fontSize: "15px", marginBottom: "12px" }}>
                Open a form to preview its questions as an applicant sees them.
              </p>
              {forms.data.map((f) => (
                <FormPreview key={f.id} form={f} />
              ))}
            </section>
          )}

          <section>
            <span className="eyebrow">Common questions</span>
            <h2 style={{ marginTop: "6px" }}>FAQ</h2>
            <details open>
              <summary>
                What does "Apply with Passport" mean?
                <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>
                Your organization's record in OpenGrants Passport pre-fills the application and attaches your verification level. You grant {funder.name} read
                access to your profile; you can revoke it at any time from your workspace.
              </p>
            </details>
            <details>
              <summary>
                Can a consultant help us write the proposal?
                <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>Yes. From Team &amp; access you can invite a consultant to specific applications with an expiry date. Submission always requires a person from your organization.</p>
            </details>
            <details>
              <summary>
                How are payments made?
                <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>
                Awards are paid in scheduled tranches to the destination your organization has verified in Passport. {funder.name} never collects bank details
                directly; payment readiness is checked before each release.
              </p>
            </details>
          </section>
        </div>
      </PublicFrame>
    </>
  );
}
