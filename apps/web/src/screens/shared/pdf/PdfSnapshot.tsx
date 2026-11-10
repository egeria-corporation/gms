// SPDX-License-Identifier: AGPL-3.0-only

export default function PdfSnapshot() {
  return (
    <>
      <title>{"PDF — application snapshot"}</title>
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
          <span>Riverbend Community Foundation · Community Health Grants 2027</span>
          <span>Application snapshot</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
          <h1 style={{ fontSize: "22px" }}>Mobile Health Navigation for Rural Families</h1>
          <div style={{ fontSize: "13px", color: "#4A5C5A" }}>
            Alder Creek Family Services · Full proposal · submitted to Riverbend Community Foundation
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
            <span className="muted">Application id</span> ·{" "}
            <span className="mono" style={{ fontSize: "11px" }}>
              app_01HZX4
            </span>
          </div>
          <div>
            <span className="muted">Submitted</span> · Apr 16, 2027 14:02 PT by Maria Santos
          </div>
          <div>
            <span className="muted">Form</span> · Full proposal v2 (pinned)
          </div>
          <div>
            <span className="muted">Requested</span> · $150,000
          </div>
          <div>
            <span className="muted">Passport attestation</span> · Level L3 · att_01HZX4-9c2 · payee verified
          </div>
          <div>
            <span className="muted">Document hash</span> ·{" "}
            <span className="mono" style={{ fontSize: "11px" }}>
              sha256 9c4e71…1a7b
            </span>
          </div>
        </div>
        <div className="sec-h">1 · Organization</div>
        <dl className="f">
          <dt>Legal name</dt>
          <dd>
            Alder Creek Family Services <span className="src">Source: Passport</span>
          </dd>
          <dt>Tax status</dt>
          <dd>
            501(c)(3) public charity · verified by Passport <span className="src">Source: Passport</span>
          </dd>
          <dt>Mailing address</dt>
          <dd>
            418 Mill Road, Alder Creek, OR <span className="src">Source: Passport</span>
          </dd>
          <dt>Primary contact</dt>
          <dd>
            Maria Santos · Executive Director <span className="src">Source: Passport</span>
          </dd>
          <dt>Annual operating budget</dt>
          <dd>
            $2,400,000 (FY2026) <span className="src">Source: Passport</span>
          </dd>
          <dt>Requested amount</dt>
          <dd>
            $150,000{" "}
            <span className="src" style={{ color: "#4A5C5A" }}>
              Entered
            </span>
          </dd>
        </dl>
        <div className="sec-h">2 · Need statement</div>
        <p style={{ fontSize: "12.5px" }}>
          Families in the Alder Creek valley travel an average of 46 miles to reach a primary care provider, and one in four households has
          no reliable vehicle. Over the last three years our intake data shows that missed appointments, not lack of coverage, is the
          leading reason children in our programs fall behind on well-child visits and immunizations.
        </p>
        <p style={{ fontSize: "12.5px" }}>
          Mobile Health Navigation pairs a community health navigator with a scheduled van route across the six unincorporated communities
          we serve. Navigators schedule visits, arrange rides, and follow up on referrals so that a family's first contact with the clinic
          is not an emergency room visit. The 2026 county health assessment ranks transportation access as the top barrier to care for rural
          families, and our pilot with 38 families cut missed appointments by 41 percent.{" "}
          <span className="src" style={{ color: "#1E4F8F" }}>
            Source: answer library “Need”, edited
          </span>
        </p>
        <div className="sec-h">3 · Approach & activities</div>
        <p style={{ fontSize: "12.5px" }}>
          Two navigators cover a weekly route of six stops. Each stop offers scheduling, transport vouchers, and warm hand-offs to the
          Copper Valley Clinic telehealth room.
        </p>
        <table className="tbl" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>Key staff</th>
              <th>Role on project</th>
              <th className="num">FTE</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Maria Santos</td>
              <td>Project director</td>
              <td className="num">0.15</td>
            </tr>
            <tr>
              <td>To be hired</td>
              <td>Community health navigator (2)</td>
              <td className="num">2.00</td>
            </tr>
          </tbody>
        </table>
        <div className="sec-h">4 · Budget</div>
        <table className="tbl bud" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Requested from Riverbend</th>
              <th className="num">Other sources</th>
              <th className="num">Total</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Personnel</td>
              <td className="num">$96,000</td>
              <td className="num">$24,000</td>
              <td className="num">$120,000</td>
              <td>2 navigators, 0.15 FTE director</td>
            </tr>
            <tr>
              <td>Travel & vehicle</td>
              <td className="num">$28,000</td>
              <td className="num">$0</td>
              <td className="num">$28,000</td>
              <td>Van lease, fuel, maintenance</td>
            </tr>
            <tr>
              <td>Supplies</td>
              <td className="num">$11,000</td>
              <td className="num">$0</td>
              <td className="num">$11,000</td>
              <td>Tablets, printed materials, vouchers</td>
            </tr>
            <tr>
              <td>Indirect (10%)</td>
              <td className="num">$15,000</td>
              <td className="num">$0</td>
              <td className="num">$15,000</td>
              <td>Within the 10% cap</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">$150,000</td>
              <td className="num">$24,000</td>
              <td className="num">$174,000</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="sec-h">5 · Attachments</div>
        <table className="tbl" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>File</th>
              <th>Source</th>
              <th>Size</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>IRS determination letter.pdf</td>
              <td>Passport locker</td>
              <td>412 KB</td>
              <td className="mono" style={{ fontSize: "11px" }}>
                sha256 3f9a…c21e
              </td>
            </tr>
            <tr>
              <td>FY2026 audited financials.xlsx</td>
              <td>Passport locker</td>
              <td>1.1 MB</td>
              <td className="mono" style={{ fontSize: "11px" }}>
                sha256 8b10…77d4
              </td>
            </tr>
            <tr>
              <td>Letter of support — Copper Valley Clinic.pdf</td>
              <td>Uploaded by Jamal Reed</td>
              <td>240 KB</td>
              <td className="mono" style={{ fontSize: "11px" }}>
                sha256 e204…55f0
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
          <span>Generated by OpenGrants GMS · Apr 16, 2027 14:02 PT · sha256 9c4e71…1a7b</span>
          <span>Page 1 of 2</span>
        </div>
      </div>
    </>
  );
}
