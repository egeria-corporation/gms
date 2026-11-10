// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { ArrowRight, BadgeCheck, Banknote, Building, Check, Clock, Pencil, ShieldCheck, X } from "lucide-react";

export default function PassportConsentReference() {
  return (
    <>
      <title>{"Passport consent — OpenGrants GMS"}</title>
      <div
        className="gms gms-applicant"
        style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--grad-hero)" }}
      >
        <header
          style={{
            height: "64px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 40px",
            borderBottom: "1px solid #D6DEDE",
            background: "#FFFFFF",
          }}
        >
          <div className="row" style={{ gap: "10px" }}>
            <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "28px", height: "28px" }} />
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "#0D2A43" }}>
              OpenGrants <span style={{ color: "#145450", fontWeight: 500 }}>Passport</span>
            </span>
          </div>
          <div className="row" style={{ gap: "10px" }}>
            <span className="small muted">Signed in as Maria Santos</span>
            <span className="av av-t">MS</span>
          </div>
        </header>
        <main style={{ flex: "1 1 auto", display: "flex", justifyContent: "center", padding: "48px 40px 64px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "620px 320px", gap: "28px", alignItems: "start", maxWidth: "1120px" }}>
            <section className="card" style={{ boxShadow: "var(--shadow-card-hover)" }}>
              <div className="card-b" style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "22px" }}>
                <div className="row" style={{ gap: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span
                      style={{
                        width: "48px",
                        height: "48px",
                        borderRadius: "12px",
                        background: "#FFFFFF",
                        border: "1px solid #D6DEDE",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "28px", height: "28px" }} />
                    </span>
                    <ArrowRight className="ic ic-md" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                    <span className="av av-xl av-t" style={{ borderRadius: "12px" }}>
                      AC
                    </span>
                  </div>
                  <div>
                    <h1 style={{ fontSize: "22px" }}>OpenGrants GMS wants access to Alder Creek Family Services</h1>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      You are signed in to Passport as Maria Santos, Executive Director. You can allow this for your organization.
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <span className="eyebrow">This will let OpenGrants GMS</span>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      border: "1px solid #D6DEDE",
                      borderRadius: "10px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "24px minmax(0, 1fr)",
                        gap: "14px",
                        padding: "14px 16px",
                        borderBottom: "1px solid #EEF3F3",
                      }}
                    >
                      <Building className="ic ic-md" aria-hidden="true" style={{ color: "#145450" }} />
                      <div>
                        <div className="b">Read your organization profile and documents</div>
                        <div className="small muted" style={{ marginTop: "2px" }}>
                          Legal name, tax status, address, representatives, and the files in your locker.
                        </div>
                        <span className="mono muted" style={{ display: "inline-block", marginTop: "6px" }}>
                          org:read
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "24px minmax(0, 1fr)",
                        gap: "14px",
                        padding: "14px 16px",
                        borderBottom: "1px solid #EEF3F3",
                      }}
                    >
                      <Pencil className="ic ic-md" aria-hidden="true" style={{ color: "#145450" }} />
                      <div>
                        <div className="b">See change requests from funders and propose changes you approve</div>
                        <div className="small muted" style={{ marginTop: "2px" }}>
                          A funder can suggest a correction (for example a new contact). Nothing changes in Passport until you accept it.
                        </div>
                        <span className="mono muted" style={{ display: "inline-block", marginTop: "6px" }}>
                          org.changes:read · org.changes:write
                        </span>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "24px minmax(0, 1fr)", gap: "14px", padding: "14px 16px" }}>
                      <Banknote className="ic ic-md" aria-hidden="true" style={{ color: "#145450" }} />
                      <div>
                        <div className="b">See payee status (bank name and last 4 digits only — never full account details)</div>
                        <div className="small muted" style={{ marginTop: "2px" }}>
                          So funders can tell whether a payment is ready to release. The GMS cannot add, edit or remove a destination.
                        </div>
                        <span className="mono muted" style={{ display: "inline-block", marginTop: "6px" }}>
                          payee:status
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span className="eyebrow">Who is asking</span>
                    <div className="row" style={{ gap: "8px" }}>
                      <span className="b">OpenGrants GMS</span>
                      <span className="bdg bdg-ok">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        Verified publisher
                      </span>
                    </div>
                    <span className="small muted">gms.opengrants.io · operated by OpenGrants</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span className="eyebrow">Not shared</span>
                    <ul className="small" style={{ display: "flex", flexDirection: "column", gap: "4px", color: "#1E2D2B" }}>
                      <li className="row" style={{ gap: "6px" }}>
                        <X className="ic ic-sm" aria-hidden="true" style={{ color: "#9B1C1C" }} />
                        Full account or routing details
                      </li>
                      <li className="row" style={{ gap: "6px" }}>
                        <X className="ic ic-sm" aria-hidden="true" style={{ color: "#9B1C1C" }} />
                        Representatives’ personal identity documents
                      </li>
                      <li className="row" style={{ gap: "6px" }}>
                        <X className="ic ic-sm" aria-hidden="true" style={{ color: "#9B1C1C" }} />
                        Your other funders’ private records
                      </li>
                    </ul>
                  </div>
                </div>
                <div
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                    paddingTop: "6px",
                    borderTop: "1px solid #EEF3F3",
                  }}
                >
                  <span className="small muted row" style={{ gap: "6px" }}>
                    <Clock className="ic ic-sm" aria-hidden="true" />
                    Access lasts until you revoke it. You can revoke it any time in Passport.
                  </span>
                  <div className="row" style={{ gap: "10px" }}>
                    <button className="btn btn-secondary btn-lg">Deny</button>
                    <Link to="/onboarding/applicant" className="btn btn-primary btn-lg">
                      Allow
                    </Link>
                  </div>
                </div>
              </div>
            </section>
            <aside style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="row" style={{ gap: "8px" }}>
                  <ShieldCheck className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                  <h3>Why this is safe</h3>
                </div>
                <ul style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px", color: "#1E2D2B" }}>
                  <li style={{ display: "flex", gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47", marginTop: "2px" }} />
                    <span>Your record stays in Passport. The GMS reads it; it does not keep a separate copy you have to maintain.</span>
                  </li>
                  <li style={{ display: "flex", gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47", marginTop: "2px" }} />
                    <span>Every value the GMS shows carries a “From Passport” mark, so you always know where it came from.</span>
                  </li>
                  <li style={{ display: "flex", gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47", marginTop: "2px" }} />
                    <span>
                      Each funder on the GMS asks for its own consent before reading your profile. Allowing the GMS does not grant any
                      funder.
                    </span>
                  </li>
                  <li style={{ display: "flex", gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47", marginTop: "2px" }} />
                    <span>Bank destination changes happen only in Passport, with a cooling-off period and a notice to you.</span>
                  </li>
                </ul>
              </div>
              <div
                className="card"
                style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "8px", background: "#F7FAFA" }}
              >
                <span className="eyebrow">Later</span>
                <p style={{ fontSize: "14px" }}>See every app and funder with access, what they can read, and revoke any of them.</p>
                <Link to="/w/alder-creek/team" className="small b row" style={{ gap: "6px" }}>
                  Manage access later in Passport
                  <ArrowRight className="ic ic-sm" aria-hidden="true" />
                </Link>
              </div>
              <p className="small muted" style={{ padding: "0 4px" }}>
                Problem with this request? <Link to="/">Report it to OpenGrants</Link>.
              </p>
            </aside>
          </div>
        </main>
      </div>
    </>
  );
}
