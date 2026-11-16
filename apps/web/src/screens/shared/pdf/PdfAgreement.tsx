// SPDX-License-Identifier: AGPL-3.0-only
import { ShieldCheck } from "lucide-react";

import { translator } from "../../../i18n/index.tsx";

const t = translator("shared");
export default function PdfAgreement() {
  return (
    <>
      <title>{t("pdfAgreement.pdfExecutedGrantAgreement")}</title>
      <div className="gms print" style={{ width: "816px", minHeight: "100vh", padding: "56px 72px 48px", gap: "14px" }}>
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            fontSize: "10.5px",
            color: "#4A5C5A",
            letterSpacing: ".04em",
            textTransform: "uppercase",
            fontWeight: 700,
            borderBottom: "1px solid #D6DEDE",
            paddingBottom: "8px",
          }}
        >
          <span>{t("pdfAgreement.riverbendCommunityFoundationCommunityHealth")}</span>
          <span>{t("pdfAgreement.grantAgreementExecuted")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginTop: "8px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h1 style={{ fontSize: "22px" }}>{t("pdfAgreement.grantAgreement")}</h1>
            <div style={{ fontSize: "13px", color: "#4A5C5A" }}>
              {t("pdfAgreement.standardGrantAgreementV4Award")}
            </div>
          </div>
          <div
            style={{
              border: "2px solid #0B5E47",
              color: "#0B5E47",
              borderRadius: "6px",
              padding: "8px 12px",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "12px",
              letterSpacing: ".06em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <ShieldCheck className="ic" aria-hidden="true" />
            {t("pdfAgreement.executedMay242027")}
          </div>
        </div>
        <div className="sec-h">{t("pdfAgreement.parties")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px", fontSize: "12.5px" }}>
          <div>
            <div className="b" style={{ color: "#0D2A43" }}>
              {t("pdfAgreement.funder")}
            </div>
            <div>{t("pdfAgreement.riverbendCommunityFoundation")}</div>
            <div className="muted">{t("pdfAgreement.n120RiverStreetRiverbendOr")}</div>
          </div>
          <div>
            <div className="b" style={{ color: "#0D2A43" }}>
              {t("pdfAgreement.grantee")}
            </div>
            <div>{t("pdfAgreement.alderCreekFamilyServices501")}</div>
            <div className="muted">{t("pdfAgreement.n418MillRoadAlderCreek")}</div>
          </div>
        </div>
        <div className="sec-h">{t("pdfAgreement.award")}</div>
        <dl style={{ display: "grid", gridTemplateColumns: "180px minmax(0, 1fr)", gap: "4px 16px", fontSize: "12.5px", margin: "0" }}>
          <dt className="muted">{t("pdfAgreement.amount")}</dt>
          <dd style={{ margin: "0" }} className="b">
            {t("pdfAgreement.n150000OneHundredFifty")}
          </dd>
          <dt className="muted">{t("pdfAgreement.purpose")}</dt>
          <dd style={{ margin: "0" }}>
            {t("pdfAgreement.mobileHealthNavigationForRural")}
          </dd>
          <dt className="muted">{t("pdfAgreement.grantPeriod")}</dt>
          <dd style={{ margin: "0" }}>{t("pdfAgreement.july12027June30")}</dd>
          <dt className="muted">{t("pdfAgreement.program")}</dt>
          <dd style={{ margin: "0" }}>{t("pdfAgreement.communityHealth2027CommunityHealth")}</dd>
        </dl>
        <div className="sec-h">{t("pdfAgreement.paymentSchedule")}</div>
        <table className="tbl" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>#</th>
              <th className="num">{t("pdfAgreement.amount")}</th>
              <th>{t("pdfAgreement.condition")}</th>
              <th>{t("pdfAgreement.scheduled")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td className="num">$75,000</td>
              <td>{t("pdfAgreement.onExecutionOfThisAgreement")}</td>
              <td>{t("pdfAgreement.may242027")}</td>
            </tr>
            <tr>
              <td>2</td>
              <td className="num">$60,000</td>
              <td>{t("pdfAgreement.onAcceptanceOfTheInterim")}</td>
              <td>{t("pdfAgreement.reportDueDec152027")}</td>
            </tr>
            <tr>
              <td>3</td>
              <td className="num">$15,000</td>
              <td>{t("pdfAgreement.onAcceptanceOfTheFinal")}</td>
              <td>{t("pdfAgreement.reportDueJul152028")}</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: "12px", color: "#4A5C5A" }}>
          {t("pdfAgreement.paymentsAreMadeThroughOpengrants")}
        </p>
        <div className="sec-h">{t("pdfAgreement.reporting")}</div>
        <p style={{ fontSize: "12.5px" }}>
          {t.rich("pdfAgreement.interimProgressAndFinancialReport", { span: (chunks) => <span className="b">{chunks}</span>, span2: (chunks) => <span className="b">{chunks}</span> })}
        </p>
        <div className="sec-h">{t("pdfAgreement.terms")}</div>
        <div className="cl">
          <span className="n">1.</span>
          <span>
            {t.rich("pdfAgreement.useOfFundsTheGrantee", { span: (chunks) => <span className="b">{chunks}</span> })}
          </span>{" "}
          <span className="n">2.</span>
          <span>
            {t.rich("pdfAgreement.recordsTheGranteeKeepsFinancial", { span: (chunks) => <span className="b">{chunks}</span> })}
          </span>{" "}
          <span className="n">3.</span>
          <span>
            {t.rich("pdfAgreement.amendmentsChangesToScopeSchedule", { span: (chunks) => <span className="b">{chunks}</span> })}
          </span>{" "}
          <span className="n">4.</span>
          <span>
            {t.rich("pdfAgreement.terminationEitherPartyMayEnd", { span: (chunks) => <span className="b">{chunks}</span> })}
          </span>
        </div>
        <div className="sec-h">{t("pdfAgreement.signatures")}</div>
        <div className="sig">
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span className="sg">{t("pdfAgreement.mariaSantos")}</span>
            <span className="b">{t("pdfAgreement.mariaSantosExecutiveDirector")}</span>
            <span>{t("pdfAgreement.alderCreekFamilyServices")}</span>
            <span className="muted">{t("pdfAgreement.signedMay21202710")}</span>
            <span className="mono" style={{ fontSize: "10.5px" }}>
              {t("pdfAgreement.docSha2564d7a02E93c")}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span className="sg">{t("pdfAgreement.danaOrtiz")}</span>
            <span className="b">{t("pdfAgreement.danaOrtizProgramOfficer")}</span>
            <span>{t("pdfAgreement.riverbendCommunityFoundation")}</span>
            <span className="muted">{t("pdfAgreement.countersignedMay24202709")}</span>
            <span className="mono" style={{ fontSize: "10.5px" }}>
              {t("pdfAgreement.docSha2564d7a02E93c")}
            </span>
          </div>
        </div>
        <p style={{ fontSize: "11.5px", color: "#4A5C5A" }}>
          {t("pdfAgreement.eachSignatureWasCapturedBy")}
        </p>
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            marginTop: "auto",
            paddingTop: "12px",
            borderTop: "1px solid #D6DEDE",
            fontSize: "10.5px",
            color: "#4A5C5A",
          }}
        >
          <span>{t("pdfAgreement.generatedByOpengrantsGmsExecuted")}</span>
          <span>{t("pdfAgreement.page1Of1")}</span>
        </div>
      </div>
    </>
  );
}
