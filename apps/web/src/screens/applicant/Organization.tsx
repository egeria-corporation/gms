// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  BadgeCheck,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Cloud,
  Database,
  ExternalLink,
  File,
  Landmark,
  Lock,
  Pencil,
  Plus,
  Shield,
  TriangleExclamationPoint,
} from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function Organization() {
  return (
    <>
      <title>{"Organization — Alder Creek Family Services"}</title>
      <ApplicantShell active="Organization">
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>Organization</h1>
                <span className="lvl lvl-3">
                  <Shield className="ic" aria-hidden="true" />
                  L3
                </span>
                <span className="pay pay-active">
                  <Check className="ic" aria-hidden="true" />
                  Payee active
                </span>
              </div>
              <div className="meta">
                <span>
                  This is your OpenGrants Passport record as funders see it. Edit it in Passport; every application and report reads from
                  it.
                </span>
              </div>
            </div>
            <div className="actions">
              <Link to="/w/alder-creek/organization" className="btn btn-secondary">
                <ExternalLink className="ic" aria-hidden="true" />
                Open Passport
              </Link>
            </div>
          </div>
          <div className="card" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
            <div className="mtr" style={{ flex: "1 1 320px" }}>
              <div className="lbls">
                <span>
                  <b>92%</b> complete
                </span>
                <span>1 field missing · 1 document expiring</span>
              </div>
              <div className="track">
                <div className="fill" style={{ width: "92%" }}></div>
              </div>
            </div>
            <div className="row" style={{ gap: "14px", flexWrap: "wrap", fontSize: "14px" }}>
              <span className="row" style={{ gap: "6px", color: "#9B1C1C" }}>
                <CircleX className="ic" aria-hidden="true" />
                Service area missing
              </span>
              <span className="row" style={{ gap: "6px", color: "#7A4A00" }}>
                <TriangleExclamationPoint className="ic" aria-hidden="true" />
                Insurance expires Sep 1
              </span>
              <a href="#identity" className="b">
                Fix in Passport
              </a>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <section className="card" id="identity">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Identity</h2>
                  <Link to="/w/alder-creek/organization" className="small b">
                    Edit in Passport
                  </Link>
                </div>
                <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px 24px" }}>
                  <div className="fld">
                    <span className="lbl">
                      Legal name
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </span>
                    <div>Alder Creek Family Services</div>
                  </div>
                  <div className="fld">
                    <span className="lbl">
                      Tax status
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </span>
                    <div>501(c)(3) public charity · verified</div>
                  </div>
                  <div className="fld">
                    <span className="lbl">
                      Mailing address
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </span>
                    <div>418 Mill Road, Alder Creek, OR</div>
                  </div>
                  <div className="fld">
                    <span className="lbl">
                      Website
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </span>
                    <div>
                      <Link to="/w/alder-creek/organization">aldercreekfs.example</Link>
                    </div>
                  </div>
                  <div className="fld">
                    <span className="lbl">
                      Founded
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </span>
                    <div>1998</div>
                  </div>
                  <div className="fld">
                    <span className="lbl">
                      Service area
                      <span className="prov prov-entered">
                        <Pencil className="ic" aria-hidden="true" />
                        Missing
                      </span>
                    </span>
                    <div className="row" style={{ gap: "8px", color: "#9B1C1C" }}>
                      <CircleX className="ic" aria-hidden="true" />
                      Not set — two funders use it in eligibility rules.<Link to="/w/alder-creek/organization">Add in Passport</Link>
                    </div>
                  </div>
                </div>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Mission</h2>
                  <Link to="/w/alder-creek/organization" className="small b">
                    Edit in Passport
                  </Link>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span className="prov prov-passport" style={{ alignSelf: "flex-start" }}>
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport · updated Jan 2027
                  </span>
                  <p>
                    Alder Creek Family Services helps families in the Alder Creek valley stay healthy, housed and connected through home
                    visiting, health navigation and emergency assistance.
                  </p>
                </div>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Representatives</h2>
                  <Link to="/w/alder-creek/organization" className="small b">
                    Manage in Passport
                  </Link>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl" style={{ fontSize: "14px" }}>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Title</th>
                        <th>Authority</th>
                        <th>Verified</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <span className="row" style={{ gap: "8px" }}>
                            <span className="av av-sm av-t">MS</span>
                            <span className="b">Maria Santos</span>
                          </span>
                        </td>
                        <td>Executive Director</td>
                        <td>Signs agreements · primary contact</td>
                        <td>
                          <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                            <CircleCheck className="ic" aria-hidden="true" />
                            Verified
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <span className="row" style={{ gap: "8px" }}>
                            <span className="av av-sm">JR</span>
                            <span className="b">Jamal Reed</span>
                          </span>
                        </td>
                        <td>Grants Manager</td>
                        <td>Submits applications and reports</td>
                        <td>
                          <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                            <CircleCheck className="ic" aria-hidden="true" />
                            Verified
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <span className="row" style={{ gap: "8px" }}>
                            <span className="av av-sm av-g">TW</span>
                            <span className="b">Teresa Walsh</span>
                          </span>
                        </td>
                        <td>Board Chair</td>
                        <td>Board attestation</td>
                        <td>
                          <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                            <CircleCheck className="ic" aria-hidden="true" />
                            Verified
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Documents locker</h2>
                  <Link to="/w/alder-creek/organization" className="small b">
                    Upload to Passport
                  </Link>
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
                        <span>No expiry</span>
                      </div>
                    </div>
                    <span className="bdg bdg-ok">
                      <CircleCheck className="ic" aria-hidden="true" />
                      Verified
                    </span>
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
                        <span>Expires Dec 31, 2027</span>
                      </div>
                    </div>
                    <span className="bdg bdg-ok">
                      <CircleCheck className="ic" aria-hidden="true" />
                      Verified
                    </span>
                  </div>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Certificate of insurance.pdf</div>
                      <div className="mt">
                        <span>240 KB</span>
                        <span>·</span>
                        <span className="prov prov-passport">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          Passport locker
                        </span>
                        <span>·</span>
                        <span className="b" style={{ color: "#7A4A00" }}>
                          Expires Sep 1, 2027
                        </span>
                      </div>
                    </div>
                    <span className="bdg bdg-warn">
                      <Clock className="ic" aria-hidden="true" />
                      Expiring soon
                    </span>
                  </div>
                  <div className="doc">
                    <span className="ft ft-doc">DOC</span>
                    <div className="grow">
                      <div className="nm">Board roster 2027.docx</div>
                      <div className="mt">
                        <span>88 KB</span>
                        <span>·</span>
                        <span className="prov prov-passport">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          Passport locker
                        </span>
                        <span>·</span>
                        <span>Updated Feb 2027</span>
                      </div>
                    </div>
                    <span className="bdg bdg-neutral">
                      <File className="ic" aria-hidden="true" />
                      On file
                    </span>
                  </div>
                </div>
              </section>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Payee status</h2>
                  <span className="pay pay-active">
                    <Check className="ic" aria-hidden="true" />
                    Payee active
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="row" style={{ gap: "12px" }}>
                    <span
                      className="doc .ft"
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "8px",
                        background: "#E1F8F6",
                        color: "#145450",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                      }}
                    >
                      <Landmark className="ic ic-md" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="b">River City Credit Union •••• 4821</div>
                      <div className="small muted">Verified destination · ACH · verified Mar 3, 2027</div>
                    </div>
                  </div>
                  <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
                    <Lock className="ic" aria-hidden="true" />
                    <div>
                      <div className="t" style={{ fontSize: "14px" }}>
                        How destination changes work
                      </div>
                      <div className="d" style={{ fontSize: "13px" }}>
                        Destination changes are made in Passport, cool off for 5 business days and are visible to funders as “Pending
                        change” while they do. The GMS never edits bank details and only ever shows the bank name and last four digits.
                      </div>
                    </div>
                  </div>
                  <Link to="/w/alder-creek/organization" className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                    Manage destination in Passport
                  </Link>
                </div>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Connected apps</h2>
                </div>
                <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <li className="row" style={{ gap: "12px" }}>
                    <span
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: "#D2E1F9",
                        color: "#1E4F8F",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                      }}
                    >
                      <Cloud className="ic" aria-hidden="true" />
                    </span>
                    <div className="grow">
                      <div className="b">Google Workspace</div>
                      <div className="small muted">Drive files for attachments · last sync 2 min ago</div>
                    </div>
                    <span className="bdg bdg-ok">
                      <Check className="ic" aria-hidden="true" />
                      Connected
                    </span>
                  </li>
                  <li className="row" style={{ gap: "12px" }}>
                    <span
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: "#EEF3F3",
                        color: "#4A5C5A",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                      }}
                    >
                      <Database className="ic" aria-hidden="true" />
                    </span>
                    <div className="grow">
                      <div className="b">QuickBooks</div>
                      <div className="small muted">Actuals for budget reports · last sync yesterday 6:10 PM</div>
                    </div>
                    <span className="bdg bdg-ok">
                      <Check className="ic" aria-hidden="true" />
                      Connected
                    </span>
                  </li>
                  <li className="row" style={{ gap: "12px" }}>
                    <span
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: "#F7FAFA",
                        border: "1px dashed #B9C6C6",
                        color: "#4A5C5A",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                      }}
                    >
                      <Plus className="ic" aria-hidden="true" />
                    </span>
                    <div className="grow">
                      <div className="b">Connect another app</div>
                      <div className="small muted">Managed in Passport so every funder reads the same sources.</div>
                    </div>
                    <Link to="/w/alder-creek/organization" className="btn btn-sm btn-secondary">
                      Connect
                    </Link>
                  </li>
                </ul>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Who has access</h2>
                  <Link to="/w/alder-creek/team" className="small b">
                    Team & access
                  </Link>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl" style={{ fontSize: "14px" }}>
                    <thead>
                      <tr>
                        <th>Funder</th>
                        <th>Can read</th>
                        <th>Granted via</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <span className="chip">
                            <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                          </span>
                        </td>
                        <td style={{ whiteSpace: "normal" }}>Profile, documents, payee status</td>
                        <td style={{ whiteSpace: "normal" }}>Application · Apr 16, 2027</td>
                        <td>
                          <button className="btn btn-sm btn-danger">Revoke</button>
                        </td>
                      </tr>
                      <tr style={{ "--tenant": "#7A4F01" } as CSSProperties}>
                        <td>
                          <span className="chip">
                            <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                          </span>
                        </td>
                        <td style={{ whiteSpace: "normal" }}>Profile</td>
                        <td style={{ whiteSpace: "normal" }}>Application · Mar 2, 2027</td>
                        <td>
                          <button className="btn btn-sm btn-danger">Revoke</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="card-f small muted">
                  Revoking stops new reads. Values already copied into a submitted application stay with that submission.
                </div>
              </section>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
