// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { Bell, Check, ChevronUp, CircleQuestionMark, ClipboardCheck, Plus, Search } from "lucide-react";

export default function WorkspaceSwitcher() {
  return (
    <>
      <title>{"Workspace switcher — OpenGrants GMS"}</title>
      <div
        className="gms gms-funder"
        style={
          {
            "--tenant": "#1F6F8B",
            "--on-tenant": "#FFFFFF",
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
            position: "relative",
          } as CSSProperties
        }
      >
        <header className="topbar" style={{ position: "relative", zIndex: 6 }}>
          <Link to="/w/riverbend" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <button
            className="ws"
            aria-expanded="true"
            aria-controls="ws-menu"
            style={{ borderColor: "#29A79F", boxShadow: "0 0 0 2px #C2F0ED" }}
          >
            Riverbend Community Foundation<span className="role">Funder</span>
            <ChevronUp className="ic" aria-hidden="true" />
          </button>
          <div className="search">
            <Search className="ic" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search applications, awards, grantees, opportunities"
              placeholder="Search applications, awards, grantees, opportunities"
            />
            <span className="kbd">⌘K</span>
          </div>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            <Link to="/notifications" className="iconbtn" aria-label="Notifications, 3 unread">
              <Bell className="ic ic-md" aria-hidden="true" />
              <span className="dot"></span>
            </Link>
            <button className="iconbtn" aria-label="Help">
              <CircleQuestionMark className="ic ic-md" aria-hidden="true" />
            </button>
            <Link to="/account/agents" className="av" aria-label="Account: Dana Ortiz">
              DO
            </Link>
          </div>
        </header>
        <div className="shell" aria-hidden="true">
          <nav className="rail">
            <div className="rail-tenant">
              <div className="name">Riverbend Community Foundation</div>
              <div className="sub">Funder workspace · FY2027</div>
            </div>
            <ul>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0" }}
                ></span>
              </li>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0", width: "60%" }}
                ></span>
              </li>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0", width: "75%" }}
                ></span>
              </li>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0", width: "70%" }}
                ></span>
              </li>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0", width: "55%" }}
                ></span>
              </li>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0", width: "50%" }}
                ></span>
              </li>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0", width: "65%" }}
                ></span>
              </li>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0", width: "60%" }}
                ></span>
              </li>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0", width: "58%" }}
                ></span>
              </li>
              <li>
                <span
                  className="ri"
                  style={{ background: "#EEF3F3", height: "14px", margin: "11px 10px", borderRadius: "4px", padding: "0", width: "62%" }}
                ></span>
              </li>
            </ul>
          </nav>
          <main className="main">
            <div style={{ height: "14px", width: "180px", background: "#EEF3F3", borderRadius: "4px" }}></div>
            <div style={{ height: "26px", width: "240px", background: "#D6DEDE", borderRadius: "4px" }}></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
              <div className="stat">
                <div style={{ height: "12px", width: "50%", background: "#EEF3F3", borderRadius: "4px" }}></div>
                <div style={{ height: "28px", width: "40%", background: "#D6DEDE", borderRadius: "4px" }}></div>
              </div>
              <div className="stat">
                <div style={{ height: "12px", width: "55%", background: "#EEF3F3", borderRadius: "4px" }}></div>
                <div style={{ height: "28px", width: "35%", background: "#D6DEDE", borderRadius: "4px" }}></div>
              </div>
              <div className="stat">
                <div style={{ height: "12px", width: "50%", background: "#EEF3F3", borderRadius: "4px" }}></div>
                <div style={{ height: "28px", width: "45%", background: "#D6DEDE", borderRadius: "4px" }}></div>
              </div>
              <div className="stat">
                <div style={{ height: "12px", width: "60%", background: "#EEF3F3", borderRadius: "4px" }}></div>
                <div style={{ height: "28px", width: "30%", background: "#D6DEDE", borderRadius: "4px" }}></div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "20px" }}>
              <div className="card" style={{ height: "280px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ height: "14px", width: "220px", background: "#EEF3F3", borderRadius: "4px" }}></div>
                <div style={{ height: "28px", background: "#EEF3F3", borderRadius: "6px" }}></div>
                <div style={{ height: "28px", background: "#EEF3F3", borderRadius: "6px", width: "85%" }}></div>
                <div style={{ height: "28px", background: "#EEF3F3", borderRadius: "6px", width: "70%" }}></div>
              </div>
              <div className="card" style={{ height: "280px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ height: "14px", width: "140px", background: "#EEF3F3", borderRadius: "4px" }}></div>
                <div style={{ height: "56px", background: "#EEF3F3", borderRadius: "6px" }}></div>
                <div style={{ height: "56px", background: "#EEF3F3", borderRadius: "6px" }}></div>
              </div>
            </div>
          </main>
        </div>
        <div
          className="ovl"
          style={{ alignItems: "flex-start", justifyContent: "flex-start", padding: "0", background: "rgba(13,42,67,.35)" }}
        >
          <div
            id="ws-menu"
            role="menu"
            aria-label="Switch workspace"
            className="card"
            style={{ margin: "104px 0 0 262px", width: "440px", boxShadow: "0 24px 64px rgba(13,42,67,.3)", overflow: "hidden" }}
          >
            <div
              style={{
                padding: "14px 16px 10px",
                borderBottom: "1px solid #D6DEDE",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span className="eyebrow">Your workspaces</span>
              <span className="small muted">dana.ortiz@riverbendcf.example</span>
            </div>
            <ul style={{ display: "flex", flexDirection: "column", padding: "6px" }}>
              <li>
                <Link
                  to="/w/riverbend"
                  role="menuitem"
                  aria-current="true"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px minmax(0, 1fr) auto",
                    gap: "12px",
                    alignItems: "center",
                    padding: "10px",
                    borderRadius: "8px",
                    textDecoration: "none",
                    color: "inherit",
                    background: "#E1F8F6",
                  }}
                >
                  <span
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "8px",
                      background: "#1F6F8B",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 800,
                      letterSpacing: ".04em",
                    }}
                  >
                    RCF
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
                    <span className="b" style={{ color: "#0D2A43" }}>
                      Riverbend Community Foundation
                    </span>
                    <span className="small muted">Current · Program officer</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="role">Funder</span>
                    <Check className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                  </span>
                </Link>
              </li>
              <li>
                <Link
                  to="/w/alder-creek"
                  role="menuitem"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px minmax(0, 1fr) auto",
                    gap: "12px",
                    alignItems: "center",
                    padding: "10px",
                    borderRadius: "8px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
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
                      fontSize: "11px",
                      fontWeight: 800,
                      letterSpacing: ".04em",
                    }}
                  >
                    ACF
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
                    <span className="b" style={{ color: "#0D2A43" }}>
                      Alder Creek Family Services
                    </span>
                    <span className="small muted">Last opened yesterday · Grants manager</span>
                  </span>
                  <span className="role">Applicant</span>
                </Link>
              </li>
              <li style={{ padding: "8px 10px 2px" }}>
                <span className="small muted b">Cascade County Health Department · funds and applies</span>
              </li>
              <li>
                <Link
                  to="/w/riverbend"
                  role="menuitem"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px minmax(0, 1fr) auto",
                    gap: "12px",
                    alignItems: "center",
                    padding: "10px",
                    borderRadius: "8px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "8px",
                      background: "#7A4F01",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "10px",
                      fontWeight: 800,
                      letterSpacing: ".04em",
                    }}
                  >
                    CCHD
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
                    <span className="b" style={{ color: "#0D2A43" }}>
                      Cascade County Health Department
                    </span>
                    <span className="small muted">Last opened 3 days ago · Reviewer</span>
                  </span>
                  <span className="role">Funder</span>
                </Link>
              </li>
              <li>
                <Link
                  to="/w/alder-creek"
                  role="menuitem"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px minmax(0, 1fr) auto",
                    gap: "12px",
                    alignItems: "center",
                    padding: "10px",
                    borderRadius: "8px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
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
                      fontSize: "10px",
                      fontWeight: 800,
                      letterSpacing: ".04em",
                    }}
                  >
                    CCHD
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
                    <span className="b" style={{ color: "#0D2A43" }}>
                      Cascade County Health Department
                    </span>
                    <span className="small muted">Applies to state pass-through programs · Member</span>
                  </span>
                  <span className="role">Applicant</span>
                </Link>
              </li>
              <li style={{ padding: "8px 10px 2px" }}>
                <span className="small muted b">External roles</span>
              </li>
              <li>
                <Link
                  to="/review/assignments"
                  role="menuitem"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px minmax(0, 1fr) auto",
                    gap: "12px",
                    alignItems: "center",
                    padding: "10px",
                    borderRadius: "8px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
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
                    }}
                  >
                    <ClipboardCheck className="ic" aria-hidden="true" />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
                    <span className="b" style={{ color: "#0D2A43" }}>
                      Reviewer portal · Riverbend
                    </span>
                    <span className="small muted">External reviewer · Community Health 2027 · expires Jun 30</span>
                  </span>
                  <span className="role">Reviewer</span>
                </Link>
              </li>
            </ul>
            <div
              style={{
                padding: "10px 16px 12px",
                borderTop: "1px solid #D6DEDE",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                fontSize: "13px",
              }}
            >
              <Link to="/onboarding/funder/brand" style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <Plus className="ic" aria-hidden="true" />
                Create a workspace
              </Link>
              <Link to="/signin" style={{ fontWeight: 700 }}>
                Join by invitation
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
