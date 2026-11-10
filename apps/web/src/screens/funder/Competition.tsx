// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Check, CircleCheck, CircleX, ExternalLink, Eye, Lock, Pencil, Plus } from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function Competition() {
  return (
    <>
      <title>{"Competition — Community Health Grants 2027"}</title>
      <FunderShell active="Opportunities">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/programs/community-health-2027">Community Health 2027</Link>
            <span>›</span>
            <span>Community Health Grants 2027</span>
            <span>›</span>
            <span>Competition</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Community Health Grants 2027</h1>
                <span className="bdg bdg-prog">
                  <Eye className="ic" aria-hidden="true" />
                  Full proposal stage open
                </span>
              </div>
              <div className="meta">
                <Link to="/f/riverbend/o/community-health-2027" className="row" style={{ gap: "5px" }}>
                  <ExternalLink className="ic ic-sm" aria-hidden="true" />
                  gms.opengrants.io/f/riverbend/o/community-health-2027
                </Link>
                <span>·</span>
                <span>Opened Jan 15, 2027</span>
                <span>·</span>
                <span>Decision Jun 15, 2027</span>
                <span>·</span>
                <span>Program budget $1,200,000</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-secondary">
                <Pencil className="ic" aria-hidden="true" />
                Edit stages
              </button>
              <Link to="/w/riverbend/competitions/community-health-2027/panel" className="btn btn-secondary">
                Panel
              </Link>
              <button className="btn btn-danger">Close stage</button>
            </div>
          </div>
          <div className="card" style={{ padding: "18px 20px" }}>
            <div className="stp" aria-label="Stage timeline">
              <div className="s done">
                <span className="n">
                  <Check className="ic ic-sm" aria-hidden="true" />
                </span>
                <div>
                  <div>LOI</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Jan 15 – Feb 28 · 58 received · closed
                  </div>
                </div>
              </div>
              <div className="ln done"></div>
              <div className="s on">
                <span className="n">2</span>
                <div>
                  <div>Full proposal</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Mar 15 – Apr 30 · 36 in stage · open
                  </div>
                </div>
              </div>
              <div className="ln"></div>
              <div className="s">
                <span className="n">3</span>
                <div>
                  <div>Interview</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    May 3 – 14 · 4 invited
                  </div>
                </div>
              </div>
              <div className="ln"></div>
              <div className="s">
                <span className="n">4</span>
                <div>
                  <div>Decision</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Panel May 18 · letters Jun 15
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
            <Link to="/w/riverbend/applications" className="stat" style={{ textDecoration: "none" }}>
              <span className="stat-l">LOI</span>
              <span className="stat-v">58</span>
              <span className="stat-d">36 advanced · 22 declined</span>
            </Link>
            <Link to="/w/riverbend/applications" className="stat" style={{ textDecoration: "none" }}>
              <span className="stat-l">Full proposal</span>
              <span className="stat-v">36</span>
              <span className="stat-d">28 under review · 4 need screening · 4 revision</span>
            </Link>
            <Link to="/w/riverbend/applications" className="stat" style={{ textDecoration: "none" }}>
              <span className="stat-l">Interview</span>
              <span className="stat-v">4</span>
              <span className="stat-d">Invited · slots open May 3–14</span>
            </Link>
            <Link to="/w/riverbend/competitions/community-health-2027/panel" className="stat" style={{ textDecoration: "none" }}>
              <span className="stat-l">Decided</span>
              <span className="stat-v">0</span>
              <span className="stat-d">$0 of $1,200,000 allocated</span>
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px" }}>
              <div className="card">
                <div className="card-h" style={{ padding: "12px 16px" }}>
                  <h3 style={{ fontSize: "14px" }}>Forms</h3>
                  <Link to="/w/riverbend/forms/loi-v2/edit" className="small b">
                    Builder
                  </Link>
                </div>
                <div
                  className="card-b"
                  style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}
                >
                  <div>
                    <div className="b" style={{ color: "#0D2A43" }}>
                      LOI form
                    </div>
                    <div className="row small muted" style={{ gap: "6px" }}>
                      <span className="tag">v1</span>pinned · stage closed
                    </div>
                  </div>
                  <div>
                    <div className="b" style={{ color: "#0D2A43" }}>
                      Full proposal form
                    </div>
                    <div className="row small muted" style={{ gap: "6px" }}>
                      <span className="tag">v2</span>pinned ·<Link to="/w/riverbend/forms/loi-v2/edit">v3 draft</Link>in progress
                    </div>
                  </div>
                  <div>
                    <div className="b" style={{ color: "#0D2A43" }}>
                      Interview notes
                    </div>
                    <div className="row small muted" style={{ gap: "6px" }}>
                      <span className="tag">v1</span>internal only
                    </div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h" style={{ padding: "12px 16px" }}>
                  <h3 style={{ fontSize: "14px" }}>Rubric</h3>
                  <Link to="/w/riverbend/settings/mcp" className="small b">
                    Rubrics
                  </Link>
                </div>
                <div
                  className="card-b"
                  style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}
                >
                  <div className="b" style={{ color: "#0D2A43" }}>
                    Community Health rubric v3{" "}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      · 5 criteria, 1–5 scale
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>Need & evidence</span>
                    <span className="tag">25%</span>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>Approach</span>
                    <span className="tag">25%</span>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>Capacity</span>
                    <span className="tag">20%</span>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>Budget reasonableness</span>
                    <span className="tag">15%</span>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>Outcomes & evaluation</span>
                    <span className="tag">15%</span>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h" style={{ padding: "12px 16px" }}>
                  <h3 style={{ fontSize: "14px" }}>Reviewer pool</h3>
                  <Link to="/w/riverbend/reviews/assign" className="small b">
                    Assign
                  </Link>
                </div>
                <div
                  className="card-b"
                  style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}
                >
                  <div className="row" style={{ gap: "8px" }}>
                    <span className="av av-sm av-t">PN</span>
                    <div>
                      <div className="b" style={{ color: "#0D2A43" }}>
                        Priya Natarajan
                      </div>
                      <div className="muted xs">Staff · 14 assigned · health</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <span className="av av-sm av-n">ML</span>
                    <div>
                      <div className="b" style={{ color: "#0D2A43" }}>
                        Marcus Lee
                      </div>
                      <div className="muted xs">Staff · 10 assigned · finance</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <span className="av av-sm av-g">HG</span>
                    <div>
                      <div className="b" style={{ color: "#0D2A43" }}>
                        Dr. Hollis Grant <span className="tag">External</span>
                      </div>
                      <div className="muted xs">Invited · 12 assigned · clinical</div>
                    </div>
                  </div>
                  <div className="divider"></div>
                  <div>
                    <div className="b" style={{ color: "#0D2A43" }}>
                      Entry rules
                    </div>
                    <div className="muted xs">Advance to Interview when mean score ≥ 3.5, ≥ 2 reviews, eligibility passes.</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <h3>Launch checklist</h3>
                <span className="bdg bdg-ok">
                  <CircleCheck className="ic" aria-hidden="true" />7 of 7 ready
                </span>
              </div>
              <div className="card-b" style={{ padding: "8px 20px 16px" }}>
                <div className="rc">
                  <div className="rc-row rc-pass" style={{ borderTop: "0" }}>
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Opportunity published</div>
                      <div className="r">Public page, OpenGrants index, sitemap</div>
                    </div>
                    <Link to="/f/riverbend/o/community-health-2027" className="fix">
                      View
                    </Link>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Form v2 pinned to this stage</div>
                      <div className="r">7 fields · 2 Passport prefills · budget table</div>
                    </div>
                    <Link to="/w/riverbend/forms/loi-v2/edit" className="fix">
                      Open
                    </Link>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Rubric attached</div>
                      <div className="r">Community Health rubric v3, weights sum to 100%</div>
                    </div>
                    <span></span>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Reviewer pool ≥ 3</div>
                      <div className="r">3 reviewers, 1 external with accepted invitation</div>
                    </div>
                    <Link to="/w/riverbend/reviews/assign" className="fix">
                      Pool
                    </Link>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Dates valid</div>
                      <div className="r">Stages don’t overlap; decision after last stage</div>
                    </div>
                    <span></span>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Public page reachable</div>
                      <div className="r">200 OK · checked 3 min ago</div>
                    </div>
                    <span></span>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">CommonGrants JSON valid</div>
                      <div className="r">Schema v1.2 · opportunity + 2 forms</div>
                    </div>
                    <Link to="/f/riverbend/o/community-health-2027" className="fix">
                      JSON
                    </Link>
                  </div>
                </div>
              </div>
              <div className="card-f" style={{ justifyContent: "space-between" }}>
                <span className="small muted">Checklist re-runs on every change.</span>
                <Link to="/f/riverbend/o/community-health-2027" className="btn btn-sm btn-primary">
                  View public page
                </Link>
              </div>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
              gap: "20px",
              marginTop: "8px",
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · Edit stages (modal)</span>
              <div className="mdl mdl-lg" style={{ width: "auto", boxShadow: "none", border: "1px solid #D6DEDE" }}>
                <div className="hd">
                  <div>
                    <h3 style={{ fontSize: "16px" }}>Edit stages</h3>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      Closed stages are locked. Changing an open stage’s end date notifies applicants with drafts.
                    </p>
                  </div>
                </div>
                <div className="bd" style={{ padding: "0" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Stage</th>
                        <th>Opens</th>
                        <th>Closes</th>
                        <th>Form</th>
                        <th>Rubric</th>
                        <th>Entry rule</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="row" style={{ gap: "6px" }}>
                          <Lock className="ic ic-sm" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                          LOI
                        </td>
                        <td>Jan 15, 2027</td>
                        <td>Feb 28, 2027</td>
                        <td>LOI form v1</td>
                        <td>Screening rubric v1</td>
                        <td className="muted">—</td>
                      </tr>
                      <tr>
                        <td>Full proposal</td>
                        <td>
                          <input
                            className="inp"
                            style={{ height: "30px", width: "130px", fontSize: "13px" }}
                            defaultValue="Mar 15, 2027"
                            aria-label="Full proposal opens"
                          />
                        </td>
                        <td>
                          <input
                            className="inp"
                            style={{ height: "30px", width: "130px", fontSize: "13px" }}
                            defaultValue="Apr 30, 2027"
                            aria-label="Full proposal closes"
                          />
                        </td>
                        <td>
                          <select className="sel" style={{ height: "30px", fontSize: "13px" }} aria-label="Full proposal form">
                            <option>Full proposal form v2</option>
                          </select>
                        </td>
                        <td>
                          <select className="sel" style={{ height: "30px", fontSize: "13px" }} aria-label="Full proposal rubric">
                            <option>Community Health rubric v3</option>
                          </select>
                        </td>
                        <td className="small">Invited from LOI</td>
                      </tr>
                      <tr>
                        <td>Interview</td>
                        <td>
                          <input
                            className="inp"
                            style={{ height: "30px", width: "130px", fontSize: "13px" }}
                            defaultValue="May 3, 2027"
                            aria-label="Interview opens"
                          />
                        </td>
                        <td>
                          <input
                            className="inp"
                            style={{ height: "30px", width: "130px", fontSize: "13px" }}
                            defaultValue="May 14, 2027"
                            aria-label="Interview closes"
                          />
                        </td>
                        <td>
                          <select className="sel" style={{ height: "30px", fontSize: "13px" }} aria-label="Interview form">
                            <option>Interview notes v1</option>
                          </select>
                        </td>
                        <td className="muted">—</td>
                        <td className="small">Score ≥ 3.5, ≥ 2 reviews</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="ft" style={{ justifyContent: "space-between" }}>
                  <button className="btn btn-sm btn-secondary">
                    <Plus className="ic" aria-hidden="true" />
                    Add stage
                  </button>
                  <div className="row" style={{ gap: "8px" }}>
                    <button className="btn btn-secondary">Cancel</button>
                    <button className="btn btn-primary">Save stages</button>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · draft with failing checklist</span>
              <div className="card">
                <div className="card-h">
                  <h3>Launch checklist</h3>
                  <span className="bdg bdg-dng">
                    <CircleX className="ic" aria-hidden="true" />5 of 7 ready
                  </span>
                </div>
                <div className="card-b" style={{ padding: "8px 20px 16px" }}>
                  <div className="rc">
                    <div className="rc-row rc-pass" style={{ borderTop: "0" }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Opportunity published</div>
                      </div>
                      <span></span>
                    </div>
                    <div className="rc-row rc-pass">
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Form v2 pinned</div>
                      </div>
                      <span></span>
                    </div>
                    <div className="rc-row rc-fail">
                      <CircleX className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">No rubric attached</div>
                        <div className="r">Reviewers can’t score without one</div>
                      </div>
                      <Link to="/w/riverbend/competitions/community-health-2027" className="fix">
                        Attach rubric
                      </Link>
                    </div>
                    <div className="rc-row rc-fail">
                      <CircleX className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Reviewer pool has 1 reviewer</div>
                        <div className="r">Minimum 3 for ≥ 2 reviews per application</div>
                      </div>
                      <Link to="/w/riverbend/reviews/assign" className="fix">
                        Invite reviewers
                      </Link>
                    </div>
                    <div className="rc-row rc-pass">
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Dates valid</div>
                      </div>
                      <span></span>
                    </div>
                  </div>
                </div>
                <div className="card-f" style={{ justifyContent: "space-between" }}>
                  <span className="small" style={{ color: "#9B1C1C", fontWeight: 700 }}>
                    Open is disabled until 2 items pass.
                  </span>
                  <button className="btn btn-sm btn-primary" disabled aria-disabled="true">
                    Open stage
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
