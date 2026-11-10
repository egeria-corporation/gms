// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Check, CircleQuestionMark, Clock, RefreshCw, TriangleExclamationPoint, Upload } from "lucide-react";

export default function FunderOnboarding() {
  return (
    <>
      <title>{"Funder onboarding — Brand"}</title>
      <div className="gms" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header className="topbar">
          <Link to="/" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <span className="muted small" style={{ marginLeft: "8px" }}>
            Set up your funder workspace
          </span>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            <button className="iconbtn" aria-label="Help">
              <CircleQuestionMark className="ic ic-md" aria-hidden="true" />
            </button>
            <Link to="/account/agents" className="av" aria-label="Account: Dana Ortiz">
              DO
            </Link>
          </div>
        </header>
        <main style={{ flex: "1 1 auto", padding: "32px 40px 48px", display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="ph">
            <div>
              <div className="crumbs">
                <Link to="/">OpenGrants GMS</Link>
                <span>›</span>
                <span>Funder onboarding</span>
                <span>›</span>
                <span>Brand</span>
              </div>
              <h1 style={{ marginTop: "6px" }}>Brand your public page</h1>
              <div className="meta">
                <span>Step 2 of 6</span>
                <span>·</span>
                <span>
                  Your accent appears only on the public page header, primary buttons, letters and emails. Everything inside the workspace
                  stays OpenGrants-neutral.
                </span>
              </div>
            </div>
            <div className="actions">
              <Link to="/w/riverbend" className="btn btn-ghost">
                Save and finish later
              </Link>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr) 460px", gap: "24px", alignItems: "start" }}>
            <aside className="card" style={{ padding: "20px" }}>
              <div className="eyebrow" style={{ marginBottom: "14px" }}>
                Setup steps
              </div>
              <div className="stp-v">
                <div className="s done">
                  <span className="n">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="t">Claim in Passport</div>
                    <div className="d">Riverbend Community Foundation claimed · verified Apr 2, 2027</div>
                    <div className="notice" style={{ marginTop: "6px", color: "#7A4A00" }}>
                      <Clock className="ic ic-sm" aria-hidden="true" />
                      Alt state: “Passport claim pending” — you can continue, publishing waits for the claim.
                    </div>
                  </div>
                </div>
                <div className="s on">
                  <span className="n">2</span>
                  <div>
                    <div className="t">Brand</div>
                    <div className="d">Logo, accent color, handle, mission line</div>
                  </div>
                </div>
                <div className="s">
                  <span className="n">3</span>
                  <div>
                    <div className="t">Team</div>
                    <div className="d">Invite program officers, finance, reviewers</div>
                  </div>
                </div>
                <div className="s">
                  <span className="n">4</span>
                  <div>
                    <div className="t">Payments</div>
                    <div className="d">
                      Connect OpenGrants Passport to release tranches from here. Or skip: “I pay from my own bank” — you record each
                      external payment against its tranche and the GMS keeps the schedule and readiness checks.
                    </div>
                  </div>
                </div>
                <div className="s">
                  <span className="n">5</span>
                  <div>
                    <div className="t">Import</div>
                    <div className="d">Optional CSV of past awards and grantees</div>
                  </div>
                </div>
                <div className="s">
                  <span className="n">6</span>
                  <div>
                    <div className="t">First program</div>
                    <div className="d">Name, fiscal year, budget</div>
                  </div>
                </div>
              </div>
            </aside>
            <section className="card">
              <div className="card-h">
                <h3>Brand</h3>
                <span className="muted small">Saved automatically</span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div className="fld">
                  <span className="lbl">Logo</span>
                  <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                    <div
                      style={{
                        width: "96px",
                        height: "96px",
                        border: "1px dashed #B9C6C6",
                        borderRadius: "10px",
                        background: "#F7FAFA",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        color: "#4A5C5A",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                    >
                      <Upload className="ic ic-md" aria-hidden="true" />
                      Upload
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }}>
                        <Upload className="ic" aria-hidden="true" />
                        Choose file
                      </button>
                      <span className="help">
                        SVG or PNG with transparency, at least 240 px wide. Until you upload one, your initials show in a tile.
                      </span>
                    </div>
                  </div>
                </div>
                <div className="fld-row">
                  <div className="fld">
                    <label className="lbl" htmlFor="accent">
                      Accent color
                    </label>
                    <div className="row" style={{ gap: "10px" }}>
                      <span
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "6px",
                          background: "#1F6F8B",
                          border: "1px solid #D6DEDE",
                          flex: "none",
                        }}
                        aria-hidden="true"
                      ></span>
                      <input className="inp mono" id="accent" defaultValue="#1F6F8B" style={{ fontSize: "14px" }} />
                    </div>
                    <span className="help">
                      Used for the public header, primary CTA, letter and email headers, and a 4 px stripe in your workspace nav.
                    </span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="onaccent">
                      Text on accent
                    </label>
                    <div className="row" style={{ gap: "10px" }}>
                      <span
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "6px",
                          background: "#FFFFFF",
                          border: "1px solid #D6DEDE",
                          flex: "none",
                        }}
                        aria-hidden="true"
                      ></span>
                      <input className="inp mono" id="onaccent" defaultValue="#FFFFFF" style={{ fontSize: "14px" }} />
                    </div>
                    <span className="help row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                      <Check className="ic ic-sm" aria-hidden="true" />
                      Contrast 5.9:1 — passes WCAG AA
                    </span>
                  </div>
                </div>
                <div className="bnr bnr-warn" role="status">
                  <TriangleExclamationPoint className="ic" aria-hidden="true" />
                  <div>
                    <div className="t">State: contrast failure</div>
                    <div className="d">Contrast 2.9:1 — text on accent fails WCAG AA. Try #FFFFFF on #1F6F8B (5.9:1).</div>
                    <div className="clears">
                      <ArrowRight className="ic ic-sm" aria-hidden="true" />
                      Continue stays disabled until the pair reaches 4.5:1.
                    </div>
                  </div>
                  <button className="btn btn-sm btn-secondary act">Use suggested pair</button>
                </div>
                <div className="fld">
                  <label className="lbl" htmlFor="handle">
                    Handle
                  </label>
                  <div className="row" style={{ gap: "0" }}>
                    <span
                      className="mono"
                      style={{
                        height: "36px",
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "0 10px",
                        background: "#EEF3F3",
                        border: "1px solid #D6DEDE",
                        borderRight: "0",
                        borderRadius: "6px 0 0 6px",
                        color: "#4A5C5A",
                      }}
                    >
                      gms.opengrants.io/f/
                    </span>
                    <input
                      className="inp mono"
                      id="handle"
                      defaultValue="riverbend"
                      style={{ borderRadius: "0 6px 6px 0", fontSize: "14px" }}
                    />
                  </div>
                  <span className="help row" style={{ gap: "5px" }}>
                    <Check className="ic ic-sm" aria-hidden="true" style={{ color: "#0B5E47" }} />
                    Available · your public page will be<span className="mono">gms.opengrants.io/f/riverbend</span>
                  </span>
                </div>
                <div className="fld">
                  <label className="lbl" htmlFor="mission">
                    Mission line
                  </label>
                  <input
                    className="inp"
                    id="mission"
                    defaultValue="Funding health, housing and opportunity across the Riverbend valley since 1984."
                  />
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="help">One sentence, shown under your name on the public page.</span>
                    <span className="counter">79 / 140</span>
                  </div>
                </div>
                <div className="fld">
                  <label className="lbl" htmlFor="site">
                    Website
                  </label>
                  <input className="inp" id="site" defaultValue="https://riverbendcf.example" />
                </div>
              </div>
              <div className="card-f" style={{ justifyContent: "space-between" }}>
                <Link to="/onboarding/funder/brand" className="btn btn-secondary">
                  <ArrowLeft className="ic" aria-hidden="true" />
                  Back
                </Link>
                <Link to="/w/riverbend" className="btn btn-primary">
                  Continue to Team
                  <ArrowRight className="ic" aria-hidden="true" />
                </Link>
              </div>
            </section>
            <aside style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="eyebrow">Live preview · public page</span>
                <span className="notice">
                  <RefreshCw className="ic ic-sm" aria-hidden="true" />
                  Updates as you type
                </span>
              </div>
              <div
                className="pub"
                style={
                  {
                    "--tenant": "#1F6F8B",
                    "--on-tenant": "#FFFFFF",
                    border: "1px solid #D6DEDE",
                    borderRadius: "12px",
                    overflow: "hidden",
                    fontSize: "14px",
                    lineHeight: 1.5,
                  } as CSSProperties
                }
              >
                <div className="addr" style={{ height: "30px" }}>
                  <div className="addr-url" style={{ height: "20px", fontSize: "11px" }}>
                    <b>https://</b>gms.opengrants.io/f/riverbend
                  </div>
                </div>
                <div className="pub-hd">
                  <div style={{ padding: "0 20px" }}>
                    <div className="bar" style={{ height: "52px" }}>
                      <div className="lg" style={{ fontSize: "15px" }}>
                        <span className="mark" style={{ width: "30px", height: "30px", fontSize: "11px" }}>
                          RCF
                        </span>
                        Riverbend Community Foundation
                      </div>
                      <a href="#preview" style={{ fontSize: "12px", fontWeight: 700 }}>
                        riverbendcf.example
                      </a>
                    </div>
                    <div className="mission" style={{ padding: "12px 0 22px", gap: "6px" }}>
                      <h1 style={{ fontSize: "22px" }}>Riverbend Community Foundation</h1>
                      <p className="sub" style={{ fontSize: "13px" }}>
                        Funding health, housing and opportunity across the Riverbend valley since 1984.
                      </p>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px", background: "#FFFFFF" }}>
                  <h2 style={{ fontSize: "16px", margin: "0" }}>Open opportunities</h2>
                  <div className="oc" style={{ padding: "16px", gap: "8px" }}>
                    <h3 style={{ fontSize: "15px" }}>Community Health Grants 2027</h3>
                    <div className="amt" style={{ fontSize: "16px" }}>
                      $50,000 – $150,000
                    </div>
                    <div className="meta" style={{ fontSize: "12px", gap: "10px" }}>
                      <span>Closes in 41 days</span>
                      <span>·</span>
                      <span>Nonprofits, tribal, public agencies</span>
                    </div>
                    <a href="#preview" className="btn btn-tenant btn-sm" style={{ alignSelf: "flex-start" }}>
                      Apply with Passport
                    </a>
                  </div>
                </div>
                <div className="pub-foot" style={{ padding: "10px 20px", fontSize: "11px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                    <span>Powered by OpenGrants GMS</span>
                    <span>CommonGrants JSON</span>
                  </div>
                </div>
              </div>
              <div className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)", fontSize: "12px", padding: "0 4px" }}>
                <dt>Accent appears on</dt>
                <dd>Header, primary CTA, letter & email headers, nav stripe</dd>
                <dt>Stays neutral</dt>
                <dd>Tables, badges, chips, forms, the applicant workspace</dd>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </>
  );
}
