// SPDX-License-Identifier: AGPL-3.0-only
import { CircleCheck } from "lucide-react";

export default function PdfCloseout() {
  return (
    <>
      <title>{"PDF — closeout summary"}</title>
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
          <span>Riverbend Community Foundation · Community Health Grants 2026</span>
          <span>Closeout summary</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginTop: "8px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h1 style={{ fontSize: "22px" }}>Closeout Summary</h1>
            <div style={{ fontSize: "13px", color: "#4A5C5A" }}>Harbor Light Shelter · Shelter Health Clinic Hours · Award awd_01HQ22</div>
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
            Completed Aug 12, 2027
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
            <span className="muted">Awarded</span> · <span className="b">$95,000</span>
          </div>
          <div>
            <span className="muted">Disbursed</span> · <span className="b">$95,000</span> (3 of 3 tranches settled)
          </div>
          <div>
            <span className="muted">Returned</span> · $0
          </div>
          <div>
            <span className="muted">Grant period</span> · Jul 1, 2026 – Jun 30, 2027
          </div>
          <div>
            <span className="muted">Agreement</span> · agr_01HQ22-1 · executed Jun 18, 2026
          </div>
          <div>
            <span className="muted">Program officer</span> · Dana Ortiz
          </div>
        </div>
        <div className="sec-h">Closeout checklist</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div className="ck-row">
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">Final report accepted</div>
              <div className="muted">Submitted Jul 28, 2027 · accepted by Dana Ortiz Aug 4, 2027</div>
            </div>
            <span className="muted">Aug 4</span>
          </div>
          <div className="ck-row">
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">All tranches settled or cancelled</div>
              <div className="muted">
                3 settled ($47,500 · $38,000 · $9,500), 0 cancelled · last settlement Aug 6, 2027 after the destination freeze cleared
              </div>
            </div>
            <span className="muted">Aug 6</span>
          </div>
          <div className="ck-row">
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">Budget reconciled</div>
              <div className="muted">
                Actuals from QuickBooks confirmed by grantee · variance −$1,240 (1.3%), under the 10% threshold, no return required
              </div>
            </div>
            <span className="muted">Aug 10</span>
          </div>
          <div className="ck-row">
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">Documents complete</div>
              <div className="muted">Agreement, 3 payment records, interim and final reports, 1 amendment (schedule)</div>
            </div>
            <span className="muted">Aug 12</span>
          </div>
          <div className="ck-row" style={{ borderBottom: "0" }}>
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="b">Award marked Completed</div>
              <div className="muted">By Dana Ortiz · mirrored to Passport as a completed award for Harbor Light Shelter</div>
            </div>
            <span className="muted">Aug 12</span>
          </div>
        </div>
        <div className="sec-h">Budget · approved vs actual</div>
        <table className="tbl bud" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Approved</th>
              <th className="num">Actual</th>
              <th className="num">Variance</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Personnel</td>
              <td className="num">$62,000</td>
              <td className="num">$63,100</td>
              <td className="num var-neg">+$1,100</td>
              <td>QuickBooks</td>
            </tr>
            <tr>
              <td>Clinic supplies</td>
              <td className="num">$18,000</td>
              <td className="num">$16,460</td>
              <td className="num var-pos">−$1,540</td>
              <td>QuickBooks</td>
            </tr>
            <tr>
              <td>Training</td>
              <td className="num">$6,000</td>
              <td className="num">$5,200</td>
              <td className="num var-pos">−$800</td>
              <td>QuickBooks</td>
            </tr>
            <tr>
              <td>Indirect (10%)</td>
              <td className="num">$9,000</td>
              <td className="num">$9,000</td>
              <td className="num">$0</td>
              <td>Entered</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">$95,000</td>
              <td className="num">$93,760</td>
              <td className="num var-pos">−$1,240</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="sec-h">Outcomes reported</div>
        <table className="tbl" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>Measure</th>
              <th className="num">Target</th>
              <th className="num">Reported</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Clinic hours offered at the shelter</td>
              <td className="num">520</td>
              <td className="num">548</td>
              <td>Two evening sessions added in spring</td>
            </tr>
            <tr>
              <td>Guests seen by a clinician</td>
              <td className="num">300</td>
              <td className="num">334</td>
              <td>Unduplicated</td>
            </tr>
            <tr>
              <td>Referrals completed within 30 days</td>
              <td className="num">60%</td>
              <td className="num">66%</td>
              <td>Tracked with partner clinic</td>
            </tr>
          </tbody>
        </table>
        <div className="sec-h">Documents</div>
        <ul
          style={{ fontSize: "12px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px 16px", color: "#1E2D2B" }}
        >
          <li>Executed agreement agr_01HQ22-1 · PDF · sha256 71be…0c4a</li>
          <li>Interim report · accepted Jan 20, 2027</li>
          <li>Final report · accepted Aug 4, 2027</li>
          <li>Amendment 1 · schedule change · approved Mar 3, 2027</li>
          <li>Payment records · pay_01HQ22-1, -2, -3</li>
          <li>Closeout summary (this document)</li>
        </ul>
        <p style={{ fontSize: "12px", color: "#4A5C5A" }}>
          Closed by Dana Ortiz, Program Officer, on Aug 12, 2027. The grantee received a copy of this summary; the award record stays
          readable to both parties.
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
          <span>Generated by OpenGrants GMS · Aug 12, 2027 · sha256 b02f6d…48e1</span>
          <span>Page 1 of 1</span>
        </div>
      </div>
    </>
  );
}
