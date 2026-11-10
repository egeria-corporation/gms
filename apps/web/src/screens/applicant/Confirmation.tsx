// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Check, Download, Mail, Shield } from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function Confirmation() {
  return (
    <>
      <title>{"Application submitted — confirmation"}</title>
      <ApplicantShell active="Applications">
        <main className="main" style={{ alignItems: "center" }}>
          <div className="crumbs" style={{ alignSelf: "flex-start" }}>
            <Link to="/w/alder-creek">Dashboard</Link>
            <span>›</span>
            <Link to="/w/alder-creek/applications/app_01HZX4">Applications</Link>
            <span>›</span>
            <span>Submitted</span>
          </div>
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: "760px",
              padding: "40px 44px",
              display: "flex",
              flexDirection: "column",
              gap: "22px",
              alignItems: "center",
              textAlign: "center",
              marginTop: "24px",
            }}
          >
            <span
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "#D9F5EC",
                color: "#0B5E47",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Check className="ic ic-xl" aria-hidden="true" />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
              <span className="chip">
                <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
              </span>
              <h1 style={{ fontSize: "26px" }}>Submitted to Riverbend Community Foundation</h1>
              <p style={{ color: "#4A5C5A" }}>Mobile Health Navigation for Rural Families · Community Health Grants 2027 · Full proposal</p>
            </div>
            <dl
              className="kv"
              style={{ gridTemplateColumns: "160px minmax(0, 1fr)", textAlign: "left", width: "100%", maxWidth: "520px", fontSize: "15px" }}
            >
              <dt>Submitted</dt>
              <dd>Apr 16, 2027 · 2:02 PM PT by Maria Santos</dd>
              <dt>Application id</dt>
              <dd>
                <span className="mono" style={{ fontSize: "14px" }}>
                  app_01HZX4
                </span>
              </dd>
              <dt>Requested</dt>
              <dd>$150,000</dd>
              <dt>Attached from Passport</dt>
              <dd className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                <span className="lvl lvl-3">
                  <Shield className="ic" aria-hidden="true" />
                  L3
                </span>
                <span>attestation · payee status (River City Credit Union •••• 4821)</span>
              </dd>
            </dl>
            <div style={{ width: "100%", maxWidth: "640px", display: "flex", flexDirection: "column", gap: "10px", textAlign: "left" }}>
              <span className="eyebrow">What happens next</span>
              <div className="stp" aria-label="Review stages">
                <div className="s done">
                  <span className="n">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  Submitted
                </div>
                <span className="ln done"></span>
                <div className="s on">
                  <span className="n">2</span>Screening
                </div>
                <span className="ln"></span>
                <div className="s">
                  <span className="n">3</span>Under review
                </div>
                <span className="ln"></span>
                <div className="s">
                  <span className="n">4</span>Decision by Jun 15
                </div>
              </div>
              <p className="small muted">
                Riverbend screens for eligibility first, then assigns reviewers. You’ll see each step and any message on the status page;
                you can withdraw until Apr 30.
              </p>
            </div>
            <div
              style={{
                width: "100%",
                maxWidth: "640px",
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "10px",
                textAlign: "left",
              }}
            >
              <Link to="/preview/pdf/application-snapshot" className="doc" style={{ textDecoration: "none", color: "inherit" }}>
                <span className="ft ft-pdf">PDF</span>
                <div className="grow">
                  <div className="nm">Application snapshot</div>
                  <div className="mt">Exactly what the funder received · sha256 c41d…9e02</div>
                </div>
                <Download className="ic" aria-hidden="true" />
              </Link>
              <Link
                to="/w/alder-creek/applications/app_01HZX4/submitted"
                className="doc"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span className="ft">JSON</span>
                <div className="grow">
                  <div className="nm">CommonGrants JSON</div>
                  <div className="mt">Open protocol record of this application</div>
                </div>
                <Download className="ic" aria-hidden="true" />
              </Link>
            </div>
            <div className="row" style={{ gap: "12px", marginTop: "6px", flexWrap: "wrap", justifyContent: "center" }}>
              <Link to="/w/alder-creek/applications/app_01HZX4" className="btn btn-primary btn-lg">
                View status
              </Link>
              <Link to="/w/alder-creek" className="btn btn-secondary btn-lg">
                Back to dashboard
              </Link>
            </div>
            <p className="notice" style={{ justifyContent: "center" }}>
              <Mail className="ic" aria-hidden="true" />
              An acknowledgment was sent to maria@aldercreekfs.example ·<Link to="/preview/email/acknowledgment">view</Link>
            </p>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
