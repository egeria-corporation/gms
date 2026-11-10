// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { ChartColumn, ChevronDown, Download, FileText, Info } from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function Analytics() {
  return (
    <>
      <title>{"Analytics — Riverbend funder workspace"}</title>
      <FunderShell active="Analytics">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <span>Analytics</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Analytics</h1>
              </div>
              <div className="meta">
                <span>FY2027 · all programs</span>
                <span>·</span>
                <span>Figures refresh nightly; payments update as Passport settles them</span>
              </div>
            </div>
            <div className="actions">
              <span className="small muted">Export</span>
              <button className="btn btn-secondary">
                <Download className="ic" aria-hidden="true" />
                CSV
              </button>
              <button className="btn btn-secondary">
                <Download className="ic" aria-hidden="true" />
                CommonGrants JSON
              </button>
              <button className="btn btn-secondary">
                <FileText className="ic" aria-hidden="true" />
                990-PF Part XV
              </button>
            </div>
          </div>
          <div className="filterbar">
            <button className="fchip on">
              FY:<span className="v">2027</span>
            </button>
            <button className="fchip">
              Program:<span className="v">All</span>
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="fchip">
              Geography:<span className="v">All</span>
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="fchip">
              Applicant type:<span className="v">All</span>
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <button className="fchip">
              PCS subject / population
              <ChevronDown className="ic ic-sm" aria-hidden="true" />
            </button>
            <Link to="/w/riverbend/analytics" className="small b" style={{ marginLeft: "4px" }}>
              Reset
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "16px" }}>
            <div className="stat">
              <span className="stat-l">Committed</span>
              <span className="stat-v">$882,000</span>
              <span className="stat-d">16 awards across 3 programs</span>
            </div>
            <div className="stat">
              <span className="stat-l">Paid</span>
              <span className="stat-v">$548,000</span>
              <span className="stat-d">62% of committed · settled via Passport</span>
            </div>
            <div className="stat">
              <span className="stat-l">Awards</span>
              <span className="stat-v">16</span>
              <span className="stat-d">7 new this cycle · 9 continuing</span>
            </div>
            <div className="stat">
              <span className="stat-l">Acceptance rate</span>
              <span className="stat-v">24%</span>
              <span className="stat-d">16 of 67 full proposals</span>
            </div>
            <div className="stat">
              <span className="stat-l">Median days to decision</span>
              <span className="stat-v">61</span>
              <span className="stat-d">Submission → committed decision</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
            <div className="card">
              <div className="card-h">
                <h3>Committed vs paid by program</h3>
                <span className="row small muted" style={{ gap: "12px" }}>
                  <span className="row" style={{ gap: "5px" }}>
                    <span
                      style={{ width: "10px", height: "10px", background: "#145450", borderRadius: "2px", display: "inline-block" }}
                    ></span>
                    Paid
                  </span>
                  <span className="row" style={{ gap: "5px" }}>
                    <span
                      style={{ width: "10px", height: "10px", background: "#C2F0ED", borderRadius: "2px", display: "inline-block" }}
                    ></span>
                    Committed, unpaid
                  </span>
                </span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="bar-h">
                  <span>Community Health 2027</span>
                  <div className="trk" role="img" aria-label="Community Health 2027: $150,000 paid of $450,000 committed">
                    <div className="f1" style={{ width: "33%" }}></div>
                    <div className="f2" style={{ width: "67%" }}></div>
                  </div>
                  <span className="num b">$450,000</span>
                </div>
                <div className="bar-h">
                  <span>Housing Stability 2027</span>
                  <div className="trk" role="img" aria-label="Housing Stability 2027: $236,000 paid of $280,000 committed">
                    <div className="f1" style={{ width: "84%" }}></div>
                    <div className="f2" style={{ width: "16%" }}></div>
                  </div>
                  <span className="num b">$280,000</span>
                </div>
                <div className="bar-h">
                  <span>Youth Opportunity 2027</span>
                  <div className="trk" role="img" aria-label="Youth Opportunity 2027: $0 paid of $0 committed">
                    <div className="f1" style={{ width: "0%" }}></div>
                  </div>
                  <span className="num b">$0</span>
                </div>
                <div className="bar-h">
                  <span>Rapid Response Fund</span>
                  <div className="trk" role="img" aria-label="Rapid Response Fund: $162,000 paid of $152,000 committed">
                    <div className="f1" style={{ width: "100%" }}></div>
                  </div>
                  <span className="num b">$152,000</span>
                </div>
                <p className="small muted">
                  Bars are scaled to the largest program budget ($1,200,000). Rapid Response Fund is over-committed by $10,000 — see{" "}
                  <Link to="/w/riverbend/programs">Programs</Link>.
                </p>
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <h3>Awards by region</h3>
                <span className="small muted">FY2027 · count of awards</span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="bar-h" style={{ gridTemplateColumns: "160px minmax(0, 1fr) 40px" }}>
                  <span>Alder Creek valley</span>
                  <div className="trk" role="img" aria-label="Alder Creek valley: 5 awards">
                    <div className="f1" style={{ width: "100%" }}></div>
                  </div>
                  <span className="num b">5</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "160px minmax(0, 1fr) 40px" }}>
                  <span>Riverbend city</span>
                  <div className="trk" role="img" aria-label="Riverbend city: 4 awards">
                    <div className="f1" style={{ width: "80%" }}></div>
                  </div>
                  <span className="num b">4</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "160px minmax(0, 1fr) 40px" }}>
                  <span>North county</span>
                  <div className="trk" role="img" aria-label="North county: 3 awards">
                    <div className="f1" style={{ width: "60%" }}></div>
                  </div>
                  <span className="num b">3</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "160px minmax(0, 1fr) 40px" }}>
                  <span>Copper Valley</span>
                  <div className="trk" role="img" aria-label="Copper Valley: 3 awards">
                    <div className="f1" style={{ width: "60%" }}></div>
                  </div>
                  <span className="num b">3</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "160px minmax(0, 1fr) 40px" }}>
                  <span>Harbor district</span>
                  <div className="trk" role="img" aria-label="Harbor district: 1 award">
                    <div className="f1" style={{ width: "20%" }}></div>
                  </div>
                  <span className="num b">1</span>
                </div>
                <p className="small muted">Region comes from the organization's Passport service area, not its mailing address.</p>
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <h3>Cycle funnel — Community Health Grants 2027</h3>
                <Link to="/w/riverbend/competitions/community-health-2027" className="small b">
                  Open competition
                </Link>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px minmax(0, 1fr) 60px",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "13px",
                  }}
                >
                  <span>LOI received</span>
                  <div
                    style={{ height: "28px", background: "#145450", borderRadius: "4px", width: "100%" }}
                    role="img"
                    aria-label="LOI received: 58"
                  ></div>
                  <span className="num b">58</span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px minmax(0, 1fr) 60px",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "13px",
                  }}
                >
                  <span>Full proposal</span>
                  <div style={{ width: "100%" }}>
                    <div
                      style={{ height: "28px", background: "#29A79F", borderRadius: "4px", width: "62%" }}
                      role="img"
                      aria-label="Full proposal: 36"
                    ></div>
                  </div>
                  <span className="num b">36</span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px minmax(0, 1fr) 60px",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "13px",
                  }}
                >
                  <span>Interview</span>
                  <div style={{ width: "100%" }}>
                    <div
                      style={{ height: "28px", background: "#4A86E8", borderRadius: "4px", width: "7%", minWidth: "12px" }}
                      role="img"
                      aria-label="Interview: 4"
                    ></div>
                  </div>
                  <span className="num b">4</span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px minmax(0, 1fr) 60px",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "13px",
                  }}
                >
                  <span>Awarded</span>
                  <div style={{ width: "100%" }}>
                    <div
                      style={{ height: "28px", background: "#0D2A43", borderRadius: "4px", width: "12%", minWidth: "12px" }}
                      role="img"
                      aria-label="Awarded: 7"
                    ></div>
                  </div>
                  <span className="num b">7</span>
                </div>
                <p className="small muted">
                  Interview is optional per stage rules: 4 invited, 7 awarded (3 awarded directly from Full proposal).
                </p>
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <h3>Reviewer load</h3>
                <span className="small muted">Full proposal stage · completed / assigned</span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="bar-h" style={{ gridTemplateColumns: "160px minmax(0, 1fr) 70px" }}>
                  <span className="row" style={{ gap: "8px" }}>
                    <span className="av av-sm av-t">PN</span>Priya Natarajan
                  </span>
                  <div className="trk" role="img" aria-label="Priya Natarajan: 12 of 14 reviews complete">
                    <div className="f1" style={{ width: "86%" }}></div>
                    <div className="f2" style={{ width: "14%" }}></div>
                  </div>
                  <span className="num b">12 / 14</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "160px minmax(0, 1fr) 70px" }}>
                  <span className="row" style={{ gap: "8px" }}>
                    <span className="av av-sm av-g">HG</span>Dr. Hollis Grant
                  </span>
                  <div className="trk" role="img" aria-label="Dr. Hollis Grant: 9 of 12 reviews complete">
                    <div className="f1" style={{ width: "75%" }}></div>
                    <div className="f2" style={{ width: "25%" }}></div>
                  </div>
                  <span className="num b">9 / 12</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "160px minmax(0, 1fr) 70px" }}>
                  <span className="row" style={{ gap: "8px" }}>
                    <span className="av av-sm">DO</span>Dana Ortiz
                  </span>
                  <div className="trk" role="img" aria-label="Dana Ortiz: 10 of 10 reviews complete">
                    <div className="f1" style={{ width: "100%" }}></div>
                  </div>
                  <span className="num b">10 / 10</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "160px minmax(0, 1fr) 70px" }}>
                  <span className="row" style={{ gap: "8px" }}>
                    <span className="av av-sm av-n">ML</span>Marcus Lee
                  </span>
                  <div className="trk" role="img" aria-label="Marcus Lee: 4 of 8 reviews complete">
                    <div className="f1" style={{ width: "50%" }}></div>
                    <div className="f2" style={{ width: "50%" }}></div>
                  </div>
                  <span className="num b">4 / 8</span>
                </div>
                <p className="small muted">
                  Scaled to 14 assignments. Uneven load is flagged in <Link to="/w/riverbend/reviews/assign">Review assignment</Link>.
                </p>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div className="row" style={{ gap: "10px" }}>
                <h3>Equity lens</h3>
                <span className="tag">Shown because demographic fields were collected</span>
              </div>
              <span className="small muted">Applicant type · FY2027</span>
            </div>
            <div
              className="card-b"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)",
                gap: "24px",
                alignItems: "start",
              }}
            >
              <p className="small muted" style={{ lineHeight: 1.6 }}>
                Compares who applied with who was awarded, by applicant type. Groups with fewer than 5 applicants are combined into “Other”
                so no organization is identifiable. Demographic fields are never shown to reviewers and never leave this view except in
                aggregate exports.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="eyebrow">Applicants · 67</span>
                <div className="bar-h" style={{ gridTemplateColumns: "110px minmax(0, 1fr) 36px", fontSize: "12px" }}>
                  <span>Nonprofit</span>
                  <div className="trk" style={{ height: "10px" }} role="img" aria-label="Nonprofit applicants: 48">
                    <div className="f1" style={{ width: "72%", background: "#29A79F" }}></div>
                  </div>
                  <span className="num b">48</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "110px minmax(0, 1fr) 36px", fontSize: "12px" }}>
                  <span>Public agency</span>
                  <div className="trk" style={{ height: "10px" }} role="img" aria-label="Public agency applicants: 9">
                    <div className="f1" style={{ width: "13%", background: "#29A79F" }}></div>
                  </div>
                  <span className="num b">9</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "110px minmax(0, 1fr) 36px", fontSize: "12px" }}>
                  <span>Tribal</span>
                  <div className="trk" style={{ height: "10px" }} role="img" aria-label="Tribal applicants: 5">
                    <div className="f1" style={{ width: "7%", background: "#29A79F" }}></div>
                  </div>
                  <span className="num b">5</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "110px minmax(0, 1fr) 36px", fontSize: "12px" }}>
                  <span>Other (n {"<"} 5 each)</span>
                  <div className="trk" style={{ height: "10px" }} role="img" aria-label="Other applicants: 5">
                    <div className="f1" style={{ width: "7%", background: "#29A79F" }}></div>
                  </div>
                  <span className="num b">5</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="eyebrow">Awards · 16</span>
                <div className="bar-h" style={{ gridTemplateColumns: "110px minmax(0, 1fr) 36px", fontSize: "12px" }}>
                  <span>Nonprofit</span>
                  <div className="trk" style={{ height: "10px" }} role="img" aria-label="Nonprofit awards: 11">
                    <div className="f1" style={{ width: "69%" }}></div>
                  </div>
                  <span className="num b">11</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "110px minmax(0, 1fr) 36px", fontSize: "12px" }}>
                  <span>Public agency</span>
                  <div className="trk" style={{ height: "10px" }} role="img" aria-label="Public agency awards: 3">
                    <div className="f1" style={{ width: "19%" }}></div>
                  </div>
                  <span className="num b">3</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "110px minmax(0, 1fr) 36px", fontSize: "12px" }}>
                  <span>Tribal</span>
                  <div className="trk" style={{ height: "10px" }} role="img" aria-label="Tribal awards: 2">
                    <div className="f1" style={{ width: "12%" }}></div>
                  </div>
                  <span className="num b">2</span>
                </div>
                <div className="bar-h" style={{ gridTemplateColumns: "110px minmax(0, 1fr) 36px", fontSize: "12px" }}>
                  <span>Other (n {"<"} 5 each)</span>
                  <div className="trk" style={{ height: "10px" }} role="img" aria-label="Other awards: 0">
                    <div className="f1" style={{ width: "0%" }}></div>
                  </div>
                  <span className="num b">0</span>
                </div>
              </div>
            </div>
            <div className="card-f">
              <Info className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
              <span className="small muted">
                Aggregation threshold n ≥ 5. Exports of this card carry the same threshold and are logged in the audit ledger.
              </span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
            <span className="eyebrow">State · insufficient data</span>
            <div className="card" style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "0" }}>
              <div style={{ padding: "16px 20px", borderRight: "1px solid #D6DEDE", display: "flex", flexDirection: "column", gap: "6px" }}>
                <span className="small muted b">Active filters</span>
                <span className="fchip on" style={{ alignSelf: "flex-start" }}>
                  Program:<span className="v">Youth Opportunity 2027</span>
                </span>
                <span className="fchip on" style={{ alignSelf: "flex-start" }}>
                  Geography:<span className="v">Harbor district</span>
                </span>
              </div>
              <div className="empty" style={{ padding: "28px 24px", alignItems: "flex-start", textAlign: "left" }}>
                <ChartColumn className="ic" aria-hidden="true" />
                <h3>Not enough awards to chart</h3>
                <p style={{ maxWidth: "560px" }}>
                  This filter matches 2 awards. Charts and the equity lens need at least 5 so that no single organization can be read from a
                  bar. Totals are still shown in the tiles above.
                </p>
                <div className="acts">
                  <Link to="/w/riverbend/analytics" className="btn btn-secondary">
                    Widen the filter
                  </Link>
                  <Link to="/w/riverbend/grantees/org_alder-creek" className="small b">
                    List the 2 grantees instead
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
