// SPDX-License-Identifier: AGPL-3.0-only
import { CircleCheck } from "lucide-react";

import { translator } from "../../../i18n/index.tsx";

const t = translator("shared");
export default function PdfCloseout() {
  return (
    <>
      <title>{t("pdfCloseout.pdfCloseoutSummary")}</title>
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
          <span>{t("pdfCloseout.riverbendCommunityFoundationCommunityHealth")}</span>
          <span>{t("pdfCloseout.closeoutSummary")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginTop: "8px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h1 style={{ fontSize: "22px" }}>{t("pdfCloseout.closeoutSummary2")}</h1>
            <div style={{ fontSize: "13px", color: "#4A5C5A" }}>{t("pdfCloseout.harborLightShelterShelterHealth")}</div>
          </div>
          <div
            style={{
              border: "2px solid #1E2D2B",
              color: "#1E2D2B",
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
            <CircleCheck className="ic" aria-hidden="true" />
            {t("pdfCloseout.completedAug122027")}
          </div>
        </div>
        <div
          style={{
            border: "1px solid #D6DEDE",
            borderRadius: "6px",
            padding: "12px 14px",
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "6px 24px",
            fontSize: "11.5px",
            background: "#F7FAFA",
          }}
        >
          <div>
            <span className="muted">{t("pdfCloseout.awarded")}</span> · <span className="b">$95,000</span>
          </div>
          <div>
            {t.rich("pdfCloseout.disbursed950003Of", { span: (chunks) => <span className="muted">{chunks}</span>, span2: (chunks) => <span className="b">{chunks}</span> })}
          </div>
          <div>
            <span className="muted">{t("pdfCloseout.returned")}</span> · $0
          </div>
          <div>
            {t.rich("pdfCloseout.grantPeriodJul12026", { span: (chunks) => <span className="muted">{chunks}</span> })}
          </div>
          <div>
            {t.rich("pdfCloseout.agreementAgr01hq221Executed", { span: (chunks) => <span className="muted">{chunks}</span> })}
          </div>
          <div>
            {t.rich("pdfCloseout.programOfficerDanaOrtiz", { span: (chunks) => <span className="muted">{chunks}</span> })}
          </div>
        </div>
        <div className="sec-h">{t("pdfCloseout.closeoutChecklist")}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div className="ck-row">
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">{t("pdfCloseout.finalReportAccepted")}</div>
              <div className="muted">{t("pdfCloseout.submittedJul282027Accepted")}</div>
            </div>
            <span className="muted">{t("pdfCloseout.aug4")}</span>
          </div>
          <div className="ck-row">
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">{t("pdfCloseout.allTranchesSettledOrCancelled")}</div>
              <div className="muted">
                {t("pdfCloseout.n3Settled4750038")}
              </div>
            </div>
            <span className="muted">{t("pdfCloseout.aug6")}</span>
          </div>
          <div className="ck-row">
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">{t("pdfCloseout.budgetReconciled")}</div>
              <div className="muted">
                {t("pdfCloseout.actualsFromQuickbooksConfirmedBy")}
              </div>
            </div>
            <span className="muted">{t("pdfCloseout.aug10")}</span>
          </div>
          <div className="ck-row">
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">{t("pdfCloseout.documentsComplete")}</div>
              <div className="muted">{t("pdfCloseout.agreement3PaymentRecordsInterim")}</div>
            </div>
            <span className="muted">{t("pdfCloseout.aug12")}</span>
          </div>
          <div className="ck-row" style={{ borderBottom: "0" }}>
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">{t("pdfCloseout.awardMarkedCompleted")}</div>
              <div className="muted">{t("pdfCloseout.byDanaOrtizMirroredTo")}</div>
            </div>
            <span className="muted">{t("pdfCloseout.aug12")}</span>
          </div>
        </div>
        <div className="sec-h">{t("pdfCloseout.budgetApprovedVsActual")}</div>
        <table className="tbl bud" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>{t("pdfCloseout.category")}</th>
              <th className="num">{t("pdfCloseout.approved")}</th>
              <th className="num">{t("pdfCloseout.actual")}</th>
              <th className="num">{t("pdfCloseout.variance")}</th>
              <th>{t("pdfCloseout.source")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t("pdfCloseout.personnel")}</td>
              <td className="num">$62,000</td>
              <td className="num">$63,100</td>
              <td className="num var-neg">+$1,100</td>
              <td>{t("pdfCloseout.quickbooks")}</td>
            </tr>
            <tr>
              <td>{t("pdfCloseout.clinicSupplies")}</td>
              <td className="num">$18,000</td>
              <td className="num">$16,460</td>
              <td className="num var-pos">−$1,540</td>
              <td>{t("pdfCloseout.quickbooks")}</td>
            </tr>
            <tr>
              <td>{t("pdfCloseout.training")}</td>
              <td className="num">$6,000</td>
              <td className="num">$5,200</td>
              <td className="num var-pos">−$800</td>
              <td>{t("pdfCloseout.quickbooks")}</td>
            </tr>
            <tr>
              <td>{t("pdfCloseout.indirect10")}</td>
              <td className="num">$9,000</td>
              <td className="num">$9,000</td>
              <td className="num">$0</td>
              <td>{t("pdfCloseout.entered")}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>{t("pdfCloseout.total")}</td>
              <td className="num">$95,000</td>
              <td className="num">$93,760</td>
              <td className="num var-pos">−$1,240</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="sec-h">{t("pdfCloseout.outcomesReported")}</div>
        <table className="tbl" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>{t("pdfCloseout.measure")}</th>
              <th className="num">{t("pdfCloseout.target")}</th>
              <th className="num">{t("pdfCloseout.reported")}</th>
              <th>{t("pdfCloseout.note")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t("pdfCloseout.clinicHoursOfferedAtThe")}</td>
              <td className="num">520</td>
              <td className="num">548</td>
              <td>{t("pdfCloseout.twoEveningSessionsAddedIn")}</td>
            </tr>
            <tr>
              <td>{t("pdfCloseout.guestsSeenByAClinician")}</td>
              <td className="num">300</td>
              <td className="num">334</td>
              <td>{t("pdfCloseout.unduplicated")}</td>
            </tr>
            <tr>
              <td>{t("pdfCloseout.referralsCompletedWithin30Days")}</td>
              <td className="num">60%</td>
              <td className="num">66%</td>
              <td>{t("pdfCloseout.trackedWithPartnerClinic")}</td>
            </tr>
          </tbody>
        </table>
        <div className="sec-h">{t("pdfCloseout.documents")}</div>
        <ul
          style={{ fontSize: "12px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px 16px", color: "#1E2D2B" }}
        >
          <li>{t("pdfCloseout.executedAgreementAgr01hq221")}</li>
          <li>{t("pdfCloseout.interimReportAcceptedJan20")}</li>
          <li>{t("pdfCloseout.finalReportAcceptedAug4")}</li>
          <li>{t("pdfCloseout.amendment1ScheduleChangeApproved")}</li>
          <li>{t("pdfCloseout.paymentRecordsPay01hq221")}</li>
          <li>{t("pdfCloseout.closeoutSummaryThisDocument")}</li>
        </ul>
        <p style={{ fontSize: "12px", color: "#4A5C5A" }}>
          {t("pdfCloseout.closedByDanaOrtizProgram")}
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
          <span>{t("pdfCloseout.generatedByOpengrantsGmsAug")}</span>
          <span>{t("pdfCloseout.page1Of1")}</span>
        </div>
      </div>
    </>
  );
}
