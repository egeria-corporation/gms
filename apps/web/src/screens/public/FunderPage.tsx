// SPDX-License-Identifier: AGPL-3.0-only
// `/f/:handle` — a funder's public front door: brand, mission and published opportunities.
// Everything here comes from `GET /gms/public/funders/{handle}` (published fields only).
import { Link, useParams } from "react-router";
import { ArrowRight, Calendar, CircleMinus, Clock, Globe, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { ApiError } from "../../api/client.ts";
import { useApiQuery } from "../../api/hooks.ts";
import type { PublicOpportunityCard } from "../../api/types.ts";
import { NotFound } from "../../components/NotFound.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { applicantTypeLabel, daysUntil, formatAwardCount, formatAwardRange, formatDate } from "../../lib/format.ts";
import { isAfterToday } from "../../lib/openDate.ts";
import { PublicFrame, PublicState } from "./PublicFrame.tsx";
import { FunderExtras, UnverifiedFunderBanner } from "./publicExtras.tsx";

import { translator } from "../../i18n/index.tsx";

const tr = translator("public");
/** The badge on an opportunity card: how long it stays open, in words. */
export function DeadlineBadge({ opp, now = new Date(), opensOn }: { opp: Pick<PublicOpportunityCard, "status" | "keyDates" | "acceptingApplications">; now?: Date; opensOn?: string | null }) {
  const close = opp.keyDates.closeDate?.date;
  const days = daysUntil(close, now);
  // Not taking applications, and an open date is still ahead: say when it opens, not when it closes.
  const opens = opensOn ?? (opp.acceptingApplications === false ? (opp.keyDates.postDate?.date ?? null) : null);
  if (opp.status === "closed") {
    return (
      <span className="bdg bdg-done">
        <CircleMinus className="ic" aria-hidden="true" />
        {tr("funderPage.closed")}
      </span>
    );
  }
  if (opp.status === "forecasted") {
    return (
      <span className="bdg bdg-neutral">
        <Calendar className="ic" aria-hidden="true" />
        {opp.keyDates.postDate?.date ? tr("funderPage.opens", { date: formatDate(opp.keyDates.postDate.date) }) : tr("funderPage.forecasted")}
      </span>
    );
  }
  if (opens && isAfterToday(opens, now)) {
    return (
      <span className="bdg bdg-neutral">
        <Calendar className="ic" aria-hidden="true" />
        {tr("funderPage.opens", { date: formatDate(opens) })}
      </span>
    );
  }
  if (days === null) {
    return (
      <span className="bdg bdg-info">
        <RefreshCw className="ic" aria-hidden="true" />
        {tr("funderPage.rolling")}
      </span>
    );
  }
  return (
    <span className={days <= 7 ? "bdg bdg-warn" : "bdg bdg-ok"}>
      <Clock className="ic" aria-hidden="true" />
      {days < 0 ? tr("funderPage.closing") : days === 0 ? tr("funderPage.closesToday") : tr("funderPage.closesInDays", { days })}
    </span>
  );
}

export function OpportunityCard({ handle, opp }: { handle: string; opp: PublicOpportunityCard }) {
  const to = `/f/${handle}/o/${opp.slug}`;
  const close = opp.keyDates.closeDate;
  const count = formatAwardCount(opp.funding);
  return (
    <article className="oc">
      <div>
        <DeadlineBadge opp={opp} />
      </div>
      <h3>{opp.title}</h3>
      <div className="amt">{formatAwardRange(opp.funding)}</div>
      <div className="meta">
        <span>{close?.date ? `${close.name} ${formatDate(close.date)}` : (opp.funding.details ?? tr("funderPage.noFixedDeadline"))}</span>
        {count && (
          <>
            <span>·</span>
            <span>{count}</span>
          </>
        )}
      </div>
      <p style={{ fontSize: "15px", color: "#4A5C5A" }}>{opp.description}</p>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {opp.acceptedApplicantTypes.map((t) => (
          <span className="tag" key={t}>
            {applicantTypeLabel(t)}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "6px" }}>
        {opp.acceptingApplications === true ? (
          <>
            <Link to={to} className="btn btn-tenant" aria-label={tr("funderPage.applyTo", { title: opp.title })}>
              {tr("funderPage.apply")} <ArrowRight className="ic" aria-hidden="true" />
            </Link>
            <Link to={to} style={{ fontSize: "14px", fontWeight: 700 }} aria-label={tr("funderPage.detailsOf", { title: opp.title })}>
              {tr("funderPage.details")}
            </Link>
          </>
        ) : (
          // Open, but no competition is taking applications yet (or an older server): no Apply.
          <Link to={to} className="btn btn-secondary" aria-label={tr("funderPage.viewDetailsOf", { title: opp.title })}>
            {tr("funderPage.viewDetails")} <ArrowRight className="ic" aria-hidden="true" />
          </Link>
        )}
      </div>
    </article>
  );
}

export default function FunderPage() {
  const { handle = "" } = useParams();
  const page = useApiQuery((api) => api.publicFunder(handle), [handle]);

  if (page.status === "loading") return <PublicState title={tr("funderPage.loading")} />;
  if (page.status === "error") {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFound />;
    return (
      <PublicState title={tr("funderPage.thisPageCouldNotBe")}>
        <ErrorBanner error={page.error} onRetry={page.reload} />
      </PublicState>
    );
  }

  const { funder, opportunities } = page.data;
  const open = opportunities.filter((o) => o.status === "open");
  // Funds as sections when more than one fund has open calls (sent once the public data carries funds).
  const withOpen = (page.data.funds ?? []).map((f) => ({ ...f, open: open.filter((o) => f.opportunityIds.includes(o.id)) })).filter((f) => f.open.length > 0);
  const byFund = withOpen.length > 1;
  // Each named fund is a section; the default fund's calls and any others come last, together.
  const fundSections = withOpen.filter((f) => !f.isDefault);
  const others = open.filter((o) => !fundSections.some((f) => f.open.includes(o)));
  const forecasted = opportunities.filter((o) => o.status === "forecasted");
  const nextForecast = forecasted[0];
  const site = funder.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // An older server sends only the level; a level means a Passport record stands behind it.
  const fromPassport = funder.verification ? funder.verification.source === "passport" : !!funder.verificationLevel;

  return (
    <>
      <title>{tr("funderPage.fundingOpportunities", { name: funder.name })}</title>
      <PublicFrame
        funder={funder}
        nav={
          <>
            <a href="#open">{tr("funderPage.openOpportunities")}</a>
            {forecasted.length > 0 && <a href="#forecast">{tr("funderPage.forecasted")}</a>}
            {page.data.pastAwards != null && <Link to={`/f/${funder.handle}/awards`}>{tr("funderPage.grantsAwarded")}</Link>}
          </>
        }
        hero={
          <div className="mission">
            <h1>{funder.name}</h1>
            {funder.workspaceName && <p className="small" style={{ color: "var(--on-tenant)" }}>{tr("funderPage.workspaceName", { workspaceName: funder.workspaceName })}</p>}
            {funder.mission && (
              <p className="sub" style={{ color: "var(--on-tenant)" }}>
                {funder.mission}
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: "14px", flexWrap: "wrap", marginTop: "4px" }}>
              {funder.website &&
                (fromPassport ? (
                  <a href={funder.website} rel="noopener" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Globe className="ic" aria-hidden="true" />
                    {site}
                  </a>
                ) : (
                  // An unverified funder's website is shown, not linked: it may not be the funder's.
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Globe className="ic" aria-hidden="true" />
                    {tr("funderPage.notChecked", { site })}
                  </span>
                ))}
              {fromPassport ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", opacity: ".9" }}>
                  <ShieldCheck className="ic" aria-hidden="true" />
                  {tr("funderPage.claimedInOpengrantsPassport")}
                </span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", opacity: ".9", fontSize: "13px" }}>
                  <ShieldOff className="ic" aria-hidden="true" />
                  {tr("funderPage.thisFunderSOrganizationIs")}
                </span>
              )}
            </div>
          </div>
        }
      >
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column" }}>
          {!fromPassport && <UnverifiedFunderBanner name={funder.name} />}
          <section id="open">
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
              <div>
                <span className="eyebrow">{tr("funderPage.acceptingApplications")}</span>
                <h2 style={{ marginBottom: "0", marginTop: "6px" }}>{tr("funderPage.openOpportunities2")}</h2>
              </div>
              <span className="muted" style={{ fontSize: "14px" }}>
                {tr("funderPage.open", { length: open.length })}
              </span>
            </div>
            {open.length > 0 && byFund ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
                {[...fundSections.map((f) => ({ key: `f-${f.slug}`, title: f.name, slug: f.slug, description: f.description, open: f.open })), { key: "other-opportunities", title: tr("funderPage.otherOpportunities"), slug: "", description: null, open: others }]
                  .filter((f) => f.open.length > 0)
                  .map((f) => (
                    <section key={f.key} aria-labelledby={`fund-${f.key}`}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
                        <h3 id={`fund-${f.key}`} style={{ fontSize: "20px" }}>
                          {f.title}
                        </h3>
                        {f.slug && (
                          <Link to={`/f/${funder.handle}/${f.slug}`} style={{ fontSize: "14px", fontWeight: 700 }} aria-label={tr("funderPage.allOf", { title: f.title })}>
                            {tr("funderPage.fundPage")} <ArrowRight className="ic ic-sm" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                      {f.description && <p style={{ fontSize: "15px", color: "var(--og-gray-600)", marginBottom: "12px" }}>{f.description}</p>}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "20px" }}>
                        {f.open.map((o) => (
                          <OpportunityCard key={o.id} handle={funder.handle} opp={o} />
                        ))}
                      </div>
                    </section>
                  ))}
              </div>
            ) : open.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "20px" }}>
                {open.map((o) => (
                  <OpportunityCard key={o.id} handle={funder.handle} opp={o} />
                ))}
              </div>
            ) : (
              <div className="card empty" style={{ minHeight: "200px", justifyContent: "center" }}>
                <Calendar className="ic" aria-hidden="true" />
                <h3>{tr("funderPage.noOpportunitiesAreOpenRight")}</h3>
                <p>
                  {nextForecast
                    ? nextForecast.keyDates.postDate?.date
                      ? tr("funderPage.nextCycleOpens", { name: funder.name, title: nextForecast.title, date: formatDate(nextForecast.keyDates.postDate.date) })
                      : tr("funderPage.nextCycle", { name: funder.name, title: nextForecast.title })
                    : tr("funderPage.hasNotAnnouncedItsNext", { name: funder.name })}
                </p>
                {nextForecast && (
                  <div className="acts">
                    <a href="#forecast" className="btn btn-tenant">
                      {tr("funderPage.seeWhatIsPlanned")}
                    </a>
                  </div>
                )}
              </div>
            )}
          </section>

          {forecasted.length > 0 && (
            <section id="forecast">
              <span className="eyebrow">{tr("funderPage.planned")}</span>
              <h2 style={{ marginTop: "6px" }}>{tr("funderPage.forecasted")}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {forecasted.map((o) => (
                  <div className="card" key={o.id} style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "720px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <h3 style={{ fontSize: "18px" }}>{o.title}</h3>
                        <DeadlineBadge opp={o} />
                      </div>
                      <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                        {o.description}
                        {formatAwardRange(o.funding) !== "—" ? ` ${tr("funderPage.expectedRange", { funding: formatAwardRange(o.funding) })}` : ""}
                      </p>
                    </div>
                    <Link to={`/f/${funder.handle}/o/${o.slug}`} className="btn btn-secondary" aria-label={tr("funderPage.detailsOf", { title: o.title })}>
                      {tr("funderPage.details")}
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}
          <FunderExtras handle={funder.handle} />
        </div>
      </PublicFrame>
    </>
  );
}
