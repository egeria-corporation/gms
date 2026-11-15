// SPDX-License-Identifier: AGPL-3.0-only
// `/f/:handle/:fundSlug` — one fund's public page: the fund's name and description under the
// funder's brand, and the fund's open and forecasted opportunities. Everything here comes from
// `GET /gms/public/funders/{handle}/funds/{slug}` (published fields only; never a budget or an advisor).
import { Link, useParams } from "react-router";
import { Calendar } from "lucide-react";
import { ApiError } from "../../api/client.ts";
import { useApiQuery } from "../../api/hooks.ts";
import { FundMark } from "../../components/FundSwitcher.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { DeadlineBadge, OpportunityCard } from "./FunderPage.tsx";
import { PublicFrame, PublicState } from "./PublicFrame.tsx";

export default function FundPage() {
  const { handle = "", fundSlug = "" } = useParams();
  const page = useApiQuery(async (api) => api.publicFund(handle, fundSlug), [handle, fundSlug]);

  if (page.status === "loading") return <PublicState title="Loading…" />;
  if (page.status === "error") {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFound />;
    return (
      <PublicState title="This page could not be loaded">
        <ErrorBanner error={page.error} onRetry={page.reload} />
      </PublicState>
    );
  }

  const { funder, fund, open, forecasted } = page.data;
  const home = `/f/${funder.handle}`;
  return (
    <>
      <title>{`${fund.name} — ${funder.name}`}</title>
      <PublicFrame
        funder={funder}
        nav={
          <>
            <Link to={home}>All of {funder.name}</Link>
            {forecasted.length > 0 && <a href="#forecast">Forecasted</a>}
          </>
        }
        hero={
          <div className="mission">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {fund.brand.logoUrl ? <img src={fund.brand.logoUrl} alt="" style={{ height: "40px", width: "auto", borderRadius: "8px" }} /> : <FundMark fund={fund} size={40} />}
              <h1>{fund.name}</h1>
            </div>
            <p className="sub" style={{ color: "var(--on-tenant)" }}>
              A fund of {funder.name}
            </p>
            {fund.description && (
              <p className="sub" style={{ color: "var(--on-tenant)" }}>
                {fund.description}
              </p>
            )}
          </div>
        }
      >
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column" }}>
          <section id="open">
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
              <div>
                <span className="eyebrow">Accepting applications</span>
                <h2 style={{ marginBottom: "0", marginTop: "6px" }}>Open opportunities</h2>
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
                <h3>Nothing is open in this fund right now</h3>
                <p>
                  <Link to={home}>See what {funder.name} has open.</Link>
                </p>
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
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <h3 style={{ fontSize: "18px" }}>{o.title}</h3>
                      <DeadlineBadge opp={o} />
                    </div>
                    <Link to={`/f/${funder.handle}/o/${o.slug}`} className="btn btn-secondary">
                      Details
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </PublicFrame>
    </>
  );
}
