// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Ban,
  Bell,
  ChartColumn,
  Check,
  ChevronDown,
  Circle,
  CircleQuestionMark,
  ClipboardCheck,
  Clock4,
  EyeOff,
  Send,
  Star,
} from "lucide-react";
import { Dialog } from "../../components/Dialog.tsx";

const COI_STATEMENTS = [
  "I am not an employee, board member, or contractor of this organization, and have not been in the last three years.",
  "No member of my household has a financial interest in this organization or this project.",
  "I have not discussed this application with the applicant outside the review process.",
];

export default function ReviewerAssignments() {
  const navigate = useNavigate();
  // A conflict-of-interest declaration is required before an application opens for scoring.
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<boolean[]>(() => COI_STATEMENTS.map(() => false));
  return (
    <>
      <title>{"Reviewer portal — My assignments"}</title>
      <div className="gms gms-funder" style={{ display: "flex", flexDirection: "column", minHeight: "100vh", position: "relative" }}>
        <header className="topbar">
          <Link to="/review/assignments" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <Link to="/workspaces" className="ws">
            Reviewer portal · Riverbend Community Foundation<span className="role">Reviewer</span>
            <ChevronDown className="ic" aria-hidden="true" />
          </Link>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            <Link to="/notifications" className="iconbtn" aria-label="Notifications, 1 unread">
              <Bell className="ic ic-md" aria-hidden="true" />
              <span className="dot"></span>
            </Link>
            <button className="iconbtn" aria-label="Help">
              <CircleQuestionMark className="ic ic-md" aria-hidden="true" />
            </button>
            <Link to="/account/agents" className="av av-t" aria-label="Account: Priya Natarajan">
              PN
            </Link>
          </div>
        </header>
        <nav aria-label="Reviewer portal" style={{ background: "#fff", borderBottom: "1px solid #D6DEDE", padding: "0 32px" }}>
          <div className="tabs" style={{ borderBottom: "0" }}>
            <Link to="/review/assignments" className="tab on" aria-current="page">
              <ClipboardCheck className="ic" aria-hidden="true" />
              My assignments<span className="n">9</span>
            </Link>
            <Link to="/review/score/app_01HZX4" className="tab">
              <Star className="ic" aria-hidden="true" />
              Scoring
            </Link>
          </div>
        </nav>
        <main className="main" style={{ maxWidth: "1120px", width: "100%", margin: "0 auto" }}>
          <div className="ph">
            <div>
              <div className="title">
                <h1>My assignments</h1>
              </div>
              <div className="meta">
                <span>Signed in as Priya Natarajan</span>
                <span>·</span>
                <span>9 assignments</span>
                <span>·</span>
                <span className="b" style={{ color: "#7A4A00" }}>
                  Due May 7, 2027
                </span>
                <span>·</span>
                <span>Community Health Grants 2027 · Full proposal</span>
              </div>
            </div>
            <div className="actions">
              <span className="row small muted" style={{ gap: "6px" }}>
                <ChartColumn className="ic" aria-hidden="true" />3 submitted · 2 in progress · 3 not started · 1 recused
              </span>
            </div>
          </div>
          <div className="bnr bnr-neu">
            <EyeOff className="ic" aria-hidden="true" />
            <div>
              <div className="t">Blind review</div>
              <div className="d">
                Applicant contact details and PII-flagged fields are hidden. You see the organization name, the responses marked visible to
                reviewers, and attachments.
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
            <Link
              to="/review/score/app_01HZX4"
              aria-haspopup="dialog"
              onClick={(e) => {
                e.preventDefault();
                setOpen(true);
              }}
              className="card"
              style={{
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                  Alder Creek Family Services
                </span>
                <span className="bdg bdg-prog">
                  <Clock4 className="ic" aria-hidden="true" />
                  In progress
                </span>
              </div>
              <div className="small muted">Mobile Health Navigation for Rural Families · requested $150,000</div>
              <div className="row" style={{ justifyContent: "space-between", fontSize: "12px", color: "#4A5C5A" }}>
                <span>3 of 5 criteria scored</span>
                <span>Due May 7</span>
              </div>
              <div className="mtr">
                <div className="track" style={{ height: "6px" }}>
                  <div className="fill" style={{ width: "60%" }}></div>
                </div>
              </div>
            </Link>
            <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                  Bayview Youth Collective
                </span>
                <span className="bdg bdg-neutral">
                  <Circle className="ic" aria-hidden="true" />
                  Not started
                </span>
              </div>
              <div className="small muted">Youth Mental Health Peer Program · requested $85,000</div>
              <div className="row" style={{ justifyContent: "space-between", fontSize: "12px", color: "#4A5C5A" }}>
                <span>0 of 5 criteria scored</span>
                <span>Due May 7</span>
              </div>
              <div className="mtr">
                <div className="track" style={{ height: "6px" }}>
                  <div className="fill" style={{ width: "0%" }}></div>
                </div>
              </div>
            </div>
            <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                  Lakeside Senior Center
                </span>
                <span className="bdg bdg-ok">
                  <Send className="ic" aria-hidden="true" />
                  Submitted
                </span>
              </div>
              <div className="small muted">Fall Prevention Program · requested $70,000</div>
              <div className="row" style={{ justifyContent: "space-between", fontSize: "12px", color: "#4A5C5A" }}>
                <span>Submitted May 2 · editable until panel opens May 18</span>
                <span>Score 4.6</span>
              </div>
              <div className="mtr">
                <div className="track" style={{ height: "6px" }}>
                  <div className="fill" style={{ width: "100%" }}></div>
                </div>
              </div>
            </div>
            <div
              className="card"
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
            >
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Northgate Housing Trust
                </span>
                <span className="bdg bdg-neutral">
                  <Ban className="ic" aria-hidden="true" />
                  Recused
                </span>
              </div>
              <div className="small muted">Housing-First Health Navigators · conflict of interest declared Apr 29</div>
              <div className="row" style={{ justifyContent: "space-between", fontSize: "12px", color: "#4A5C5A" }}>
                <span>Removed from your queue · program officer notified</span>
              </div>
            </div>
            <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                  Cedar Hollow Food Bank
                </span>
                <span className="bdg bdg-neutral">
                  <Circle className="ic" aria-hidden="true" />
                  Not started
                </span>
              </div>
              <div className="small muted">Healthy Pantry Expansion · requested $60,000</div>
              <div className="row" style={{ justifyContent: "space-between", fontSize: "12px", color: "#4A5C5A" }}>
                <span>0 of 5 criteria scored</span>
                <span>Due May 7</span>
              </div>
              <div className="mtr">
                <div className="track" style={{ height: "6px" }}>
                  <div className="fill" style={{ width: "0%" }}></div>
                </div>
              </div>
            </div>
            <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                  Willow Creek Legal Aid
                </span>
                <span className="bdg bdg-prog">
                  <Clock4 className="ic" aria-hidden="true" />
                  In progress
                </span>
              </div>
              <div className="small muted">Medical-Legal Partnership · requested $110,000</div>
              <div className="row" style={{ justifyContent: "space-between", fontSize: "12px", color: "#4A5C5A" }}>
                <span>1 of 5 criteria scored</span>
                <span>Due May 7</span>
              </div>
              <div className="mtr">
                <div className="track" style={{ height: "6px" }}>
                  <div className="fill" style={{ width: "20%" }}></div>
                </div>
              </div>
            </div>
          </div>
          <div className="small muted">
            3 more assignments · Copper Valley Clinic (Submitted) · Harbor Light Shelter (Not started) · Granite Peak Youth Sports
            (Submitted)
          </div>
        </main>
        <Dialog open={open} onClose={() => setOpen(false)} labelledBy="coi-title">
          <div className="hd">
            <div>
              <h3 id="coi-title" style={{ fontSize: "16px" }}>
                Before you open Alder Creek Family Services
              </h3>
              <p className="small muted" style={{ marginTop: "4px" }}>
                Riverbend requires a conflict-of-interest declaration for each application. Your answers are recorded in the audit ledger.
              </p>
            </div>
          </div>
          <div className="bd">
            {COI_STATEMENTS.map((text, i) => (
              <label className="cb" key={text}>
                <input
                  type="checkbox"
                  className="sr"
                  checked={checks[i] ?? false}
                  onChange={(e) => setChecks(checks.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <span className={checks[i] ? "c on" : "c"} aria-hidden="true">
                  {checks[i] && <Check className="ic ic-sm" aria-hidden="true" />}
                </span>
                <span>{text}</span>
              </label>
            ))}
            <p className="small muted">
              If you have a conflict, choose “I have a conflict”. The application is removed from your queue and the program officer
              reassigns it; nothing else about your review changes.
            </p>
          </div>
          <div className="ft" style={{ justifyContent: "space-between" }}>
            <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
              I have a conflict — recuse me
            </button>
            <div className="row">
              <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={!checks.every(Boolean)}
                onClick={() => navigate("/review/score/app_01HZX4")}
              >
                Continue to scoring
              </button>
            </div>
          </div>
        </Dialog>
      </div>
    </>
  );
}
