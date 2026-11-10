// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, Clock, Database, File } from "lucide-react";

export default function EmailReminder() {
  return (
    <>
      <title>{"Email — report reminder"}</title>
      <div
        className="gms email"
        style={
          {
            "--tenant": "#1F6F8B",
            "--on-tenant": "#FFFFFF",
            width: "640px",
            minHeight: "100vh",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
          } as CSSProperties
        }
      >
        <div
          style={{
            padding: "14px 28px",
            background: "#F7FAFA",
            borderBottom: "1px solid #D6DEDE",
            fontSize: "13px",
            color: "#4A5C5A",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <div>
            <span className="b" style={{ color: "#1E2D2B" }}>
              Subject:
            </span>{" "}
            Reminder: interim report due in 7 days (Dec 15)
          </div>
          <div>
            <span className="b" style={{ color: "#1E2D2B" }}>
              To:
            </span>{" "}
            Alder Creek Family Services {"<"}grants@aldercreekfs.example{">"} ·{" "}
            <span className="b" style={{ color: "#1E2D2B" }}>
              From:
            </span>{" "}
            Riverbend Community Foundation via OpenGrants GMS
          </div>
        </div>
        <div className="hd">
          <span
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              background: "rgba(255,255,255,.18)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              letterSpacing: ".04em",
            }}
          >
            RCF
          </span>
          Riverbend Community Foundation
        </div>
        <div className="bd">
          <div className="row" style={{ gap: "8px" }}>
            <span className="bdg bdg-warn bdg-lg">
              <Clock className="ic" aria-hidden="true" />
              Due in 7 days
            </span>
            <span className="small muted">Grant awd_01J2Q7 · Mobile Health Navigation for Rural Families</span>
          </div>
          <h2 style={{ fontSize: "20px" }}>Your interim report is due December 15, 2027</h2>
          <p>Hello Alder Creek team,</p>
          <p>
            The <span className="b">interim progress and financial report</span> for your Community Health Grants 2027 award is due in seven
            days. It covers July 1 – November 30, 2027 and uses Riverbend's interim report form (v1).
          </p>
          <div
            className="card"
            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
          >
            <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
              Already filled in for you
            </div>
            <ul style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "6px", color: "#1E2D2B" }}>
              <li className="row" style={{ gap: "8px", alignItems: "flex-start" }}>
                <span className="prov prov-report" style={{ marginTop: "2px" }}>
                  <File className="ic" aria-hidden="true" />
                  From prior report
                </span>
                <span>Program description, staffing and outcome targets carry over from your application; update what changed.</span>
              </li>
              <li className="row" style={{ gap: "8px", alignItems: "flex-start" }}>
                <span className="prov prov-qb" style={{ marginTop: "2px" }}>
                  <Database className="ic" aria-hidden="true" />
                  From QuickBooks
                </span>
                <span>
                  Actual spending by budget category is pulled from your connected QuickBooks classes through November 30; you confirm the
                  mapping.
                </span>
              </li>
            </ul>
          </div>
          <p>
            When Riverbend accepts the report, <span className="b">tranche 2 ($60,000)</span> moves to Due and is released to your verified
            destination. If you need an extension, request one from the grant's Amendments tab before the due date.
          </p>
          <Link to="/w/alder-creek/reports" className="btn btn-tenant btn-lg">
            Open report
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
            Reminder schedule for this requirement: 7 days before, on the due date, and 7 days after if nothing is received. You can change
            which reminders you get in your notification settings.
          </p>
        </div>
        <div className="ft" style={{ marginTop: "auto" }}>
          <span>Sent by OpenGrants GMS on behalf of Riverbend Community Foundation</span>
          <span>
            <Link to="/notifications">Manage notifications</Link> · gms.opengrants.io
          </span>
        </div>
      </div>
    </>
  );
}
