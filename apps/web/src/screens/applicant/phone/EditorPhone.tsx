// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  Award,
  BadgeCheck,
  Bell,
  BookOpen,
  Building,
  Check,
  Circle,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Clock,
  Clock4,
  FileText,
  House,
  Lock,
  Menu,
  MessageSquare,
  Pencil,
  Sparkles,
} from "lucide-react";

export default function EditorPhone() {
  return (
    <>
      <title>{"Application editor — phone"}</title>
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
            Application
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
        <div
          style={{
            background: "#fff",
            borderBottom: "1px solid #D6DEDE",
            padding: "12px 16px 0",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            position: "sticky",
            top: "0",
            zIndex: 2,
          }}
        >
          <div className="row wrap" style={{ gap: "8px" }}>
            <span className="chip">
              <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
            </span>
            <span className="row small b" style={{ gap: "5px", color: "#7A4A00" }}>
              <Clock className="ic" aria-hidden="true" />
              Closes in 14 days
            </span>
          </div>
          <div className="row" style={{ justifyContent: "space-between", gap: "10px", alignItems: "flex-start" }}>
            <h2 style={{ fontSize: "17px", lineHeight: 1.3, minWidth: "0" }}>Mobile Health Navigation for Rural Families</h2>
            <span className="pres" aria-label="Editing now: Maria Santos, Jamal Reed, Lena Fischer" style={{ flex: "none" }}>
              <span className="av av-t live">MS</span>
              <span className="av live-b">JR</span>
              <span className="av av-g">LF</span>
            </span>
          </div>
          <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
            <span className="notice">
              <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
              Saved 12 s ago
            </span>
            <span className="small muted">Full proposal · Draft · 3 of 8 sections</span>
          </div>
          <nav
            className="pillrow"
            aria-label="Sections"
            style={{ display: "flex", gap: "8px", overflowX: "auto", padding: "4px 0 12px", scrollbarWidth: "none" }}
          >
            <a href="#organization" className="fchip" style={{ height: "36px", flex: "none", color: "#0B5E47" }}>
              <Check className="ic ic-sm" aria-hidden="true" />
              Organization
            </a>
            <a href="#summary" className="fchip" style={{ height: "36px", flex: "none", color: "#0B5E47" }}>
              <Check className="ic ic-sm" aria-hidden="true" />
              Summary
            </a>
            <a href="#need" className="fchip on" style={{ height: "36px", flex: "none" }} aria-current="true">
              <Clock4 className="ic ic-sm" aria-hidden="true" />
              Need
              <span className="tag" style={{ height: "18px", background: "#E1F8F6", color: "#145450" }}>
                <MessageSquare className="ic ic-sm" aria-hidden="true" style={{ width: "10px", height: "10px" }} />2
              </span>
            </a>
            <a href="#approach" className="fchip" style={{ height: "36px", flex: "none" }}>
              <Clock4 className="ic ic-sm" aria-hidden="true" />
              Approach
            </a>
            <a href="#budget" className="fchip" style={{ height: "36px", flex: "none" }}>
              <Circle className="ic ic-sm" aria-hidden="true" />
              Budget<span className="av av-sm av-g">LF</span>
            </a>
            <a href="#outcomes" className="fchip" style={{ height: "36px", flex: "none" }}>
              <Circle className="ic ic-sm" aria-hidden="true" />
              Outcomes
            </a>
            <a href="#attachments" className="fchip" style={{ height: "36px", flex: "none" }}>
              <Clock4 className="ic ic-sm" aria-hidden="true" />
              Attachments
            </a>
            <a href="#loi" className="fchip" style={{ height: "36px", flex: "none", color: "#4A5C5A" }}>
              <Lock className="ic ic-sm" aria-hidden="true" />
              LOI
            </a>
          </nav>
        </div>
        <main className="main" style={{ flex: 1, paddingBottom: "24px" }}>
          <section className="card" id="need">
            <div className="card-h" style={{ padding: "14px 16px", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ fontSize: "16px" }}>Need statement</h3>
                <p className="small muted">500 words maximum.</p>
              </div>
              <span className="bdg bdg-prog">
                <Clock4 className="ic" aria-hidden="true" />
                In progress
              </span>
            </div>
            <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="fld">
                <label className="lbl" htmlFor="need-text" style={{ flexWrap: "wrap" }}>
                  What need does this project address?
                  <span className="req" aria-hidden="true">
                    *
                  </span>
                  <span className="prov prov-library">
                    <BookOpen className="ic" aria-hidden="true" />
                    From library · “Need”
                  </span>
                </label>
                <textarea
                  className="ta"
                  id="need-text"
                  style={{ minHeight: "260px", fontSize: "16px" }}
                  defaultValue={"Families in the Alder Creek valley travel an average of 46 miles to reach a primary care provider, and one in four households has no reliable vehicle. Over the last three years our intake data shows that missed appointments, not lack of coverage, is the leading reason children in our programs fall behind on well-child visits and immunizations.\n\nMobile Health Navigation pairs a community health navigator with a scheduled van route across the six unincorporated communities we serve. Navigators schedule visits, arrange rides, and follow up on referrals so that a family's first contact with the clinic is not an emergency room visit. The 2026 county health assessment ranks transportation access as the top barrier to care for rural families, and our pilot with 38 families cut missed appointments by 41 percent."}
                />
                <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                  <span className="help">Reviewers see this field.</span>
                  <span className="counter">412 / 500 words</span>
                </div>
              </div>
              <Link to="/w/alder-creek/library" className="btn btn-secondary btn-lg btn-block">
                <BookOpen className="ic" aria-hidden="true" />
                Insert from library
              </Link>
              <div className="cmt" style={{ background: "#F7FAFA" }}>
                <div className="hd" style={{ flexWrap: "wrap" }}>
                  <span className="av av-sm">JR</span>
                  <span className="who">Jamal Reed</span>
                  <span>· 1 h ago</span>
                  <span className="shared-mark">Team</span>
                </div>
                <div className="bd">Can we cite the county assessment by name and year? The rubric asks for a source.</div>
                <div className="row" style={{ gap: "16px" }}>
                  <a href="#need" style={{ minHeight: "44px", display: "inline-flex", alignItems: "center", fontWeight: 700 }}>
                    Reply
                  </a>
                  <a href="#need" style={{ minHeight: "44px", display: "inline-flex", alignItems: "center", fontWeight: 700 }}>
                    Resolve
                  </a>
                </div>
              </div>
            </div>
          </section>
          <section className="card" id="organization">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <div>
                <h3 style={{ fontSize: "16px" }}>Organization</h3>
                <p className="small muted">From Passport · read-only here</p>
              </div>
              <span className="bdg bdg-ok">
                <CircleCheck className="ic" aria-hidden="true" />
                Complete
              </span>
            </div>
            <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="fld">
                <label className="lbl" htmlFor="legal" style={{ flexWrap: "wrap" }}>
                  Legal name
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
                  </span>
                </label>
                <input className="inp" id="legal" defaultValue="Alder Creek Family Services" readOnly />
                <span className="help">
                  <Link to="/w/alder-creek/organization">Edit in Passport</Link>
                </span>
              </div>
              <div className="fld">
                <label className="lbl" htmlFor="tax" style={{ flexWrap: "wrap" }}>
                  Tax status
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
                  </span>
                </label>
                <input className="inp" id="tax" defaultValue="501(c)(3) public charity · verified" readOnly />
              </div>
              <div className="fld">
                <label className="lbl" htmlFor="contact" style={{ flexWrap: "wrap" }}>
                  Primary contact
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
                  </span>
                </label>
                <input className="inp" id="contact" defaultValue="Maria Santos · Executive Director" readOnly />
              </div>
              <div className="fld">
                <label className="lbl" htmlFor="req" style={{ flexWrap: "wrap" }}>
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
                <span className="help">Range: $50,000 – $150,000</span>
              </div>
            </div>
          </section>
          <div
            className="row"
            style={{ gap: "10px", position: "sticky", bottom: "232px", zIndex: 2, background: "#F7FAFA", padding: "8px 0" }}
          >
            <Link to="/preview/pdf/application-snapshot" className="btn btn-secondary btn-lg" style={{ flex: 1 }}>
              Preview
            </Link>
            <Link to="/w/alder-creek/applications/app_01HZX4/edit/submit" className="btn btn-primary btn-lg" style={{ flex: 1 }}>
              Submit…
            </Link>
          </div>
        </main>
        <div
          className="sheet"
          style={{ position: "sticky", bottom: "68px", zIndex: 3, marginTop: "auto" }}
          role="region"
          aria-label="Validation and comments"
        >
          <div className="grab" aria-hidden="true"></div>
          <div className="panel-tabs" role="tablist" style={{ padding: "0 8px" }}>
            <button className="tab on" role="tab" aria-selected="true" style={{ minHeight: "44px" }}>
              Validation
              <span className="n" style={{ background: "#FBE3E3", color: "#9B1C1C" }}>
                2
              </span>
            </button>
            <button className="tab" role="tab" style={{ minHeight: "44px" }}>
              Comments<span className="n">2</span>
            </button>
            <button className="tab" role="tab" style={{ minHeight: "44px" }}>
              Assignments
            </button>
            <button className="tab" role="tab" style={{ minHeight: "44px" }}>
              <Sparkles className="ic" aria-hidden="true" />
              Assistant
            </button>
          </div>
          <ul style={{ padding: "4px 16px 12px", display: "flex", flexDirection: "column" }}>
            <li>
              <a
                href="#budget"
                className="rc-row rc-fail"
                style={{ borderTop: "0", minHeight: "44px", textDecoration: "none", color: "inherit" }}
              >
                <CircleX className="ic" aria-hidden="true" />
                <div>
                  <div className="l" style={{ fontSize: "15px" }}>
                    Budget exceeds requested amount
                  </div>
                  <div className="r">$153,000 vs $150,000</div>
                </div>
                <span className="fix">Fix →</span>
              </a>
            </li>
            <li>
              <a href="#attachments" className="rc-row rc-fail" style={{ minHeight: "44px", textDecoration: "none", color: "inherit" }}>
                <CircleX className="ic" aria-hidden="true" />
                <div>
                  <div className="l" style={{ fontSize: "15px" }}>
                    Letters of support missing
                  </div>
                  <div className="r">Required attachment</div>
                </div>
                <span className="fix">Fix →</span>
              </a>
            </li>
          </ul>
        </div>
        <nav className="phone-tabs" aria-label="Primary" style={{ position: "sticky", bottom: "0", zIndex: 4 }}>
          <Link to="/w/alder-creek">
            <House className="ic ic-md" aria-hidden="true" />
            Home
          </Link>
          <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="on" aria-current="page">
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
          <Link to="/w/alder-creek/organization">
            <Building className="ic ic-md" aria-hidden="true" />
            Org
          </Link>
        </nav>
      </div>
    </>
  );
}
