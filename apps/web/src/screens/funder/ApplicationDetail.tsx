// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Link } from "react-router";
import {
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Ellipsis,
  Eye,
  EyeOff,
  Info,
  Lock,
  Pencil,
  RefreshCw,
  RotateCcw,
  Shield,
  Sparkles,
  TriangleExclamationPoint,
  Upload,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function ApplicationDetail() {
  const [internal, setInternal] = useState(false);
  return (
    <>
      <title>{"Application detail — Alder Creek Family Services"}</title>
      <FunderShell active="Applications">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/applications">Applications</Link>
            <span>›</span>
            <span>app_01HZX4</span>
          </div>
          <div className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
                <div className="row wrap" style={{ gap: "8px" }}>
                  <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                    Alder Creek Family Services
                  </Link>
                  <span className="lvl lvl-3">
                    <Shield className="ic" aria-hidden="true" />
                    L3
                  </span>
                  <span className="pay pay-active">
                    <Check className="ic" aria-hidden="true" />
                    Payee active · River City Credit Union •••• 4821
                  </span>
                  <a href="#applicant" className="pill-warn">
                    <RefreshCw className="ic ic-sm" aria-hidden="true" />
                    Org changes pending (1)
                  </a>
                </div>
                <h1>Mobile Health Navigation for Rural Families</h1>
                <div className="meta" style={{ marginTop: "0" }}>
                  <span>Community Health Grants 2027</span>
                  <span>·</span>
                  <span className="row" style={{ gap: "6px" }}>
                    Full proposal
                    <span className="bdg bdg-prog">
                      <Eye className="ic" aria-hidden="true" />
                      Under review
                    </span>
                  </span>
                  <span>·</span>
                  <span>
                    Requested <b style={{ color: "#0D2A43" }}>$150,000</b>
                  </span>
                  <span>·</span>
                  <span>12 days in stage</span>
                  <span>·</span>
                  <span>Submitted Mar 28, 2027 · snapshot v1 · attestation attached</span>
                </div>
              </div>
              <div className="actions">
                <Link to="/w/riverbend/reviews/assign" className="btn btn-primary">
                  Advance to Full → assign reviewers
                  <ChevronDown className="ic ic-sm caret" aria-hidden="true" />
                </Link>
                <button className="btn btn-secondary">Request revision</button>
                <button className="btn btn-danger">Decline</button>
                <Link to="/w/riverbend/competitions/community-health-2027/panel" className="btn btn-secondary">
                  Approve → Award
                </Link>
                <button className="iconbtn" aria-label="More actions">
                  <Ellipsis className="ic" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "232px minmax(0, 1fr) 380px", gap: "20px", alignItems: "start" }}>
            <aside className="card" style={{ padding: "12px" }}>
              <div className="eyebrow" style={{ padding: "4px 10px 10px" }}>
                Sections · 8 of 8 complete
              </div>
              <nav className="sec" aria-label="Response sections">
                <a href="#organization" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Organization</div>
                    <div className="st">From Passport</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-t">MS</span>
                  </span>
                </a>
                <a href="#summary" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Project summary</div>
                    <div className="st">Complete</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-t">MS</span>
                  </span>
                </a>
                <a href="#need" className="s-done on" aria-current="true">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Need statement</div>
                    <div className="st">Complete · 468 words</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm">JR</span>
                  </span>
                </a>
                <a href="#approach" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Approach & activities</div>
                    <div className="st">Complete</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-t">MS</span>
                  </span>
                </a>
                <a href="#budget" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Budget</div>
                    <div className="st">Complete · consultant</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-g">LF</span>
                  </span>
                </a>
                <a href="#outcomes" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Outcomes & evaluation</div>
                    <div className="st">Complete</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-t">MS</span>
                  </span>
                </a>
                <a href="#attachments" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Attachments</div>
                    <div className="st">3 files</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm">JR</span>
                  </span>
                </a>
                <a href="#loi" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">LOI responses</div>
                    <div className="st">Prior stage</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-t">MS</span>
                  </span>
                </a>
              </nav>
              <div className="divider" style={{ margin: "10px 0" }}></div>
              <div className="small muted" style={{ padding: "0 10px 4px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <Link to="/preview/pdf/application-snapshot">Download snapshot PDF</Link>
                <a href="#loi">View as CommonGrants JSON</a>
              </div>
            </aside>
            <section style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
              <div className="card" id="organization">
                <div className="card-h">
                  <h3>Organization</h3>
                  <span className="small muted">Read-only · sourced values are marked</span>
                </div>
                <div
                  className="card-b"
                  style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 24px", fontSize: "13px" }}
                >
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Legal name
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </div>
                    <p>Alder Creek Family Services</p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Tax status
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </div>
                    <p>501(c)(3) public charity · verified</p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Mailing address
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </div>
                    <p>418 Mill Road, Alder Creek, OR</p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Primary contact
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </div>
                    <p>Maria Santos · Executive Director · maria@aldercreekfs.example</p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Annual operating budget
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </div>
                    <p>$2,400,000 (FY2026)</p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Requested amount
                      <span className="prov prov-entered">
                        <Pencil className="ic" aria-hidden="true" />
                        Entered
                      </span>
                    </div>
                    <p className="b" style={{ color: "#0D2A43" }}>
                      $150,000{" "}
                      <span className="muted" style={{ fontWeight: 400 }}>
                        · CommonGrants <span className="mono">requestedAmount</span>
                      </span>
                    </p>
                  </div>
                </div>
              </div>
              <div className="card" id="summary">
                <div className="card-h">
                  <h3>Project summary</h3>
                </div>
                <div className="card-b" style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div className="lbl" style={{ fontSize: "12px" }}>
                    Summarize the project in two sentences
                    <span className="prov prov-entered">
                      <Pencil className="ic" aria-hidden="true" />
                      Entered
                    </span>
                  </div>
                  <p>
                    Mobile Health Navigation pairs two community health navigators with a weekly van route across the six unincorporated
                    communities of the Alder Creek valley. Navigators schedule visits, arrange rides and follow up on referrals so that a
                    family's first contact with care is not an emergency room visit.
                  </p>
                </div>
              </div>
              <div className="card" id="need">
                <div className="card-h">
                  <h3>Need statement</h3>
                  <span className="small muted">468 / 500 words</span>
                </div>
                <div className="card-b" style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="lbl" style={{ fontSize: "12px" }}>
                    What need does this project address?
                    <span className="prov prov-library">
                      <BookOpen className="ic" aria-hidden="true" />
                      From library · “Need”
                    </span>
                  </div>
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
              <div className="card" id="approach">
                <div className="card-h">
                  <h3>Approach & activities</h3>
                </div>
                <div className="card-b" style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Describe the main activities
                      <span className="prov prov-entered">
                        <Pencil className="ic" aria-hidden="true" />
                        Entered
                      </span>
                    </div>
                    <p>
                      Two navigators cover a weekly route of six stops. Each stop offers scheduling, transport vouchers, and warm hand-offs
                      to the Copper Valley Clinic telehealth room.
                    </p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px", marginBottom: "6px" }}>
                      Key staff
                    </div>
                    <div className="tbl-wrap">
                      <table className="tbl tbl-compact">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Role on project</th>
                            <th className="num">FTE</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Maria Santos</td>
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
              </div>
              <div className="card" id="budget">
                <div className="card-h">
                  <h3>Budget</h3>
                  <span className="small muted">Proposed · totals equal requested</span>
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
              <div className="card" id="attachments">
                <div className="card-h">
                  <h3>Attachments</h3>
                  <span className="small muted">3 files · hashes recorded at submission</span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
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
                        <span className="mono">sha256 3f9a…c21e</span>
                      </div>
                    </div>
                    <a href="#attachments" className="btn btn-sm btn-ghost">
                      Preview
                    </a>
                  </div>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Letter of support — Copper Valley Clinic.pdf</div>
                      <div className="mt">
                        <span>188 KB</span>
                        <span>·</span>
                        <span className="prov prov-entered">
                          <Upload className="ic" aria-hidden="true" />
                          Uploaded
                        </span>
                        <span>·</span>
                        <span className="mono">sha256 c04d…91ab</span>
                      </div>
                    </div>
                    <a href="#attachments" className="btn btn-sm btn-ghost">
                      Preview
                    </a>
                  </div>
                </div>
              </div>
              <div className="card" id="loi" style={{ opacity: ".9" }}>
                <div className="card-h">
                  <h3>LOI responses</h3>
                  <span className="bdg bdg-neutral">
                    <Lock className="ic" aria-hidden="true" />
                    Prior stage
                  </span>
                </div>
                <div className="card-b" style={{ fontSize: "13px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Summary of intent
                    </div>
                    <p className="muted">
                      Expand mobile health navigation from a 38-family pilot to the six unincorporated communities of the Alder Creek
                      valley.
                    </p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "12px" }}>
                      Estimated request
                    </div>
                    <p className="muted">$140,000 – $150,000 · submitted Feb 21, 2027</p>
                  </div>
                </div>
              </div>
            </section>
            <aside style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
              <div className="card" id="applicant" style={{ overflow: "hidden" }}>
                <div className="panel-tabs" role="tablist">
                  <button className="tab on" role="tab" aria-selected="true">
                    Applicant
                  </button>
                  <button className="tab" role="tab">
                    Reviews<span className="n">3</span>
                  </button>
                  <button className="tab" role="tab">
                    Eligibility
                  </button>
                  <button className="tab" role="tab">
                    Budget
                  </button>
                  <button className="tab" role="tab">
                    Documents
                  </button>
                  <button className="tab" role="tab">
                    Messages<span className="n">3</span>
                  </button>
                  <button className="tab" role="tab">
                    Activity
                  </button>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "13px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <div className="row" style={{ gap: "8px" }}>
                      <span className="lvl lvl-3">
                        <Shield className="ic" aria-hidden="true" />
                        L3
                      </span>
                      <span className="b" style={{ color: "#0D2A43" }}>
                        Passport · payee verified
                      </span>
                    </div>
                    <a href="#applicant" className="small b">
                      View attestation
                    </a>
                  </div>
                  <ul style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <li className="row" style={{ gap: "8px" }}>
                      <CircleCheck className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                      <span>Identity verified</span>
                      <span className="muted" style={{ marginLeft: "auto" }}>
                        Sep 12, 2026
                      </span>
                    </li>
                    <li className="row" style={{ gap: "8px" }}>
                      <CircleCheck className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                      <span>Documents verified</span>
                      <span className="muted" style={{ marginLeft: "auto" }}>
                        Sep 14, 2026
                      </span>
                    </li>
                    <li className="row" style={{ gap: "8px" }}>
                      <CircleCheck className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                      <span>Payee verified</span>
                      <span className="muted" style={{ marginLeft: "auto" }}>
                        Sep 20, 2026
                      </span>
                    </li>
                  </ul>
                  <div className="kv">
                    <dt>Destination</dt>
                    <dd>
                      <span className="pay pay-active">
                        <Check className="ic" aria-hidden="true" />
                        Active
                      </span>{" "}
                      River City Credit Union •••• 4821
                    </dd>
                    <dt>Prior awards (Riverbend)</dt>
                    <dd className="muted">None</dd>
                    <dt>Prior reports</dt>
                    <dd className="muted">None</dd>
                    <dt>Consent</dt>
                    <dd>org:read · org.changes:read/write · granted Mar 2, 2027</dd>
                  </div>
                  <div className="divider"></div>
                  <div className="eyebrow">Open org changes · 1</div>
                  <div
                    className="card"
                    style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px", background: "#F7FAFA" }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                      <span className="b">Primary contact phone changed</span>
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        Source: Passport
                      </span>
                    </div>
                    <div className="muted small">
                      Maria Santos updated the office line in Passport on Apr 9, 2027. Accept to update your grantee record; the application
                      snapshot is unchanged.
                    </div>
                    <div className="row" style={{ gap: "8px" }}>
                      <button className="btn btn-sm btn-primary">Accept</button>
                      <button className="btn btn-sm btn-secondary">Dismiss</button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Reviews · 3 of 3 submitted</h3>
                  <span className="bdg bdg-warn">
                    <TriangleExclamationPoint className="ic" aria-hidden="true" />
                    Variance on Feasibility
                  </span>
                </div>
                <div className="card-b" style={{ padding: "0" }}>
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th>Criterion</th>
                        <th className="num">PN</th>
                        <th className="num">ML</th>
                        <th className="num">HG</th>
                        <th className="num">Mean</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Need & evidence</td>
                        <td className="num">5</td>
                        <td className="num">5</td>
                        <td className="num">4</td>
                        <td className="num b">4.7</td>
                      </tr>
                      <tr>
                        <td>Approach</td>
                        <td className="num">4</td>
                        <td className="num">5</td>
                        <td className="num">4</td>
                        <td className="num b">4.3</td>
                      </tr>
                      <tr>
                        <td>
                          <span className="row" style={{ gap: "6px" }}>
                            Feasibility
                            <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" style={{ color: "#7A4A00" }} />
                          </span>
                        </td>
                        <td className="num">4</td>
                        <td className="num">3</td>
                        <td className="num">5</td>
                        <td className="num b">4.0</td>
                      </tr>
                      <tr>
                        <td>Budget realism</td>
                        <td className="num">3</td>
                        <td className="num">4</td>
                        <td className="num">4</td>
                        <td className="num b">3.7</td>
                      </tr>
                      <tr>
                        <td>Outcomes & evaluation</td>
                        <td className="num">4</td>
                        <td className="num">4</td>
                        <td className="num">5</td>
                        <td className="num b">4.3</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="b">Weighted mean</td>
                        <td className="num">4.1</td>
                        <td className="num">4.3</td>
                        <td className="num">4.4</td>
                        <td className="num b">4.4</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div
                  className="card-b"
                  style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px", borderTop: "1px solid #D6DEDE" }}
                >
                  <div className="row wrap" style={{ gap: "6px" }}>
                    <span className="bdg bdg-ok">
                      <Check className="ic" aria-hidden="true" />
                      PN · Fund
                    </span>
                    <span className="bdg bdg-ok">
                      <Check className="ic" aria-hidden="true" />
                      ML · Fund
                    </span>
                    <span className="bdg bdg-warn">
                      <Info className="ic" aria-hidden="true" />
                      HG · Fund with reservations
                    </span>
                  </div>
                  <div className="cmt">
                    <div className="hd">
                      <span className="av av-sm av-t">PN</span>
                      <span className="who">Priya Natarajan</span>
                      <span>· narrative</span>
                    </div>
                    <div className="bd">
                      Strong evidence base and a tested pilot. Hiring two navigators by July is the main risk; recommend a 90-day hiring
                      milestone tied to tranche 2.
                    </div>
                  </div>
                  <div className="cmt">
                    <div className="hd">
                      <span className="av av-sm av-g">HG</span>
                      <span className="who">Dr. Hollis Grant</span>
                      <span>· narrative</span>
                    </div>
                    <div className="bd">
                      Clinically sound hand-off model. Reservation: the van lease covers one vehicle for six stops; weather days will erode
                      coverage in winter.
                    </div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Eligibility · all rules pass</h3>
                  <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700, fontSize: "12px" }}>
                    <CircleCheck className="ic" aria-hidden="true" />
                    Pass
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <div className="rc-row rc-pass" style={{ borderTop: "0", padding: "4px 0" }}>
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Applicant is a 501(c)(3) in good standing</div>
                      <div className="r">
                        Passport <span className="mono">org.taxStatus</span> = 501(c)(3) · verified Sep 14, 2026
                      </div>
                    </div>
                    <span className="fix muted">Rule 1</span>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Serves Riverbend County</div>
                      <div className="r">
                        <span className="mono">org.serviceArea</span> includes Riverbend County
                      </div>
                    </div>
                    <span className="fix muted">Rule 2</span>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Annual budget under $5,000,000</div>
                      <div className="r">
                        <span className="mono">org.annualBudget</span> = $2,400,000
                      </div>
                    </div>
                    <span className="fix muted">Rule 3</span>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Requested within $50,000 – $150,000</div>
                      <div className="r">
                        <span className="mono">requestedAmount</span> = $150,000
                      </div>
                    </div>
                    <span className="fix muted">Rule 4</span>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Messages</h3>
                  <div className="seg" role="group" aria-label="Thread filter">
                    <button className={internal ? "" : "on"} aria-pressed={!internal} onClick={() => setInternal(false)}>
                      Shared
                    </button>
                    <button className={internal ? "on" : ""} aria-pressed={internal} onClick={() => setInternal(true)}>
                      <Lock className="ic ic-sm" aria-hidden="true" />
                      Internal
                    </button>
                  </div>
                </div>
                <div className="card-b th">
                  {!internal && (
                    <>
                      <div className="msg">
                        <span className="av av-t">MS</span>
                        <div className="bub">
                          <div className="hd">
                            <span className="who">Maria Santos</span>
                            <span>Alder Creek · Apr 2</span>
                            <span className="shared-mark">Shared</span>
                          </div>
                          <div className="bd">
                            We attached the Copper Valley Clinic letter of support today. Let us know if the reviewers need the pilot
                            evaluation as well.
                          </div>
                        </div>
                      </div>
                      <div className="msg">
                        <span className="av">DO</span>
                        <div className="bub">
                          <div className="hd">
                            <span className="who">Dana Ortiz</span>
                            <span>Riverbend · Apr 3</span>
                            <span className="shared-mark">Shared</span>
                          </div>
                          <div className="bd">
                            Thanks, received. The pilot evaluation would help the Feasibility criterion if you have it.
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  {internal && (
                    <>
                      <div className="msg msg-int">
                        <span className="av">DO</span>
                        <div className="bub">
                          <div className="hd">
                            <span className="who">Dana Ortiz</span>
                            <span>Apr 3</span>
                            <span className="int-mark">
                              <Lock className="ic" aria-hidden="true" />
                              Internal
                            </span>
                          </div>
                          <div className="bd">
                            Marcus — flag for panel: their 2026 audit shows a 3-month cash reserve. Fine for tranche 1, worth a condition on
                            tranche 2.
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  <div className="composer">
                    <textarea
                      className="ta"
                      style={{ minHeight: "44px" }}
                      aria-label="Write a message"
                      placeholder="Write to Alder Creek Family Services…"
                    />
                    <button className="btn btn-primary">Send</button>
                  </div>
                </div>
              </div>
              <div className="assist">
                <div className="hd">
                  <Sparkles className="ic" aria-hidden="true" style={{ color: "#4B2E9E" }} />
                  Assistant<span className="draft-mark">Draft — review before use</span>
                  <span className="quota">22 of 60 this month</span>
                  <button className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label="Collapse assistant">
                    <ChevronUp className="ic" aria-hidden="true" />
                  </button>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
                  <div>
                    <div className="eyebrow">Summary</div>
                    <p style={{ marginTop: "4px" }}>
                      Expands a 38-family pilot to a two-navigator van route across six communities; requests $150,000, mostly personnel;
                      evidence cites the 2026 county assessment and a 41% drop in missed appointments.
                    </p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
                    <div>
                      <div className="eyebrow" style={{ color: "#0B5E47" }}>
                        Strengths vs rubric
                      </div>
                      <ul style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "4px" }}>
                        <li>· Need: county data plus own pilot results</li>
                        <li>· Approach: clear hand-off to Copper Valley Clinic</li>
                        <li>· Outcomes: measurable (missed-appointment rate)</li>
                      </ul>
                    </div>
                    <div>
                      <div className="eyebrow" style={{ color: "#7A4A00" }}>
                        Risks
                      </div>
                      <ul style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "4px" }}>
                        <li>· Two hires needed before Jul 1</li>
                        <li>· One vehicle for six stops; weather coverage</li>
                      </ul>
                    </div>
                  </div>
                  <button className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }}>
                    Draft reply to applicant
                  </button>
                </div>
              </div>
            </aside>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
            <span className="eyebrow">States</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
              <div className="card" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                <span className="bdg bdg-warn">
                  <RotateCcw className="ic" aria-hidden="true" />
                  Revision requested
                </span>
                <p className="muted">Applicant responded Apr 11. Changed fields: Budget (Indirect), Attachments (+1).</p>
                <Link to="/styleguide/components-a" className="b">
                  View revision diff →
                </Link>
              </div>
              <div className="card" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                <span className="bdg bdg-dng">
                  <CircleX className="ic" aria-hidden="true" />
                  Declined
                </span>
                <div className="doc" style={{ padding: "8px 10px" }}>
                  <span className="ft">TXT</span>
                  <div className="grow">
                    <div className="nm">Letter sent · Standard decline v3</div>
                    <div className="mt">May 19, 2027 9:04 AM · to maria@aldercreekfs.example</div>
                  </div>
                </div>
              </div>
              <div className="card" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                <span className="bdg bdg-ok">
                  <CircleCheck className="ic" aria-hidden="true" />
                  Accepted
                </span>
                <p className="muted">Decision committed May 18 · award awd_01J2Q7 created · $150,000.</p>
                <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="b">
                  Open award →
                </Link>
              </div>
              <div
                className="card"
                style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px", background: "#F7FAFA" }}
              >
                <span className="row" style={{ gap: "6px", fontWeight: 700, color: "#0D2A43" }}>
                  <EyeOff className="ic" aria-hidden="true" />
                  External reviewer view
                </span>
                <p className="muted">
                  Same screen for Dr. Hollis Grant, with: contact details masked · no Applicant tab · PII-flagged fields hidden · no
                  Messages or Activity · scoring panel in place of actions.
                </p>
                <Link to="/review/score/app_01HZX4" className="b">
                  Open reviewer scoring →
                </Link>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
