// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, RotateCcw } from "lucide-react";

export default function EmailRevision() {
  return (
    <>
      <title>{"Email — revision requested"}</title>
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
            Revision requested: Rural Telehealth Expansion
          </div>
          <div>
            <span className="b" style={{ color: "#1E2D2B" }}>
              To:
            </span>{" "}
            Copper Valley Clinic {"<"}admin@coppervalleyclinic.example{">"} ·{" "}
            <span className="b" style={{ color: "#1E2D2B" }}>
              From:
            </span>{" "}
            Dana Ortiz, Riverbend Community Foundation via OpenGrants GMS
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
              <RotateCcw className="ic" aria-hidden="true" />
              Revision requested
            </span>
            <span className="small muted">Community Health Grants 2027 · Full proposal</span>
          </div>
          <h2 style={{ fontSize: "20px" }}>Two changes before review continues</h2>
          <p>Hello Copper Valley Clinic team,</p>
          <p>
            I have read <span className="b">Rural Telehealth Expansion</span> and would like two things clarified before it goes to the
            review panel. Your application is on hold until you respond; nothing else needs to change.
          </p>
          <div
            className="card"
            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
          >
            <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
              Requested changes
            </div>
            <ol
              style={{
                listStyle: "decimal",
                paddingLeft: "20px",
                fontSize: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                color: "#1E2D2B",
              }}
            >
              <li>
                <span className="b">Budget narrative.</span> The budget table lists $48,000 for equipment but the narrative does not
                describe what is purchased or how it is maintained after the grant period.
              </li>
              <li>
                <span className="b">Service-area map.</span> The attached map is from 2024. Please attach the current one so the eligibility
                check for Riverbend County can be completed (it is showing “unknown” today).
              </li>
            </ol>
          </div>
          <p>
            Only the <span className="b">Budget</span> section and <span className="b">Attachments</span> are unlocked for editing; other
            sections stay as submitted. When you resubmit, I will see exactly what changed side by side with the original. Please respond by{" "}
            <span className="b">May 2, 2027</span>.
          </p>
          <Link to="/w/alder-creek/applications/app_01HZX4" className="btn btn-tenant btn-lg">
            Respond to revision request
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
            You can also reply to this email; your reply is added to the shared message thread on the application. — Dana Ortiz, Program
            Officer
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
