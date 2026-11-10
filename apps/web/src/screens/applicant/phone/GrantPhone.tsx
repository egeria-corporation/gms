// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  Award,
  BadgeCheck,
  Bell,
  Building,
  Calendar,
  Check,
  ClipboardCheck,
  Download,
  FileText,
  House,
  Info,
  Landmark,
  Mail,
  Menu,
  PenLine,
  ShieldCheck,
} from "lucide-react";

export default function GrantPhone() {
  return (
    <>
      <title>{"Grant detail — phone"}</title>
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
            My grants
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
          <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span className="chip" style={{ alignSelf: "flex-start" }}>
              <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
            </span>
            <h2 style={{ fontSize: "20px", lineHeight: 1.3 }}>Mobile Health Navigation for Rural Families</h2>
            <div className="row wrap" style={{ gap: "8px" }}>
              <span className="bdg bdg-ok bdg-lg">
                <BadgeCheck className="ic" aria-hidden="true" />
                Active
              </span>
              <span className="small muted">Jul 1, 2027 – Jun 30, 2028</span>
            </div>
            <span className="mono muted">awd_01J2Q7 · Community Health 2027</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="stat" style={{ padding: "14px 16px" }}>
              <span className="stat-l">Awarded</span>
              <span className="stat-v" style={{ fontSize: "26px" }}>
                $150,000
              </span>
            </div>
            <div className="stat" style={{ padding: "14px 16px" }}>
              <span className="stat-l">Received</span>
              <span className="stat-v" style={{ fontSize: "26px" }}>
                $75,000
              </span>
              <span className="stat-d">1 of 3 tranches settled</span>
            </div>
            <div className="stat" style={{ padding: "14px 16px" }}>
              <span className="stat-l">Remaining</span>
              <span className="stat-v" style={{ fontSize: "26px" }}>
                $75,000
              </span>
              <span className="stat-d">Released as reports are accepted</span>
            </div>
          </div>
          <nav className="tabs tabrow" aria-label="Grant sections" style={{ scrollbarWidth: "none", margin: "0 -16px", padding: "0 16px" }}>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" style={{ minHeight: "44px" }}>
              Agreement
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab on" aria-current="true" style={{ minHeight: "44px" }}>
              Payments
            </Link>
            <Link to="/w/alder-creek/reports" className="tab" style={{ minHeight: "44px" }}>
              Reports
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" style={{ minHeight: "44px" }}>
              Budget
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" style={{ minHeight: "44px" }}>
              Amendments
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" style={{ minHeight: "44px" }}>
              Documents
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" style={{ minHeight: "44px" }}>
              Messages
            </Link>
            <Link to="/w/alder-creek/grants/awd_01J2Q7" className="tab" style={{ minHeight: "44px" }}>
              Closeout
            </Link>
          </nav>
          <section style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-labelledby="sched-h">
            <h3 id="sched-h" style={{ fontSize: "16px" }}>
              Payment schedule
            </h3>
            <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px" }}>
                  Tranche 1 of 3
                </span>
                <span className="b" style={{ fontSize: "17px", fontVariantNumeric: "tabular-nums" }}>
                  $75,000
                </span>
              </div>
              <div className="small muted">Condition: agreement executed</div>
              <div className="row wrap" style={{ gap: "8px" }}>
                <span className="bdg bdg-ok">
                  <BadgeCheck className="ic" aria-hidden="true" />
                  Settled
                </span>
                <span className="small muted">May 25, 2027 · ACH · River City Credit Union •••• 4821</span>
              </div>
            </div>
            <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px" }}>
                  Tranche 2 of 3
                </span>
                <span className="b" style={{ fontSize: "17px", fontVariantNumeric: "tabular-nums" }}>
                  $60,000
                </span>
              </div>
              <div className="small muted">Condition: interim report accepted</div>
              <div className="row wrap" style={{ gap: "8px" }}>
                <span className="bdg bdg-neutral">
                  <Calendar className="ic" aria-hidden="true" />
                  Scheduled
                </span>
                <span className="small muted">
                  Expected Dec 2027 · <Link to="/w/alder-creek/reports">interim report due Dec 15</Link>
                </span>
              </div>
            </div>
            <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px" }}>
                  Tranche 3 of 3
                </span>
                <span className="b" style={{ fontSize: "17px", fontVariantNumeric: "tabular-nums" }}>
                  $15,000
                </span>
              </div>
              <div className="small muted">Condition: final report accepted</div>
              <div className="row wrap" style={{ gap: "8px" }}>
                <span className="bdg bdg-neutral">
                  <Calendar className="ic" aria-hidden="true" />
                  Scheduled
                </span>
                <span className="small muted">Expected Jul 2028</span>
              </div>
            </div>
          </section>
          <section className="card" aria-labelledby="dest-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="dest-h" style={{ fontSize: "16px" }}>
                Payment destination
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
                  <div className="small muted">From Passport · verified Feb 3, 2027</div>
                </div>
              </div>
              <div className="bnr bnr-info" style={{ padding: "10px 12px" }}>
                <Info className="ic" aria-hidden="true" />
                <div className="d" style={{ fontSize: "13px", margin: "0" }}>
                  Expecting a payment? Changes to your bank account take 5 business days —
                  <Link to="/w/alder-creek/organization">manage in Passport</Link>.
                </div>
              </div>
            </div>
          </section>
          <section className="card" aria-labelledby="agr-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="agr-h" style={{ fontSize: "16px" }}>
                Agreement
              </h3>
              <span className="bdg bdg-ok">
                <ShieldCheck className="ic" aria-hidden="true" />
                Executed
              </span>
            </div>
            <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="small muted">Signed by Maria Santos May 21, 2027 · countersigned by Dana Ortiz May 24, 2027</div>
              <Link to="/preview/pdf/agreement" className="btn btn-secondary btn-lg btn-block">
                <Download className="ic" aria-hidden="true" />
                Download executed PDF
              </Link>
            </div>
          </section>
          <section style={{ display: "flex", flexDirection: "column", gap: "8px" }} aria-labelledby="off-h">
            <span className="eyebrow" id="off-h">
              State · Offered
            </span>
            <div
              className="card"
              style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", borderColor: "#B9CFF2" }}
            >
              <div className="row wrap" style={{ gap: "8px" }}>
                <span className="bdg bdg-info bdg-lg">
                  <Mail className="ic" aria-hidden="true" />
                  Offered
                </span>
                <span className="small muted">Letter received May 19, 2027</span>
              </div>
              <p style={{ fontSize: "15px" }}>
                Riverbend Community Foundation has offered <span className="b">$150,000</span> for Mobile Health Navigation for Rural
                Families. Review the agreement, then accept and sign. Signing requires an authorized signer — agents cannot sign for you.
              </p>
              <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="btn btn-primary btn-lg btn-block">
                Accept award
              </Link>
              <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="btn btn-secondary btn-lg btn-block">
                <PenLine className="ic" aria-hidden="true" />
                Review and sign agreement
              </Link>
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
          <Link to="/w/alder-creek/grants/awd_01J2Q7" className="on" aria-current="page">
            <Award className="ic ic-md" aria-hidden="true" />
            Grants
          </Link>
          <Link to="/w/alder-creek/reports">
            <ClipboardCheck className="ic ic-md" aria-hidden="true" />
            Reports
          </Link>
          <Link to="/w/alder-creek/organization">
            <Building className="ic ic-md" aria-hidden="true" />
            Org
          </Link>
        </nav>
      </div>
    </>
  );
}
