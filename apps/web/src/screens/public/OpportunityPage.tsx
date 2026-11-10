// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  Award,
  BadgeCheck,
  Calendar,
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  CodeXml,
  DollarSign,
  Info,
  MapPin,
  ShieldCheck,
  Upload,
} from "lucide-react";

export default function OpportunityPage() {
  return (
    <>
      <title>{"Community Health Grants 2027 — Opportunity"}</title>
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
                <Link to="/f/riverbend">All opportunities</Link>
                <Link to="/f/riverbend">Past awards</Link>
                <Link to="/f/riverbend">Contact</Link>
                <Link
                  to="/signin"
                  className="btn btn-secondary"
                  style={{ background: "transparent", color: "var(--on-tenant)", borderColor: "rgba(255,255,255,.45)" }}
                >
                  Sign in
                </Link>
              </nav>
            </div>
          </div>
        </header>
        <div className="sticky-cta">
          <div
            className="wrap-c"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <h1 style={{ fontSize: "24px" }}>Community Health Grants 2027</h1>
                <span className="bdg bdg-ok">
                  <Clock className="ic" aria-hidden="true" />
                  Open · LOI closes in 14 days
                </span>
              </div>
              <div className="muted" style={{ fontSize: "14px" }}>
                Program: Community Health 2027 · Opportunity id <span className="mono">opp_01HV7R</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <Link to="/f/riverbend/o/community-health-2027" className="btn btn-secondary">
                <CodeXml className="ic" aria-hidden="true" />
                View as CommonGrants JSON
              </Link>
              <Link to="/signin" className="btn btn-tenant btn-lg">
                <ShieldCheck className="ic" aria-hidden="true" />
                Apply with Passport
              </Link>
            </div>
          </div>
        </div>
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column" }}>
          <section style={{ paddingTop: "32px" }}>
            <div className="band">
              <div>
                <div className="k">Funding range</div>
                <div className="v">$50,000 – $150,000</div>
              </div>
              <div>
                <div className="k">Estimated awards</div>
                <div className="v">8 – 12</div>
              </div>
              <div>
                <div className="k">Opens · LOI closes</div>
                <div className="v" style={{ fontSize: "17px" }}>
                  Jan 15 · Feb 28, 2027
                </div>
              </div>
              <div>
                <div className="k">Decision by</div>
                <div className="v" style={{ fontSize: "17px" }}>
                  Jun 15, 2027
                </div>
              </div>
              <div>
                <div className="k">Grant period</div>
                <div className="v" style={{ fontSize: "17px" }}>
                  Jul 1, 2027 – Jun 30, 2028
                </div>
              </div>
            </div>
            <p style={{ maxWidth: "720px", marginTop: "24px", fontSize: "17px" }}>
              Community Health Grants fund direct-service projects that improve access to primary and preventive care for families in the
              Riverbend valley. Priority goes to projects that reduce travel barriers, extend clinic hours, or connect families to care they
              are already eligible for.
            </p>
          </section>
          <section>
            <span className="eyebrow">Generated from this opportunity's rules</span>
            <h2 style={{ marginTop: "6px" }}>Who Can Apply</h2>
            <ul className="elig">
              <li>
                <ShieldCheck className="ic" aria-hidden="true" />
                <div>
                  <b>Your organization is a 501(c)(3) in good standing</b>, a federally recognized tribe, or a local government.
                </div>
              </li>
              <li>
                <MapPin className="ic" aria-hidden="true" />
                <div>
                  <b>You serve residents of Riverbend County.</b> Projects may be based elsewhere if the people served live in the county.
                </div>
              </li>
              <li>
                <DollarSign className="ic" aria-hidden="true" />
                <div>
                  <b>Your annual operating budget is under $5,000,000</b> in the most recently completed fiscal year.
                </div>
              </li>
              <li>
                <Award className="ic" aria-hidden="true" />
                <div>
                  <b>You do not hold a current Riverbend award in the Community Health program.</b> Past grantees whose awards are completed
                  may apply.
                </div>
              </li>
              <li>
                <Calendar className="ic" aria-hidden="true" />
                <div>
                  <b>Your project starts on or after July 1, 2027</b> and finishes within the 12-month grant period.
                </div>
              </li>
              <li style={{ background: "#F7FAFA" }}>
                <Info className="ic" aria-hidden="true" />
                <div>
                  When you apply with Passport, each rule is checked against your record and shown as Pass, Fail, or Unknown before you
                  start writing.
                </div>
              </li>
            </ul>
          </section>
          <section>
            <span className="eyebrow">Two stages, one interview</span>
            <h2 style={{ marginTop: "6px" }}>How the Competition Runs</h2>
            <div className="card" style={{ padding: "24px 28px" }}>
              <div className="stp" aria-label="Stages">
                <div className="s done">
                  <span className="n">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  <div>
                    <div>LOI</div>
                    <div className="muted" style={{ fontWeight: 400, fontSize: "12px" }}>
                      Jan 15 – Feb 28
                    </div>
                  </div>
                </div>
                <span className="ln done"></span>
                <div className="s on">
                  <span className="n">2</span>
                  <div>
                    <div>Full proposal</div>
                    <div className="muted" style={{ fontWeight: 400, fontSize: "12px" }}>
                      Mar 15 – Apr 30
                    </div>
                  </div>
                </div>
                <span className="ln"></span>
                <div className="s">
                  <span className="n">3</span>
                  <div>
                    <div>Interview</div>
                    <div className="muted" style={{ fontWeight: 400, fontSize: "12px" }}>
                      May 2027
                    </div>
                  </div>
                </div>
                <span className="ln"></span>
                <div className="s">
                  <span className="n">4</span>
                  <div>
                    <div>Decision</div>
                    <div className="muted" style={{ fontWeight: 400, fontSize: "12px" }}>
                      By Jun 15
                    </div>
                  </div>
                </div>
              </div>
              <p style={{ marginTop: "18px", fontSize: "15px", color: "#4A5C5A" }}>
                Letters of intent are screened for eligibility and fit; selected applicants are invited to the full proposal. Finalists are
                interviewed in May. Every applicant receives a decision letter by June 15, 2027.
              </p>
            </div>
          </section>
          <section>
            <span className="eyebrow">Prepare ahead</span>
            <h2 style={{ marginTop: "6px" }}>What You'll Need</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
              <div className="card">
                <div className="card-h">
                  <h3 style={{ fontSize: "16px" }}>Forms</h3>
                  <span className="muted small">Preview as applicant</span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span
                      className="doc-ft ft"
                      style={{
                        width: "36px",
                        height: "40px",
                        borderRadius: "6px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "10px",
                        fontWeight: 800,
                        background: "#EEF3F3",
                        color: "#4A5C5A",
                        border: "1px solid #D6DEDE",
                        flex: "none",
                      }}
                    >
                      LOI
                    </span>
                    <div>
                      <div className="b" style={{ color: "#0D2A43" }}>
                        LOI form{" "}
                        <span className="muted" style={{ fontWeight: 400 }}>
                          · v1
                        </span>
                      </div>
                      <div style={{ fontSize: "14px", color: "#4A5C5A" }}>
                        6 questions. Organization details are{" "}
                        <span className="prov prov-passport">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          pre-filled from Passport
                        </span>
                        . About 30 minutes.
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span
                      className="ft"
                      style={{
                        width: "36px",
                        height: "40px",
                        borderRadius: "6px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "10px",
                        fontWeight: 800,
                        background: "#EEF3F3",
                        color: "#4A5C5A",
                        border: "1px solid #D6DEDE",
                        flex: "none",
                      }}
                    >
                      FULL
                    </span>
                    <div>
                      <div className="b" style={{ color: "#0D2A43" }}>
                        Full proposal form{" "}
                        <span className="muted" style={{ fontWeight: 400 }}>
                          · v2
                        </span>
                      </div>
                      <div style={{ fontSize: "14px", color: "#4A5C5A" }}>
                        8 sections including a budget table (proposed by category, 10% indirect cap) and key staff. Team members and
                        consultants can be assigned sections.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3 style={{ fontSize: "16px" }}>Documents</h3>
                  <span className="muted small">3 required</span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">IRS determination letter</div>
                      <div className="mt">
                        <span className="prov prov-passport">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          Pre-filled from Passport locker
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="doc">
                    <span className="ft ft-xls">XLS</span>
                    <div className="grow">
                      <div className="nm">Most recent audited financials</div>
                      <div className="mt">
                        <span className="prov prov-passport">
                          <BadgeCheck className="ic" aria-hidden="true" />
                          Pre-filled from Passport locker
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="doc">
                    <span className="ft ft-pdf">PDF</span>
                    <div className="grow">
                      <div className="nm">Letters of support</div>
                      <div className="mt">
                        <span className="prov prov-entered">
                          <Upload className="ic" aria-hidden="true" />
                          Upload
                        </span>
                        <span>· at least one from a partner clinic</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section>
            <span className="eyebrow">Common questions</span>
            <h2 style={{ marginTop: "6px" }}>FAQ</h2>
            <details open>
              <summary>
                Can we apply if we were funded by Riverbend in another program? <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>
                Yes. The restriction applies only to a current award in the Community Health program. Awards in Housing Stability or the
                Rapid Response Fund do not affect eligibility.
              </p>
            </details>
            <details>
              <summary>
                What does "Apply with Passport" mean? <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>
                Your organization's record in OpenGrants Passport pre-fills the application and attaches your verification level. You grant
                Riverbend read access to your profile; you can revoke it at any time from your workspace.
              </p>
            </details>
            <details>
              <summary>
                Can a consultant help us write the proposal? <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>
                Yes. From Team & access you can invite a consultant to specific applications with an expiry date. Submission always requires
                a person from your organization.
              </p>
            </details>
            <details>
              <summary>
                How are payments made? <ChevronDown className="ic" aria-hidden="true" />
              </summary>
              <p>
                Awards are paid in scheduled tranches to the destination your organization has verified in Passport. Riverbend never
                collects bank details directly; payment readiness is checked before each release.
              </p>
            </details>
          </section>
          <section aria-label="States">
            <span className="eyebrow">States</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", marginTop: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="small muted b">Forecasted</span>
                <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: "18px" }}>Community Health Grants 2027</h3>
                    <span className="bdg bdg-neutral">
                      <Calendar className="ic" aria-hidden="true" />
                      Forecasted · opens Jan 15, 2027
                    </span>
                  </div>
                  <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
                    Details below may change before the opportunity opens. We will email you when applications are accepted.
                  </p>
                  <form style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <label className="sr" htmlFor="forecast-email">
                      Email for notification
                    </label>
                    <input
                      className="inp"
                      id="forecast-email"
                      type="email"
                      placeholder="you@organization.example"
                      style={{ width: "240px", height: "40px" }}
                    />
                    <button className="btn btn-tenant" type="button">
                      Notify me
                    </button>
                  </form>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="small muted b">Closed · results published</span>
                <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: "18px" }}>Community Health Grants 2027</h3>
                    <span className="bdg bdg-done">
                      <CircleCheck className="ic" aria-hidden="true" />
                      Closed · decided Jun 12, 2027
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
                    <div>
                      <div
                        className="k"
                        style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#4A5C5A" }}
                      >
                        Awards
                      </div>
                      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "22px", color: "#0D2A43" }}>9</div>
                    </div>
                    <div>
                      <div
                        className="k"
                        style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#4A5C5A" }}
                      >
                        Committed
                      </div>
                      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "22px", color: "#0D2A43" }}>$720,000</div>
                    </div>
                    <div>
                      <div
                        className="k"
                        style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#4A5C5A" }}
                      >
                        Applications
                      </div>
                      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "22px", color: "#0D2A43" }}>61</div>
                    </div>
                  </div>
                  <Link
                    to="/f/riverbend"
                    style={{ fontSize: "14px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    See the awards
                    <ArrowRight className="ic" aria-hidden="true" />
                  </Link>
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
              <Link to="/f/riverbend">Accessibility</Link>
              <Link to="/f/riverbend">Privacy</Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
