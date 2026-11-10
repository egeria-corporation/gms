// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  Award,
  BadgeCheck,
  Bell,
  Building,
  Check,
  ClipboardCheck,
  Clock,
  Cloud,
  Database,
  FileText,
  House,
  Landmark,
  Lock,
  Menu,
  Shield,
} from "lucide-react";

export default function OrganizationPhone() {
  return (
    <>
      <title>{"Organization — phone"}</title>
      <div
        className="gms gms-applicant gms-phone"
        style={
          {
            "--tenant": "#1F6F8B",
            "--on-tenant": "#FFFFFF",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            background: "#F7FAFA",
            position: "relative",
          } as CSSProperties
        }
      >
        <header className="phone-bar">
          <button className="iconbtn" aria-label="Menu" style={{ width: "44px", height: "44px" }}>
            <Menu className="ic ic-md" aria-hidden="true" />
          </button>
          <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "24px", height: "24px" }} />
          <h1 style={{ fontSize: "17px", flex: 1, minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Organization
          </h1>
          <Link to="/notifications" className="iconbtn" aria-label="Notifications, 2 unread" style={{ width: "44px", height: "44px" }}>
            <Bell className="ic ic-md" aria-hidden="true" />
            <span className="dot"></span>
          </Link>
          <Link
            to="/account/agents"
            className="av av-t"
            aria-label="Account: Maria Santos"
            style={{ width: "36px", height: "36px", fontSize: "12px" }}
          >
            MS
          </Link>
        </header>
        <main className="main" style={{ flex: 1 }}>
          <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="row" style={{ gap: "12px", alignItems: "flex-start" }}>
              <span className="av av-xl av-n" aria-hidden="true">
                AC
              </span>
              <div className="grow" style={{ minWidth: "0" }}>
                <h2 style={{ fontSize: "20px", lineHeight: 1.25 }}>Alder Creek Family Services</h2>
                <div className="row wrap" style={{ gap: "6px", marginTop: "6px" }}>
                  <span className="lvl lvl-3">
                    <Shield className="ic" aria-hidden="true" />
                    L3
                  </span>
                  <span className="pay pay-active">
                    <Check className="ic" aria-hidden="true" />
                    Payee active
                  </span>
                </div>
              </div>
            </div>
            <div className="mtr">
              <div className="lbls">
                <span>Profile completeness</span>
                <b>92%</b>
              </div>
              <div className="track">
                <div className="fill" style={{ width: "92%" }}></div>
              </div>
              <span className="small muted">Missing: board list (optional), DUNS (optional)</span>
            </div>
            <p className="small muted">
              Everything here is read from your OpenGrants Passport record. Edit it there and every funder sees the change.
            </p>
          </div>
          <section className="card" aria-labelledby="prof-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="prof-h" style={{ fontSize: "16px" }}>
                Profile
              </h3>
              <Link to="/w/alder-creek/organization" className="small b">
                Edit in Passport
              </Link>
            </div>
            <dl style={{ margin: "0", display: "flex", flexDirection: "column" }}>
              <div
                style={{ padding: "12px 16px", borderBottom: "1px solid #EEF3F3", display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <dt className="row small muted" style={{ gap: "8px" }}>
                  Legal name
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
                  </span>
                </dt>
                <dd style={{ margin: "0", fontSize: "16px" }}>Alder Creek Family Services</dd>
              </div>
              <div
                style={{ padding: "12px 16px", borderBottom: "1px solid #EEF3F3", display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <dt className="row small muted" style={{ gap: "8px" }}>
                  Tax status
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
                  </span>
                </dt>
                <dd style={{ margin: "0", fontSize: "16px" }}>501(c)(3) public charity · verified</dd>
              </div>
              <div
                style={{ padding: "12px 16px", borderBottom: "1px solid #EEF3F3", display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <dt className="row small muted" style={{ gap: "8px" }}>
                  Mailing address
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
                  </span>
                </dt>
                <dd style={{ margin: "0", fontSize: "16px" }}>418 Mill Road, Alder Creek, OR</dd>
              </div>
              <div
                style={{ padding: "12px 16px", borderBottom: "1px solid #EEF3F3", display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <dt className="row small muted" style={{ gap: "8px" }}>
                  Website
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
                  </span>
                </dt>
                <dd style={{ margin: "0", fontSize: "16px", wordBreak: "break-word" }}>aldercreekfs.example</dd>
              </div>
              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <dt className="row small muted" style={{ gap: "8px" }}>
                  Representatives
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
                  </span>
                </dt>
                <dd style={{ margin: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="row" style={{ gap: "10px" }}>
                    <span className="av av-t">MS</span>
                    <div>
                      <div className="b" style={{ fontSize: "15px" }}>
                        Maria Santos
                      </div>
                      <div className="small muted">Executive Director · authorized signer</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "10px" }}>
                    <span className="av">JR</span>
                    <div>
                      <div className="b" style={{ fontSize: "15px" }}>
                        Jamal Reed
                      </div>
                      <div className="small muted">Grants Manager</div>
                    </div>
                  </div>
                </dd>
              </div>
            </dl>
          </section>
          <section className="card" aria-labelledby="docs-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="docs-h" style={{ fontSize: "16px" }}>
                Documents locker
              </h3>
              <span className="small muted">4 files</span>
            </div>
            <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="doc" style={{ flexWrap: "wrap" }}>
                <span className="ft ft-pdf">PDF</span>
                <div className="grow" style={{ minWidth: "0" }}>
                  <div className="nm">IRS determination letter</div>
                  <div className="mt">
                    <span>No expiry</span>
                    <span>·</span>
                    <span>Verified</span>
                  </div>
                </div>
              </div>
              <div className="doc" style={{ flexWrap: "wrap" }}>
                <span className="ft ft-xls">XLS</span>
                <div className="grow" style={{ minWidth: "0" }}>
                  <div className="nm">FY2026 audited financials</div>
                  <div className="mt">
                    <span>Replace after FY2027 audit</span>
                  </div>
                </div>
              </div>
              <div className="doc" style={{ flexWrap: "wrap", borderColor: "#E9C77D", background: "#FFFBF2" }}>
                <span className="ft ft-pdf">PDF</span>
                <div className="grow" style={{ minWidth: "0" }}>
                  <div className="nm">Certificate of insurance</div>
                  <div className="mt">
                    <span className="bdg bdg-warn">
                      <Clock className="ic" aria-hidden="true" />
                      Expires Sep 1, 2027
                    </span>
                  </div>
                </div>
                <Link to="/w/alder-creek/organization" className="btn btn-sm btn-secondary">
                  Replace
                </Link>
              </div>
              <div className="doc" style={{ flexWrap: "wrap" }}>
                <span className="ft ft-doc">DOC</span>
                <div className="grow" style={{ minWidth: "0" }}>
                  <div className="nm">Board roster 2027</div>
                  <div className="mt">
                    <span>Uploaded Jan 9</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section className="card" aria-labelledby="payee-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="payee-h" style={{ fontSize: "16px" }}>
                Payee status
              </h3>
              <span className="pay pay-active">
                <Check className="ic" aria-hidden="true" />
                Active
              </span>
            </div>
            <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="row" style={{ gap: "10px" }}>
                <Landmark className="ic ic-md" aria-hidden="true" style={{ color: "#145450" }} />
                <div>
                  <div className="b" style={{ fontSize: "15px" }}>
                    River City Credit Union •••• 4821
                  </div>
                  <div className="small muted">Verified Feb 3, 2027 · ACH</div>
                </div>
              </div>
              <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
                <Lock className="ic" aria-hidden="true" />
                <div>
                  <div className="t" style={{ fontSize: "14px" }}>
                    Change control
                  </div>
                  <div className="d" style={{ fontSize: "13px" }}>
                    Destination changes are made in Passport by an authorized signer, take 5 business days to cool off, and pause any
                    payment due in that window. Funders see the status, never the account details.
                  </div>
                </div>
              </div>
              <Link to="/w/alder-creek/organization" className="btn btn-secondary btn-lg btn-block">
                Manage destination in Passport
              </Link>
            </div>
          </section>
          <section className="card" aria-labelledby="apps-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="apps-h" style={{ fontSize: "16px" }}>
                Connected apps
              </h3>
            </div>
            <ul style={{ display: "flex", flexDirection: "column" }}>
              <li className="row" style={{ padding: "12px 16px", gap: "12px", minHeight: "56px", borderBottom: "1px solid #EEF3F3" }}>
                <Cloud className="ic ic-md" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                <div className="grow">
                  <div className="b" style={{ fontSize: "15px" }}>
                    Google Workspace
                  </div>
                  <div className="small muted">Drive picker · synced 10 min ago</div>
                </div>
                <span className="bdg bdg-ok">
                  <Check className="ic" aria-hidden="true" />
                  Connected
                </span>
              </li>
              <li className="row" style={{ padding: "12px 16px", gap: "12px", minHeight: "56px" }}>
                <Database className="ic ic-md" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                <div className="grow">
                  <div className="b" style={{ fontSize: "15px" }}>
                    QuickBooks
                  </div>
                  <div className="small muted">Actuals for budgets · synced 1 h ago</div>
                </div>
                <span className="bdg bdg-ok">
                  <Check className="ic" aria-hidden="true" />
                  Connected
                </span>
              </li>
            </ul>
          </section>
          <section className="card" aria-labelledby="access-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="access-h" style={{ fontSize: "16px" }}>
                Who has access
              </h3>
              <Link to="/w/alder-creek/team" className="small b">
                Manage
              </Link>
            </div>
            <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div
                style={
                  {
                    "--tenant": "#1F6F8B",
                    border: "1px solid #D6DEDE",
                    borderRadius: "10px",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  } as CSSProperties
                }
              >
                <span className="chip" style={{ alignSelf: "flex-start" }}>
                  <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                </span>
                <p style={{ fontSize: "14px" }}>
                  Can read your organization profile and documents, and can propose changes you approve. Granted Jan 14, 2027 via the
                  Community Health Grants 2027 application.
                </p>
                <button className="btn btn-danger btn-sm" style={{ alignSelf: "flex-start", height: "36px" }}>
                  Revoke access
                </button>
              </div>
              <div
                style={
                  {
                    "--tenant": "#7A4F01",
                    border: "1px solid #D6DEDE",
                    borderRadius: "10px",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  } as CSSProperties
                }
              >
                <span className="chip" style={{ alignSelf: "flex-start" }}>
                  <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                </span>
                <p style={{ fontSize: "14px" }}>
                  Can read your organization profile only. Granted Mar 2, 2027 via the Community Clinic Capacity LOI.
                </p>
                <button className="btn btn-danger btn-sm" style={{ alignSelf: "flex-start", height: "36px" }}>
                  Revoke access
                </button>
              </div>
            </div>
          </section>
        </main>
        <nav className="phone-tabs" aria-label="Primary" style={{ position: "sticky", bottom: "0" }}>
          <Link to="/w/alder-creek">
            <House className="ic ic-md" aria-hidden="true" />
            Home
          </Link>
          <Link to="/w/alder-creek/applications/app_01HZX4/edit">
            <FileText className="ic ic-md" aria-hidden="true" />
            Apply
          </Link>
          <Link to="/w/alder-creek/grants/awd_01J2Q7">
            <Award className="ic ic-md" aria-hidden="true" />
            Grants
          </Link>
          <Link to="/w/alder-creek/reports">
            <ClipboardCheck className="ic ic-md" aria-hidden="true" />
            Reports
          </Link>
          <Link to="/w/alder-creek/organization" className="on" aria-current="page">
            <Building className="ic ic-md" aria-hidden="true" />
            Org
          </Link>
        </nav>
      </div>
    </>
  );
}
