// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { BadgeCheck, Check, CircleCheck, Clock, Globe, Hash, Lock, Mail, PenLine, Send, User, X } from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function GrantOffered() {
  return (
    <>
      <title>{"Grant — Offered: accept and sign"}</title>
      <ApplicantShell
        active="My grants"
        overlay={
          <>
            <div className="ovl" id="sign" role="dialog" aria-modal="true" aria-labelledby="sign-title" style={{ paddingTop: "72px" }}>
              <div className="mdl mdl-lg">
                <div className="hd">
                  <div>
                    <h2 id="sign-title" style={{ fontSize: "20px" }}>
                      Sign the grant agreement
                    </h2>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      Riverbend Community Foundation · Mobile Health Navigation for Rural Families · $150,000
                    </p>
                  </div>
                  <button className="iconbtn" aria-label="Close">
                    <X className="ic" aria-hidden="true" />
                  </button>
                </div>
                <div className="bd" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "20px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <span className="eyebrow">Document</span>
                    <div
                      style={{
                        border: "1px solid #D6DEDE",
                        borderRadius: "8px",
                        height: "300px",
                        overflow: "auto",
                        padding: "16px 18px",
                        background: "#FFFFFF",
                        fontSize: "13px",
                        lineHeight: 1.6,
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div className="b" style={{ fontFamily: "var(--font-display)", color: "#0D2A43", fontSize: "15px" }}>
                        Grant Agreement — Community Health Grants 2027
                      </div>
                      <p>
                        <span className="b">1. Parties.</span> Riverbend Community Foundation and Alder Creek Family Services.
                      </p>
                      <p>
                        <span className="b">2. Purpose and amount.</span> $150,000 for Mobile Health Navigation for Rural Families, Jul 1,
                        2027 – Jun 30, 2028.
                      </p>
                      <p>
                        <span className="b">3. Payment schedule.</span> $75,000 on execution; $60,000 on acceptance of the interim report;
                        $15,000 on acceptance of the final report.
                      </p>
                      <p>
                        <span className="b">4. Use of funds.</span> Funds are restricted to the approved budget; reallocations above 10% of
                        a category require an amendment.
                      </p>
                      <p>
                        <span className="b">5. Reporting.</span> Interim report due Dec 15, 2027; final report due Jul 15, 2028, each on the
                        Funder’s report form.
                      </p>
                      <p>
                        <span className="b">6. Records and audit.</span> Grantee keeps financial records for three years after closeout.
                      </p>
                      <p className="muted">Clauses 7–12 …</p>
                    </div>
                    <div className="row small muted" style={{ gap: "6px" }}>
                      <Hash className="ic" aria-hidden="true" />
                      Document hash sha256 7e2b…40af · 12 pages ·<Link to="/preview/pdf/agreement">open PDF</Link>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="fld">
                      <label className="lbl" htmlFor="typed">
                        Type your full legal name
                      </label>
                      <input
                        className="inp"
                        id="typed"
                        defaultValue="Maria Santos"
                        style={{ fontFamily: "var(--font-emphasis)", fontStyle: "italic", fontSize: "20px", height: "48px" }}
                      />
                      <span className="help">Must match a verified representative: Maria Santos, Executive Director.</span>
                    </div>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>I am authorized to sign for Alder Creek Family Services and agree to the terms above.</span>
                    </label>
                    <div className="card" style={{ padding: "12px 14px", background: "#F7FAFA" }}>
                      <div className="eyebrow">What is recorded</div>
                      <ul style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px", fontSize: "14px" }}>
                        <li className="row" style={{ gap: "8px" }}>
                          <User className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                          Typed name · Maria Santos
                        </li>
                        <li className="row" style={{ gap: "8px" }}>
                          <Clock className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                          Time of signing (UTC) · recorded at click
                        </li>
                        <li className="row" style={{ gap: "8px" }}>
                          <Globe className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                          IP address of this session
                        </li>
                        <li className="row" style={{ gap: "8px" }}>
                          <Hash className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                          Document hash · sha256 7e2b…40af
                        </li>
                      </ul>
                    </div>
                    <div className="row small muted" style={{ gap: "6px" }}>
                      <Lock className="ic" aria-hidden="true" />
                      Signing is a human gate: a connected agent can prepare this agreement but can never sign it.
                    </div>
                  </div>
                </div>
                <div className="ft">
                  <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="btn btn-secondary">
                    Cancel
                  </Link>
                  <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="btn btn-primary btn-lg">
                    <PenLine className="ic" aria-hidden="true" />
                    Sign agreement
                  </Link>
                </div>
              </div>
            </div>
          </>
        }
      >
        <main className="main">
          <div className="ph">
            <div>
              <h1>My grants</h1>
              <div className="meta">
                <span>2 grants · $190,000 awarded · $40,000 received</span>
              </div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl" style={{ fontSize: "14px" }}>
              <thead>
                <tr>
                  <th>Funder</th>
                  <th>Title</th>
                  <th className="num">Awarded</th>
                  <th className="num">Received</th>
                  <th className="num">Remaining</th>
                  <th>Next due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="sel">
                  <td>
                    <span className="chip">
                      <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                    </span>
                  </td>
                  <td>
                    <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="b">
                      Mobile Health Navigation for Rural Families
                    </Link>
                  </td>
                  <td className="num">$150,000</td>
                  <td className="num">$0</td>
                  <td className="num">$150,000</td>
                  <td className="muted">—</td>
                  <td>
                    <span className="bdg bdg-info">
                      <Mail className="ic" aria-hidden="true" />
                      Offered
                    </span>
                  </td>
                </tr>
                <tr style={{ "--tenant": "#7A4F01" } as CSSProperties}>
                  <td>
                    <span className="chip">
                      <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                    </span>
                  </td>
                  <td>
                    <Link to="/w/alder-creek/grants/awd_01J2Q7" className="b">
                      2026 Clinic Outreach
                    </Link>
                  </td>
                  <td className="num">$40,000</td>
                  <td className="num">$40,000</td>
                  <td className="num">$0</td>
                  <td>Final report · Jun 30</td>
                  <td>
                    <span className="bdg bdg-ok">
                      <BadgeCheck className="ic" aria-hidden="true" />
                      Active
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="row" style={{ gap: "14px", flexWrap: "wrap" }}>
              <span className="chip">
                <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
              </span>
              <h2 style={{ fontSize: "20px" }}>Mobile Health Navigation for Rural Families</h2>
              <span className="bdg bdg-info bdg-lg">
                <Mail className="ic" aria-hidden="true" />
                Offered
              </span>
              <span className="small muted" style={{ marginLeft: "auto" }}>
                Award <span className="mono">awd_01J2Q7</span> · Community Health 2027 · period Jul 1, 2027 – Jun 30, 2028
              </span>
            </div>
            <div className="amounts">
              <div>
                <div className="stat-l">Awarded</div>
                <div className="stat-v">$150,000</div>
              </div>
              <div>
                <div className="stat-l">Disbursed</div>
                <div className="stat-v">$0</div>
              </div>
              <div>
                <div className="stat-l">Remaining</div>
                <div className="stat-v">$150,000</div>
              </div>
              <div>
                <div className="stat-l">Payment destination</div>
                <div className="row" style={{ gap: "8px", marginTop: "6px" }}>
                  <span className="b">River City Credit Union •••• 4821</span>
                  <span className="pay pay-active">
                    <Check className="ic" aria-hidden="true" />
                    Payee active
                  </span>
                </div>
              </div>
            </div>
            <div className="bnr bnr-info">
              <Mail className="ic" aria-hidden="true" />
              <div>
                <div className="t">Riverbend offered this award on May 19, 2027. Accept by Jun 2, 2027.</div>
                <div className="d">
                  Accepting opens the grant agreement for signature. The first tranche ($75,000) is released after both signatures and a
                  readiness check.
                </div>
              </div>
              <a href="#agreement" className="btn btn-primary act">
                Accept award
              </a>
            </div>
          </div>
          <div className="tabs" role="tablist" id="agreement">
            <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="tab on" role="tab" aria-selected="true">
              Agreement
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" role="tab">
              Payments<span className="n">3</span>
            </Link>
            <Link to="/w/alder-creek/reports" className="tab" role="tab">
              Reports<span className="n">2</span>
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" role="tab">
              Budget
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" role="tab">
              Amendments
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" role="tab">
              Documents<span className="n">2</span>
            </Link>
            <Link to="/w/alder-creek/applications/app_01HZX4" className="tab" role="tab">
              Messages
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" role="tab">
              Closeout
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <section className="card">
              <div className="card-h">
                <div>
                  <h2 style={{ fontSize: "18px" }}>Grant agreement</h2>
                  <p className="small muted">Riverbend Community Foundation · Standard grant agreement v4 · generated May 19, 2027</p>
                </div>
                <span className="bdg bdg-info">
                  <Send className="ic" aria-hidden="true" />
                  Sent
                </span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="stp" aria-label="Agreement status">
                  <div className="s done">
                    <span className="n">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    Draft
                  </div>
                  <span className="ln done"></span>
                  <div className="s done">
                    <span className="n">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    Sent
                  </div>
                  <span className="ln"></span>
                  <div className="s on">
                    <span className="n">3</span>Signed by grantee
                  </div>
                  <span className="ln"></span>
                  <div className="s">
                    <span className="n">4</span>Countersigned
                  </div>
                  <span className="ln"></span>
                  <div className="s">
                    <span className="n">5</span>Executed
                  </div>
                </div>
                <div
                  style={{
                    border: "1px solid #D6DEDE",
                    borderRadius: "8px",
                    padding: "18px 20px",
                    background: "#F7FAFA",
                    fontSize: "14px",
                    lineHeight: 1.6,
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div className="b" style={{ fontFamily: "var(--font-display)", color: "#0D2A43", fontSize: "16px" }}>
                    Grant Agreement — Community Health Grants 2027
                  </div>
                  <p>
                    <span className="b">1. Parties.</span> Riverbend Community Foundation (“Funder”) and Alder Creek Family Services
                    (“Grantee”), a 501(c)(3) public charity.
                  </p>
                  <p>
                    <span className="b">2. Purpose and amount.</span> Funder awards $150,000 for Mobile Health Navigation for Rural
                    Families, to be used during Jul 1, 2027 – Jun 30, 2028 as described in the approved application and budget.
                  </p>
                  <p>
                    <span className="b">3. Payment schedule.</span> $75,000 on execution; $60,000 on acceptance of the interim report (due
                    Dec 15, 2027); $15,000 on acceptance of the final report (due Jul 15, 2028). Payments go to the destination verified in
                    OpenGrants Passport.
                  </p>
                  <p className="muted">
                    … 9 more clauses · <a href="#agreement">read the full agreement</a>
                  </p>
                </div>
                <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                  <a href="#sign" className="btn btn-primary btn-lg">
                    <PenLine className="ic" aria-hidden="true" />
                    Review and sign
                  </a>
                  <Link to="/preview/pdf/agreement" className="btn btn-secondary btn-lg">
                    Download PDF
                  </Link>
                  <span className="small muted">Signing authority: Maria Santos (verified representative)</span>
                </div>
              </div>
            </section>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Before you sign</h2>
                </div>
                <div className="card-b rc" style={{ paddingTop: "8px" }}>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Payee verified (L3)</div>
                      <div className="r">River City Credit Union •••• 4821 · active</div>
                    </div>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Approved budget matches the application</div>
                      <div className="r">$150,000 across 4 categories</div>
                    </div>
                  </div>
                  <div className="rc-row rc-pass">
                    <CircleCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="l">Reporting plan accepted</div>
                      <div className="r">Interim Dec 15, 2027 · Final Jul 15, 2028</div>
                    </div>
                  </div>
                </div>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Documents</h2>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <Link to="/preview/email/award" className="doc" style={{ textDecoration: "none", color: "inherit" }}>
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Award letter</div>
                      <div className="mt">May 19, 2027 · Riverbend</div>
                    </div>
                  </Link>
                  <Link to="/preview/pdf/agreement" className="doc" style={{ textDecoration: "none", color: "inherit" }}>
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Grant agreement (unsigned)</div>
                      <div className="mt">sha256 7e2b…40af</div>
                    </div>
                  </Link>
                </div>
              </section>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
