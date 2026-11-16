// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";

import { translator } from "../../../i18n/index.tsx";

const t = translator("shared");
export default function EmailAck() {
  return (
    <>
      <title>{t("emailAck.emailApplicationReceived")}</title>
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
            {t.rich("emailAck.subjectWeReceivedYourApplication", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
          <div>
            {t.rich("emailAck.toMariaSantosMariaAldercreekfs", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span>, span2: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
        </div>
        <div className="hd">
          {t.rich("emailAck.rcfRiverbendCommunityFoundation", { span: (chunks) => <span
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
          <h2 style={{ fontSize: "20px" }}>{t("emailAck.weReceivedYourApplication")}</h2>
          <p>{t("emailAck.helloMaria")}</p>
          <p>
            {t.rich("emailAck.alderCreekFamilyServicesSubmitted", { span: (chunks) => <span className="b">{chunks}</span>, span2: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <div
            className="card"
            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px", background: "#F7FAFA" }}
          >
            <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
              {t("emailAck.whatHappensNext")}
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
              <li>{t("emailAck.screeningForEligibilityAndCompleteness")}</li>
              <li>{t("emailAck.reviewByTheCommunityHealth")}</li>
              <li>
                {t.rich("emailAck.aDecisionFromRiverbendBy", { span: (chunks) => <span className="b">{chunks}</span> })}
              </li>
            </ol>
          </div>
          <p>
            {t("emailAck.youCanFollowEveryStep")}
          </p>
          <Link to="/w/alder-creek/applications/app_01HZX4" className="btn btn-tenant btn-lg">
            {t("emailAck.viewApplicationStatus")}
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <div className="doc" style={{ marginTop: "4px" }}>
            <span className="ft ft-pdf">PDF</span>
            <div className="grow">
              <div className="nm">{t("emailAck.applicationSnapshotApp01hzx4Pdf")}</div>
              <div className="mt">
                <span>{t("emailAck.n186Kb")}</span>
                <span>·</span>
                <span className="mono">{t("emailAck.sha2569c4e1a7b")}</span>
              </div>
            </div>
          </div>
          <div className="doc">
            <span className="ft">{t("emailAck.att")}</span>
            <div className="grow">
              <div className="nm">{t("emailAck.passportAttestationL3Json")}</div>
              <div className="mt">
                <span>{t("emailAck.n4Kb")}</span>
                <span>·</span>
                <span>{t("emailAck.issuedByOpengrantsPassportValid")}</span>
              </div>
            </div>
          </div>
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
            {t("emailAck.questionsReplyToThisEmail")}
          </p>
        </div>
        <div className="ft" style={{ marginTop: "auto" }}>
          <span>{t("emailAck.sentByOpengrantsGmsOn")}</span>
          <span>
            {t.rich("emailAck.manageNotificationsGmsOpengrantsIo", { link: (chunks) => <Link to="/notifications">{chunks}</Link> })}
          </span>
        </div>
      </div>
    </>
  );
}
