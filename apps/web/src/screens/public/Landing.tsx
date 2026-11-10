// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { ArrowRight, Bot, Check, Download, ExternalLink, FileText, Landmark, ShieldCheck } from "lucide-react";

export default function Landing() {
  return (
    <>
      <title>{"OpenGrants GMS — Landing"}</title>
      <div className="gms pub" style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#FFFFFF" }}>
        <header style={{ borderBottom: "1px solid #D6DEDE", background: "#FFFFFF" }}>
          <div
            className="wrap-c"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "24px",
              height: "64px",
              flexWrap: "wrap",
            }}
          >
            <Link
              to="/"
              className="logo"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                textDecoration: "none",
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                color: "#0D2A43",
                fontSize: "16px",
              }}
            >
              <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" style={{ height: "22px", width: "auto", display: "block" }} />
              <span style={{ color: "#145450", fontWeight: 500 }}>GMS</span>
            </Link>
            <nav
              aria-label="Primary"
              style={{ display: "flex", alignItems: "center", gap: "24px", fontSize: "14px", fontWeight: 700, flexWrap: "wrap" }}
            >
              <a href="#how" style={{ color: "#1E2D2B" }}>
                How it works
              </a>
              <a href="#fund" style={{ color: "#1E2D2B" }}>
                For funders
              </a>
              <a href="#apply" style={{ color: "#1E2D2B" }}>
                For applicants
              </a>
              <a href="#agents" style={{ color: "#1E2D2B" }}>
                For agents
              </a>
              <a href="#selfhost" style={{ color: "#1E2D2B" }}>
                Self-host
              </a>
              <Link to="/signin" className="btn btn-secondary">
                Sign in
              </Link>
            </nav>
          </div>
        </header>
        <section style={{ background: "var(--grad-hero)", padding: "64px 0 56px" }}>
          <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <span className="og-eyebrow">
              <ShieldCheck className="ic" aria-hidden="true" />
              Free Grants Management
            </span>
            <h1 style={{ fontSize: "48px", maxWidth: "760px", color: "#0D2A43" }}>Grants Management for Funders and Applicants</h1>
            <p style={{ fontSize: "19px", maxWidth: "680px", color: "#1E2D2B", lineHeight: 1.6 }}>
              One system for the whole grant. Funders design opportunities and forms, run reviews, decide, issue awards, pay through
              OpenGrants Passport and track reporting. Applicants apply from a record they keep once, report once, and get paid to a
              destination they have verified.
            </p>
            <div className="og-accent" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "20px",
                marginTop: "16px",
                maxWidth: "960px",
              }}
            >
              <div
                className="card"
                id="fund"
                style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "12px", background: "#FFFFFF" }}
              >
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "10px",
                    background: "#E1F8F6",
                    color: "#145450",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Landmark className="ic ic-md" aria-hidden="true" />
                </div>
                <h2 style={{ fontSize: "22px" }}>I fund</h2>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Publish opportunities on your own branded page, build application and report forms, assign reviewers, decide in a panel,
                  and release payments only when a readiness check passes.
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "6px", flexWrap: "wrap" }}>
                  <Link to="/onboarding/funder" className="btn btn-cta">
                    Create a funder workspace
                    <ArrowRight className="ic" aria-hidden="true" />
                  </Link>
                  <Link to="/f/riverbend" style={{ fontSize: "14px", fontWeight: 700 }}>
                    See an example funder page
                  </Link>
                </div>
              </div>
              <div
                className="card"
                id="apply"
                style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "12px", background: "#FFFFFF" }}
              >
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "10px",
                    background: "#D2E1F9",
                    color: "#1E4F8F",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <FileText className="ic ic-md" aria-hidden="true" />
                </div>
                <h2 style={{ fontSize: "22px" }}>I apply</h2>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Start from your Passport record: organization details, documents and payee status arrive pre-filled. Work on applications
                  with your team, track every status, and report once.
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "6px", flexWrap: "wrap" }}>
                  <Link to="/signin" className="btn btn-primary">
                    Continue with Passport
                    <ArrowRight className="ic" aria-hidden="true" />
                  </Link>
                  <Link to="/w/alder-creek/find" style={{ fontSize: "14px", fontWeight: 700 }}>
                    Find funding
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section id="how" style={{ padding: "48px 0" }}>
          <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "1px",
                background: "#D6DEDE",
                border: "1px solid #D6DEDE",
                borderRadius: "12px",
                overflow: "hidden",
              }}
            >
              <div style={{ background: "#FFFFFF", padding: "22px 24px" }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "28px", color: "var(--og-teal-dark)" }}>$0</div>
                <div style={{ fontSize: "14px", color: "#4A5C5A" }}>for funders, every plan</div>
              </div>
              <div style={{ background: "#FFFFFF", padding: "22px 24px" }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "28px", color: "#4A86E8" }}>$0</div>
                <div style={{ fontSize: "14px", color: "#4A5C5A" }}>for applicants, always</div>
              </div>
              <div style={{ background: "#FFFFFF", padding: "22px 24px" }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "28px", color: "#2470B3" }}>1 record</div>
                <div style={{ fontSize: "14px", color: "#4A5C5A" }}>Passport, entered once</div>
              </div>
              <div style={{ background: "#FFFFFF", padding: "22px 24px" }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "28px", color: "#145450" }}>Open</div>
                <div style={{ fontSize: "14px", color: "#4A5C5A" }}>CommonGrants protocol</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "20px" }}>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <span className="eyebrow">Passport</span>
                <h3 style={{ fontSize: "18px" }}>One Record, Read With Consent</h3>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  An organization keeps its profile, documents and representatives in OpenGrants Passport. A funder reads it only with the
                  organization's consent, and every imported value shows where it came from.
                </p>
              </div>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <span className="eyebrow">Verified payee</span>
                <h3 style={{ fontSize: "18px" }}>Paid To a Verified Destination</h3>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Payments go to a destination the organization verified in Passport. Changes cool off before they take effect, holds are
                  explicit, and the GMS never edits bank details.
                </p>
              </div>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <span className="eyebrow">CommonGrants</span>
                <h3 style={{ fontSize: "18px" }}>An Open Protocol Underneath</h3>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Opportunities, applications and awards are readable as CommonGrants JSON. Export anything, index opportunities on
                  OpenGrants, and move data between systems without a vendor in the way.
                </p>
              </div>
            </div>
            <div
              className="card"
              style={{
                padding: "24px 28px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "24px",
                flexWrap: "wrap",
                background: "#F7FAFA",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "720px" }}>
                <h3 style={{ fontSize: "18px" }}>Free for Both Sides</h3>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  OpenGrants GMS is free for funders and free for applicants. Use it hosted at gms.opengrants.io or run it yourself.
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
                <a
                  href="#selfhost"
                  id="selfhost"
                  style={{ fontSize: "14px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <Download className="ic" aria-hidden="true" />
                  Self-host
                </a>
                <Link
                  to="/agents"
                  id="agents"
                  style={{ fontSize: "14px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <Bot className="ic" aria-hidden="true" />
                  For agents (MCP)
                </Link>
                <Link
                  to="/f/riverbend/o/community-health-2027"
                  style={{ fontSize: "14px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <ExternalLink className="ic" aria-hidden="true" />
                  View a live opportunity
                </Link>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <h3 style={{ fontSize: "16px" }}>What a funder gets</h3>
                <ul style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px", color: "#1E2D2B" }}>
                  <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#145450", marginTop: "3px" }} />A branded public page and
                    opportunity listings, indexed on OpenGrants
                  </li>
                  <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#145450", marginTop: "3px" }} />
                    Form builder with Passport prefill, eligibility rules in plain language, multi-stage competitions
                  </li>
                  <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#145450", marginTop: "3px" }} />
                    Reviewer assignment, scoring, panel allocation and decision letters
                  </li>
                  <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#145450", marginTop: "3px" }} />
                    Agreements, scheduled tranches, readiness checks, reconciliation and reporting
                  </li>
                </ul>
              </div>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <h3 style={{ fontSize: "16px" }}>What an applicant gets</h3>
                <ul style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px", color: "#1E2D2B" }}>
                  <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#1E4F8F", marginTop: "3px" }} />
                    Applications pre-filled from Passport, with every sourced value marked
                  </li>
                  <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#1E4F8F", marginTop: "3px" }} />
                    Shared editing with teammates and consultants, an answer library, section assignments
                  </li>
                  <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#1E4F8F", marginTop: "3px" }} />
                    One status view across funders, a shared message thread, revision diffs
                  </li>
                  <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#1E4F8F", marginTop: "3px" }} />
                    Report once and share it with another funder; payments to your verified destination
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
        <footer className="pub-foot" style={{ marginTop: "auto" }}>
          <div className="wrap-c">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
              <span>OpenGrants GMS · gms.opengrants.io</span>
            </div>
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <a href="#how">Docs</a>
              <a href="#how">CommonGrants spec</a>
              <a href="#selfhost">Source</a>
              <a href="#how">Privacy</a>
              <a href="#how">Status</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
