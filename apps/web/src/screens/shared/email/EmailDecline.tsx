// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ExternalLink, File } from "lucide-react";

import { translator } from "../../../i18n/index.tsx";

const t = translator("shared");
export default function EmailDecline() {
  return (
    <>
      <title>{t("emailDecline.emailDecisionOnYourLoi")}</title>
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
            {t.rich("emailDecline.subjectDecisionOnYourLoi", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
          <div>
            {t.rich("emailDecline.toPineRidgeLiteracyProject", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span>, span2: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
        </div>
        <div className="hd">
          {t.rich("emailDecline.rcfRiverbendCommunityFoundation", { span: (chunks) => <span
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
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>{t("emailDecline.may252027")}</p>
          <p>{t("emailDecline.dearPineRidgeLiteracyProject")}</p>
          <p>
            {t.rich("emailDecline.thankYouForSubmittingHealth", { span: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <p>
            {t("emailDecline.theProposedServiceAreaIs")}
          </p>
          <p>
            {t.rich("emailDecline.weEncourageYouToCheck", { span: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <p>{t("emailDecline.questionsAboutThisDecisionCan")}</p>
          <p>
            {t("emailDecline.sincerely")}
            <br />
            {t("emailDecline.danaOrtiz")}
            <br />
            {t("emailDecline.programOfficerRiverbendCommunityFoundation")}
          </p>
          <div className="divider"></div>
          <div className="row" style={{ gap: "18px", flexWrap: "wrap", fontSize: "14px" }}>
            <Link to="/f/riverbend" className="b row" style={{ gap: "6px" }}>
              <ExternalLink className="ic" aria-hidden="true" />
              {t("emailDecline.otherOpenOpportunities")}
            </Link>
            <Link to="/w/alder-creek/applications/app_01HZX4" className="b row" style={{ gap: "6px" }}>
              <File className="ic" aria-hidden="true" />
              {t("emailDecline.viewTheDecisionLetterPdf")}
            </Link>
          </div>
          <p style={{ fontSize: "13px", color: "#4A5C5A" }}>
            {t("emailDecline.thisLetterWasPreparedFrom")}
          </p>
        </div>
        <div className="ft" style={{ marginTop: "auto" }}>
          <span>{t("emailDecline.sentByOpengrantsGmsOn")}</span>
          <span>
            {t.rich("emailDecline.manageNotificationsGmsOpengrantsIo", { link: (chunks) => <Link to="/notifications">{chunks}</Link> })}
          </span>
        </div>
      </div>
    </>
  );
}
