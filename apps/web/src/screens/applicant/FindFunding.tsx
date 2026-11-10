// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ChevronDown, CircleCheck, CircleDashed, CircleX, ExternalLink, Info, Plus, Search, Star } from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function FindFunding() {
  return (
    <>
      <title>{"Find funding — Alder Creek Family Services"}</title>
      <ApplicantShell active="Find funding">
        <main className="main">
          <div className="ph">
            <div>
              <h1>Find funding</h1>
              <div className="meta">
                <span>Eligibility is checked against your Passport record before you start, so you only write what you can win.</span>
              </div>
            </div>
          </div>
          <div className="tabs" role="tablist">
            <Link to="/w/alder-creek/find" className="tab on" role="tab" aria-selected="true">
              Open here<span className="n">4</span>
            </Link>
            <a href="#index" className="tab" role="tab">
              OpenGrants index
            </a>
            <a href="#alerts" className="tab" role="tab">
              Alerts<span className="n">1</span>
            </a>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
            <article className="card" style={{ padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                <span className="chip">
                  <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                </span>
                <span className="bdg bdg-ok bdg-lg">
                  <CircleCheck className="ic" aria-hidden="true" />
                  Eligible
                </span>
              </div>
              <h2 style={{ fontSize: "20px" }}>Community Health Grants 2027</h2>
              <div className="row" style={{ gap: "14px", flexWrap: "wrap", fontSize: "14px", color: "#4A5C5A" }}>
                <span className="b" style={{ color: "#0D2A43" }}>
                  $50,000 – $150,000
                </span>
                <span>·</span>
                <span>Full proposal closes Apr 30, 2027</span>
                <span>·</span>
                <span>8–12 awards</span>
              </div>
              <ul style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
                <li className="row" style={{ gap: "6px", color: "#0B5E47" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  501(c)(3) in good standing
                </li>
                <li className="row" style={{ gap: "6px", color: "#0B5E47" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  Serves Riverbend County
                </li>
                <li className="row" style={{ gap: "6px", color: "#0B5E47" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  Annual budget under $5M
                </li>
                <li className="row" style={{ gap: "6px", color: "#0B5E47" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  Health is a primary program area
                </li>
              </ul>
              <div className="row" style={{ gap: "14px", marginTop: "4px", flexWrap: "wrap" }}>
                <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="btn btn-primary">
                  Start application
                </Link>
                <Link to="/f/riverbend/o/community-health-2027" className="small b">
                  Read the opportunity
                </Link>
              </div>
            </article>
            <article className="card" style={{ padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                <span className="chip">
                  <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                </span>
                <span className="bdg bdg-dng bdg-lg">
                  <CircleX className="ic" aria-hidden="true" />
                  Not eligible
                </span>
              </div>
              <h2 style={{ fontSize: "20px" }}>Housing Stability Grants 2027</h2>
              <div className="row" style={{ gap: "14px", flexWrap: "wrap", fontSize: "14px", color: "#4A5C5A" }}>
                <span className="b" style={{ color: "#0D2A43" }}>
                  $25,000 – $100,000
                </span>
                <span>·</span>
                <span>LOI closes Jun 15, 2027</span>
              </div>
              <div className="bnr bnr-dng" style={{ padding: "10px 12px" }}>
                <CircleX className="ic" aria-hidden="true" />
                <div>
                  <div className="t" style={{ fontSize: "14px" }}>
                    Requires housing services as a primary program area
                  </div>
                  <div className="d" style={{ fontSize: "13px" }}>
                    Your Passport lists Health and Family support. If that is out of date,
                    <Link to="/w/alder-creek/organization">update program areas in Passport</Link>and the result re-evaluates.
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: "14px", marginTop: "4px" }}>
                <button className="btn btn-secondary" disabled>
                  Start application
                </button>
                <Link to="/f/riverbend" className="small b">
                  Funder page
                </Link>
              </div>
            </article>
            <article
              className="card"
              style={{ "--tenant": "#7A4F01", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" } as CSSProperties}
            >
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                <span className="chip">
                  <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                </span>
                <span className="bdg bdg-neutral bdg-lg">
                  <CircleDashed className="ic" aria-hidden="true" />
                  Eligibility unknown
                </span>
              </div>
              <h2 style={{ fontSize: "20px" }}>Community Clinic Capacity Grants FY28</h2>
              <div className="row" style={{ gap: "14px", flexWrap: "wrap", fontSize: "14px", color: "#4A5C5A" }}>
                <span className="b" style={{ color: "#0D2A43" }}>
                  Up to $200,000
                </span>
                <span>·</span>
                <span>Closes Jul 31, 2027</span>
                <span>·</span>
                <span>Clinics and FQHC partners</span>
              </div>
              <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
                <Info className="ic" aria-hidden="true" />
                <div>
                  <div className="t" style={{ fontSize: "14px" }}>
                    One rule could not be checked
                  </div>
                  <div className="d" style={{ fontSize: "13px" }}>
                    “Serves Cascade County” reads your service-area field, which is missing in Passport.
                  </div>
                  <div className="clears">
                    <Link to="/w/alder-creek/organization">Add service area in Passport →</Link>
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: "14px", marginTop: "4px" }}>
                <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="btn btn-secondary">
                  Start anyway
                </Link>
                <span className="small muted">You can start; eligibility re-checks at submit.</span>
              </div>
            </article>
            <article
              className="card"
              style={{ "--tenant": "#7A4F01", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" } as CSSProperties}
            >
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                <span className="chip">
                  <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                </span>
                <span className="bdg bdg-ok bdg-lg">
                  <CircleCheck className="ic" aria-hidden="true" />
                  Eligible
                </span>
              </div>
              <h2 style={{ fontSize: "20px" }}>Overdose Prevention Mini-Grants</h2>
              <div className="row" style={{ gap: "14px", flexWrap: "wrap", fontSize: "14px", color: "#4A5C5A" }}>
                <span className="b" style={{ color: "#0D2A43" }}>
                  $5,000 – $15,000
                </span>
                <span>·</span>
                <span>Rolling · next review Jun 1</span>
                <span>·</span>
                <span>Single stage</span>
              </div>
              <ul style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
                <li className="row" style={{ gap: "6px", color: "#0B5E47" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  Nonprofit or public agency
                </li>
                <li className="row" style={{ gap: "6px", color: "#0B5E47" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  Direct-service program in the last 2 years
                </li>
              </ul>
              <div className="row" style={{ gap: "14px", marginTop: "4px" }}>
                <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="btn btn-primary">
                  Start application
                </Link>
                <Link to="/f/cascade-county" className="small b">
                  Funder page
                </Link>
              </div>
            </article>
          </div>
          <section id="index" className="card">
            <div className="card-h">
              <div>
                <h2 style={{ fontSize: "18px" }}>OpenGrants index</h2>
                <p className="small muted">Opportunities from every funder on OpenGrants, matched to your Passport profile.</p>
              </div>
              <Link to="/w/alder-creek/find" className="small b">
                Open full search
              </Link>
            </div>
            <div
              className="card-b"
              style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "20px", alignItems: "start" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="inp-icon">
                  <Search className="ic" aria-hidden="true" />
                  <input className="inp" type="search" aria-label="Search the OpenGrants index" defaultValue="rural health navigation" />
                </div>
                <div className="filterbar">
                  <button className="fchip on">Oregon</button>
                  <button className="fchip on">Health</button>
                  <button className="fchip">
                    Amount
                    <ChevronDown className="ic ic-sm" aria-hidden="true" />
                  </button>
                  <button className="fchip">
                    Deadline
                    <ChevronDown className="ic ic-sm" aria-hidden="true" />
                  </button>
                  <button className="fchip">
                    Funder type
                    <ChevronDown className="ic ic-sm" aria-hidden="true" />
                  </button>
                  <span className="small muted" style={{ marginLeft: "auto" }}>
                    212 results
                  </span>
                </div>
                <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                    <div className="b" style={{ fontSize: "17px", color: "#0D2A43" }}>
                      Rural Health Access Program
                    </div>
                    <span className="bdg bdg-prog">
                      <Star className="ic" aria-hidden="true" />
                      86% match
                    </span>
                  </div>
                  <div className="row" style={{ gap: "12px", flexWrap: "wrap", fontSize: "14px", color: "#4A5C5A" }}>
                    <span>Cedar Basin Health Foundation</span>
                    <span>·</span>
                    <span>Up to $120,000</span>
                    <span>·</span>
                    <span>Closes Aug 15, 2027</span>
                    <span>·</span>
                    <span>Not on the GMS</span>
                  </div>
                  <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                    <button className="btn btn-sm btn-secondary">Check eligibility</button>
                    <button className="btn btn-sm btn-ghost">
                      <Star className="ic" aria-hidden="true" />
                      Save
                    </button>
                    <Link to="/w/alder-creek/find" className="btn btn-sm btn-ghost">
                      Open listing
                      <ExternalLink className="ic" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
                <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                    <div className="b" style={{ fontSize: "17px", color: "#0D2A43" }}>
                      Community Health Worker Expansion
                    </div>
                    <span className="bdg bdg-prog">
                      <Star className="ic" aria-hidden="true" />
                      74% match
                    </span>
                  </div>
                  <div className="row" style={{ gap: "12px", flexWrap: "wrap", fontSize: "14px", color: "#4A5C5A" }}>
                    <span>State Office of Rural Health</span>
                    <span>·</span>
                    <span>$40,000 – $250,000</span>
                    <span>·</span>
                    <span>Forecasted · opens Sep 2027</span>
                  </div>
                  <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                    <button className="btn btn-sm btn-secondary">Check eligibility</button>
                    <button className="btn btn-sm btn-ghost">
                      <Star className="ic" aria-hidden="true" />
                      Save
                    </button>
                    <Link to="/w/alder-creek/find" className="btn btn-sm btn-ghost">
                      Open listing
                      <ExternalLink className="ic" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
              <aside
                id="alerts"
                className="card"
                style={{ background: "#F7FAFA", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>Alerts</h3>
                  <button className="btn btn-sm btn-secondary">
                    <Plus className="ic" aria-hidden="true" />
                    New
                  </button>
                </div>
                <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div className="b">“rural health navigation”</div>
                  <div className="small muted">Oregon · Health · weekly digest · 3 new this week</div>
                  <div className="row small" style={{ gap: "10px" }}>
                    <a href="#alerts">Edit</a>
                    <a href="#alerts">Pause</a>
                  </div>
                </div>
                <p className="small muted">Alerts search the whole OpenGrants index, not only funders on the GMS.</p>
              </aside>
            </div>
          </section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", marginTop: "8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · no results</span>
              <div className="card empty">
                <Search className="ic" aria-hidden="true" />
                <h3>No opportunities match “equine therapy” in Oregon</h3>
                <p>Try fewer filters, or save this as an alert and we’ll tell you when something is listed.</p>
                <div className="acts">
                  <button className="btn btn-primary">Save as alert</button>
                  <Link to="/w/alder-creek/find" className="small b">
                    Clear filters
                  </Link>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · eligibility unknown</span>
              <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div className="row" style={{ gap: "8px" }}>
                  <span className="bdg bdg-neutral bdg-lg">
                    <CircleDashed className="ic" aria-hidden="true" />
                    Eligibility unknown
                  </span>
                </div>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Unknown is shown when a rule cannot be evaluated: a Passport field is missing, a document has expired, or Passport cannot
                  be reached. It is never collapsed into Eligible or Not eligible. The card names the rule, the field it reads and where to
                  fix it.
                </p>
                <ul style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
                  <li className="row" style={{ gap: "6px", color: "#0B5E47" }}>
                    <CircleCheck className="ic" aria-hidden="true" />
                    Nonprofit or public agency
                  </li>
                  <li className="row" style={{ gap: "6px", color: "#4A5C5A" }}>
                    <CircleDashed className="ic" aria-hidden="true" />
                    Serves Cascade County — reads<span className="mono">org.serviceArea</span>(missing) ·
                    <Link to="/w/alder-creek/organization">fix</Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
