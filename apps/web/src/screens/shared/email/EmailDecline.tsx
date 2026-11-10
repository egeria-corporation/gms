// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ExternalLink, File } from "lucide-react";

export default function EmailDecline() {
  return (
    <>
      <title>{"Email — decision on your LOI"}</title>
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
            Decision on your LOI — Community Health Grants 2027
          </div>
          <div>
            <span className="b" style={{ color: "#1E2D2B" }}>
              To:
            </span>{" "}
            Pine Ridge Literacy Project {"<"}director@pineridgeliteracy.example{">"} ·{" "}
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
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>May 25, 2027</p>
          <p>Dear Pine Ridge Literacy Project,</p>
          <p>
            Thank you for submitting <span className="b">Health Literacy Workshops</span> to Community Health Grants 2027. After review,
            Riverbend Community Foundation will not be advancing this letter of intent to the full proposal stage.
          </p>
          <p>
            The proposed service area is outside Riverbend County, which this opportunity requires. Eligibility for Community Health Grants
            is limited to programs serving residents of the county.
          </p>
          <p>
            We encourage you to check eligibility for <span className="b">Housing Stability Grants 2027</span>, which accepts applications
            from organizations serving the wider region and opens on June 1, and to apply again in a future Community Health cycle if your
            service area changes.
          </p>
          <p>Questions about this decision can be sent to grants@riverbendcf.example.</p>
          <p>
            Sincerely,
            <br />
            Dana Ortiz
            <br />
            Program Officer, Riverbend Community Foundation
          </p>
          <div className="divider"></div>
          <div className="row" style={{ gap: "18px", flexWrap: "wrap", fontSize: "14px" }}>
            <Link to="/f/riverbend" className="b row" style={{ gap: "6px" }}>
              <ExternalLink className="ic" aria-hidden="true" />
              Other open opportunities
            </Link>
            <Link to="/w/alder-creek/applications/app_01HZX4" className="b row" style={{ gap: "6px" }}>
              <File className="ic" aria-hidden="true" />
              View the decision letter (PDF)
            </Link>
          </div>
          <p style={{ fontSize: "13px", color: "#4A5C5A" }}>
            This letter was prepared from Riverbend's “Standard decline v3” template and approved by Dana Ortiz before sending. A copy is
            attached to your application record.
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
