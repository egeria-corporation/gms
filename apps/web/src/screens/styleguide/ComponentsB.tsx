// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  BadgeCheck,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleMinus,
  Cloud,
  Lock,
  PenLine,
  Shield,
  TriangleExclamationPoint,
  Upload,
  User,
  X,
} from "lucide-react";

export default function ComponentsB() {
  return (
    <>
      <title>{"Component additions B"}</title>
      <div
        className="gms"
        style={{
          minHeight: "100vh",
          background: "#FFFFFF",
          padding: "40px 48px 56px",
          display: "flex",
          flexDirection: "column",
          gap: "28px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "900px" }}>
          <span className="eyebrow">OpenGrants GMS · Component additions</span>
          <h1 style={{ fontSize: "28px" }}>Component Additions B</h1>
          <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
            Review, decision, money and agent components. Score card, ranking row and allocator meter are the panel’s working surface;
            timeline, thread and document card are shared across both workspaces; signature modal and approval card are the two human gates.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)", gap: "24px" }}>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Score card</h3>
                <p className="small muted">
                  Reviewer scoring per criterion. Guidance from the rubric, weight shown, numeric or categorical scale, comment.
                </p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="spec">
                <span className="cap">Numeric · slider + input</span>
                <div className="score">
                  <div className="hd">
                    <div>
                      <h4 style={{ fontSize: "14px" }}>Community need</h4>
                      <div className="guide">
                        How clearly is the need described and evidenced for the population served? 5 = specific local data and a credible
                        source; 1 = general claims only.
                      </div>
                    </div>
                    <span className="w">Weight 30%</span>
                  </div>
                  <div className="scale">
                    <label className="sr" htmlFor="sc-need">
                      Score for Community need, 1 to 5
                    </label>
                    <input type="range" id="sc-need" min="1" max="5" step="0.5" defaultValue="4.5" />
                    <input className="inp v" defaultValue="4.5" aria-label="Score value" />
                    <span className="small muted">/ 5</span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="sc-need-c" style={{ fontSize: "12px" }}>
                      Comment
                      <span className="muted" style={{ fontWeight: 400 }}>
                        · visible to the panel
                      </span>
                    </label>
                    <textarea
                      className="ta"
                      id="sc-need-c"
                      style={{ minHeight: "64px", fontSize: "13px" }}
                      defaultValue="Cites the 2026 county health assessment and the 38-family pilot. Strong."
                    />
                  </div>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Categorical</span>
                <div className="score">
                  <div className="hd">
                    <div>
                      <h4 style={{ fontSize: "14px" }}>Organizational capacity</h4>
                      <div className="guide">Can the organization deliver at this scale within the grant period?</div>
                    </div>
                    <span className="w">Weight 20%</span>
                  </div>
                  <div className="scale-cat" role="group" aria-label="Organizational capacity rating">
                    <button>Insufficient</button>
                    <button>Developing</button>
                    <button className="on">Strong</button>
                    <button>Exceptional</button>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="sc-cap-c" style={{ fontSize: "12px" }}>
                      Comment
                    </label>
                    <textarea className="ta" id="sc-cap-c" style={{ minHeight: "48px", fontSize: "13px" }} placeholder="Optional" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div className="card">
              <div className="card-h">
                <div>
                  <h3>Ranking row</h3>
                  <p className="small muted">
                    Panel view. Rank, applicant with level badge, requested, mean / median / spread, n reviews, allocation input, decision
                    control.
                  </p>
                </div>
              </div>
              <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Applicant</th>
                      <th className="num">Requested</th>
                      <th>Mean</th>
                      <th>Median</th>
                      <th>Spread</th>
                      <th className="num">n</th>
                      <th className="num">Allocation</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="b">1</td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                            Lakeside Senior Center
                          </Link>
                          <div className="sub">
                            <span className="lvl lvl-2">L2</span>
                          </div>
                        </div>
                      </td>
                      <td className="num">$70,000</td>
                      <td className="b">4.6</td>
                      <td>4.5</td>
                      <td>
                        <span className="row" style={{ gap: "4px" }}>
                          0.4
                        </span>
                      </td>
                      <td className="num">3</td>
                      <td className="num">
                        <input
                          className="inp"
                          style={{ width: "110px", textAlign: "right", height: "32px" }}
                          defaultValue="$70,000"
                          aria-label="Allocation for Lakeside Senior Center"
                        />
                      </td>
                      <td>
                        <div className="seg">
                          <button className="on">Approve</button>
                          <button>Decline</button>
                          <button>Waitlist</button>
                          <button>Defer</button>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className="b">2</td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                            Alder Creek Family Services
                          </Link>
                          <div className="sub">
                            <span className="lvl lvl-3">
                              <Shield className="ic" aria-hidden="true" />
                              L3
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="num">$150,000</td>
                      <td className="b">4.4</td>
                      <td>4.5</td>
                      <td>0.6</td>
                      <td className="num">3</td>
                      <td className="num">
                        <input
                          className="inp"
                          style={{ width: "110px", textAlign: "right", height: "32px" }}
                          defaultValue="$150,000"
                          aria-label="Allocation for Alder Creek Family Services"
                        />
                      </td>
                      <td>
                        <div className="seg">
                          <button className="on">Approve</button>
                          <button>Decline</button>
                          <button>Waitlist</button>
                          <button>Defer</button>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className="b">3</td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/applications/app_01HZX4" className="nm">
                            Bayview Youth Collective
                          </Link>
                          <div className="sub">
                            <span className="lvl lvl-2">L2</span>
                            <span className="pay pay-none">
                              <CircleMinus className="ic" aria-hidden="true" />
                              No destination
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="num">$85,000</td>
                      <td className="b">3.9</td>
                      <td>3.5</td>
                      <td>
                        <span className="row" style={{ gap: "4px", color: "#7A4A00", fontWeight: 700 }}>
                          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                          1.8
                        </span>
                      </td>
                      <td className="num">2</td>
                      <td className="num">
                        <input
                          className="inp"
                          style={{ width: "110px", textAlign: "right", height: "32px" }}
                          defaultValue="$0"
                          aria-label="Allocation for Bayview Youth Collective"
                        />
                      </td>
                      <td>
                        <div className="seg">
                          <button>Approve</button>
                          <button>Decline</button>
                          <button className="on">Waitlist</button>
                          <button>Defer</button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="card-f small muted">
                Spread flag appears when the reviewer range exceeds 1.5. Rows expand to the per-criterion review summary.
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <div>
                  <h3>Allocator meter</h3>
                  <p className="small muted">
                    Program budget headroom: available, allocated (committed), pending (typed, not committed). Error state when allocations
                    exceed what is available.
                  </p>
                </div>
              </div>
              <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "20px" }}>
                <div className="spec">
                  <span className="cap">Normal</span>
                  <div className="mtr">
                    <div className="lbls">
                      <span>
                        Available <b>$1,200,000</b>
                      </span>
                      <span>
                        Allocated <b>$0</b>
                      </span>
                    </div>
                    <div className="track">
                      <div className="fill" style={{ width: "0%" }}></div>
                      <div className="fill pend" style={{ width: "18%" }}></div>
                    </div>
                    <div className="lbls">
                      <span>
                        Pending <b>$220,000</b>
                      </span>
                      <span>
                        Headroom <b>$980,000</b>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="spec">
                  <span className="cap">Near full</span>
                  <div className="mtr">
                    <div className="lbls">
                      <span>
                        Available <b>$1,200,000</b>
                      </span>
                      <span>
                        Allocated <b>$890,000</b>
                      </span>
                    </div>
                    <div className="track">
                      <div className="fill" style={{ width: "74%" }}></div>
                      <div className="fill pend" style={{ width: "22%" }}></div>
                    </div>
                    <div className="lbls">
                      <span>
                        Pending <b>$265,000</b>
                      </span>
                      <span>
                        Headroom <b>$45,000</b>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="spec">
                  <span className="cap">Over · error</span>
                  <div className="mtr mtr-over">
                    <div className="lbls">
                      <span>
                        Available <b>$1,200,000</b>
                      </span>
                      <span>
                        Allocated + pending <b style={{ color: "#9B1C1C" }}>$1,265,000</b>
                      </span>
                    </div>
                    <div className="track">
                      <div className="fill" style={{ width: "100%" }}></div>
                    </div>
                    <div className="over-msg">
                      <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                      $65,000 over · Commit decisions is disabled until allocations fit
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "24px" }}>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Timeline</h3>
                <p className="small muted">Status history, vertical, actor-attributed. Payloads expand.</p>
              </div>
            </div>
            <div className="card-b">
              <div className="tl">
                <div className="tl-i tl-ok">
                  <span className="dot">
                    <BadgeCheck className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Tranche 1 settled · $75,000</div>
                    <div className="who">
                      <span className="cap" style={{ color: "#4A5C5A" }}>
                        System
                      </span>
                      · May 27, 2027 · Passport id<span className="mono">dsb_01J3…</span>
                    </div>
                  </div>
                </div>
                <div className="tl-i tl-passport">
                  <span className="dot">
                    <Shield className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Disbursement initiated (ACH)</div>
                    <div className="who">
                      <span className="cap" style={{ color: "#1E4F8F" }}>
                        Passport
                      </span>
                      · May 25, 2027
                    </div>
                    <details className="payload">
                      <summary>Payload</summary>
                      <pre>
                        {"{"} "tranche": 1, "amount": 75000, "rail": "ach", "destination": "River City Credit Union •••• 4821" {"}"}
                      </pre>
                    </details>
                  </div>
                </div>
                <div className="tl-i tl-person">
                  <span className="dot">
                    <User className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Release approved</div>
                    <div className="who">
                      <span className="av av-sm av-n">ML</span>Marcus Lee (Finance) · May 25, 2027 · readiness 5 / 5
                    </div>
                  </div>
                </div>
                <div className="tl-i tl-agent">
                  <span className="dot">
                    <Bot className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Readiness check run</div>
                    <div className="who">
                      <span className="cap" style={{ color: "#4B2E9E" }}>
                        Agent
                      </span>
                      Riverbend Triage Agent (via Claude) · May 25, 2027 · read-only tool
                    </div>
                  </div>
                </div>
                <div className="tl-i tl-person">
                  <span className="dot">
                    <PenLine className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Agreement executed</div>
                    <div className="who">
                      <span className="av av-sm">DO</span>Dana Ortiz countersigned · May 24, 2027
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Thread</h3>
                <p className="small muted">
                  Shared vs internal messaging. Internal messages carry a lock and a tinted background; the applicant never sees them.
                </p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="seg" role="group" aria-label="Thread filter" style={{ alignSelf: "flex-start" }}>
                <button className="on">All</button>
                <button>Shared</button>
                <button>
                  <Lock className="ic ic-sm" aria-hidden="true" />
                  Internal
                </button>
              </div>
              <div className="th">
                <div className="msg">
                  <span className="av av-t">MS</span>
                  <div className="bub">
                    <div className="hd">
                      <span className="who">Maria Santos</span>
                      <span>Alder Creek · Apr 9</span>
                      <span className="shared-mark">Shared</span>
                    </div>
                    <div className="bd">We’ve revised the indirect line to 10% and resubmitted. Thank you for the clear note.</div>
                  </div>
                </div>
                <div className="msg msg-int">
                  <span className="av av-n">DO</span>
                  <div className="bub">
                    <div className="hd">
                      <span className="who">Dana Ortiz</span>
                      <span>Riverbend · Apr 9</span>
                      <span className="int-mark">
                        <Lock className="ic" aria-hidden="true" />
                        Internal
                      </span>
                    </div>
                    <div className="bd">Priya: revision looks good to me; happy to move this to the panel without another round.</div>
                  </div>
                </div>
                <div className="msg">
                  <span className="av av-n">DO</span>
                  <div className="bub">
                    <div className="hd">
                      <span className="who">Dana Ortiz</span>
                      <span>Riverbend · Apr 10</span>
                      <span className="shared-mark">Shared</span>
                    </div>
                    <div className="bd">Received — the revision is accepted and the application is back under review.</div>
                  </div>
                </div>
              </div>
              <div className="composer">
                <textarea
                  className="ta grow"
                  style={{ minHeight: "56px" }}
                  aria-label="Write a message"
                  placeholder="Write to Alder Creek…"
                />
                <div className="col" style={{ gap: "6px" }}>
                  <button className="btn btn-sm btn-primary">Send shared</button>
                  <button className="btn btn-sm btn-secondary">
                    <Lock className="ic ic-sm" aria-hidden="true" />
                    Internal note
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Document card</h3>
                <p className="small muted">Attachments. File type, name, size, source, hash tooltip, preview.</p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="spec">
                <span className="cap">Uploaded</span>
                <div className="doc">
                  <span className="ft ft-pdf">PDF</span>
                  <div className="grow">
                    <div className="nm">Letter of support — Copper Valley Clinic.pdf</div>
                    <div className="mt">
                      <span>286 KB</span>
                      <span>·</span>
                      <span className="row" style={{ gap: "4px" }}>
                        <Upload className="ic ic-sm" aria-hidden="true" />
                        Uploaded by JR
                      </span>
                      <span>·</span>
                      <span className="mono" title="sha256 c71e…9a02">
                        c71e…9a02
                      </span>
                    </div>
                  </div>
                  <Link to="/preview/pdf/application-snapshot" className="btn btn-sm btn-ghost">
                    Preview
                  </Link>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Passport locker</span>
                <div className="doc">
                  <span className="ft ft-pdf">PDF</span>
                  <div className="grow">
                    <div className="nm">IRS determination letter.pdf</div>
                    <div className="mt">
                      <span>412 KB</span>
                      <span>·</span>
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        Passport locker
                      </span>
                      <span>·</span>
                      <span className="mono">3f9a…c21e</span>
                    </div>
                  </div>
                  <Link to="/preview/pdf/application-snapshot" className="btn btn-sm btn-ghost">
                    Preview
                  </Link>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Google Drive</span>
                <div className="doc">
                  <span className="ft ft-xls">XLS</span>
                  <div className="grow">
                    <div className="nm">Navigator route plan.xlsx</div>
                    <div className="mt">
                      <span>88 KB</span>
                      <span>·</span>
                      <span className="row" style={{ gap: "4px" }}>
                        <Cloud className="ic ic-sm" aria-hidden="true" />
                        Drive · snapshot Apr 9
                      </span>
                      <span>·</span>
                      <span className="mono">7bd0…e114</span>
                    </div>
                  </div>
                  <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="btn btn-sm btn-ghost">
                    Preview
                  </Link>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Hash tooltip</span>
                <div className="tip" role="tooltip">
                  <div className="b">sha256</div>
                  <div className="mono" style={{ color: "#C2F0ED", wordBreak: "break-all" }}>
                    3f9a0c4d7e21b8f6a9d3c5e7f1a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6c21e
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    Recorded at upload; the same hash is in the application snapshot and the audit ledger.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: "24px" }}>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Signature modal</h3>
                <p className="small muted">
                  Click-to-sign. Sign stays disabled until the typed name and attestation are both present. Signing is always a human gate.
                </p>
              </div>
            </div>
            <div className="card-b">
              <div className="mdl" style={{ width: "auto", boxShadow: "none", border: "1px solid #D6DEDE" }}>
                <div className="hd">
                  <div>
                    <h3 style={{ fontSize: "16px" }}>Sign the grant agreement</h3>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      Riverbend Community Foundation → Alder Creek Family Services · $150,000 · Jul 1, 2027 – Jun 30, 2028
                    </p>
                  </div>
                  <button className="iconbtn" aria-label="Close">
                    <X className="ic" aria-hidden="true" />
                  </button>
                </div>
                <div className="bd">
                  <div
                    style={{
                      border: "1px solid #D6DEDE",
                      borderRadius: "8px",
                      background: "#F7FAFA",
                      padding: "14px 16px",
                      fontSize: "12px",
                      lineHeight: 1.6,
                      color: "#4A5C5A",
                      maxHeight: "120px",
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    <div className="b" style={{ color: "#0D2A43", fontSize: "13px" }}>
                      Grant Agreement — Community Health Grants 2027
                    </div>
                    1. Purpose. The Foundation awards the Grantee $150,000 for Mobile Health Navigation for Rural Families, to be used
                    solely for the activities described in the approved application dated April 9, 2027.
                    <br />
                    2. Payment. Funds are disbursed in three tranches according to the schedule in Exhibit A, to the Grantee’s verified
                    payment destination on record in OpenGrants Passport…
                    <div
                      style={{
                        position: "absolute",
                        left: "0",
                        right: "0",
                        bottom: "0",
                        height: "40px",
                        background: "linear-gradient(180deg, rgba(247,250,250,0), #F7FAFA)",
                      }}
                    ></div>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between", fontSize: "12px" }}>
                    <span className="mono muted">Document sha256 9d2c…41af · 6 pages</span>
                    <Link to="/preview/pdf/agreement" className="small b">
                      Open full document
                    </Link>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="sig-name">
                      Type your full legal name
                    </label>
                    <input className="inp" id="sig-name" placeholder="Maria Elena Santos" />
                  </div>
                  <label className="cb" htmlFor="sig-att">
                    <span className="c" id="sig-att" role="checkbox" aria-checked="false" tabIndex={0}></span>
                    <span style={{ fontSize: "13px" }}>
                      I am Maria Santos, Executive Director, authorized to sign for Alder Creek Family Services, and I agree to the terms of
                      this agreement.
                    </span>
                  </label>
                  <div style={{ fontSize: "12px", color: "#4A5C5A", display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span className="b" style={{ color: "#1E2D2B" }}>
                      What is recorded with your signature
                    </span>
                    <span className="row" style={{ gap: "6px" }}>
                      <Check className="ic ic-sm" aria-hidden="true" />
                      Typed name and role
                    </span>
                    <span className="row" style={{ gap: "6px" }}>
                      <Check className="ic ic-sm" aria-hidden="true" />
                      Date and time (UTC)
                    </span>
                    <span className="row" style={{ gap: "6px" }}>
                      <Check className="ic ic-sm" aria-hidden="true" />
                      IP address of this session
                    </span>
                    <span className="row" style={{ gap: "6px" }}>
                      <Check className="ic ic-sm" aria-hidden="true" />
                      Document hash 9d2c…41af
                    </span>
                  </div>
                </div>
                <div className="ft">
                  <button className="btn btn-secondary">Cancel</button>
                  <button className="btn btn-primary" disabled>
                    <PenLine className="ic" aria-hidden="true" />
                    Sign agreement
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <div>
                <h3>Approval request card</h3>
                <p className="small muted">Human gate for agent actions. Pending and resolved states.</p>
              </div>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="spec">
                <span className="cap">Pending</span>
                <div className="apr">
                  <div className="hd">
                    <Bot className="ic" aria-hidden="true" />
                    Riverbend Triage Agent
                    <span className="muted" style={{ fontWeight: 400, color: "#4B2E9E" }}>
                      via Claude · 2 min ago
                    </span>
                  </div>
                  <div className="bd">
                    <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
                      Decline 14 LOI applications that fail eligibility
                    </div>
                    <dl className="kv">
                      <dt>Tool</dt>
                      <dd>
                        <span className="mono">applications.decline</span>
                      </dd>
                      <dt>Scope</dt>
                      <dd>Community Health Grants 2027 · LOI stage</dd>
                      <dt>Reason</dt>
                      <dd>Rule “501(c)(3) in good standing” failed on all 14</dd>
                      <dt>Letter</dt>
                      <dd>Standard decline v3</dd>
                    </dl>
                    <div className="impact">
                      <TriangleExclamationPoint className="ic" aria-hidden="true" style={{ color: "#7A4A00" }} />
                      Will send 14 letters and set 14 statuses to Declined
                    </div>
                  </div>
                  <div className="ft">
                    <Link to="/w/riverbend/approvals" className="btn btn-primary">
                      Approve
                    </Link>
                    <button className="btn btn-danger">Reject</button>
                    <Link to="/w/riverbend/approvals" className="btn btn-ghost" style={{ marginLeft: "auto" }}>
                      Open
                      <ChevronRight className="ic" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
              <div className="spec">
                <span className="cap">Resolved</span>
                <div className="apr" style={{ borderColor: "#D6DEDE" }}>
                  <div className="hd" style={{ background: "#EEF3F3", color: "#4A5C5A" }}>
                    <Bot className="ic" aria-hidden="true" />
                    Riverbend Triage Agent<span style={{ fontWeight: 400 }}>via Claude · Mar 2</span>
                    <span className="bdg bdg-ok" style={{ marginLeft: "auto" }}>
                      <Check className="ic" aria-hidden="true" />
                      Approved
                    </span>
                  </div>
                  <div className="bd">
                    <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
                      Tag 22 applications “rural” from geography field
                    </div>
                    <div className="attrib">
                      Approved by
                      <span className="b" style={{ color: "#1E2D2B" }}>
                        Dana Ortiz
                      </span>
                      · Mar 2, 2027 at 3:41 PM PT · 22 tags applied
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div className="card">
              <div className="card-h">
                <div>
                  <h3>Agent attribution line</h3>
                  <p className="small muted">On any record an agent touched. Who, through what, when, and which human decided.</p>
                </div>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="spec">
                  <span className="cap">Proposed · awaiting approval</span>
                  <span className="attrib">
                    <Bot className="ic" aria-hidden="true" />
                    Decline proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· 2 min ago ·
                    <Link to="/w/riverbend/approvals">awaiting approval</Link>
                  </span>
                </div>
                <div className="spec">
                  <span className="cap">Approved by a human</span>
                  <span className="attrib">
                    <Bot className="ic" aria-hidden="true" />
                    Proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· Mar 2 · approved by Dana Ortiz
                  </span>
                </div>
                <div className="spec">
                  <span className="cap">Rejected</span>
                  <span className="attrib">
                    <Bot className="ic" aria-hidden="true" />
                    Proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· Feb 18 ·
                    <span style={{ color: "#9B1C1C", fontWeight: 700 }}>rejected by Marcus Lee</span>· “Wait for the audited financials”
                  </span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <div>
                  <h3>Empty state</h3>
                  <p className="small muted">Every list. No illustration; one sentence, one primary action, one secondary link.</p>
                </div>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="empty" style={{ border: "1px solid #D6DEDE", borderRadius: "8px", padding: "28px 20px" }}>
                  <Bot className="ic" aria-hidden="true" />
                  <h3>No agent requests</h3>
                  <p>Connected agents have not proposed anything that needs a human decision.</p>
                  <div className="acts">
                    <Link to="/w/riverbend/settings/mcp" className="btn btn-primary">
                      Connect an agent
                    </Link>
                    <Link to="/w/riverbend/settings/mcp" className="small b">
                      Review human gates
                    </Link>
                  </div>
                </div>
                <div className="empty" style={{ border: "1px solid #D6DEDE", borderRadius: "8px", padding: "28px 20px" }}>
                  <BookOpen className="ic" aria-hidden="true" />
                  <h3>Your answer library is empty</h3>
                  <p>Save answers once and reuse them across applications and reports.</p>
                  <div className="acts">
                    <Link to="/w/alder-creek/library" className="btn btn-primary">
                      Add the starter set
                    </Link>
                    <Link to="/w/alder-creek/library" className="small b">
                      Write your own
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
