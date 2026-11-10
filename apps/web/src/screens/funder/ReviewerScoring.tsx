// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Ban, Bell, Check, ChevronDown, CircleQuestionMark, ClipboardCheck, Clock4, Download, EyeOff, Send, Star } from "lucide-react";

export default function ReviewerScoring() {
  return (
    <>
      <title>{"Reviewer portal — Scoring Alder Creek Family Services"}</title>
      <div className="gms gms-funder" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header className="topbar">
          <Link to="/review/assignments" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <Link to="/workspaces" className="ws">
            Reviewer portal · Riverbend Community Foundation<span className="role">Reviewer</span>
            <ChevronDown className="ic" aria-hidden="true" />
          </Link>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            <Link to="/notifications" className="iconbtn" aria-label="Notifications, 1 unread">
              <Bell className="ic ic-md" aria-hidden="true" />
              <span className="dot"></span>
            </Link>
            <button className="iconbtn" aria-label="Help">
              <CircleQuestionMark className="ic ic-md" aria-hidden="true" />
            </button>
            <Link to="/account/agents" className="av av-t" aria-label="Account: Priya Natarajan">
              PN
            </Link>
          </div>
        </header>
        <nav aria-label="Reviewer portal" style={{ background: "#fff", borderBottom: "1px solid #D6DEDE", padding: "0 32px" }}>
          <div className="tabs" style={{ borderBottom: "0" }}>
            <Link to="/review/assignments" className="tab">
              <ClipboardCheck className="ic" aria-hidden="true" />
              My assignments<span className="n">9</span>
            </Link>
            <Link to="/review/score/app_01HZX4" className="tab on" aria-current="page">
              <Star className="ic" aria-hidden="true" />
              Scoring
            </Link>
          </div>
        </nav>
        <main className="main" style={{ paddingBottom: "96px" }}>
          <div className="crumbs">
            <Link to="/review/assignments">My assignments</Link>
            <span>›</span>
            <span>Alder Creek Family Services</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Mobile Health Navigation for Rural Families</h1>
                <span className="bdg bdg-prog">
                  <Clock4 className="ic" aria-hidden="true" />
                  In progress · 3 of 5
                </span>
              </div>
              <div className="meta">
                <span>Alder Creek Family Services</span>
                <span>·</span>
                <span>Requested $150,000</span>
                <span>·</span>
                <span>Community Health rubric v3</span>
                <span>·</span>
                <span className="b" style={{ color: "#7A4A00" }}>
                  Due May 7, 2027
                </span>
                <span>·</span>
                <span className="row" style={{ gap: "5px" }}>
                  <EyeOff className="ic ic-sm" aria-hidden="true" />
                  Blind review
                </span>
              </div>
            </div>
            <div className="actions">
              <Link to="/preview/pdf/application-snapshot" className="btn btn-secondary">
                <Download className="ic" aria-hidden="true" />
                Snapshot PDF
              </Link>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 460px", gap: "24px", alignItems: "start" }}>
            <section style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
              <div className="card">
                <div className="card-h">
                  <h3>Organization</h3>
                  <span className="small muted">Masked per Riverbend's blind-review settings</span>
                </div>
                <div
                  className="card-b"
                  style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 24px", fontSize: "13px" }}
                >
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Legal name
                    </div>
                    <p>Alder Creek Family Services</p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Tax status
                    </div>
                    <p>501(c)(3) public charity · verified</p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Primary contact
                    </div>
                    <p>
                      <span className="masked">
                        <EyeOff className="ic ic-sm" aria-hidden="true" />
                        Hidden in blind review
                      </span>
                    </p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Mailing address
                    </div>
                    <p>
                      <span className="masked">
                        <EyeOff className="ic ic-sm" aria-hidden="true" />
                        Hidden in blind review
                      </span>
                    </p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Annual operating budget
                    </div>
                    <p>$2,400,000 (FY2026)</p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Requested amount
                    </div>
                    <p className="b" style={{ color: "#0D2A43" }}>
                      $150,000
                    </p>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Project summary</h3>
                </div>
                <div className="card-b" style={{ fontSize: "14px" }}>
                  <p>
                    Mobile Health Navigation pairs two community health navigators with a weekly van route across the six unincorporated
                    communities of the Alder Creek valley. Navigators schedule visits, arrange rides and follow up on referrals so that a
                    family's first contact with care is not an emergency room visit.
                  </p>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Need statement</h3>
                  <span className="small muted">468 words</span>
                </div>
                <div className="card-b" style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <p>
                    Families in the Alder Creek valley travel an average of 46 miles to reach a primary care provider, and one in four
                    households has no reliable vehicle. Over the last three years our intake data shows that missed appointments, not lack
                    of coverage, is the leading reason children in our programs fall behind on well-child visits and immunizations.
                  </p>
                  <p>
                    Mobile Health Navigation pairs a community health navigator with a scheduled van route across the six unincorporated
                    communities we serve. Navigators schedule visits, arrange rides, and follow up on referrals so that a family's first
                    contact with the clinic is not an emergency room visit. The 2026 Riverbend County Community Health Assessment ranks
                    transportation access as the top barrier to care for rural families, and our pilot with 38 families cut missed
                    appointments by 41 percent.
                  </p>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Approach & activities</h3>
                </div>
                <div className="card-b" style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <p>
                    Two navigators cover a weekly route of six stops. Each stop offers scheduling, transport vouchers, and warm hand-offs to
                    the Copper Valley Clinic telehealth room.
                  </p>
                  <div className="tbl-wrap">
                    <table className="tbl tbl-compact">
                      <thead>
                        <tr>
                          <th>Key staff</th>
                          <th>Role on project</th>
                          <th className="num">FTE</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            <span className="masked">
                              <EyeOff className="ic ic-sm" aria-hidden="true" />
                              Name hidden
                            </span>
                          </td>
                          <td>Project director</td>
                          <td className="num">0.15</td>
                        </tr>
                        <tr>
                          <td>To be hired</td>
                          <td>Community health navigator (2)</td>
                          <td className="num">2.00</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Budget</h3>
                  <span className="small muted">Proposed</span>
                </div>
                <div className="card-b" style={{ padding: "0" }}>
                  <table className="tbl bud">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="num">From Riverbend</th>
                        <th className="num">Other sources</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Personnel</td>
                        <td className="num">$96,000</td>
                        <td className="num">$24,000</td>
                        <td className="num">$120,000</td>
                      </tr>
                      <tr>
                        <td>Travel & vehicle</td>
                        <td className="num">$28,000</td>
                        <td className="num">$0</td>
                        <td className="num">$28,000</td>
                      </tr>
                      <tr>
                        <td>Supplies</td>
                        <td className="num">$11,000</td>
                        <td className="num">$0</td>
                        <td className="num">$11,000</td>
                      </tr>
                      <tr>
                        <td>Indirect (10%)</td>
                        <td className="num">$15,000</td>
                        <td className="num">$0</td>
                        <td className="num">$15,000</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total</td>
                        <td className="num">$150,000</td>
                        <td className="num">$24,000</td>
                        <td className="num">$174,000</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Attachments</h3>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">IRS determination letter.pdf</div>
                      <div className="mt">
                        <span>412 KB</span>
                        <span>·</span>
                        <span>Passport locker</span>
                      </div>
                    </div>
                    <a href="#attachments" className="btn btn-sm btn-ghost">
                      Open
                    </a>
                  </div>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Letter of support — Copper Valley Clinic.pdf</div>
                      <div className="mt">
                        <span>188 KB</span>
                        <span>·</span>
                        <span>Uploaded</span>
                      </div>
                    </div>
                    <a href="#attachments" className="btn btn-sm btn-ghost">
                      Open
                    </a>
                  </div>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Pilot evaluation 2026.pdf</div>
                      <div className="mt">
                        <span>1.4 MB</span>
                        <span>·</span>
                        <span>Uploaded Apr 4</span>
                      </div>
                    </div>
                    <a href="#attachments" className="btn btn-sm btn-ghost">
                      Open
                    </a>
                  </div>
                </div>
              </div>
            </section>
            <aside style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ fontSize: "16px" }}>Score card</h2>
                <span className="small muted">Community Health rubric v3 · 1–5 scale</span>
              </div>
              <div className="score">
                <div className="hd">
                  <div>
                    <h3>Need & evidence</h3>
                    <div className="guide">
                      Is the need specific to the population and backed by data the reviewer can check? 5 = cites independent data and own
                      results; 1 = asserted only.
                    </div>
                  </div>
                  <span className="w">25%</span>
                </div>
                <div className="scale">
                  <label className="sr" htmlFor="s1">
                    Need and evidence score
                  </label>
                  <input type="range" id="s1" min="1" max="5" step="1" defaultValue="5" />
                  <input className="inp v" type="number" min="1" max="5" defaultValue="5" aria-label="Need and evidence score value" />
                </div>
                <textarea
                  className="ta"
                  style={{ minHeight: "64px" }}
                  aria-label="Comment on Need and evidence"
                  defaultValue="County assessment plus a 38-family pilot with a measured 41% reduction in missed appointments. Strong."
                />
              </div>
              <div className="score">
                <div className="hd">
                  <div>
                    <h3>Approach</h3>
                    <div className="guide">
                      Do the activities plausibly address the need, with a clear hand-off to care? Consider sequencing and partners.
                    </div>
                  </div>
                  <span className="w">25%</span>
                </div>
                <div className="scale">
                  <label className="sr" htmlFor="s2">
                    Approach score
                  </label>
                  <input type="range" id="s2" min="1" max="5" step="1" defaultValue="4" />
                  <input className="inp v" type="number" min="1" max="5" defaultValue="4" aria-label="Approach score value" />
                </div>
                <textarea
                  className="ta"
                  style={{ minHeight: "64px" }}
                  aria-label="Comment on Approach"
                  defaultValue="Clear route model and partner clinic hand-off. Would like to see how referrals are tracked after the visit."
                />
              </div>
              <div className="score">
                <div className="hd">
                  <div>
                    <h3>Feasibility</h3>
                    <div className="guide">
                      Can the organization deliver within the period with the staff and vehicles described? Weigh hiring risk and capacity.
                    </div>
                  </div>
                  <span className="w">20%</span>
                </div>
                <div className="scale">
                  <label className="sr" htmlFor="s3">
                    Feasibility score
                  </label>
                  <input type="range" id="s3" min="1" max="5" step="1" defaultValue="4" />
                  <input className="inp v" type="number" min="1" max="5" defaultValue="4" aria-label="Feasibility score value" />
                </div>
                <textarea className="ta" style={{ minHeight: "64px" }} aria-label="Comment on Feasibility" placeholder="Optional comment" />
              </div>
              <div className="score">
                <div className="hd">
                  <div>
                    <h3>Budget realism</h3>
                    <div className="guide">
                      Are costs reasonable for the activities and within the opportunity's limits (10% indirect cap)?
                    </div>
                  </div>
                  <span className="w">15%</span>
                </div>
                <div className="scale">
                  <label className="sr" htmlFor="s4">
                    Budget realism score
                  </label>
                  <input type="range" id="s4" min="1" max="5" step="1" defaultValue="3" />
                  <input className="inp v" type="number" min="1" max="5" defaultValue="3" aria-label="Budget realism score value" />
                </div>
                <textarea
                  className="ta"
                  style={{ minHeight: "64px" }}
                  aria-label="Comment on Budget realism"
                  placeholder="Optional comment"
                />
              </div>
              <div className="score" style={{ borderColor: "#E9C77D" }}>
                <div className="hd">
                  <div>
                    <h3>Outcomes & evaluation</h3>
                    <div className="guide">Are outcomes measurable within the period, with a baseline and a method?</div>
                  </div>
                  <span className="w">15%</span>
                </div>
                <div className="scale">
                  <label className="sr" htmlFor="s5">
                    Outcomes and evaluation score
                  </label>
                  <input type="range" id="s5" min="1" max="5" step="1" defaultValue="3" aria-describedby="s5-help" />
                  <input
                    className="inp v"
                    type="number"
                    min="1"
                    max="5"
                    defaultValue=""
                    placeholder="—"
                    aria-label="Outcomes and evaluation score value"
                  />
                </div>
                <span className="help" id="s5-help" style={{ color: "#7A4A00", fontWeight: 700 }}>
                  Not scored yet — required before submitting
                </span>
                <textarea
                  className="ta"
                  style={{ minHeight: "64px" }}
                  aria-label="Comment on Outcomes and evaluation"
                  placeholder="Optional comment"
                />
              </div>
              <div className="score">
                <div className="hd">
                  <div>
                    <h3>Overall recommendation</h3>
                    <div className="guide">
                      Your recommendation to the panel. The panel sees it beside your weighted score (currently 4.1 of 5 across scored
                      criteria).
                    </div>
                  </div>
                </div>
                <div className="scale-cat" role="radiogroup" aria-label="Overall recommendation">
                  <button className="on" role="radio" aria-checked="true">
                    Fund
                  </button>
                  <button role="radio" aria-checked="false">
                    Fund with reservations
                  </button>
                  <button role="radio" aria-checked="false">
                    Do not fund
                  </button>
                </div>
                <label className="lbl" htmlFor="narr" style={{ marginTop: "4px" }}>
                  Narrative for the panel
                </label>
                <textarea
                  className="ta"
                  id="narr"
                  style={{ minHeight: "96px" }}
                  defaultValue="Strong evidence base and a tested pilot. Hiring two navigators by July is the main risk; recommend a 90-day hiring milestone tied to tranche 2."
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="eyebrow">States</span>
                <div
                  className="card"
                  style={{
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    fontSize: "13px",
                    background: "#F7FAFA",
                  }}
                >
                  <div className="row" style={{ gap: "8px" }}>
                    <span className="bdg bdg-ok">
                      <Send className="ic" aria-hidden="true" />
                      Submitted
                    </span>
                    <span className="muted">Submitted May 5 · read-only · edit until panel opens May 18</span>
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <button className="btn btn-sm btn-secondary">Reopen my review</button>
                  </div>
                </div>
                <div
                  className="card"
                  style={{
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    fontSize: "13px",
                    background: "#F7FAFA",
                  }}
                >
                  <div className="row" style={{ gap: "8px" }}>
                    <span className="bdg bdg-neutral">
                      <Ban className="ic" aria-hidden="true" />
                      Recused
                    </span>
                    <span className="muted">Conflict declared Apr 29 · scoring disabled · program officer notified</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </main>
        <div
          style={{
            position: "sticky",
            bottom: "0",
            background: "#fff",
            borderTop: "1px solid #D6DEDE",
            padding: "12px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            marginTop: "auto",
          }}
        >
          <span className="small muted row" style={{ gap: "6px" }}>
            <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
            Draft saved 40 seconds ago · 4 of 5 criteria scored · submitting locks your scores until the panel opens
          </span>
          <div className="row">
            <button className="btn btn-secondary">Save draft</button>
            <Link to="/w/riverbend/competitions/community-health-2027/panel" className="btn btn-primary">
              Submit review
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
