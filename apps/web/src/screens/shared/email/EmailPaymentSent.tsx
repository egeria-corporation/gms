// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, Send, Shield } from "lucide-react";

import { translator } from "../../../i18n/index.tsx";

const t = translator("shared");
export default function EmailPaymentSent() {
  return (
    <>
      <title>{t("emailPaymentSent.emailPaymentSent")}</title>
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
            {t.rich("emailPaymentSent.subjectPaymentSent75000", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
          <div>
            {t.rich("emailPaymentSent.toAlderCreekFamilyServices", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span>, span2: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
        </div>
        <div className="hd">
          {t.rich("emailPaymentSent.rcfRiverbendCommunityFoundation", { span: (chunks) => <span
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              // Outlined in the header's own text color: a translucent white plate failed contrast (as .pub-hd .mark).
              background: "transparent",
              border: "1.5px solid currentColor",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              letterSpacing: ".04em",
            }}
          >{chunks}</span> })}
        </div>
        <div className="bd">
          <div className="row" style={{ gap: "8px" }}>
            <span className="bdg bdg-info bdg-lg">
              <Send className="ic" aria-hidden="true" />
              {t("emailPaymentSent.paymentInitiated")}
            </span>
            <span className="small muted">{t("emailPaymentSent.grantAwd01j2q7Tranche1")}</span>
          </div>
          <h2 style={{ fontSize: "20px" }}>{t("emailPaymentSent.n75000IsOnIts")}</h2>
          <p>{t("emailPaymentSent.helloAlderCreekTeam")}</p>
          <p>
            {t.rich("emailPaymentSent.riverbendCommunityFoundationReleasedThe", { span: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <div className="amounts" style={{ fontSize: "14px" }}>
            <div>
              <div className="small muted b">{t("emailPaymentSent.amount")}</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "22px", color: "#0D2A43" }}>$75,000</div>
              <div className="small muted">{t("emailPaymentSent.tranche1Of3On")}</div>
            </div>
            <div>
              <div className="small muted b">{t("emailPaymentSent.sent")}</div>
              <div className="b" style={{ marginTop: "4px" }}>
                {t("emailPaymentSent.may252027Ach")}
              </div>
              <div className="small muted">{t("emailPaymentSent.expectedToSettleTheSame")}</div>
            </div>
            <div>
              <div className="small muted b">{t("emailPaymentSent.destination")}</div>
              <div className="b" style={{ marginTop: "4px" }}>
                {t("emailPaymentSent.riverCityCreditUnion4821")}
              </div>
              <div className="small muted">{t("emailPaymentSent.verifiedInPassportLevelL3")}</div>
            </div>
          </div>
          <p>
            {t("emailPaymentSent.theRemainingScheduleIsUnchanged")}
          </p>
          <div className="bnr bnr-neu">
            <Shield className="ic" aria-hidden="true" />
            <div>
              <div className="t">{t("emailPaymentSent.didnTExpectAPayment")}</div>
              <div className="d">
                {t("emailPaymentSent.contactRiverbendAtGrantsRiverbendcf")}
              </div>
            </div>
          </div>
          <Link to="/w/alder-creek/grants/awd_01J2Q7" className="btn btn-tenant btn-lg">
            {t("emailPaymentSent.viewPayment")}
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <p style={{ fontSize: "13px", color: "#4A5C5A" }}>
            {t("emailPaymentSent.passportDisbursementIdPay01j3k9")}
          </p>
        </div>
        <div className="ft" style={{ marginTop: "auto" }}>
          <span>{t("emailPaymentSent.sentByOpengrantsGmsOn")}</span>
          <span>
            {t.rich("emailPaymentSent.manageNotificationsGmsOpengrantsIo", { link: (chunks) => <Link to="/notifications">{chunks}</Link> })}
          </span>
        </div>
      </div>
    </>
  );
}
