// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, RotateCcw } from "lucide-react";

import { translator } from "../../../i18n/index.tsx";

const t = translator("shared");
export default function EmailRevision() {
  return (
    <>
      <title>{t("emailRevision.emailRevisionRequested")}</title>
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
            {t.rich("emailRevision.subjectRevisionRequestedRuralTelehealth", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
          <div>
            {t.rich("emailRevision.toCopperValleyClinicAdmin", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span>, span2: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
        </div>
        <div className="hd">
          {t.rich("emailRevision.rcfRiverbendCommunityFoundation", { span: (chunks) => <span
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
            <span className="bdg bdg-warn bdg-lg">
              <RotateCcw className="ic" aria-hidden="true" />
              {t("emailRevision.revisionRequested")}
            </span>
            <span className="small muted">{t("emailRevision.communityHealthGrants2027Full")}</span>
          </div>
          <h2 style={{ fontSize: "20px" }}>{t("emailRevision.twoChangesBeforeReviewContinues")}</h2>
          <p>{t("emailRevision.helloCopperValleyClinicTeam")}</p>
          <p>
            {t.rich("emailRevision.iHaveReadRuralTelehealth", { span: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <div
            className="card"
            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
          >
            <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
              {t("emailRevision.requestedChanges")}
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
                {t.rich("emailRevision.budgetNarrativeTheBudgetTable", { span: (chunks) => <span className="b">{chunks}</span> })}
              </li>
              <li>
                {t.rich("emailRevision.serviceAreaMapTheAttached", { span: (chunks) => <span className="b">{chunks}</span> })}
              </li>
            </ol>
          </div>
          <p>
            {t.rich("emailRevision.onlyTheBudgetSectionAnd", { span: (chunks) => <span className="b">{chunks}</span>, span2: (chunks) => <span className="b">{chunks}</span>, span3: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <Link to="/w/alder-creek/applications/app_01HZX4" className="btn btn-tenant btn-lg">
            {t("emailRevision.respondToRevisionRequest")}
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
            {t("emailRevision.youCanAlsoReplyTo")}
          </p>
        </div>
        <div className="ft" style={{ marginTop: "auto" }}>
          <span>{t("emailRevision.sentByOpengrantsGmsOn")}</span>
          <span>
            {t.rich("emailRevision.manageNotificationsGmsOpengrantsIo", { link: (chunks) => <Link to="/notifications">{chunks}</Link> })}
          </span>
        </div>
      </div>
    </>
  );
}
