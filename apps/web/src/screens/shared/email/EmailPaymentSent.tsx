// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, Send, Shield } from "lucide-react";

export default function EmailPaymentSent() {
  return (
    <>
      <title>{"Email — payment sent"}</title>
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
            Payment sent: $75,000 to River City Credit Union •••• 4821
          </div>
          <div>
            <span className="b" style={{ color: "#1E2D2B" }}>
              To:
            </span>{" "}
            Alder Creek Family Services {"<"}finance@aldercreekfs.example{">"} ·{" "}
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
              <Send className="ic" aria-hidden="true" />
              Payment initiated
            </span>
            <span className="small muted">Grant awd_01J2Q7 · tranche 1 of 3</span>
          </div>
          <h2 style={{ fontSize: "20px" }}>$75,000 is on its way</h2>
          <p>Hello Alder Creek team,</p>
          <p>
            Riverbend Community Foundation released the first payment for{" "}
            <span className="b">Mobile Health Navigation for Rural Families</span> today.
          </p>
          <div className="amounts" style={{ fontSize: "14px" }}>
            <div>
              <div className="small muted b">Amount</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "22px", color: "#0D2A43" }}>$75,000</div>
              <div className="small muted">Tranche 1 of 3 · on execution</div>
            </div>
            <div>
              <div className="small muted b">Sent</div>
              <div className="b" style={{ marginTop: "4px" }}>
                May 25, 2027 · ACH
              </div>
              <div className="small muted">Expected to settle the same business day</div>
            </div>
            <div>
              <div className="small muted b">Destination</div>
              <div className="b" style={{ marginTop: "4px" }}>
                River City Credit Union •••• 4821
              </div>
              <div className="small muted">Verified in Passport · level L3</div>
            </div>
          </div>
          <p>
            The remaining schedule is unchanged: $60,000 when your interim report is accepted (due Dec 15, 2027) and $15,000 when the final
            report is accepted (due Jul 15, 2028). You will get another message when this payment settles.
          </p>
          <div className="bnr bnr-neu">
            <Shield className="ic" aria-hidden="true" />
            <div>
              <div className="t">Didn't expect a payment, or don't recognize the destination?</div>
              <div className="d">
                Contact Riverbend at grants@riverbendcf.example and check your payee record in Passport. Riverbend never changes bank
                details on your behalf; only your organization can, in Passport, and changes take 5 business days to take effect.
              </div>
            </div>
          </div>
          <Link to="/w/alder-creek/grants/awd_01J2Q7" className="btn btn-tenant btn-lg">
            View payment
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <p style={{ fontSize: "13px", color: "#4A5C5A" }}>
            Passport disbursement id pay_01J3K9 · recorded in your grant's payment timeline and in Riverbend's ledger.
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
