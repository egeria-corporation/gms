// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  BadgeCheck,
  Calendar,
  Check,
  CircleCheck,
  CircleDashed,
  CirclePause,
  Clock,
  Database,
  ExternalLink,
  Info,
  Landmark,
  Lock,
  Mail,
  Send,
  Shield,
  Upload,
} from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function GrantPayments() {
  return (
    <>
      <title>{"Grant — Payments — Alder Creek Family Services"}</title>
      <ApplicantShell active="My grants">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/alder-creek">Dashboard</Link>
            <span>›</span>
            <Link to="/w/alder-creek/grants/awd_01J2Q7">My grants</Link>
            <span>›</span>
            <span>Mobile Health Navigation for Rural Families</span>
          </div>
          <div className="ph">
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="chip">
                <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
              </span>
              <div className="title">
                <h1>Mobile Health Navigation for Rural Families</h1>
                <span className="bdg bdg-ok bdg-lg">
                  <BadgeCheck className="ic" aria-hidden="true" />
                  Active
                </span>
              </div>
              <div className="meta">
                <span>Community Health Grants 2027</span>
                <span>·</span>
                <span>Grant period Jul 1, 2027 – Jun 30, 2028</span>
                <span>·</span>
                <span>Agreement executed May 24, 2027</span>
                <span>·</span>
                <Link to="/preview/pdf/agreement">Download executed agreement</Link>
              </div>
            </div>
            <div className="actions">
              <Link to="/w/alder-creek/reports" className="btn btn-secondary">
                Open interim report
              </Link>
              <a href="#messages" className="btn btn-secondary">
                Message Riverbend
              </a>
            </div>
          </div>
          <div className="amounts">
            <div>
              <div className="stat-l">Awarded</div>
              <div className="stat-v">$150,000</div>
            </div>
            <div>
              <div className="stat-l">Received</div>
              <div className="stat-v">$75,000</div>
              <div className="stat-d">1 of 3 tranches settled</div>
            </div>
            <div>
              <div className="stat-l">Remaining</div>
              <div className="stat-v">$75,000</div>
              <div className="stat-d">Next: $60,000 after interim report</div>
            </div>
            <div>
              <div className="stat-l">Period</div>
              <div className="mtr" style={{ marginTop: "8px" }}>
                <div className="track" style={{ height: "8px" }}>
                  <div className="fill" style={{ width: "8%" }}></div>
                </div>
                <div className="lbls">
                  <span>Jul 1, 2027</span>
                  <span>Jun 30, 2028</span>
                </div>
              </div>
            </div>
          </div>
          <div className="tabs" role="tablist" aria-label="Grant sections">
            <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="tab" role="tab">
              Agreement
            </Link>
            <a href="#payments" className="tab on" role="tab" aria-selected="true">
              Payments
            </a>
            <Link to="/w/alder-creek/reports" className="tab" role="tab">
              Reports<span className="n">1 due</span>
            </Link>
            <a href="#budget" className="tab" role="tab">
              Budget
            </a>
            <a href="#amendments" className="tab" role="tab">
              Amendments
            </a>
            <a href="#documents" className="tab" role="tab">
              Documents
            </a>
            <a href="#messages" className="tab" role="tab">
              Messages<span className="n">2</span>
            </a>
            <a href="#closeout" className="tab" role="tab">
              Closeout
            </a>
          </div>
          <div
            id="payments"
            style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}
          >
            <div className="card">
              <div className="card-h">
                <div>
                  <h2>Payment schedule</h2>
                  <p className="small muted">
                    Expected dates follow your funder's conditions. Money only moves after Riverbend's readiness check passes.
                  </p>
                </div>
              </div>
              <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                <table className="tbl" style={{ fontSize: "15px" }}>
                  <thead>
                    <tr>
                      <th>Tranche</th>
                      <th className="num">Amount</th>
                      <th>Condition</th>
                      <th>Expected</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="b">1</td>
                      <td className="num b">$75,000</td>
                      <td>On execution of the agreement</td>
                      <td>Settled May 25, 2027</td>
                      <td>
                        <span className="bdg bdg-ok">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          Settled
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="b">2</td>
                      <td className="num b">$60,000</td>
                      <td>When the interim report is accepted</td>
                      <td>After Dec 15, 2027</td>
                      <td>
                        <span className="bdg bdg-neutral">
                          <Calendar className="ic" aria-hidden="true" />
                          Scheduled
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="b">3</td>
                      <td className="num b">$15,000</td>
                      <td>When the final report is accepted</td>
                      <td>After Jul 15, 2028</td>
                      <td>
                        <span className="bdg bdg-neutral">
                          <Calendar className="ic" aria-hidden="true" />
                          Scheduled
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="card-f" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <span className="notice">
                  <Info className="ic" aria-hidden="true" />
                  Tranche 1 was sent by ACH · Passport disbursement pd_9K3M · confirmation emailed to grants@aldercreekfs.example
                </span>
                <Link to="/w/alder-creek/reports" className="small b">
                  Submit the interim report to unlock tranche 2 →
                </Link>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card">
                <div className="card-h">
                  <h3>Payment destination</h3>
                  <span className="pay pay-active">
                    <Check className="ic" aria-hidden="true" />
                    Payee active
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="row" style={{ gap: "12px" }}>
                    <span
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "10px",
                        background: "#E1F8F6",
                        color: "#145450",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Landmark className="ic ic-md" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="b">River City Credit Union •••• 4821</div>
                      <div className="small muted">
                        Verified in Passport ·{" "}
                        <span className="lvl lvl-3">
                          <Shield className="ic" aria-hidden="true" />
                          L3
                        </span>{" "}
                        payee verified
                      </div>
                    </div>
                  </div>
                  <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
                    <Clock className="ic" aria-hidden="true" />
                    <div>
                      <div className="t" style={{ fontSize: "14px" }}>
                        Expecting a payment?
                      </div>
                      <div className="d" style={{ fontSize: "13px" }}>
                        Changes to your bank account take 5 business days and pause payments until they clear. Manage the destination in
                        Passport, never here.
                      </div>
                    </div>
                  </div>
                  <Link to="/w/alder-creek/organization" className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                    <ExternalLink className="ic" aria-hidden="true" />
                    Manage in Passport
                  </Link>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Tranche 1 · disbursement</h3>
                  <span className="small muted">Passport id pd_9K3M</span>
                </div>
                <div className="card-b">
                  <div className="tl tl-sm">
                    <div className="tl-i tl-ok">
                      <span className="dot">
                        <Check className="ic" aria-hidden="true" />
                      </span>
                      <div>
                        <div className="what">Settled</div>
                        <div className="who">Passport · May 25, 2027 9:14 AM</div>
                      </div>
                    </div>
                    <div className="tl-i tl-passport">
                      <span className="dot">
                        <Send className="ic" aria-hidden="true" />
                      </span>
                      <div>
                        <div className="what">Initiated by ACH</div>
                        <div className="who">Passport · May 24, 2027 3:02 PM</div>
                      </div>
                    </div>
                    <div className="tl-i tl-person">
                      <span className="dot">
                        <Check className="ic" aria-hidden="true" />
                      </span>
                      <div>
                        <div className="what">Released by Marcus Lee (Riverbend finance)</div>
                        <div className="who">Readiness check 5 of 5 passed · May 24, 2027 2:58 PM</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
            <div className="card" id="budget">
              <div className="card-h">
                <div>
                  <h2>Budget</h2>
                  <p className="small muted">Approved vs actual. Actuals come from QuickBooks once categories are mapped.</p>
                </div>
                <span className="prov prov-qb">
                  <Database className="ic" aria-hidden="true" />
                  From QuickBooks · synced yesterday
                </span>
              </div>
              <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                <table className="tbl bud" style={{ fontSize: "14px" }}>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="num">Approved</th>
                      <th className="num">Actual to date</th>
                      <th className="num">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Personnel</td>
                      <td className="num">$96,000</td>
                      <td className="num">$31,400</td>
                      <td className="num var-pos">−$64,600</td>
                    </tr>
                    <tr>
                      <td>Travel & vehicle</td>
                      <td className="num">$28,000</td>
                      <td className="num">$30,240</td>
                      <td className="num var-neg">+$2,240 (8%)</td>
                    </tr>
                    <tr>
                      <td>Supplies</td>
                      <td className="num">$11,000</td>
                      <td className="num">$6,120</td>
                      <td className="num var-pos">−$4,880</td>
                    </tr>
                    <tr>
                      <td>Indirect (10%)</td>
                      <td className="num">$15,000</td>
                      <td className="num">$6,776</td>
                      <td className="num var-pos">−$8,224</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">$150,000</td>
                      <td className="num">$74,536</td>
                      <td className="num var-pos">−$75,464</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="card-b" style={{ borderTop: "1px solid #D6DEDE", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>Map categories</h3>
                  <span className="small muted">QuickBooks account → budget category</span>
                </div>
                <div className="kv" style={{ gridTemplateColumns: "minmax(0, 1fr) 24px minmax(0, 1fr)", fontSize: "14px" }}>
                  <dt className="mono" style={{ color: "#1E2D2B" }}>
                    6100 Salaries & wages
                  </dt>
                  <dd className="muted" style={{ textAlign: "center" }}>
                    →
                  </dd>
                  <dd>
                    <select className="sel" style={{ height: "36px", fontSize: "14px" }} aria-label="Category for 6100 Salaries and wages">
                      <option>Personnel</option>
                    </select>
                  </dd>
                  <dt className="mono" style={{ color: "#1E2D2B" }}>
                    6400 Vehicle lease & fuel
                  </dt>
                  <dd className="muted" style={{ textAlign: "center" }}>
                    →
                  </dd>
                  <dd>
                    <select
                      className="sel"
                      style={{ height: "36px", fontSize: "14px" }}
                      aria-label="Category for 6400 Vehicle lease and fuel"
                    >
                      <option>Travel & vehicle</option>
                    </select>
                  </dd>
                  <dt className="mono" style={{ color: "#1E2D2B" }}>
                    6550 Program supplies
                  </dt>
                  <dd className="muted" style={{ textAlign: "center" }}>
                    →
                  </dd>
                  <dd>
                    <select className="sel" style={{ height: "36px", fontSize: "14px" }} aria-label="Category for 6550 Program supplies">
                      <option>Supplies</option>
                    </select>
                  </dd>
                  <dt className="mono" style={{ color: "#1E2D2B" }}>
                    7000 Admin allocation
                  </dt>
                  <dd className="muted" style={{ textAlign: "center" }}>
                    →
                  </dd>
                  <dd>
                    <select
                      className="sel err"
                      style={{ height: "36px", fontSize: "14px" }}
                      aria-label="Category for 7000 Admin allocation"
                    >
                      <option>Unmapped</option>
                      <option>Indirect (10%)</option>
                    </select>
                  </dd>
                </div>
                <div className="row" style={{ gap: "10px" }}>
                  <button className="btn btn-sm btn-primary">Save mapping</button>
                  <span className="help">1 account unmapped · its $0 to date is excluded from actuals</span>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div className="card" id="amendments">
                <div className="card-h">
                  <div>
                    <h2>Amendments</h2>
                    <p className="small muted">No amendments requested yet.</p>
                  </div>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <span className="lbl">Request an amendment</span>
                  <div className="seg" role="group" aria-label="Amendment type">
                    <button className="on">Extension</button>
                    <button>Reallocation</button>
                    <button>Scope</button>
                    <button>Supplemental</button>
                  </div>
                  <div className="fld-row">
                    <div className="fld">
                      <label className="lbl" htmlFor="am-end">
                        New end date
                      </label>
                      <input className="inp" id="am-end" defaultValue="Sep 30, 2028" />
                    </div>
                    <div className="fld">
                      <label className="lbl" htmlFor="am-months">
                        Extension length
                      </label>
                      <input className="inp" id="am-months" defaultValue="3 months" readOnly />
                    </div>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="am-why">
                      Reason
                    </label>
                    <textarea
                      className="ta"
                      id="am-why"
                      placeholder="Why the grant period needs to change, and what it changes about reporting"
                    />
                  </div>
                  <div className="row" style={{ gap: "10px" }}>
                    <button className="btn btn-primary">Send request to Riverbend</button>
                    <span className="help">Riverbend approves or declines in their Awards view; you are notified either way.</span>
                  </div>
                </div>
              </div>
              <div className="card" id="documents">
                <div className="card-h">
                  <h2>Documents</h2>
                  <button className="btn btn-sm btn-secondary">
                    <Upload className="ic" aria-hidden="true" />
                    Upload
                  </button>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Grant agreement — executed.pdf</div>
                      <div className="mt">
                        <span>228 KB</span>
                        <span>·</span>
                        <span>Generated by the GMS · May 24, 2027</span>
                        <span>·</span>
                        <span className="mono" title="sha256 c41e…9ab2">
                          sha256 c41e…9ab2
                        </span>
                      </div>
                    </div>
                    <Link to="/preview/pdf/agreement" className="btn btn-sm btn-ghost">
                      Open
                    </Link>
                  </div>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Application snapshot — Full proposal.pdf</div>
                      <div className="mt">
                        <span>1.4 MB</span>
                        <span>·</span>
                        <span>Submitted Apr 16, 2027</span>
                        <span>·</span>
                        <span className="mono">sha256 7d02…e1f0</span>
                      </div>
                    </div>
                    <Link to="/preview/pdf/application-snapshot" className="btn btn-sm btn-ghost">
                      Open
                    </Link>
                  </div>
                  <div className="doc">
                    <span className="ft ft-doc">DOC</span>
                    <div className="grow">
                      <div className="nm">Award letter — Riverbend.docx</div>
                      <div className="mt">
                        <span>84 KB</span>
                        <span>·</span>
                        <span>Uploaded by Maria Santos</span>
                        <span>·</span>
                        <span className="mono">sha256 11ac…40d7</span>
                      </div>
                    </div>
                    <a href="#documents" className="btn btn-sm btn-ghost">
                      Open
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
            <div className="card" id="messages">
              <div className="card-h">
                <h2>Messages</h2>
                <span className="shared-mark">Shared with Riverbend</span>
              </div>
              <div className="card-b th">
                <div className="msg">
                  <span className="av">DO</span>
                  <div className="bub">
                    <div className="hd">
                      <span className="who">Dana Ortiz</span>
                      <span>Riverbend Community Foundation</span>
                      <span>· May 26, 2027</span>
                      <span className="shared-mark">Shared</span>
                    </div>
                    <div className="bd">
                      Tranche 1 settled yesterday. The interim report template is now in your Reports tab; it reuses your budget categories
                      so actuals can flow from QuickBooks.
                    </div>
                  </div>
                </div>
                <div className="msg">
                  <span className="av av-t">MS</span>
                  <div className="bub">
                    <div className="hd">
                      <span className="who">Maria Santos</span>
                      <span>· May 26, 2027</span>
                      <span className="shared-mark">Shared</span>
                    </div>
                    <div className="bd">
                      Received, thank you. Navigator hiring starts June 2; we will note the start dates in the report.
                    </div>
                  </div>
                </div>
                <div className="composer">
                  <label className="sr" htmlFor="reply">
                    Reply
                  </label>
                  <textarea className="ta" id="reply" style={{ minHeight: "56px" }} placeholder="Reply to Riverbend…" />
                  <button className="btn btn-primary">Send</button>
                </div>
              </div>
            </div>
            <div className="card" id="closeout">
              <div className="card-h">
                <div>
                  <h2>Closeout</h2>
                  <p className="small muted">Available after the final report is accepted. Preview of what completes the grant.</p>
                </div>
                <span className="bdg bdg-neutral">
                  <Lock className="ic" aria-hidden="true" />
                  Not yet available
                </span>
              </div>
              <div className="card-b">
                <div className="rc" style={{ opacity: ".8" }}>
                  <div className="rc-row rc-unk">
                    <CircleDashed className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Final report accepted</div>
                      <div className="r">Due Jul 15, 2028</div>
                    </div>
                    <span className="fix muted">Pending</span>
                  </div>
                  <div className="rc-row rc-unk">
                    <CircleDashed className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">All tranches settled or cancelled</div>
                      <div className="r">1 of 3 settled</div>
                    </div>
                    <span className="fix muted">Pending</span>
                  </div>
                  <div className="rc-row rc-unk">
                    <CircleDashed className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Budget reconciled</div>
                      <div className="r">Actuals within approved categories</div>
                    </div>
                    <span className="fix muted">Pending</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
            <span className="eyebrow">States · offered · suspended · completed</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px", alignItems: "start" }}>
              <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <span className="bdg bdg-info">
                  <Mail className="ic" aria-hidden="true" />
                  Offered
                </span>
                <h3>Riverbend offered $150,000</h3>
                <p className="small muted">
                  Review the agreement, accept the award, then sign. Payments are scheduled only after both signatures.
                </p>
                <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="btn btn-primary">
                  Accept award
                </Link>
              </div>
              <div className="bnr bnr-warn">
                <CirclePause className="ic" aria-hidden="true" />
                <div>
                  <div className="t">Grant suspended by Riverbend</div>
                  <div className="d">Payments are paused while the interim report is overdue. Scheduled tranches stay on the schedule.</div>
                  <div className="clears">
                    <Check className="ic ic-sm" aria-hidden="true" />
                    Clears when the interim report is accepted
                  </div>
                </div>
              </div>
              <div
                className="card"
                style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
              >
                <span className="bdg bdg-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  Completed
                </span>
                <h3>Grant completed Aug 2, 2028</h3>
                <p className="small muted">
                  $150,000 received · 3 reports accepted · budget reconciled. Archived; everything stays downloadable.
                </p>
                <Link to="/preview/pdf/closeout" className="small b">
                  Download closeout summary
                </Link>
              </div>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
