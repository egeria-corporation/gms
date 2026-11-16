// SPDX-License-Identifier: AGPL-3.0-only
// `/f/:handle/o/:slug` — a published opportunity in the funder's brand. Data comes from
// `GET /gms/public/funders/{handle}/opportunities/{slug}`; the forms preview reads the
// CommonGrants competition record. The page links its CommonGrants JSON as an alternate; its
// schema.org JSON-LD is written into the head by the front Worker (src/edge/meta.ts), not here.
// Apply appears only while a competition is open; until then the page says it is not taking
// applications, and a signed-in applicant can save it to come back to.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowRight, BadgeCheck, Bookmark, BookmarkCheck, Calendar, Check, ChevronDown, CircleCheck, Clock, CodeXml, Info, ShieldCheck } from "lucide-react";
import { useApplicantApi } from "../../api/applicantHooks.ts";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { collectControls, type FormDefinition } from "@gms/forms";
import { ApiError } from "../../api/client.ts";
import { useApiQuery } from "../../api/hooks.ts";
import type { CgForm, OpportunityPageData, PublicStage } from "../../api/types.ts";
import { NotFound } from "../../components/NotFound.tsx";
import { rememberSocialLanding } from "../../lib/socialLanding.ts";
import { ErrorBanner } from "../../components/ui.tsx";
import { FormView } from "../../forms/FormView.tsx";
import { formatAwardRange, formatDate } from "../../lib/format.ts";
import { DeadlineBadge } from "./FunderPage.tsx";
import { PublicFrame, PublicState } from "./PublicFrame.tsx";
import { openBlob } from "../../lib/browser.ts";
import { OpportunityDocuments, PublishedFaq, UnverifiedFunderBanner } from "./publicExtras.tsx";
import { useServices } from "../../app/services.tsx";

import { translator } from "../../i18n/index.tsx";

const t = translator("public");
/**
 * Apply also needs the opportunity itself to be published as open (not forecasted). The stricter
 * reading; set false to offer Apply whenever a competition is open on a published opportunity.
 */
export const APPLY_NEEDS_OPEN_OPPORTUNITY = true;

/** Whether the page offers Apply: a competition is open, and the opportunity is open (see above). */
export function takingApplications(data: Pick<OpportunityPageData, "opportunity" | "competitions">): boolean {
  const status = data.opportunity.status;
  if (status === "closed" || (APPLY_NEEDS_OPEN_OPPORTUNITY && status !== "open")) return false;
  return data.competitions.some((c) => c.status === "open");
}

