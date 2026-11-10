// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, Mail } from "lucide-react";

export default function EmailAward() {
  return (
    <>
      <title>{"Email — award offer"}</title>
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
            Award offer: $150,000 — Community Health Grants 2027
          </div>
          <div>
            <span className="b" style={{ color: "#1E2D2B" }}>
              To:
            </span>{" "}
            Maria Santos {"<"}maria@aldercreekfs.example{">"} ·{" "}
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
            <span className="bdg bdg-info bdg-lg">
              <Mail className="ic" aria-hidden="true" />
              Award offered
            </span>
            <span className="small muted">Community Health Grants 2027</span>
          </div>
          <h2 style={{ fontSize: "20px" }}>Riverbend is offering Alder Creek Family Services a $150,000 grant</h2>
          <p>Hello Maria,</p>
          <p>
            The Community Health panel has recommended, and Riverbend Community Foundation has approved, an award of{" "}
            <span className="b">$150,000</span> for <span className="b">Mobile Health Navigation for Rural Families</span>. The grant period
            is <span className="b">July 1, 2027 – June 30, 2028</span>.
          </p>
          <div
            className="card"
            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
          >
            <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
              To accept
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
                Open the grant and choose <span className="b">Accept award</span>.
              </li>
              <li>
                Review the grant agreement (Standard grant agreement v4) and sign it. Signing records your name, the time, your IP address
                and the document hash.
              </li>
              <li>
                Nothing else is needed for payment: your Passport payee verification (level L3) is already complete, so the first tranche of
                $75,000 is scheduled on execution of the agreement.
              </li>
            </ol>
          </div>
          <p>
            Please accept by <span className="b">June 2, 2027</span>. If you need more time or want to discuss the scope or schedule, reply
            to this email before then and the offer will be held.
          </p>
          <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="btn btn-tenant btn-lg">
            Review and accept
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <div className="doc" style={{ marginTop: "4px" }}>
            <span className="ft ft-pdf">PDF</span>
            <div className="grow">
              <div className="nm">Award letter — Alder Creek Family Services.pdf</div>
              <div className="mt">
                <span>92 KB</span>
                <span>·</span>
                <span>Award letter v4 · signed by Dana Ortiz, Program Officer</span>
              </div>
            </div>
          </div>
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
            Payment schedule after execution: $75,000 on execution · $60,000 on acceptance of the interim report (due Dec 15, 2027) ·
            $15,000 on acceptance of the final report (due Jul 15, 2028).
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
