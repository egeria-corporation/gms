// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";

export default function EmailAck() {
  return (
    <>
      <title>{"Email — application received"}</title>
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
            We received your application — Community Health Grants 2027
          </div>
          <div>
            <span className="b" style={{ color: "#1E2D2B" }}>
              To:
            </span>{" "}
            Maria Santos {"<"}maria@aldercreekfs.example{">"} ·{" "}
            <span className="b" style={{ color: "#1E2D2B" }}>
              From:
            </span>{" "}
            Riverbend Community Foundation via OpenGrants GMS {"<"}grants@riverbendcf.example{">"}
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
          <h2 style={{ fontSize: "20px" }}>We received your application</h2>
          <p>Hello Maria,</p>
          <p>
            Alder Creek Family Services submitted <span className="b">Mobile Health Navigation for Rural Families</span> to Community Health
            Grants 2027 on <span className="b">April 16, 2027 at 2:02 PM PT</span>. A PDF snapshot of the application as submitted is
            attached, along with your Passport attestation (level L3, payee verified).
          </p>
          <div
            className="card"
            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px", background: "#F7FAFA" }}
          >
            <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
              What happens next
            </div>
            <ol
              style={{
                listStyle: "decimal",
                paddingLeft: "20px",
                fontSize: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                color: "#1E2D2B",
              }}
            >
              <li>Screening for eligibility and completeness, usually within 10 business days.</li>
              <li>Review by the Community Health panel, April 30 – May 14.</li>
              <li>
                A decision from Riverbend by <span className="b">June 15, 2027</span>, sent to this address and shown in your status page.
              </li>
            </ol>
          </div>
          <p>
            You can follow every step, read messages from the program officer, and respond to any revision request from your application
            status page. If you need to withdraw, you can do that there too.
          </p>
          <Link to="/w/alder-creek/applications/app_01HZX4" className="btn btn-tenant btn-lg">
            View application status
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <div className="doc" style={{ marginTop: "4px" }}>
            <span className="ft ft-pdf">PDF</span>
            <div className="grow">
              <div className="nm">Application snapshot — app_01HZX4.pdf</div>
              <div className="mt">
                <span>186 KB</span>
                <span>·</span>
                <span className="mono">sha256 9c4e…1a7b</span>
              </div>
            </div>
          </div>
          <div className="doc">
            <span className="ft">ATT</span>
            <div className="grow">
              <div className="nm">Passport attestation — L3.json</div>
              <div className="mt">
                <span>4 KB</span>
                <span>·</span>
                <span>Issued by OpenGrants Passport · valid through Mar 2028</span>
              </div>
            </div>
          </div>
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
            Questions? Reply to this email or write to grants@riverbendcf.example. Replies go to the program officer, Dana Ortiz, and appear
            in your shared message thread.
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