/** Save for later, for a signed-in person with an applicant workspace. It lands under Saved in Find funding. */
function SaveButton({ workspaceId, opportunity, pageUrl }: { workspaceId: string; opportunity: { id: string; title: string }; pageUrl: string }) {
  const api = useApplicantApi(workspaceId);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  useEffect(() => {
    let live = true;
    // Already saved: say so. A failed read leaves the button to try.
    api.saved().then(
      (rows) => live && rows.some((s) => s.source === "gms" && s.externalId === opportunity.id) && setState("saved"),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, opportunity.id]);
  const already = state === "saved";
  const url = /^https?:\/\//.test(pageUrl) ? pageUrl : `${window.location.origin}${pageUrl}`;
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={already || state === "saving"}
        onClick={async () => {
          setState("saving");
          try {
            await api.save({ source: "gms", externalId: opportunity.id, title: opportunity.title, url });
            setState("saved");
          } catch {
            setState("failed");
          }
        }}
      >
        {already ? <BookmarkCheck className="ic" aria-hidden="true" /> : <Bookmark className="ic" aria-hidden="true" />}
        {already ? t("opportunityPage.saved") : t("opportunityPage.save")}
      </button>
      {state === "failed" && (
        <span className="small" role="alert">
          {t("opportunityPage.itCouldNotBeSaved")}
        </span>
      )}
    </>
  );
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
    <ol className="stp" aria-label={t("opportunityPage.stages")} style={{ flexWrap: "wrap", rowGap: "12px" }}>
      {stages.map((s, i) => {
        const state = stageState(s, now);
        return (
          <li key={s.key} style={{ display: "contents" }}>
            {i > 0 && <span className={state === "todo" ? "ln" : "ln done"} aria-hidden="true"></span>}
            <div className={state === "done" ? "s done" : state === "on" ? "s on" : "s"} aria-current={state === "on" ? "step" : undefined}>
              <span className="n">{state === "done" ? <Check className="ic ic-sm" role="img" aria-label={t("opportunityPage.closed")} /> : i + 1}</span>
              <div>
                <div>{s.label}</div>
                <div className="muted" style={{ fontWeight: 400, fontSize: "12px" }}>
                  {s.opens || s.closes ? `${formatDate(s.opens)} – ${formatDate(s.closes)}` : s.requiresSubmission ? t("opportunityPage.datesToBeAnnounced") : t("opportunityPage.byInvitation")}
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
          {form.title} <span className="muted" style={{ fontWeight: 400 }}>{t("opportunityPage.version", { version: String(form.version ?? "1") })}</span>
        </span>
        <ChevronDown className="ic" aria-hidden="true" />
      </summary>
      <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
        {t("opportunityPage.questions", { count: controls.length })}
        {prefilled > 0 && (
          <>
            {" "}
            {t.rich("opportunityPage.prefilled", {
              count: prefilled,
              prov: (chunks) => (
                <span className="prov prov-passport">
                  <BadgeCheck className="ic" aria-hidden="true" />
                  {chunks}
                </span>
              ),
            })}
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
  const passportFlags = usePassportFlags();
  const { handle = "", slug = "" } = useParams();
  const location = useLocation();
  // A visit from a shared social link is remembered, so an application started from it counts.
  useEffect(() => rememberSocialLanding(handle, slug, location.search), [handle, slug, location.search]);
  const { mock, sessionState, meState } = useServices();
  const page = useApiQuery((api) => api.publicOpportunity(handle, slug), [handle, slug]);
  // The open competition when there is one; otherwise the first, for its stages and forms.
  const shown = page.status === "ready" ? (page.data.competitions.find((c) => c.status === "open") ?? page.data.competitions[0]) : undefined;
  const competitionId = shown?.id;
  const forms = useApiQuery(async (api) => (competitionId ? Object.values((await api.publicCompetition(competitionId)).forms.forms) : []), [competitionId]);

  if (page.status === "loading") return <PublicState title={t("opportunityPage.loading")} />;
  if (page.status === "error") {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFound />;
    return (
      <PublicState title={t("opportunityPage.thisOpportunityCouldNotBe")}>
        <ErrorBanner error={page.error} onRetry={page.reload} />
      </PublicState>
    );
  }

  const data = page.data;
  const { funder, opportunity: o, competitions } = data;
  const home = `/f/${funder.handle}`;
  const funderVerified = funder.verification ? funder.verification.source === "passport" : !!funder.verificationLevel;
  // Signed-out visitors are sent through sign-in by the route guard and come back to the apply entry.
  const applyPath = `/apply/${funder.handle}/${o.slug}`;
  const competition = shown ?? competitions[0];
  const taking = takingApplications(data);
  const applicantWs = sessionState.status === "signedIn" && meState.status === "ready" ? meState.me.workspaces.find((w) => w.kind === "applicant") : undefined;
  const dates = [o.keyDates.postDate, ...Object.values(o.keyDates.otherDates ?? {}), o.keyDates.closeDate].filter((d): d is NonNullable<typeof d> => !!d?.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const awards = o.funding.minAwardCount && o.funding.maxAwardCount ? `${o.funding.minAwardCount} – ${o.funding.maxAwardCount}` : o.funding.estimatedAwardCount ? String(o.funding.estimatedAwardCount) : "—";

  return (
    <>
      <title>{`${o.title} — ${funder.name}`}</title>
      <link rel="alternate" type="application/json" href={data.links.json} title={t("opportunityPage.commongrantsRecord")} />
      <link rel="canonical" href={data.links.page} />
      <PublicFrame funder={funder} jsonHref={data.links.json} nav={<Link to={home}>{t("opportunityPage.allOpportunities")}</Link>}>
        <div className="sticky-cta">
          <div className="wrap-c" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <h1 style={{ fontSize: "24px" }}>{o.title}</h1>
                <DeadlineBadge opp={o} />
              </div>
              <div className="muted" style={{ fontSize: "14px" }}>
                {/* A fund other than the default is named, with its page (sent once the public data carries funds). */}
                {o.fund && !o.fund.isDefault ? (
                  <>
                    {t.rich("opportunityPage.aFundOf", { fund: o.fund.name, funder: funder.name, link: (chunks) => <Link to={`/f/${funder.handle}/${o.fund!.slug}`}>{chunks}</Link> })}
                  </>
                ) : (
                  funder.name
                )}
                {o.publishedAt ? ` · ${t("opportunityPage.published", { publishedAt: formatDate(o.publishedAt) })}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <a
                href={data.links.json}
                className="btn btn-secondary"
                onClick={(e) => {
                  // Without an API to serve it (mock mode), show the same record from the page's own data.
                  if (!mock) return;
                  e.preventDefault();
                  openBlob(new Blob([JSON.stringify(data.commonGrants, null, 2)], { type: "application/json" }), `${o.slug}.json`);
                }}
              >
                <CodeXml className="ic" aria-hidden="true" />
                {t("opportunityPage.viewAsCommongrantsJson")}
              </a>
              {taking && (
                <Link to={applyPath} className="btn btn-tenant btn-lg">
                  <ArrowRight className="ic" aria-hidden="true" />
                  {t("opportunityPage.apply")}
                </Link>
              )}
              {!taking && o.status !== "closed" && (
                <>
                  <span className="bdg bdg-neutral bdg-lg" role="status">
                    <Clock className="ic" aria-hidden="true" />
                    {t("opportunityPage.notTakingApplicationsYet")}
                  </span>
                  {applicantWs && <SaveButton workspaceId={applicantWs.id} opportunity={o} pageUrl={data.links.page} />}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="wrap-c" style={{ display: "flex", flexDirection: "column" }}>
          <section style={{ paddingTop: "32px" }}>
            {!funderVerified && (
              <div style={{ marginBottom: "20px" }}>
                <UnverifiedFunderBanner name={funder.name} />
              </div>
            )}
            {o.status === "forecasted" && (
              <div className="bnr bnr-neu" role="status" style={{ marginBottom: "20px" }}>
                <Calendar className="ic" aria-hidden="true" />
                <div>
                  <div className="t">{t("opportunityPage.thisOpportunityIsForecasted")}</div>
                  <div className="d">{t("opportunityPage.detailsBelowMayChangeBefore")}</div>
                </div>
              </div>
            )}
            {o.status === "closed" && (
              <div className="bnr bnr-neu" role="status" style={{ marginBottom: "20px" }}>
                <CircleCheck className="ic" aria-hidden="true" />
                <div>
                  <div className="t">{t("opportunityPage.thisOpportunityIsClosed")}</div>
                  <div className="d">
                    {t.rich("opportunityPage.applicationsAreNoLongerAccepted", { name: funder.name, link: (chunks) => <Link to={home}>{chunks}</Link> })}
                  </div>
                </div>
              </div>
            )}
            <dl className="band" style={{ margin: 0 }}>
              <div>
                <dt className="k">{t("opportunityPage.fundingRange")}</dt>
                <dd className="v" style={{ marginLeft: 0 }}>
                  {formatAwardRange(o.funding)}
                </dd>
              </div>
              <div>
                <dt className="k">{t("opportunityPage.estimatedAwards")}</dt>
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
            <span className="eyebrow">{t("opportunityPage.generatedFromThisOpportunityS")}</span>
            <h2 style={{ marginTop: "6px" }}>{t("opportunityPage.whoCanApply")}</h2>
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
                    {t.rich("opportunityPage.thisOpportunityListsNoEligibility", { b: (chunks) => <b>{chunks}</b> })}
                  </div>
                </li>
              )}
              <li style={{ background: "#F7FAFA" }}>
                <Info className="ic" aria-hidden="true" />
                <div>{t("opportunityPage.whenYouApplyEachRule")}</div>
              </li>
            </ul>
          </section>

          {competition && competition.stages.length > 0 && (
            <section>
              <span className="eyebrow">
                {t("opportunityPage.stageCount", { count: competition.stages.length })}
              </span>
              <h2 style={{ marginTop: "6px" }}>{t("opportunityPage.howTheCompetitionRuns")}</h2>
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
              <span className="eyebrow">{t("opportunityPage.prepareAhead")}</span>
              <h2 style={{ marginTop: "6px" }}>{t("opportunityPage.whatYouLlNeed")}</h2>
              <p className="muted" style={{ fontSize: "15px", marginBottom: "12px" }}>
                {t("opportunityPage.openAFormToPreview")}
              </p>
              {forms.data.map((f) => (
                <FormPreview key={f.id} form={f} />
              ))}
            </section>
          )}

          <section>
            <span className="eyebrow">{t("opportunityPage.guidelines")}</span>
            <h2 style={{ marginTop: "6px" }}>{t("opportunityPage.documents")}</h2>
            <OpportunityDocuments handle={funder.handle} slug={o.slug} />
          </section>

          <section>
            <span className="eyebrow">{t("opportunityPage.commonQuestions")}</span>
            <h2 style={{ marginTop: "6px" }}>{t("opportunityPage.faq")}</h2>
            <PublishedFaq handle={funder.handle} />
            <details open>
              <summary>
                {t("opportunityPage.doINeedPassportTo")}
                <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>
                {t("opportunityPage.noYouCanSetUp", { name: funder.name })}
                {passportFlags.linking &&
                  t(passportFlags.payments ? "opportunityPage.passportRecommendedPayments" : "opportunityPage.passportRecommended", { name: funder.name })}
              </p>
            </details>
            <details>
              <summary>
                {t("opportunityPage.canAConsultantHelpUs")}
                <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>{t("opportunityPage.yesFromTeamAccessYou")}</p>
            </details>
            <details>
              <summary>
                {t("opportunityPage.howArePaymentsMade")}
                <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>
                {passportFlags.payments
                  ? t("opportunityPage.awardsArePaidInScheduled", { name: funder.name })
                  : t("opportunityPage.awardsArePaidInScheduled2", { name: funder.name })}
              </p>
            </details>
          </section>
        </div>
      </PublicFrame>
    </>
  );
}
