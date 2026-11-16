
import { translator } from "../../../i18n/index.tsx";

const t = translator("shared");// SPDX-License-Identifier: AGPL-3.0-only

export default function PdfSnapshot() {
  return (
    <>
      <title>{t("pdfSnapshot.pdfApplicationSnapshot")}</title>
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
          <span>{t("pdfSnapshot.riverbendCommunityFoundationCommunityHealth")}</span>
          <span>{t("pdfSnapshot.applicationSnapshot")}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
          <h1 style={{ fontSize: "22px" }}>{t("pdfSnapshot.mobileHealthNavigationForRural")}</h1>
          <div style={{ fontSize: "13px", color: "#4A5C5A" }}>
            {t("pdfSnapshot.alderCreekFamilyServicesFull")}
          </div>
        </div>
        <div
          style={{
            border: "1px solid #D6DEDE",
            borderRadius: "6px",
            padding: "12px 14px",
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "6px 24px",
            fontSize: "11.5px",
            background: "#F7FAFA",
          }}
        >
          <div>
            <span className="muted">{t("pdfSnapshot.applicationId")}</span> ·{" "}
            <span className="mono" style={{ fontSize: "11px" }}>
              {t("pdfSnapshot.app01hzx4")}
            </span>
          </div>
          <div>
            {t.rich("pdfSnapshot.submittedApr16202714", { span: (chunks) => <span className="muted">{chunks}</span> })}
          </div>
          <div>
            {t.rich("pdfSnapshot.formFullProposalV2Pinned", { span: (chunks) => <span className="muted">{chunks}</span> })}
          </div>
          <div>
            <span className="muted">{t("pdfSnapshot.requested")}</span> · $150,000
          </div>
          <div>
            {t.rich("pdfSnapshot.passportAttestationLevelL3Att", { span: (chunks) => <span className="muted">{chunks}</span> })}
          </div>
          <div>
            <span className="muted">{t("pdfSnapshot.documentHash")}</span> ·{" "}
            <span className="mono" style={{ fontSize: "11px" }}>
              {t("pdfSnapshot.sha2569c4e711a7b")}
            </span>
          </div>
        </div>
        <div className="sec-h">{t("pdfSnapshot.n1Organization")}</div>
        <dl className="f">
          <dt>{t("pdfSnapshot.legalName")}</dt>
          <dd>
            {t.rich("pdfSnapshot.alderCreekFamilyServicesSource", { span: (chunks) => <span className="src">{chunks}</span> })}
          </dd>
          <dt>{t("pdfSnapshot.taxStatus")}</dt>
          <dd>
            {t.rich("pdfSnapshot.n501C3PublicCharity", { span: (chunks) => <span className="src">{chunks}</span> })}
          </dd>
          <dt>{t("pdfSnapshot.mailingAddress")}</dt>
          <dd>
            {t.rich("pdfSnapshot.n418MillRoadAlderCreek", { span: (chunks) => <span className="src">{chunks}</span> })}
          </dd>
          <dt>{t("pdfSnapshot.primaryContact")}</dt>
          <dd>
            {t.rich("pdfSnapshot.mariaSantosExecutiveDirectorSource", { span: (chunks) => <span className="src">{chunks}</span> })}
          </dd>
          <dt>{t("pdfSnapshot.annualOperatingBudget")}</dt>
          <dd>
            {t.rich("pdfSnapshot.n2400000Fy2026Source", { span: (chunks) => <span className="src">{chunks}</span> })}
          </dd>
          <dt>{t("pdfSnapshot.requestedAmount")}</dt>
          <dd>
            $150,000{" "}
            <span className="src" style={{ color: "#4A5C5A" }}>
              {t("pdfSnapshot.entered")}
            </span>
          </dd>
        </dl>
        <div className="sec-h">{t("pdfSnapshot.n2NeedStatement")}</div>
        <p style={{ fontSize: "12.5px" }}>
          {t("pdfSnapshot.familiesInTheAlderCreek")}
        </p>
        <p style={{ fontSize: "12.5px" }}>
          {t.rich("pdfSnapshot.mobileHealthNavigationPairsA", { span: (chunks) => <span className="src" style={{ color: "#1E4F8F" }}>{chunks}</span> })}
        </p>
        <div className="sec-h">{t("pdfSnapshot.n3ApproachActivities")}</div>
        <p style={{ fontSize: "12.5px" }}>
          {t("pdfSnapshot.twoNavigatorsCoverAWeekly")}
        </p>
        <table className="tbl" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>{t("pdfSnapshot.keyStaff")}</th>
              <th>{t("pdfSnapshot.roleOnProject")}</th>
              <th className="num">{t("pdfSnapshot.fte")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t("pdfSnapshot.mariaSantos")}</td>
              <td>{t("pdfSnapshot.projectDirector")}</td>
              <td className="num">0.15</td>
            </tr>
            <tr>
              <td>{t("pdfSnapshot.toBeHired")}</td>
              <td>{t("pdfSnapshot.communityHealthNavigator2")}</td>
              <td className="num">2.00</td>
            </tr>
          </tbody>
        </table>
        <div className="sec-h">{t("pdfSnapshot.n4Budget")}</div>
        <table className="tbl bud" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>{t("pdfSnapshot.category")}</th>
              <th className="num">{t("pdfSnapshot.requestedFromRiverbend")}</th>
              <th className="num">{t("pdfSnapshot.otherSources")}</th>
              <th className="num">{t("pdfSnapshot.total")}</th>
              <th>{t("pdfSnapshot.notes")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t("pdfSnapshot.personnel")}</td>
              <td className="num">$96,000</td>
              <td className="num">$24,000</td>
              <td className="num">$120,000</td>
              <td>{t("pdfSnapshot.n2Navigators015Fte")}</td>
            </tr>
            <tr>
              <td>{t("pdfSnapshot.travelVehicle")}</td>
              <td className="num">$28,000</td>
              <td className="num">$0</td>
              <td className="num">$28,000</td>
              <td>{t("pdfSnapshot.vanLeaseFuelMaintenance")}</td>
            </tr>
            <tr>
              <td>{t("pdfSnapshot.supplies")}</td>
              <td className="num">$11,000</td>
              <td className="num">$0</td>
              <td className="num">$11,000</td>
              <td>{t("pdfSnapshot.tabletsPrintedMaterialsVouchers")}</td>
            </tr>
            <tr>
              <td>{t("pdfSnapshot.indirect10")}</td>
              <td className="num">$15,000</td>
              <td className="num">$0</td>
              <td className="num">$15,000</td>
              <td>{t("pdfSnapshot.withinThe10Cap")}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>{t("pdfSnapshot.total")}</td>
              <td className="num">$150,000</td>
              <td className="num">$24,000</td>
              <td className="num">$174,000</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="sec-h">{t("pdfSnapshot.n5Attachments")}</div>
        <table className="tbl" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>{t("pdfSnapshot.file")}</th>
              <th>{t("pdfSnapshot.source")}</th>
              <th>{t("pdfSnapshot.size")}</th>
              <th>{t("pdfSnapshot.hash")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t("pdfSnapshot.irsDeterminationLetterPdf")}</td>
              <td>{t("pdfSnapshot.passportLocker")}</td>
              <td>{t("pdfSnapshot.n412Kb")}</td>
              <td className="mono" style={{ fontSize: "11px" }}>
                {t("pdfSnapshot.sha2563f9aC21e")}
              </td>
            </tr>
            <tr>
              <td>{t("pdfSnapshot.fy2026AuditedFinancialsXlsx")}</td>
              <td>{t("pdfSnapshot.passportLocker")}</td>
              <td>{t("pdfSnapshot.n11Mb")}</td>
              <td className="mono" style={{ fontSize: "11px" }}>
                {t("pdfSnapshot.sha2568b1077d4")}
              </td>
            </tr>
            <tr>
              <td>{t("pdfSnapshot.letterOfSupportCopperValley")}</td>
              <td>{t("pdfSnapshot.uploadedByJamalReed")}</td>
              <td>{t("pdfSnapshot.n240Kb")}</td>
              <td className="mono" style={{ fontSize: "11px" }}>
                {t("pdfSnapshot.sha256E20455f0")}
              </td>
            </tr>
          </tbody>
        </table>
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
          <span>{t("pdfSnapshot.generatedByOpengrantsGmsApr")}</span>
          <span>{t("pdfSnapshot.page1Of2")}</span>
        </div>
      </div>
    </>
  );
}
