// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, Clock, Database, File } from "lucide-react";

import { translator } from "../../../i18n/index.tsx";

const t = translator("shared");
export default function EmailReminder() {
  return (
    <>
      <title>{t("emailReminder.emailReportReminder")}</title>
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
            {t.rich("emailReminder.subjectReminderInterimReportDue", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
          <div>
            {t.rich("emailReminder.toAlderCreekFamilyServices", { span: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span>, span2: (chunks) => <span className="b" style={{ color: "#1E2D2B" }}>{chunks}</span> })}
          </div>
        </div>
        <div className="hd">
          {t.rich("emailReminder.rcfRiverbendCommunityFoundation", { span: (chunks) => <span
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
              <Clock className="ic" aria-hidden="true" />
              {t("emailReminder.dueIn7Days")}
            </span>
            <span className="small muted">{t("emailReminder.grantAwd01j2q7MobileHealth")}</span>
          </div>
          <h2 style={{ fontSize: "20px" }}>{t("emailReminder.yourInterimReportIsDue")}</h2>
          <p>{t("emailReminder.helloAlderCreekTeam")}</p>
          <p>
            {t.rich("emailReminder.theInterimProgressAndFinancial", { span: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <div
            className="card"
            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
          >
            <div className="b" style={{ fontSize: "14px", color: "#0D2A43" }}>
              {t("emailReminder.alreadyFilledInForYou")}
            </div>
            <ul style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "6px", color: "#1E2D2B" }}>
              <li className="row" style={{ gap: "8px", alignItems: "flex-start" }}>
                <span className="prov prov-report" style={{ marginTop: "2px" }}>
                  <File className="ic" aria-hidden="true" />
                  {t("emailReminder.fromPriorReport")}
                </span>
                <span>{t("emailReminder.programDescriptionStaffingAndOutcome")}</span>
              </li>
              <li className="row" style={{ gap: "8px", alignItems: "flex-start" }}>
                <span className="prov prov-qb" style={{ marginTop: "2px" }}>
                  <Database className="ic" aria-hidden="true" />
                  {t("emailReminder.fromQuickbooks")}
                </span>
                <span>
                  {t("emailReminder.actualSpendingByBudgetCategory")}
                </span>
              </li>
            </ul>
          </div>
          <p>
            {t.rich("emailReminder.whenRiverbendAcceptsTheReport", { span: (chunks) => <span className="b">{chunks}</span> })}
          </p>
          <Link to="/w/alder-creek/reports" className="btn btn-tenant btn-lg">
            {t("emailReminder.openReport")}
            <ArrowRight className="ic" aria-hidden="true" />
          </Link>
          <p style={{ fontSize: "14px", color: "#4A5C5A" }}>
            {t("emailReminder.reminderScheduleForThisRequirement")}
          </p>
        </div>
        <div className="ft" style={{ marginTop: "auto" }}>
          <span>{t("emailReminder.sentByOpengrantsGmsOn")}</span>
          <span>
            {t.rich("emailReminder.manageNotificationsGmsOpengrantsIo", { link: (chunks) => <Link to="/notifications">{chunks}</Link> })}
          </span>
        </div>
      </div>
    </>
  );
}
