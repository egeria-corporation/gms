// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, Calendar, Clock, EyeOff, Globe, Info, MapPin, RefreshCw, ShieldCheck } from "lucide-react";

export default function FunderPageRiverbend() {
  return (
    <>
      <title>{"Riverbend Community Foundation — Funder page"}</title>
      <div
        className="gms pub"
        style={
          {
            "--tenant": "#1F6F8B",
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
              <Link to="/f/riverbend" className="lg" style={{ textDecoration: "none" }}>
                <span className="mark" aria-hidden="true">
                  RCF
                </span>
                Riverbend Community Foundation
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
              <h1>Riverbend Community Foundation</h1>
              <p className="sub">Funding health, housing and opportunity across the Riverbend valley since 1984.</p>
              <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: "14px", flexWrap: "wrap", marginTop: "4px" }}>
                <a href="#contact" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <Globe className="ic" aria-hidden="true" />
                  riverbendcf.example
                </a>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", opacity: ".9" }}>
                  <MapPin className="ic" aria-hidden="true" />
                  Riverbend County
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
                3 open · listed on OpenGrants
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "20px" }}>
              <article className="oc">
                <span className="bdg bdg-ok">
                  <Clock className="ic" aria-hidden="true" />
                  Closes in 14 days
                </span>
                <h3>Community Health Grants 2027</h3>
                <div className="amt">$50,000 – $150,000</div>
                <div className="meta">
                  <span>LOI closes Feb 28, 2027</span>
                  <span>·</span>
                  <span>8–12 awards</span>
                </div>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Direct-service projects that improve access to primary and preventive care for families in the valley.
                </p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span className="tag">501(c)(3)</span>
                  <span className="tag">Tribal</span>
                  <span className="tag">Local government</span>
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
                <span className="bdg bdg-ok">
                  <Clock className="ic" aria-hidden="true" />
                  Closes in 41 days
                </span>
                <h3>Housing Stability Grants 2027</h3>
                <div className="amt">$25,000 – $100,000</div>
                <div className="meta">
                  <span>Closes May 27, 2027</span>
                  <span>·</span>
                  <span>6–10 awards</span>
                </div>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Eviction prevention, rapid rehousing and tenant services for households at risk of losing housing.
                </p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span className="tag">501(c)(3)</span>
                  <span className="tag">Housing authority</span>
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
                <h3>Rapid Response Fund</h3>
                <div className="amt">Up to $10,000</div>
                <div className="meta">
                  <span>Reviewed monthly</span>
                  <span>·</span>
                  <span>Decision in 30 days</span>
                </div>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Small, fast grants for urgent community needs that cannot wait for a scheduled cycle.
                </p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span className="tag">501(c)(3)</span>
                  <span className="tag">Fiscally sponsored</span>
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
                  <h3 style={{ fontSize: "18px" }}>Youth Opportunity 2028</h3>
                  <span className="bdg bdg-neutral">
                    <Calendar className="ic" aria-hidden="true" />
                    Opens Sep 2027
                  </span>
                </div>
                <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                  Out-of-school programs for ages 12–18. Expected range $20,000 – $60,000. Details are published when the opportunity opens.
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
                <span className="seg" role="group" aria-label="Year">
                  <button className="on" type="button">
                    2026
                  </button>
                  <button type="button">2025</button>
                  <button type="button">2024</button>
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
                    <td>2026</td>
                    <td className="b">Harbor Light Shelter</td>
                    <td className="num">$95,000</td>
                    <td style={{ whiteSpace: "normal" }}>Shelter health clinic hours</td>
                  </tr>
                  <tr>
                    <td>2026</td>
                    <td className="b">Elm Street Health Alliance</td>
                    <td className="num">$120,000</td>
                    <td style={{ whiteSpace: "normal" }}>Community paramedicine pilot</td>
                  </tr>
                  <tr>
                    <td>2026</td>
                    <td className="b">Fernwood Early Learning</td>
                    <td className="num">$48,000</td>
                    <td style={{ whiteSpace: "normal" }}>Developmental screening for preschoolers</td>
                  </tr>
                  <tr>
                    <td>2026</td>
                    <td className="b">Oakmont Veterans Outreach</td>
                    <td className="num">$60,000</td>
                    <td style={{ whiteSpace: "normal" }}>Transportation to VA appointments</td>
                  </tr>
                  <tr>
                    <td>2026</td>
                    <td className="b">Stonebridge Community Kitchen</td>
                    <td className="num">$35,000</td>
                    <td style={{ whiteSpace: "normal" }}>Medically tailored meals</td>
                  </tr>
                  <tr>
                    <td>2026</td>
                    <td className="b">Maple Grove Tenant Union</td>
                    <td className="num">$25,000</td>
                    <td style={{ whiteSpace: "normal" }}>Healthy homes inspections</td>
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
                Shown because Riverbend enabled transparency for this program. 6 awards · $383,000 in 2026.
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
                <div style={{ fontSize: "15px" }}>Dana Ortiz, Program Officer</div>
                <a href="#contact" style={{ fontSize: "15px" }}>
                  grants@riverbendcf.example
                </a>
              </div>
              <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="b" style={{ color: "#0D2A43" }}>
                  Payments and reporting
                </div>
                <div style={{ fontSize: "15px" }}>Marcus Lee, Finance</div>
                <a href="#contact" style={{ fontSize: "15px" }}>
                  finance@riverbendcf.example
                </a>
              </div>
              <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="b" style={{ color: "#0D2A43" }}>
                  Office hours
                </div>
                <div style={{ fontSize: "15px" }}>Thursdays 10:00–11:00 PT during open cycles</div>
                <a href="#contact" style={{ fontSize: "15px" }}>
                  Reserve a slot
                </a>
              </div>
            </div>
          </section>
          <section aria-label="States">
            <span className="eyebrow">States</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", marginTop: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="small muted b">No open opportunities</span>
                <div className="card empty" style={{ minHeight: "200px", justifyContent: "center" }}>
                  <Calendar className="ic" aria-hidden="true" />
                  <h3>No opportunities are open right now</h3>
                  <p>Riverbend's next cycle, Youth Opportunity 2028, is forecasted to open in September 2027.</p>
                  <div className="acts">
                    <a href="#forecast" className="btn btn-tenant">
                      Notify me when it opens
                    </a>
                    <a href="#past" className="small b">
                      See past awards
                    </a>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="small muted b">Transparency section hidden</span>
                <div
                  className="card"
                  style={{
                    minHeight: "200px",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: "10px",
                    background: "#F7FAFA",
                  }}
                >
                  <div className="b" style={{ color: "#0D2A43", display: "flex", alignItems: "center", gap: "8px" }}>
                    <EyeOff className="ic" aria-hidden="true" />
                    Past awards not shown
                  </div>
                  <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                    When the funder turns transparency off in Settings › Branding, the Past awards section and its nav link are removed from
                    the public page. Nothing else changes; the opportunity data stays available as CommonGrants JSON.
                  </p>
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
