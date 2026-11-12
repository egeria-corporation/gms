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
import { PublicFrame, PublicState } from "./PublicFrame.tsx";
import { FunderExtras } from "./publicExtras.tsx";

/** The badge on an opportunity card: how long it stays open, in words. */
export function DeadlineBadge({ opp, now = new Date() }: { opp: Pick<PublicOpportunityCard, "status" | "keyDates">; now?: Date }) {
  const close = opp.keyDates.closeDate?.date;
  const days = daysUntil(close, now);
  if (opp.status === "closed") {
    return (
      <span className="bdg bdg-done">
        <CircleMinus className="ic" aria-hidden="true" />
        Closed
      </span>
    );
  }
  if (opp.status === "forecasted") {
    return (
      <span className="bdg bdg-neutral">
        <Calendar className="ic" aria-hidden="true" />
        {opp.keyDates.postDate?.date ? `Opens ${formatDate(opp.keyDates.postDate.date)}` : "Forecasted"}
      </span>
    );
  }
  if (days === null) {
    return (
      <span className="bdg bdg-info">
        <RefreshCw className="ic" aria-hidden="true" />
        Rolling
      </span>
    );
  }
  return (
    <span className={days <= 7 ? "bdg bdg-warn" : "bdg bdg-ok"}>
      <Clock className="ic" aria-hidden="true" />
      {days < 0 ? "Closing" : days === 0 ? "Closes today" : `Closes in ${days} day${days === 1 ? "" : "s"}`}
    </span>
  );
}

function OpportunityCard({ handle, opp }: { handle: string; opp: PublicOpportunityCard }) {
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
        <span>{close?.date ? `${close.name} ${formatDate(close.date)}` : (opp.funding.details ?? "No fixed deadline")}</span>
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
        <Link to={to} className="btn btn-tenant" aria-label={`Apply to ${opp.title}`}>
          Apply <ArrowRight className="ic" aria-hidden="true" />
        </Link>
        <Link to={to} style={{ fontSize: "14px", fontWeight: 700 }} aria-label={`Details of ${opp.title}`}>
          Details
        </Link>
      </div>
    </article>
  );
}

export default function FunderPage() {
  const { handle = "" } = useParams();
  const page = useApiQuery((api) => api.publicFunder(handle), [handle]);

  if (page.status === "loading") return <PublicState title="Loading…" />;
  if (page.status === "error") {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFound />;
    return (
      <PublicState title="This page could not be loaded">
        <ErrorBanner error={page.error} onRetry={page.reload} />
      </PublicState>
    );
  }

  const { funder, opportunities } = page.data;
  const open = opportunities.filter((o) => o.status === "open");
  const forecasted = opportunities.filter((o) => o.status === "forecasted");
  const nextForecast = forecasted[0];
  const site = funder.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // An older server sends only the level; a level means a Passport record stands behind it.
  const fromPassport = funder.verification ? funder.verification.source === "passport" : !!funder.verificationLevel;

  return (
    <>
      <title>{`${funder.name} — Funding opportunities`}</title>
      <PublicFrame
        funder={funder}
        nav={
          <>
            <a href="#open">Open opportunities</a>
            {forecasted.length > 0 && <a href="#forecast">Forecasted</a>}
          </>
        }
        hero={
          <div className="mission">
            <h1>{funder.name}</h1>
            {funder.mission && (
              <p className="sub" style={{ color: "var(--on-tenant)" }}>
                {funder.mission}
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: "14px", flexWrap: "wrap", marginTop: "4px" }}>
              {funder.website && (
                <a href={funder.website} rel="noopener" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <Globe className="ic" aria-hidden="true" />
                  {site}
                </a>
              )}
              {fromPassport ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", opacity: ".9" }}>
                  <ShieldCheck className="ic" aria-hidden="true" />
                  Claimed in OpenGrants Passport
                </span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", opacity: ".9", fontSize: "13px" }}>
                  <ShieldOff className="ic" aria-hidden="true" />
                  This funder’s organization is not verified with OpenGrants Passport
                </span>
              )}
            </div>
          </div>
        }
      >
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column" }}>
          <section id="open">
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
              <div>
                <span className="eyebrow">Accepting applications</span>
                <h2 style={{ marginBottom: "0", marginTop: "6px" }}>Open Opportunities</h2>
              </div>
              <span className="muted" style={{ fontSize: "14px" }}>
                {open.length} open
              </span>
            </div>
            {open.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "20px" }}>
                {open.map((o) => (
                  <OpportunityCard key={o.id} handle={funder.handle} opp={o} />
                ))}
              </div>
            ) : (
              <div className="card empty" style={{ minHeight: "200px", justifyContent: "center" }}>
                <Calendar className="ic" aria-hidden="true" />
                <h3>No opportunities are open right now</h3>
                <p>
                  {nextForecast
                    ? `${funder.name}'s next cycle, ${nextForecast.title}, is forecasted${nextForecast.keyDates.postDate?.date ? ` to open ${formatDate(nextForecast.keyDates.postDate.date)}` : ""}.`
                    : `${funder.name} has not announced its next cycle yet.`}
                </p>
                {nextForecast && (
                  <div className="acts">
                    <a href="#forecast" className="btn btn-tenant">
                      See what is planned
                    </a>
                  </div>
                )}
              </div>
            )}
          </section>

          {forecasted.length > 0 && (
            <section id="forecast">
              <span className="eyebrow">Planned</span>
              <h2 style={{ marginTop: "6px" }}>Forecasted</h2>
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
                        {formatAwardRange(o.funding) !== "—" ? ` Expected range ${formatAwardRange(o.funding)}.` : ""}
                      </p>
                    </div>
                    <Link to={`/f/${funder.handle}/o/${o.slug}`} className="btn btn-secondary">
                      Details
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
