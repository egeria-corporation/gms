// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, Mail } from "lucide-react";

import { translator } from "../../../i18n/index.tsx";

const t = translator("shared");
export default function EmailAward() {
  return (
    <>
      <title>{t("emailAward.emailAwardOffer")}</title>
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
            {t.rich("emailAward.subjectAwardOffer150000", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
          <div>
            {t.rich("emailAward.toMariaSantosMariaAldercreekfs", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span>, span2: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
        </div>
        <div className="hd">
          {t.rich("emailAward.rcfRiverbendCommunityFoundation", { span: (chunks) => <span
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
              <Mail className="ic" aria-hidden="true" />
              {t("emailAward.awardOffered")}
            </span>
            <span className="small muted">{t("emailAward.communityHealthGrants2027")}</span>
          </div>
          <h2 style={{ fontSize: "20px" }}>{t("emailAward.riverbendIsOfferingAlderCreek")}</h2>
          <p>{t("emailAward.helloMaria")}</p>
          <p>
            {t.rich("emailAward.theCommunityHealthPanelHas", { span: (chunks) => <span className="b">{chunks}</span>, span2: (chunks) => <span className="b">{chunks}</span>, span3: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <div
            className="card"
            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
          >
            <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
              {t("emailAward.toAccept")}
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
                {t.rich("emailAward.openTheGrantAndChoose", { span: (chunks) => <span className="b">{chunks}</span> })}
              </li>
              <li>
                {t("emailAward.reviewTheGrantAgreementStandard")}
              </li>
              <li>
                {t("emailAward.nothingElseIsNeededFor")}
              </li>
            </ol>
          </div>
          <p>
            {t.rich("emailAward.pleaseAcceptByJune2", { span: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="btn btn-tenant btn-lg">
            {t("emailAward.reviewAndAccept")}
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <div className="doc" style={{ marginTop: "4px" }}>
            <span className="ft ft-pdf">PDF</span>
            <div className="grow">
              <div className="nm">{t("emailAward.awardLetterAlderCreekFamily")}</div>
              <div className="mt">
                <span>{t("emailAward.n92Kb")}</span>
                <span>·</span>
                <span>{t("emailAward.awardLetterV4SignedBy")}</span>
              </div>
            </div>
          </div>
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
            {t("emailAward.paymentScheduleAfterExecution75")}
          </p>
        </div>
        <div className="ft" style={{ marginTop: "auto" }}>
          <span>{t("emailAward.sentByOpengrantsGmsOn")}</span>
          <span>
            {t.rich("emailAward.manageNotificationsGmsOpengrantsIo", { link: (chunks) => <Link to="/notifications">{chunks}</Link> })}
          </span>
        </div>
      </div>
    </>
  );
}
