// SPDX-License-Identifier: AGPL-3.0-only
import { ShieldCheck } from "lucide-react";

export default function PdfAgreement() {
  return (
    <>
      <title>{"PDF — executed grant agreement"}</title>
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
          <span>Grant agreement · executed</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginTop: "8px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h1 style={{ fontSize: "22px" }}>Grant Agreement</h1>
            <div style={{ fontSize: "13px", color: "#4A5C5A" }}>
              Standard grant agreement v4 · Award awd_01J2Q7 · Agreement agr_01J2Q7-1
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
            Executed May 24, 2027
          </div>
        </div>
        <div className="sec-h">Parties</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px", fontSize: "12.5px" }}>
          <div>
            <div className="b" style={{ color: "#0D2A43" }}>
              Funder
            </div>
            <div>Riverbend Community Foundation</div>
            <div className="muted">120 River Street, Riverbend, OR · grants@riverbendcf.example</div>
          </div>
          <div>
            <div className="b" style={{ color: "#0D2A43" }}>
              Grantee
            </div>
            <div>Alder Creek Family Services · 501(c)(3)</div>
            <div className="muted">418 Mill Road, Alder Creek, OR · Passport level L3, payee verified</div>
          </div>
        </div>
        <div className="sec-h">Award</div>
        <dl style={{ display: "grid", gridTemplateColumns: "180px minmax(0, 1fr)", gap: "4px 16px", fontSize: "12.5px", margin: "0" }}>
          <dt className="muted">Amount</dt>
          <dd style={{ margin: "0" }} className="b">
            $150,000 (one hundred fifty thousand US dollars)
          </dd>
          <dt className="muted">Purpose</dt>
          <dd style={{ margin: "0" }}>
            Mobile Health Navigation for Rural Families, as described in application app_01HZX4 and its approved budget.
          </dd>
          <dt className="muted">Grant period</dt>
          <dd style={{ margin: "0" }}>July 1, 2027 – June 30, 2028</dd>
          <dt className="muted">Program</dt>
          <dd style={{ margin: "0" }}>Community Health 2027 · Community Health Grants 2027</dd>
        </dl>
        <div className="sec-h">Payment schedule</div>
        <table className="tbl" style={{ fontSize: "12px" }}>
          <thead>
            <tr>
              <th>#</th>
              <th className="num">Amount</th>
              <th>Condition</th>
              <th>Scheduled</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td className="num">$75,000</td>
              <td>On execution of this agreement</td>
              <td>May 24, 2027</td>
            </tr>
            <tr>
              <td>2</td>
              <td className="num">$60,000</td>
              <td>On acceptance of the interim report</td>
              <td>Report due Dec 15, 2027</td>
            </tr>
            <tr>
              <td>3</td>
              <td className="num">$15,000</td>
              <td>On acceptance of the final report</td>
              <td>Report due Jul 15, 2028</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: "12px", color: "#4A5C5A" }}>
          Payments are made through OpenGrants Passport to the destination the Grantee has verified there (currently River City Credit Union
          •••• 4821). The Funder does not hold or change the Grantee's bank details. A payment is released only when its readiness check
          passes.
        </p>
        <div className="sec-h">Reporting</div>
        <p style={{ fontSize: "12.5px" }}>
          Interim progress and financial report covering Jul 1 – Nov 30, 2027, due <span className="b">Dec 15, 2027</span>. Final report
          covering the full grant period, due <span className="b">Jul 15, 2028</span>. Reports use the Funder's forms in OpenGrants GMS and
          may be shared by the Grantee with other funders at the Grantee's discretion.
        </p>
        <div className="sec-h">Terms</div>
        <div className="cl">
          <span className="n">1.</span>
          <span>
            <span className="b">Use of funds.</span> The Grantee uses the funds only for the purpose above and within the approved budget.
            Moving more than 10% between budget categories requires an approved amendment.
          </span>{" "}
          <span className="n">2.</span>
          <span>
            <span className="b">Records.</span> The Grantee keeps financial records for this grant for four years after the period ends and
            makes them available to the Funder on reasonable request.
          </span>{" "}
          <span className="n">3.</span>
          <span>
            <span className="b">Amendments.</span> Changes to scope, schedule or budget are requested and approved in OpenGrants GMS; both
            parties' approvals are recorded there.
          </span>{" "}
          <span className="n">4.</span>
          <span>
            <span className="b">Termination.</span> Either party may end this agreement with 30 days' written notice. Unspent funds are
            returned within 60 days of termination; scheduled payments not yet released are cancelled.
          </span>
        </div>
        <div className="sec-h">Signatures</div>
        <div className="sig">
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span className="sg">Maria Santos</span>
            <span className="b">Maria Santos · Executive Director</span>
            <span>Alder Creek Family Services</span>
            <span className="muted">Signed May 21, 2027 10:14 PT · IP recorded · typed name, attestation accepted</span>
            <span className="mono" style={{ fontSize: "10.5px" }}>
              doc sha256 4d7a02…e93c
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span className="sg">Dana Ortiz</span>
            <span className="b">Dana Ortiz · Program Officer</span>
            <span>Riverbend Community Foundation</span>
            <span className="muted">Countersigned May 24, 2027 09:02 PT · IP recorded · typed name, attestation accepted</span>
            <span className="mono" style={{ fontSize: "10.5px" }}>
              doc sha256 4d7a02…e93c
            </span>
          </div>
        </div>
        <p style={{ fontSize: "11.5px", color: "#4A5C5A" }}>
          Each signature was captured by click-to-sign in OpenGrants GMS. The record for each signer holds the typed name, the time, the
          signer's IP address and the hash of this document as it stood when signed. Agents cannot sign agreements.
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
          <span>Generated by OpenGrants GMS · executed May 24, 2027 09:02 PT · sha256 4d7a02…e93c</span>
          <span>Page 1 of 1</span>
        </div>
      </div>
    </>
  );
}
