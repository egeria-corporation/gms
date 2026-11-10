// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Link } from "react-router";
import { BadgeCheck, Check, CircleCheck, Lock, Pencil, ShieldCheck, Upload, X } from "lucide-react";
import { Dialog } from "../../components/Dialog.tsx";
import { ApplicantShell } from "../../components/shells.tsx";

export default function EditorSubmit() {
  // This route is the editor with the readiness dialog open; closing it leaves the editor.
  const [open, setOpen] = useState(true);
  return (
    <>
      <title>{"Submit application — readiness checklist"}</title>
      <ApplicantShell
        active="Applications"
        overlay={
          <Dialog open={open} onClose={() => setOpen(false)} labelledBy="submit-title" size="lg">
            <div className="hd">
              <div>
                <h2 id="submit-title" style={{ fontSize: "20px" }}>
                  Ready to submit?
                </h2>
                <p className="small muted" style={{ marginTop: "4px" }}>
                  Riverbend Community Foundation · Community Health Grants 2027 · Full proposal
                </p>
              </div>
              <button className="iconbtn" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X className="ic" aria-hidden="true" />
              </button>
            </div>
            <div className="bd" style={{ gap: "10px" }}>
              <div className="rc">
                <div className="rc-sum">
                  <CircleCheck className="ic" aria-hidden="true" style={{ color: "#0B5E47", width: "20px", height: "20px" }} />
                  <span>5 of 5 checks pass</span>
                </div>
                <div className="rc-row rc-pass">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Required sections complete</div>
                    <div className="r">8 of 8 · Budget totals $150,000, equal to the requested amount</div>
                  </div>
                  <a href="#budget" className="fix" onClick={() => setOpen(false)}>
                    Review
                  </a>
                </div>
                <div className="rc-row rc-pass">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Attachments present</div>
                    <div className="r">3 of 3 · letters of support added by Jamal Reed</div>
                  </div>
                  <a href="#attachments" className="fix" onClick={() => setOpen(false)}>
                    Review
                  </a>
                </div>
                <div className="rc-row rc-pass">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Eligibility preview</div>
                    <div className="r">4 of 4 rules pass against your Passport record</div>
                  </div>
                  <Link to="/w/alder-creek/find" className="fix">
                    Rules
                  </Link>
                </div>
                <div className="rc-row rc-pass">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Word limits respected</div>
                    <div className="r">Need statement 468 / 500 · Approach 312 / 400</div>
                  </div>
                  <span className="fix muted">—</span>
                </div>
                <div className="rc-row rc-pass">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Signing authority confirmed</div>
                    <div className="r">Maria Santos is a verified representative who may submit</div>
                  </div>
                  <span className="fix muted">—</span>
                </div>
              </div>
              <div className="bnr bnr-info">
                <ShieldCheck className="ic" aria-hidden="true" />
                <div>
                  <div className="t">Your Passport level L3 and attestation will be attached to this submission</div>
                  <div className="d">
                    Riverbend receives a snapshot of this application, your attestation and your payee status (bank name and last four
                    digits only). Nothing else from Passport is shared.
                  </div>
                </div>
              </div>
              <p className="small muted">
                You can withdraw until the stage closes on Apr 30, 2027. A PDF snapshot and the CommonGrants JSON are created at submission.
              </p>
            </div>
            <div className="ft">
              <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <Link to="/w/alder-creek/applications/app_01HZX4/submitted" className="btn btn-primary btn-lg">
                Submit application
              </Link>
            </div>
          </Dialog>
        }
      >
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
                All changes saved
              </span>
              <div className="pres" aria-label="Editing now: Maria Santos">
                <span className="av av-t live" title="Maria Santos (you)">
                  MS
                </span>
              </div>
              <Link to="/preview/pdf/application-snapshot" className="btn btn-secondary">
                Preview
              </Link>
              <button className="btn btn-primary" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
                Submit…
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "248px minmax(0, 1fr) 320px", gap: "20px", alignItems: "start" }}>
            <aside className="card" style={{ padding: "12px" }}>
              <div className="eyebrow" style={{ padding: "4px 10px 10px" }}>
                Sections · 8 of 8 complete
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
                <a href="#need" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Need statement</div>
                    <div className="st">Complete · 468 / 500 words</div>
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
                    <div className="st">Complete · $150,000</div>
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
                    <div className="st">3 of 3 files</div>
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
            </aside>
            <section style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: "0" }}>
              <div className="card" id="budget">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Budget</h2>
                    <p className="small muted">Proposed budget by category. Totals must equal the requested amount.</p>
                  </div>
                  <span className="bdg bdg-ok">
                    <CircleCheck className="ic" aria-hidden="true" />
                    Complete
                  </span>
                </div>
                <div className="card-b">
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
                          <td className="num">$96,000</td>
                          <td className="num">$24,000</td>
                          <td className="num b">$120,000</td>
                          <td>2 navigators, 0.15 FTE director</td>
                        </tr>
                        <tr>
                          <td>Travel & vehicle</td>
                          <td className="num">$28,000</td>
                          <td className="num">$0</td>
                          <td className="num b">$28,000</td>
                          <td>Van lease, fuel, maintenance</td>
                        </tr>
                        <tr>
                          <td>Supplies</td>
                          <td className="num">$11,000</td>
                          <td className="num">$0</td>
                          <td className="num b">$11,000</td>
                          <td>Tablets, printed materials, vouchers</td>
                        </tr>
                        <tr>
                          <td>Indirect (10% cap)</td>
                          <td className="num">$15,000</td>
                          <td className="num">$0</td>
                          <td className="num b">$15,000</td>
                          <td>Within the 10% limit</td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Total</td>
                          <td className="num">$150,000</td>
                          <td className="num">$24,000</td>
                          <td className="num">$174,000</td>
                          <td>
                            <span className="row" style={{ gap: "5px", color: "#0B5E47" }}>
                              <Check className="ic ic-sm" aria-hidden="true" />
                              Equals requested amount
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
              <div className="card" id="attachments">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Attachments</h2>
                    <p className="small muted">Three documents are required.</p>
                  </div>
                  <span className="bdg bdg-ok">
                    <CircleCheck className="ic" aria-hidden="true" />3 of 3
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
                      </div>
                    </div>
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
                      </div>
                    </div>
                  </div>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Letters of support — Copper Valley Clinic, County Health.pdf</div>
                      <div className="mt">
                        <span>2.3 MB</span>
                        <span>·</span>
                        <span className="prov prov-entered">
                          <Upload className="ic" aria-hidden="true" />
                          Uploaded by Jamal Reed
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <aside className="card" style={{ overflow: "hidden" }}>
              <div className="panel-tabs" role="tablist">
                <button className="tab on" role="tab" aria-selected="true">
                  Validation
                  <span className="n" style={{ background: "#D9F5EC", color: "#0B5E47" }}>
                    0
                  </span>
                </button>
                <button className="tab" role="tab">
                  Comments<span className="n">2</span>
                </button>
                <button className="tab" role="tab">
                  Assignments
                </button>
                <button className="tab" role="tab">
                  Assistant
                </button>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="row" style={{ gap: "8px", color: "#0B5E47", fontWeight: 700 }}>
                  <CircleCheck className="ic" aria-hidden="true" />0 blockers · 0 warnings
                </div>
                <p className="small muted">Every required field is complete and within limits. Submit opens the readiness checklist.</p>
              </div>
            </aside>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
