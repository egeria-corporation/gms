// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, Calendar, Clock, Globe, Info, Landmark, RefreshCw, ShieldCheck } from "lucide-react";

export default function FunderPageCascade() {
  return (
    <>
      <title>{"Cascade County Health Department — Funder page"}</title>
      <div
        className="gms pub"
        style={
          {
            "--tenant": "#7A4F01",
            "--on-tenant": "#FFFFFF",
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
            background: "#FFFFFF",
          } as CSSProperties
        }
      >
        <header className="pub-hd">
          <div className="wrap-c">
            <div className="bar">
              <Link to="/f/cascade-county" className="lg" style={{ textDecoration: "none" }}>
                <span className="mark" aria-hidden="true">
                  CCHD
                </span>
                Cascade County Health Department
              </Link>
              <nav
                aria-label="Funder page"
                style={{ display: "flex", alignItems: "center", gap: "22px", fontSize: "14px", fontWeight: 700, flexWrap: "wrap" }}
              >
                <a href="#open">Open opportunities</a>
                <a href="#forecast">Forecasted</a>
                <a href="#past">Past awards</a>
                <a href="#contact">Contact</a>
                <Link
                  to="/signin"
                  className="btn btn-secondary"
                  style={{ background: "transparent", color: "var(--on-tenant)", borderColor: "rgba(255,255,255,.45)" }}
                >
                  Sign in
                </Link>
              </nav>
            </div>
            <div className="mission">
              <h1>Cascade County Health Department</h1>
              <p className="sub">Public health programs and partnerships for Cascade County residents.</p>
              <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: "14px", flexWrap: "wrap", marginTop: "4px" }}>
                <a href="#contact" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <Globe className="ic" aria-hidden="true" />
                  cascadecounty.example/health
                </a>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", opacity: ".9" }}>
                  <Landmark className="ic" aria-hidden="true" />
                  County government
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", opacity: ".9" }}>
                  <ShieldCheck className="ic" aria-hidden="true" />
                  Claimed in OpenGrants Passport
                </span>
              </div>
            </div>
          </div>
        </header>
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column" }}>
          <section id="open">
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: "16px",
                flexWrap: "wrap",
                marginBottom: "16px",
              }}
            >
              <div>
                <span className="eyebrow">Accepting applications</span>
                <h2 style={{ marginBottom: "0", marginTop: "6px" }}>Open Opportunities</h2>
              </div>
              <span className="muted" style={{ fontSize: "14px" }}>
                2 open · listed on OpenGrants
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "20px" }}>
              <article className="oc">
                <span className="bdg bdg-ok">
                  <Clock className="ic" aria-hidden="true" />
                  Closes in 29 days
                </span>
                <h3>Community Clinic Capacity Grants FY28</h3>
                <div className="amt">$75,000 – $250,000</div>
                <div className="meta">
                  <span>Closes May 15, 2027</span>
                  <span>·</span>
                  <span>4–6 awards</span>
                </div>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Staffing, equipment and facility improvements that add appointment capacity at safety-net clinics in the county.
                </p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span className="tag">FQHC</span>
                  <span className="tag">501(c)(3)</span>
                  <span className="tag">Rural health clinic</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "6px" }}>
                  <Link to="/f/riverbend/o/community-health-2027" className="btn btn-tenant">
                    Apply
                    <ArrowRight className="ic" aria-hidden="true" />
                  </Link>
                  <Link to="/f/riverbend/o/community-health-2027" style={{ fontSize: "14px", fontWeight: 700 }}>
                    Details
                  </Link>
                </div>
              </article>
              <article className="oc">
                <span className="bdg bdg-info">
                  <RefreshCw className="ic" aria-hidden="true" />
                  Rolling
                </span>
                <h3>Overdose Prevention Mini-Grants</h3>
                <div className="amt">Up to $15,000</div>
                <div className="meta">
                  <span>Reviewed twice monthly</span>
                  <span>·</span>
                  <span>Decision in 21 days</span>
                </div>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Naloxone distribution, peer outreach and training for community organizations and first responders.
                </p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span className="tag">501(c)(3)</span>
                  <span className="tag">Fire district</span>
                  <span className="tag">School district</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "6px" }}>
                  <Link to="/f/riverbend/o/community-health-2027" className="btn btn-tenant">
                    Apply
                    <ArrowRight className="ic" aria-hidden="true" />
                  </Link>
                  <Link to="/f/riverbend/o/community-health-2027" style={{ fontSize: "14px", fontWeight: 700 }}>
                    Details
                  </Link>
                </div>
              </article>
              <div
                className="card"
                style={{
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: "10px",
                  background: "#F7FAFA",
                  borderStyle: "dashed",
                }}
              >
                <div className="b" style={{ color: "#0D2A43" }}>
                  Looking for something else?
                </div>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Other county funding, including state pass-through programs, is listed on the OpenGrants index.
                </p>
                <Link to="/" style={{ fontSize: "14px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  Search the OpenGrants index
                  <ArrowRight className="ic" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
          <section id="forecast">
            <span className="eyebrow">Planned</span>
            <h2 style={{ marginTop: "6px" }}>Forecasted</h2>
            <div
              className="card"
              style={{
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "20px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <h3 style={{ fontSize: "18px" }}>Rural EMS Readiness</h3>
                  <span className="bdg bdg-neutral">
                    <Calendar className="ic" aria-hidden="true" />
                    Opens Aug 2027
                  </span>
                </div>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Equipment and training for volunteer EMS agencies serving unincorporated areas. Expected range $30,000 – $120,000.
                </p>
              </div>
              <form style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <label className="sr" htmlFor="notify-email">
                  Email for notification
                </label>
                <input
                  className="inp"
                  id="notify-email"
                  type="email"
                  placeholder="you@organization.example"
                  style={{ width: "260px", height: "40px" }}
                />
                <button className="btn btn-secondary" type="button">
                  Notify me
                </button>
              </form>
            </div>
          </section>
          <section id="past">
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: "16px",
                flexWrap: "wrap",
                marginBottom: "12px",
              }}
            >
              <div>
                <span className="eyebrow">Transparency</span>
                <h2 style={{ marginBottom: "0", marginTop: "6px" }}>Past Awards</h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "14px" }}>
                <span className="seg" role="group" aria-label="Fiscal year">
                  <button className="on" type="button">
                    FY27
                  </button>
                  <button type="button">FY26</button>
                </span>
                <a href="#past" style={{ fontWeight: 700 }}>
                  Download CSV
                </a>
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl" style={{ fontSize: "15px" }}>
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Recipient</th>
                    <th className="num">Amount</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>FY27</td>
                    <td className="b">Copper Valley Clinic</td>
                    <td className="num">$180,000</td>
                    <td style={{ whiteSpace: "normal" }}>Telehealth room build-out</td>
                  </tr>
                  <tr>
                    <td>FY27</td>
                    <td className="b">Blue Heron Conservation</td>
                    <td className="num">$42,000</td>
                    <td style={{ whiteSpace: "normal" }}>Well-water testing outreach</td>
                  </tr>
                  <tr>
                    <td>FY27</td>
                    <td className="b">Granite Peak Youth Sports</td>
                    <td className="num">$12,500</td>
                    <td style={{ whiteSpace: "normal" }}>Concussion safety clinics</td>
                  </tr>
                  <tr>
                    <td>FY27</td>
                    <td className="b">Sunrise Recovery Network</td>
                    <td className="num">$15,000</td>
                    <td style={{ whiteSpace: "normal" }}>Peer naloxone distribution</td>
                  </tr>
                </tbody>
              </table>
              <div
                style={{
                  padding: "10px 16px",
                  borderTop: "1px solid #D6DEDE",
                  fontSize: "13px",
                  color: "#4A5C5A",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Info className="ic" aria-hidden="true" />
                Shown because Cascade County enabled transparency. 4 awards · $249,500 in FY27.
              </div>
            </div>
          </section>
          <section id="contact">
            <span className="eyebrow">Contact</span>
            <h2 style={{ marginTop: "6px" }}>Questions About Applying</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "20px" }}>
              <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="b" style={{ color: "#0D2A43" }}>
                  Program questions
                </div>
                <div style={{ fontSize: "15px" }}>Grants Unit, Public Health Division</div>
                <a href="#contact" style={{ fontSize: "15px" }}>
                  grants@cascadecounty.example
                </a>
              </div>
              <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="b" style={{ color: "#0D2A43" }}>
                  Contracts and payments
                </div>
                <div style={{ fontSize: "15px" }}>County Auditor's Office</div>
                <a href="#contact" style={{ fontSize: "15px" }}>
                  ap@cascadecounty.example
                </a>
              </div>
              <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="b" style={{ color: "#0D2A43" }}>
                  Public records
                </div>
                <div style={{ fontSize: "15px" }}>Award data is published quarterly</div>
                <a href="#past" style={{ fontSize: "15px" }}>
                  Request a record
                </a>
              </div>
            </div>
          </section>
          <section aria-label="Theming note">
            <div className="bnr bnr-neu" style={{ alignItems: "center" }}>
              <Info className="ic" aria-hidden="true" />
              <div>
                <div className="t">Same system, second tenant</div>
                <div className="d">
                  Only the header and the primary Apply button carry Cascade County's accent. Badges, tags, tables, cards and the footer are
                  identical to Riverbend's page, so the product stays recognizable across funders.
                </div>
              </div>
            </div>
          </section>
        </div>
        <footer className="pub-foot" style={{ marginTop: "auto" }}>
          <div className="wrap-c">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
              <span>Powered by OpenGrants GMS</span>
            </div>
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <Link to="/f/riverbend/o/community-health-2027">CommonGrants JSON</Link>
              <Link to="/">About OpenGrants GMS</Link>
              <a href="#contact">Accessibility</a>
              <a href="#contact">Privacy</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
