// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  BadgeCheck,
  BookOpen,
  Check,
  Circle,
  CircleCheck,
  CircleX,
  Clock4,
  Cloud,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  Shield,
  ShieldCheck,
  Sparkles,
  TriangleExclamationPoint,
  Upload,
} from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function Editor() {
  return (
    <>
      <title>{"Application editor — Alder Creek Family Services"}</title>
      <ApplicantShell active="Applications">
        <main className="main" style={{ padding: "20px 28px 48px", gap: "16px" }}>
          <div className="crumbs">
            <Link to="/w/alder-creek">Dashboard</Link>
            <span>›</span>
            <Link to="/w/alder-creek/applications/app_01HZX4">Applications</Link>
            <span>›</span>
            <span>Mobile Health Navigation for Rural Families</span>
          </div>
          <div className="card" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
            <span className="chip">
              <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
              <h1 style={{ fontSize: "20px" }}>Mobile Health Navigation for Rural Families</h1>
              <div className="row small muted" style={{ gap: "10px", flexWrap: "wrap" }}>
                <span>Community Health Grants 2027</span>
                <span>·</span>
                <span className="bdg bdg-prog">
                  <Pencil className="ic" aria-hidden="true" />
                  Full proposal · Draft
                </span>
                <span>·</span>
                <span className="b" style={{ color: "#7A4A00" }}>
                  Closes in 14 days · Apr 30, 2027 5:00 PM PT
                </span>
              </div>
            </div>
            <div className="row" style={{ marginLeft: "auto", gap: "14px", flexWrap: "wrap" }}>
              <span className="notice">
                <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                Saved 12 seconds ago
              </span>
              <div className="pres" aria-label="Editing now: Maria Santos, Jamal Reed, Lena Fischer">
                <span className="av av-t live" title="Maria Santos (you)">
                  MS
                </span>
                <span className="av live-b" title="Jamal Reed">
                  JR
                </span>
                <span className="av av-g" title="Lena Fischer (consultant)">
                  LF
                </span>
              </div>
              <Link to="/preview/pdf/application-snapshot" className="btn btn-secondary">
                Preview
              </Link>
              <Link to="/w/alder-creek/applications/app_01HZX4/edit/submit" className="btn btn-primary">
                Submit…
              </Link>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "248px minmax(0, 1fr) 320px", gap: "20px", alignItems: "start" }}>
            <aside className="card" style={{ padding: "12px", position: "sticky", top: "16px" }}>
              <div className="eyebrow" style={{ padding: "4px 10px 10px" }}>
                Sections · 3 of 8 complete
              </div>
              <nav className="sec" aria-label="Application sections">
                <a href="#organization" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Organization</div>
                    <div className="st">Complete · from Passport</div>
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
                <a href="#need" className="s-prog on" aria-current="true">
                  <Clock4 className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Need statement</div>
                    <div className="st">In progress · 412 / 500 words</div>
                  </div>
                  <span className="meta">
                    <MessageSquare className="ic ic-sm" aria-hidden="true" />2<span className="av av-sm">JR</span>
                  </span>
                </a>
                <a href="#approach" className="s-prog">
                  <Clock4 className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Approach & activities</div>
                    <div className="st">In progress</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-t">MS</span>
                  </span>
                </a>
                <a href="#budget" className="s-todo">
                  <Circle className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Budget</div>
                    <div className="st">Not started · assigned to consultant</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-g">LF</span>
                  </span>
                </a>
                <a href="#outcomes" className="s-todo">
                  <Circle className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Outcomes & evaluation</div>
                    <div className="st">Not started</div>
                  </div>
                  <span className="meta">
                    <span className="muted xs">Unassigned</span>
                  </span>
                </a>
                <a href="#attachments" className="s-prog">
                  <Clock4 className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Attachments</div>
                    <div className="st">2 of 3 files</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm">JR</span>
                  </span>
                </a>
                <a href="#loi" className="s-lock">
                  <Lock className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">LOI responses</div>
                    <div className="st">Locked · prior stage, read-only</div>
                  </div>
                  <span className="meta"></span>
                </a>
              </nav>
              <div className="divider" style={{ margin: "10px 0" }}></div>
              <div className="small muted" style={{ padding: "0 10px 4px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <span>Form v2 · pinned by Riverbend</span>
                <Link to="/preview/pdf/application-snapshot">Download draft PDF</Link>
              </div>
            </aside>
            <section style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: "0" }}>
              <div className="card" id="organization">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Organization</h2>
                    <p className="small muted">
                      Prefilled from your Passport record. Values are read-only here; change them in Passport and they update everywhere.
                    </p>
                  </div>
                  <span className="bdg bdg-ok">
                    <CircleCheck className="ic" aria-hidden="true" />
                    Complete
                  </span>
                </div>
                <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "18px 24px" }}>
                  <div className="fld">
                    <label className="lbl" htmlFor="legal">
                      Legal name
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="legal" defaultValue="Alder Creek Family Services" readOnly />
                    <span className="help">
                      <Link to="/w/alder-creek/organization">Edit in Passport</Link> · synced 2 min ago
                    </span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="tax">
                      Tax status
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="tax" defaultValue="501(c)(3) public charity · verified by Passport" readOnly />
                    <span className="help">Determination letter is in your Passport locker</span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="addr">
                      Mailing address
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="addr" defaultValue="418 Mill Road, Alder Creek, OR" readOnly />
                    <span className="help">
                      <Link to="/w/alder-creek/organization">Edit in Passport</Link>
                    </span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="contact">
                      Primary contact
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="contact" defaultValue="Maria Santos · Executive Director" readOnly />
                    <span className="help">Representatives are managed in Passport</span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="annual">
                      Annual operating budget
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="annual" defaultValue="$2,400,000 (FY2026)" readOnly />
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="req">
                      Requested amount
                      <span className="req" aria-hidden="true">
                        *
                      </span>
                      <span className="prov prov-entered">
                        <Pencil className="ic" aria-hidden="true" />
                        Entered
                      </span>
                    </label>
                    <input className="inp" id="req" defaultValue="$150,000" />
                    <span className="help">
                      Range for this opportunity: $50,000 – $150,000 · maps to CommonGrants <span className="mono">requestedAmount</span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="card" id="need">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Need statement</h2>
                    <p className="small muted">
                      Describe the community need this project addresses and the evidence for it. 500 words maximum.
                    </p>
                  </div>
                  <span className="bdg bdg-prog">
                    <Clock4 className="ic" aria-hidden="true" />
                    In progress
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div className="fld">
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                      <label className="lbl" htmlFor="need-text">
                        What need does this project address?
                        <span className="req" aria-hidden="true">
                          *
                        </span>
                        <span className="prov prov-library">
                          <BookOpen className="ic" aria-hidden="true" />
                          From library · “Need”
                        </span>
                      </label>
                      <Link to="/w/alder-creek/library" className="btn btn-sm btn-secondary">
                        <BookOpen className="ic" aria-hidden="true" />
                        Insert from answer library
                      </Link>
                    </div>
                    <textarea
                      className="ta"
                      id="need-text"
                      style={{ minHeight: "220px", fontSize: "16px" }}
                      defaultValue={"Families in the Alder Creek valley travel an average of 46 miles to reach a primary care provider, and one in four households has no reliable vehicle. Over the last three years our intake data shows that missed appointments, not lack of coverage, is the leading reason children in our programs fall behind on well-child visits and immunizations.\n\nMobile Health Navigation pairs a community health navigator with a scheduled van route across the six unincorporated communities we serve. Navigators schedule visits, arrange rides, and follow up on referrals so that a family's first contact with the clinic is not an emergency room visit. The 2026 county health assessment ranks transportation access as the top barrier to care for rural families, and our pilot with 38 families cut missed appointments by 41 percent."}
                    />
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="help">Reviewers see this field. Avoid personal health details about named individuals.</span>
                      <span className="counter">412 / 500 words</span>
                    </div>
                  </div>
                  <div className="cmt" style={{ background: "#F7FAFA" }}>
                    <div className="hd">
                      <span className="av av-sm">JR</span>
                      <span className="who">Jamal Reed</span>
                      <span>· 1 hour ago</span>
                      <span className="fld-ref">on “What need does this project address?”</span>
                      <span className="shared-mark">Team</span>
                    </div>
                    <div className="bd">Can we cite the county assessment by name and year? The reviewers’ rubric asks for a source.</div>
                    <div className="row small">
                      <a href="#need">Reply</a>
                      <a href="#need">Resolve</a>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card" id="approach">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Approach & activities</h2>
                    <p className="small muted">Activities, timeline and key staff for the grant period (Jul 1, 2027 – Jun 30, 2028).</p>
                  </div>
                  <span className="bdg bdg-prog">
                    <Clock4 className="ic" aria-hidden="true" />
                    In progress
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  <div className="fld">
                    <label className="lbl" htmlFor="approach-text">
                      Describe the main activities
                      <span className="req" aria-hidden="true">
                        *
                      </span>
                      <span className="prov prov-entered">
                        <Pencil className="ic" aria-hidden="true" />
                        Entered
                      </span>
                    </label>
                    <textarea
                      className="ta"
                      id="approach-text"
                      style={{ minHeight: "120px", fontSize: "16px" }}
                      defaultValue="Two navigators cover a weekly route of six stops. Each stop offers scheduling, transport vouchers, and warm hand-offs to the Copper Valley Clinic telehealth room."
                    />
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="help">Shown when “Project type” is Direct service</span>
                      <span className="counter">38 / 400 words</span>
                    </div>
                  </div>
                  <div className="fld">
                    <span className="lbl">
                      Key staff
                      <span className="muted" style={{ fontWeight: 400 }}>
                        · repeating group, up to 5
                      </span>
                    </span>
                    <div className="tbl-wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Role on project</th>
                            <th>FTE</th>
                            <th style={{ width: "40px" }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Maria Santos</td>
                            <td>Project director</td>
                            <td>0.15</td>
                            <td>
                              <button className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label="Remove Maria Santos">
                                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M3 6h18" />
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                          <tr>
                            <td>To be hired</td>
                            <td>Community health navigator (2)</td>
                            <td>2.00</td>
                            <td>
                              <button className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label="Remove navigator row">
                                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M3 6h18" />
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <button className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }}>
                      <Plus className="ic" aria-hidden="true" />
                      Add staff member
                    </button>
                  </div>
                </div>
              </div>
              <div className="card" id="budget">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Budget</h2>
                    <p className="small muted">Proposed budget by category. Totals must equal the requested amount.</p>
                  </div>
                  <div className="row" style={{ gap: "10px" }}>
                    <span className="row small muted" style={{ gap: "6px" }}>
                      <span className="av av-sm av-g">LF</span>Assigned to Lena Fischer (consultant)
                    </span>
                    <span className="bdg bdg-neutral">
                      <Circle className="ic" aria-hidden="true" />
                      Not started
                    </span>
                  </div>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="tbl-wrap">
                    <table className="tbl bud">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th className="num">Requested from Riverbend</th>
                          <th className="num">Other sources</th>
                          <th className="num">Total</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Personnel</td>
                          <td className="num">
                            <input
                              className="inp"
                              style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                              defaultValue="$96,000"
                              aria-label="Personnel requested"
                            />
                          </td>
                          <td className="num">
                            <input
                              className="inp"
                              style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                              defaultValue="$24,000"
                              aria-label="Personnel other sources"
                            />
                          </td>
                          <td className="num b">$120,000</td>
                          <td>
                            <input
                              className="inp"
                              style={{ height: "32px", fontSize: "14px" }}
                              defaultValue="2 navigators, 0.15 FTE director"
                              aria-label="Personnel notes"
                            />
                          </td>
                        </tr>
                        <tr>
                          <td>Travel & vehicle</td>
                          <td className="num">
                            <input
                              className="inp"
                              style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                              defaultValue="$28,000"
                              aria-label="Travel requested"
                            />
                          </td>
                          <td className="num">
                            <input
                              className="inp"
                              style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                              defaultValue="$0"
                              aria-label="Travel other sources"
                            />
                          </td>
                          <td className="num b">$28,000</td>
                          <td>
                            <input
                              className="inp"
                              style={{ height: "32px", fontSize: "14px" }}
                              defaultValue="Van lease, fuel, maintenance"
                              aria-label="Travel notes"
                            />
                          </td>
                        </tr>
                        <tr>
                          <td>Supplies</td>
                          <td className="num">
                            <input
                              className="inp"
                              style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                              defaultValue="$11,000"
                              aria-label="Supplies requested"
                            />
                          </td>
                          <td className="num">
                            <input
                              className="inp"
                              style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                              defaultValue="$0"
                              aria-label="Supplies other sources"
                            />
                          </td>
                          <td className="num b">$11,000</td>
                          <td>
                            <input
                              className="inp"
                              style={{ height: "32px", fontSize: "14px" }}
                              defaultValue="Tablets, printed materials, vouchers"
                              aria-label="Supplies notes"
                            />
                          </td>
                        </tr>
                        <tr>
                          <td>Indirect (10% cap)</td>
                          <td className="num">
                            <input
                              className="inp err"
                              style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                              defaultValue="$18,000"
                              aria-label="Indirect requested"
                            />
                          </td>
                          <td className="num">
                            <input
                              className="inp"
                              style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                              defaultValue="$0"
                              aria-label="Indirect other sources"
                            />
                          </td>
                          <td className="num b over">$18,000</td>
                          <td>
                            <span className="err-msg">
                              <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                              Over the 10% indirect limit ($15,000)
                            </span>
                          </td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Total</td>
                          <td className="num over">$153,000</td>
                          <td className="num">$24,000</td>
                          <td className="num">$177,000</td>
                          <td>
                            <span className="err-msg">
                              <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                              $3,000 over the requested amount
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="row" style={{ gap: "10px" }}>
                    <button className="btn btn-sm btn-secondary">
                      <Plus className="ic" aria-hidden="true" />
                      Add category
                    </button>
                    <Link to="/w/alder-creek/library" className="small b">
                      Reuse last year’s budget as a starting point
                    </Link>
                  </div>
                </div>
              </div>
              <div className="card" id="attachments">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Attachments</h2>
                    <p className="small muted">Three documents are required. Passport locker files are already verified.</p>
                  </div>
                  <span className="bdg bdg-prog">
                    <Clock4 className="ic" aria-hidden="true" />2 of 3
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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
                        <span className="mono" title="sha256 3f9a…c21e">
                          sha256 3f9a…c21e
                        </span>
                      </div>
                    </div>
                    <a href="#attachments" className="btn btn-sm btn-ghost">
                      Preview
                    </a>
                  </div>
                  <div className="doc">
                    <span className="ft ft-xls">XLS</span>
                    <div className="grow">
                      <div className="nm">FY2026 audited financials.xlsx</div>
                      <div className="mt">
                        <span>1.1 MB</span>
                        <span>·</span>
                        <span className="prov prov-passport">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          Passport locker
                        </span>
                        <span>·</span>
                        <span className="mono">sha256 8b10…77d4</span>
                      </div>
                    </div>
                    <a href="#attachments" className="btn btn-sm btn-ghost">
                      Preview
                    </a>
                  </div>
                  <div
                    style={{
                      border: "1px dashed #B9C6C6",
                      borderRadius: "8px",
                      padding: "16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      background: "#F7FAFA",
                    }}
                  >
                    <div>
                      <div className="b">
                        Letters of support{" "}
                        <span className="req" aria-hidden="true">
                          *
                        </span>
                      </div>
                      <div className="help">PDF, up to 10 MB. At least one letter from a partner clinic.</div>
                    </div>
                    <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                      <button className="btn btn-sm btn-secondary">
                        <Upload className="ic" aria-hidden="true" />
                        Upload
                      </button>
                      <button className="btn btn-sm btn-secondary">
                        <Shield className="ic" aria-hidden="true" />
                        Passport locker
                      </button>
                      <button className="btn btn-sm btn-secondary">
                        <Cloud className="ic" aria-hidden="true" />
                        Google Drive
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card" id="loi" style={{ opacity: ".85" }}>
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>LOI responses</h2>
                    <p className="small muted">Submitted Feb 21, 2027. Prior-stage responses are read-only and visible to reviewers.</p>
                  </div>
                  <span className="bdg bdg-neutral">
                    <Lock className="ic" aria-hidden="true" />
                    Locked
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "15px" }}>
                  <div>
                    <div className="lbl" style={{ fontSize: "14px" }}>
                      Summary of intent
                    </div>
                    <p className="muted">
                      Expand mobile health navigation from a 38-family pilot to the six unincorporated communities of the Alder Creek
                      valley.
                    </p>
                  </div>
                  <div>
                    <div className="lbl" style={{ fontSize: "14px" }}>
                      Estimated request
                    </div>
                    <p className="muted">$140,000 – $150,000</p>
                  </div>
                </div>
              </div>
            </section>
            <aside style={{ display: "flex", flexDirection: "column", gap: "0", position: "sticky", top: "16px" }}>
              <div className="card" style={{ overflow: "hidden" }}>
                <div className="panel-tabs" role="tablist">
                  <button className="tab on" role="tab" aria-selected="true">
                    Validation
                    <span className="n" style={{ background: "#FBE3E3", color: "#9B1C1C" }}>
                      3
                    </span>
                  </button>
                  <button className="tab" role="tab">
                    Comments<span className="n">2</span>
                  </button>
                  <button className="tab" role="tab">
                    Assignments
                  </button>
                  <button className="tab" role="tab">
                    <Sparkles className="ic" aria-hidden="true" />
                    Assistant
                  </button>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <div className="eyebrow" style={{ color: "#9B1C1C" }}>
                      Blockers · 2
                    </div>
                    <ul style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                      <li>
                        <a
                          href="#budget"
                          className="rc-row rc-fail"
                          style={{ padding: "8px 0", border: "0", textDecoration: "none", color: "inherit" }}
                        >
                          <CircleX className="ic" aria-hidden="true" />
                          <div>
                            <div className="l">Budget total exceeds requested amount</div>
                            <div className="r">$153,000 requested vs $150,000 entered</div>
                          </div>
                          <span className="fix">Fix →</span>
                        </a>
                      </li>
                      <li>
                        <a
                          href="#attachments"
                          className="rc-row rc-fail"
                          style={{ padding: "8px 0", border: "0", textDecoration: "none", color: "inherit" }}
                        >
                          <CircleX className="ic" aria-hidden="true" />
                          <div>
                            <div className="l">Letters of support missing</div>
                            <div className="r">Required attachment, none added</div>
                          </div>
                          <span className="fix">Fix →</span>
                        </a>
                      </li>
                    </ul>
                  </div>
                  <div>
                    <div className="eyebrow" style={{ color: "#7A4A00" }}>
                      Warnings · 1
                    </div>
                    <ul style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                      <li>
                        <a
                          href="#budget"
                          className="rc-row rc-unk"
                          style={{ padding: "8px 0", border: "0", textDecoration: "none", color: "inherit" }}
                        >
                          <TriangleExclamationPoint className="ic" aria-hidden="true" style={{ color: "#7A4A00" }} />
                          <div>
                            <div className="l" style={{ color: "#1E2D2B" }}>
                              Indirect costs over the 10% cap
                            </div>
                            <div className="r">$18,000 entered; cap is $15,000</div>
                          </div>
                          <span className="fix">View →</span>
                        </a>
                      </li>
                    </ul>
                  </div>
                  <div className="divider"></div>
                  <div>
                    <div className="eyebrow">Eligibility preview</div>
                    <ul style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px", fontSize: "13px" }}>
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
                    </ul>
                  </div>
                  <div className="bnr bnr-info" style={{ padding: "10px 12px" }}>
                    <ShieldCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="t" style={{ fontSize: "13px" }}>
                        Passport level L3 will be attached
                      </div>
                      <div className="d" style={{ fontSize: "12px" }}>
                        Your attestation and payee status travel with the submission.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="assist" style={{ marginTop: "16px" }}>
                <div className="hd">
                  <Sparkles className="ic" aria-hidden="true" style={{ color: "#4B2E9E" }} />
                  Assistant<span className="draft-mark">Draft — review before use</span>
                  <span className="quota">14 of 40 this month</span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <p className="muted">
                    Adapt a library answer to the question in focus. Output appears here first; nothing is written into the form until you
                    insert it.
                  </p>
                  <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }}>
                    Adapt “Need” to this question
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
