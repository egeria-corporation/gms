// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { BadgeCheck, Download, Eye, Mail, Plus, Star, TriangleExclamationPoint } from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function Programs() {
  return (
    <>
      <title>{"Programs — Riverbend funder workspace"}</title>
      <FunderShell active="Programs">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <span>Programs</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Programs</h1>
              </div>
              <div className="meta">
                <span>4 programs · FY2027</span>
                <span>·</span>
                <span>$2,650,000 budgeted</span>
                <span>·</span>
                <span>$882,000 committed</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-secondary">
                <Download className="ic" aria-hidden="true" />
                Export
              </button>
              <button className="btn btn-primary">
                <Plus className="ic" aria-hidden="true" />
                New program
              </button>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Program</th>
                  <th>FY</th>
                  <th className="num">Budget</th>
                  <th className="num">Committed</th>
                  <th className="num">Paid</th>
                  <th className="num">Remaining</th>
                  <th className="num">Opportunities</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                <tr className="sel">
                  <td>
                    <Link to="/w/riverbend/programs/community-health-2027" className="b" style={{ color: "#0D2A43" }}>
                      Community Health 2027
                    </Link>
                  </td>
                  <td>2027</td>
                  <td className="num">$1,200,000</td>
                  <td className="num">$720,000</td>
                  <td className="num">$0</td>
                  <td className="num">$480,000</td>
                  <td className="num">1</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/w/riverbend/programs/community-health-2027" className="b" style={{ color: "#0D2A43" }}>
                      Housing Stability 2027
                    </Link>
                  </td>
                  <td>2027</td>
                  <td className="num">$800,000</td>
                  <td className="num">$0</td>
                  <td className="num">$0</td>
                  <td className="num">$800,000</td>
                  <td className="num">1</td>
                  <td>
                    <span className="av av-sm" title="Dana Ortiz">
                      DO
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/w/riverbend/programs/community-health-2027" className="b" style={{ color: "#0D2A43" }}>
                      Youth Opportunity 2027
                    </Link>
                  </td>
                  <td>2027</td>
                  <td className="num">$500,000</td>
                  <td className="num">$0</td>
                  <td className="num">$0</td>
                  <td className="num">$500,000</td>
                  <td className="num">0</td>
                  <td>
                    <span className="av av-sm av-t" title="Priya Natarajan">
                      PN
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/programs/community-health-2027" className="nm">
                        Rapid Response Fund
                      </Link>
                      <div className="sub">
                        <span className="pill-warn">
                          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                          Over-committed
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>2027</td>
                  <td className="num">$150,000</td>
                  <td className="num b" style={{ color: "#9B1C1C" }}>
                    $162,000
                  </td>
                  <td className="num">$96,500</td>
                  <td className="num b" style={{ color: "#9B1C1C" }}>
                    <span className="row" style={{ justifyContent: "flex-end", gap: "5px" }}>
                      <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                      −$12,000
                    </span>
                  </td>
                  <td className="num">0</td>
                  <td>
                    <span className="av av-sm av-n" title="Marcus Lee">
                      ML
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-h" style={{ padding: "16px 20px" }}>
              <div>
                <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: "18px" }}>Community Health 2027</h2>
                  <span className="bdg bdg-ok">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    Active
                  </span>
                </div>
                <div className="small muted" style={{ marginTop: "4px" }}>
                  FY2027 · Jul 1, 2027 – Jun 30, 2028 · Owner Dana Ortiz · Finance Marcus Lee
                </div>
              </div>
              <div className="row" style={{ gap: "8px" }}>
                <button className="btn btn-secondary">Edit program</button>
                <Link to="/w/riverbend/opportunities/community-health-2027/edit" className="btn btn-primary">
                  <Plus className="ic" aria-hidden="true" />
                  New opportunity
                </Link>
              </div>
            </div>
            <div
              className="card-b"
              style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "24px", alignItems: "start" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: "0" }}>
                <div className="mtr">
                  <div className="lbls">
                    <span>Budget headroom</span>
                    <span>
                      Available <b>$1,200,000</b> · Allocated <b>$720,000</b> · Pending <b>$0</b> · Remaining <b>$480,000</b>
                    </span>
                  </div>
                  <div className="track" aria-label="Allocated 60 percent of budget">
                    <div className="fill" style={{ width: "60%" }}></div>
                    <div className="fill pend" style={{ width: "0%" }}></div>
                  </div>
                </div>
                <div>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3>Opportunities</h3>
                    <Link to="/w/riverbend/opportunities/community-health-2027/edit" className="small b">
                      Add opportunity
                    </Link>
                  </div>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Opportunity</th>
                          <th>Status</th>
                          <th>Stage</th>
                          <th className="num">Applications</th>
                          <th>Closes</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            <Link to="/w/riverbend/competitions/community-health-2027" className="b" style={{ color: "#0D2A43" }}>
                              Community Health Grants 2027
                            </Link>
                          </td>
                          <td>
                            <span className="bdg bdg-prog">
                              <Eye className="ic" aria-hidden="true" />
                              Open
                            </span>
                          </td>
                          <td>Full proposal</td>
                          <td className="num">36</td>
                          <td>Apr 30, 2027</td>
                          <td className="num">
                            <Link to="/w/riverbend/competitions/community-health-2027" className="btn btn-sm btn-secondary">
                              Competition
                            </Link>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <h3 style={{ marginBottom: "8px" }}>Outcomes rollup · 2026 cycle</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
                    <div className="stat">
                      <span className="stat-l">Awards made</span>
                      <span className="stat-v">9</span>
                      <span className="stat-d">$610,000 committed · 7 active</span>
                    </div>
                    <div className="stat">
                      <span className="stat-l">Families served (reported)</span>
                      <span className="stat-v">412</span>
                      <span className="stat-d">From 6 interim reports</span>
                    </div>
                    <div className="stat">
                      <span className="stat-l">Reports on time</span>
                      <span className="stat-v">87%</span>
                      <span className="stat-d">13 of 15 due</span>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
                <div className="card" style={{ background: "#F7FAFA" }}>
                  <div className="card-h" style={{ padding: "12px 16px" }}>
                    <h3 style={{ fontSize: "14px" }}>Program defaults</h3>
                    <Link to="/w/riverbend/settings/mcp" className="small b">
                      Edit
                    </Link>
                  </div>
                  <div className="card-b" style={{ padding: "14px 16px" }}>
                    <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
                      <dt>Rubric</dt>
                      <dd>
                        <Link to="/w/riverbend/competitions/community-health-2027">Community Health rubric v3</Link> · 5 criteria
                      </dd>
                      <dt>Letter templates</dt>
                      <dd>
                        <Link to="/w/riverbend/communications">Standard set v3</Link> (ack, revision, decline, award)
                      </dd>
                      <dt>Agreement</dt>
                      <dd>Riverbend grant agreement v2</dd>
                      <dt>Requirement plan</dt>
                      <dd>Interim report at month 6 · Final report at close</dd>
                      <dt>Reminder plan</dt>
                      <dd>−14, −7, −1 days · overdue weekly</dd>
                      <dt>Payment schedule</dt>
                      <dd>50% on execution · 40% on interim · 10% on final</dd>
                    </dl>
                  </div>
                </div>
                <div className="card" style={{ background: "#F7FAFA" }}>
                  <div className="card-h" style={{ padding: "12px 16px" }}>
                    <h3 style={{ fontSize: "14px" }}>Committed by status</h3>
                  </div>
                  <div
                    className="card-b"
                    style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}
                  >
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="row" style={{ gap: "6px" }}>
                        <span className="bdg bdg-prog">
                          <Star className="ic" aria-hidden="true" />
                          Recommended
                        </span>
                      </span>
                      <span className="num b">$720,000 · 6</span>
                    </div>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="bdg bdg-info">
                        <Mail className="ic" aria-hidden="true" />
                        Offered
                      </span>
                      <span className="num b">$0 · 0</span>
                    </div>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="bdg bdg-ok">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        Active
                      </span>
                      <span className="num b">$0 · 0</span>
                    </div>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      Allocations become commitments when the panel commits decisions (F10). Nothing is paid before an agreement is
                      executed.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
            <span className="eyebrow">State · over-committed program (Rapid Response Fund)</span>
            <div className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="row" style={{ gap: "10px" }}>
                <h3>Rapid Response Fund</h3>
                <span className="bdg bdg-dng">
                  <TriangleExclamationPoint className="ic" aria-hidden="true" />
                  Over-committed by $12,000
                </span>
              </div>
              <div className="mtr mtr-over">
                <div className="lbls">
                  <span>Budget headroom</span>
                  <span>
                    Available <b>$150,000</b> · Allocated <b>$162,000</b> · Paid <b>$96,500</b>
                  </span>
                </div>
                <div className="track" aria-label="Allocated 108 percent of budget">
                  <div className="fill" style={{ width: "100%" }}></div>
                </div>
                <div className="over-msg">
                  <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                  Commitments exceed the budget. Increase the budget, move an award to another program, or cancel a scheduled tranche before
                  releasing more payments.
                </div>
              </div>
              <div className="row" style={{ gap: "8px" }}>
                <button className="btn btn-sm btn-secondary">Increase budget</button>
                <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="btn btn-sm btn-secondary">
                  Review awards
                </Link>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
