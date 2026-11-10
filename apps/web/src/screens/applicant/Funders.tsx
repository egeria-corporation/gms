// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { BadgeCheck, Calendar, Clock, ExternalLink, Info, Mail, PenLine, RotateCcw, Search, Send, ShieldCheck } from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function Funders() {
  return (
    <>
      <title>{"Funders — Alder Creek Family Services"}</title>
      <ApplicantShell active="Funders">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/alder-creek">Dashboard</Link>
            <span>›</span>
            <span>Funders</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Funders</h1>
              </div>
              <div className="meta">
                <span>3 funders you have applied to on the GMS</span>
                <span>·</span>
                <span>2 open items</span>
              </div>
            </div>
            <div className="actions">
              <Link to="/w/alder-creek/find" className="btn btn-secondary">
                <Search className="ic" aria-hidden="true" />
                Find more funding
              </Link>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl" style={{ fontSize: "15px" }}>
              <thead>
                <tr>
                  <th>Funder</th>
                  <th>Relationship since</th>
                  <th className="num">Applications</th>
                  <th className="num">Awards</th>
                  <th>Open items</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                <tr className="sel">
                  <td>
                    <a href="#detail" className="chip">
                      <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                    </a>
                  </td>
                  <td>2027</td>
                  <td className="num">1</td>
                  <td className="num">1 · $150,000</td>
                  <td>
                    <span className="bdg bdg-warn">
                      <Clock className="ic" aria-hidden="true" />1 report due
                    </span>
                  </td>
                  <td>
                    <div className="ent">
                      <span>Dana Ortiz · Program officer</span>
                      <a href="#detail" className="small">
                        grants@riverbendcf.example
                      </a>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>
                    <a href="#detail" className="chip" style={{ "--tenant": "#7A4F01" } as CSSProperties}>
                      <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                    </a>
                  </td>
                  <td>2025</td>
                  <td className="num">3</td>
                  <td className="num">2 · $210,000</td>
                  <td>
                    <span className="bdg bdg-warn">
                      <RotateCcw className="ic" aria-hidden="true" />1 returned report
                    </span>
                  </td>
                  <td>
                    <div className="ent">
                      <span>Grants Office</span>
                      <a href="#detail" className="small">
                        grants@cascadecounty.example
                      </a>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>
                    <a href="#detail" className="chip" style={{ "--tenant": "#4A5C5A" } as CSSProperties}>
                      <span className="tdot" aria-hidden="true"></span>Northwind Family Foundation
                    </a>
                  </td>
                  <td>2024</td>
                  <td className="num">2</td>
                  <td className="num">1 · $40,000</td>
                  <td>
                    <span className="muted">—</span>
                  </td>
                  <td>
                    <div className="ent">
                      <span>Program team</span>
                      <a href="#detail" className="small">
                        programs@northwindff.example
                      </a>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            id="detail"
            style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}
          >
            <div className="card">
              <div className="card-h">
                <div className="row" style={{ gap: "12px" }}>
                  <span className="chip">
                    <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                  </span>
                  <h2 style={{ fontSize: "18px" }}>History</h2>
                </div>
                <Link to="/f/riverbend" className="small b">
                  Public page <ExternalLink className="ic ic-sm" aria-hidden="true" />
                </Link>
              </div>
              <div className="card-b">
                <div className="tl">
                  <div className="tl-i tl-ok">
                    <span className="dot">
                      <BadgeCheck className="ic" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="what">Payment settled · $75,000 (tranche 1)</div>
                      <div className="who">Passport · May 25, 2027 · River City Credit Union •••• 4821</div>
                    </div>
                  </div>
                  <div className="tl-i tl-person">
                    <span className="dot">
                      <ShieldCheck className="ic" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="what">Agreement executed</div>
                      <div className="who">
                        Countersigned by Dana Ortiz · May 24, 2027 ·<Link to="/preview/pdf/agreement">Executed PDF</Link>
                      </div>
                    </div>
                  </div>
                  <div className="tl-i tl-person">
                    <span className="dot">
                      <PenLine className="ic" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="what">Agreement signed</div>
                      <div className="who">Maria Santos · May 21, 2027</div>
                    </div>
                  </div>
                  <div className="tl-i tl-passport">
                    <span className="dot">
                      <Mail className="ic" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="what">Award offered · $150,000</div>
                      <div className="who">
                        Riverbend panel decision · May 18, 2027 ·<Link to="/w/alder-creek/grants/awd_01J2Q7/offer">Offer and letter</Link>
                      </div>
                    </div>
                  </div>
                  <div className="tl-i tl-person">
                    <span className="dot">
                      <Calendar className="ic" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="what">Interview held</div>
                      <div className="who">Dana Ortiz, Priya Natarajan with Maria Santos · May 6, 2027</div>
                    </div>
                  </div>
                  <div className="tl-i tl-person">
                    <span className="dot">
                      <Send className="ic" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="what">Full proposal submitted</div>
                      <div className="who">
                        Maria Santos · Apr 16, 2027 ·<Link to="/preview/pdf/application-snapshot">Snapshot PDF</Link>
                      </div>
                    </div>
                  </div>
                  <div className="tl-i tl-person">
                    <span className="dot">
                      <Send className="ic" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="what">LOI submitted</div>
                      <div className="who">Jamal Reed · Feb 21, 2027</div>
                    </div>
                  </div>
                  <div className="tl-i tl-passport">
                    <span className="dot">
                      <BadgeCheck className="ic" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="what">Consent granted to read your Passport record</div>
                      <div className="who">
                        Maria Santos · Feb 3, 2027 ·<Link to="/w/alder-creek/team">Manage</Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card">
                <div className="card-h">
                  <h3>Open items</h3>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <Link
                    to="/w/alder-creek/reports"
                    className="rc-row"
                    style={{ border: "0", padding: "6px 0", textDecoration: "none", color: "inherit" }}
                  >
                    <Clock className="ic" aria-hidden="true" style={{ color: "#7A4A00" }} />
                    <div>
                      <div className="l">Interim report due Dec 15, 2027</div>
                      <div className="r">Accepting releases tranche 2 ($60,000)</div>
                    </div>
                    <span className="fix">Open →</span>
                  </Link>
                  <Link
                    to="/w/alder-creek/team"
                    className="rc-row"
                    style={{ borderTop: "1px solid #EEF3F3", padding: "10px 0 4px", textDecoration: "none", color: "inherit" }}
                  >
                    <Info className="ic" aria-hidden="true" style={{ color: "#1E4F8F" }} />
                    <div>
                      <div className="l">Access request: payee status</div>
                      <div className="r">Bank name and last4 only · requested May 19</div>
                    </div>
                    <span className="fix">Review →</span>
                  </Link>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Documents from Riverbend</h3>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Grant agreement — executed.pdf</div>
                      <div className="mt">
                        <span>May 24, 2027</span>
                        <span>·</span>
                        <span className="mono">sha256 c41e…9ab2</span>
                      </div>
                    </div>
                    <Link to="/preview/pdf/agreement" className="btn btn-sm btn-ghost">
                      Open
                    </Link>
                  </div>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Award letter.pdf</div>
                      <div className="mt">
                        <span>May 19, 2027</span>
                      </div>
                    </div>
                    <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="btn btn-sm btn-ghost">
                      Open
                    </Link>
                  </div>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Interim report template.pdf</div>
                      <div className="mt">
                        <span>May 26, 2027</span>
                      </div>
                    </div>
                    <Link to="/w/alder-creek/reports" className="btn btn-sm btn-ghost">
                      Open
                    </Link>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Contact</h3>
                </div>
                <div className="card-b">
                  <dl className="kv" style={{ fontSize: "15px" }}>
                    <dt>Program officer</dt>
                    <dd>Dana Ortiz</dd>
                    <dt>Email</dt>
                    <dd>
                      <a href="#detail">grants@riverbendcf.example</a>
                    </dd>
                    <dt>Finance</dt>
                    <dd>Marcus Lee</dd>
                    <dt>Website</dt>
                    <dd>
                      <Link to="/f/riverbend">riverbendcf.example</Link>
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
