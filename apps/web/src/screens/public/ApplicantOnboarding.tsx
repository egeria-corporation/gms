// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleCheck,
  CircleMinus,
  CircleQuestionMark,
  CircleX,
  Cloud,
  Database,
  File,
  Plus,
  Shield,
} from "lucide-react";

export default function ApplicantOnboarding() {
  return (
    <>
      <title>{"Applicant onboarding"}</title>
      <div className="gms gms-applicant" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header className="topbar">
          <Link to="/" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <span className="muted small" style={{ marginLeft: "8px" }}>
            Set up your applicant workspace
          </span>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            <button className="iconbtn" aria-label="Help">
              <CircleQuestionMark className="ic ic-md" aria-hidden="true" />
            </button>
            <Link to="/account/agents" className="av av-t" aria-label="Account: Maria Santos">
              MS
            </Link>
          </div>
        </header>
        <main style={{ flex: "1 1 auto", padding: "32px 40px 48px", display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="ph">
            <div>
              <h1>Welcome, Alder Creek Family Services</h1>
              <div className="meta">
                <span>Your Passport record does the typing. Confirm what came across, invite your team, and you are ready to apply.</span>
              </div>
            </div>
          </div>
          <div className="card" style={{ padding: "16px 24px" }}>
            <div className="stp" aria-label="Onboarding steps">
              <div className="s done">
                <span className="n">
                  <Check className="ic ic-sm" aria-hidden="true" />
                </span>
                Continue with Passport
              </div>
              <span className="ln done"></span>
              <div className="s on">
                <span className="n">2</span>Confirm imported profile
              </div>
              <span className="ln"></span>
              <div className="s">
                <span className="n">3</span>Invite teammates & connect apps
              </div>
              <span className="ln"></span>
              <div className="s">
                <span className="n">4</span>Ready
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
            <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">Step 1 · Passport consent (mock)</span>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div className="row" style={{ gap: "12px" }}>
                  <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "32px", height: "32px" }} />
                  <div>
                    <div className="b" style={{ fontSize: "15px" }}>
                      OpenGrants Passport
                    </div>
                    <div className="small muted">passport.opengrants.io</div>
                  </div>
                </div>
                <h2 style={{ fontSize: "18px" }}>Alder Creek Family Services is sharing with OpenGrants GMS</h2>
                <ul style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px" }}>
                  <li className="cb">
                    <span className="c on">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    <span>Read your organization profile</span>
                  </li>
                  <li className="cb">
                    <span className="c on">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    <span>Read and propose changes to your profile (you approve each one)</span>
                  </li>
                  <li className="cb">
                    <span className="c on">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    <span>Read your document locker</span>
                  </li>
                  <li className="cb">
                    <span className="c on">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    <span>Read payee status (bank name and last4 only)</span>
                  </li>
                </ul>
                <p className="small muted">The GMS never sees full account details and cannot change your bank destination.</p>
                <div className="row" style={{ gap: "10px" }}>
                  <Link to="/styleguide/passport-consent" className="btn btn-primary">
                    Allow
                  </Link>
                  <button className="btn btn-secondary">Not now</button>
                </div>
                <div className="notice">
                  <Check className="ic ic-sm" aria-hidden="true" style={{ color: "#0B5E47" }} />
                  Granted Apr 16, 2027 ·<Link to="/styleguide/passport-consent">Full consent screen</Link>
                </div>
              </div>
            </section>
            <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">Step 2 · Confirm imported profile</span>
              <div className="card">
                <div className="card-h">
                  <h3>From your Passport record</h3>
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    Synced 1 min ago
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="fld">
                    <label className="lbl" htmlFor="p-legal">
                      Legal name
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="p-legal" defaultValue="Alder Creek Family Services" readOnly />
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <label className="cb small">
                        <span className="c on">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        Looks right
                      </label>
                      <Link to="/w/alder-creek/organization" className="small b">
                        Edit in Passport
                      </Link>
                    </div>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="p-tax">
                      Tax status
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="p-tax" defaultValue="501(c)(3) public charity · verified" readOnly />
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <label className="cb small">
                        <span className="c on">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        Looks right
                      </label>
                      <Link to="/w/alder-creek/organization" className="small b">
                        Edit in Passport
                      </Link>
                    </div>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="p-addr">
                      Address
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="p-addr" defaultValue="418 Mill Road, Alder Creek, OR" readOnly />
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <label className="cb small">
                        <span className="c on">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        Looks right
                      </label>
                      <Link to="/w/alder-creek/organization" className="small b">
                        Edit in Passport
                      </Link>
                    </div>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="p-contact">
                      Primary contact
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="p-contact" defaultValue="Maria Santos · Executive Director" readOnly />
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <label className="cb small">
                        <span className="c on">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        Looks right
                      </label>
                      <Link to="/w/alder-creek/organization" className="small b">
                        Edit in Passport
                      </Link>
                    </div>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="p-budget">
                      Annual budget
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </label>
                    <input className="inp" id="p-budget" defaultValue="$2,400,000 (FY2026)" readOnly />
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <label className="cb small">
                        <span className="c"></span>Looks right
                      </label>
                      <Link to="/w/alder-creek/organization" className="small b">
                        Edit in Passport
                      </Link>
                    </div>
                  </div>
                  <div className="fld">
                    <span className="lbl">
                      Documents
                      <span className="prov prov-passport">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        From Passport
                      </span>
                    </span>
                    <div className="small" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span className="row" style={{ gap: "6px" }}>
                        <File className="ic ic-sm" aria-hidden="true" />
                        IRS determination letter.pdf
                      </span>
                      <span className="row" style={{ gap: "6px" }}>
                        <File className="ic ic-sm" aria-hidden="true" />
                        FY2026 audited financials.xlsx
                      </span>
                      <span className="row" style={{ gap: "6px" }}>
                        <File className="ic ic-sm" aria-hidden="true" />
                        Board roster 2027.pdf
                      </span>
                    </div>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <label className="cb small">
                        <span className="c on">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        Looks right
                      </label>
                      <Link to="/w/alder-creek/organization" className="small b">
                        Edit in Passport
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="card-f" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-primary">Confirm 6 fields</button>
                </div>
              </div>
            </section>
            <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">Step 3 · Team & connected apps</span>
              <div className="card">
                <div className="card-h">
                  <h3>Invite teammates</h3>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="fld">
                    <label className="lbl" htmlFor="inv-email">
                      Email
                    </label>
                    <input
                      className="inp"
                      id="inv-email"
                      placeholder="jamal@aldercreekfs.example"
                      defaultValue="jamal@aldercreekfs.example"
                    />
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="inv-role">
                      Role
                    </label>
                    <select className="sel" id="inv-role">
                      <option>Grants manager — edits applications and reports</option>
                      <option>Finance — budgets and payment status</option>
                      <option>Viewer — read only</option>
                    </select>
                  </div>
                  <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                    <Plus className="ic" aria-hidden="true" />
                    Send invitation
                  </button>
                  <div className="row small muted" style={{ gap: "6px" }}>
                    <span className="av av-sm">JR</span>Jamal Reed · invited
                  </div>
                  <p className="small muted">
                    Consultants (outside your organization) are invited later from Team & access with a scope and an expiry.
                  </p>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Connect apps</h3>
                  <span className="muted small">Optional</span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div className="doc">
                    <span className="ft" style={{ background: "#D2E1F9", color: "#1E4F8F", borderColor: "#B9CFF2" }}>
                      <Cloud className="ic" aria-hidden="true" />
                    </span>
                    <div className="grow">
                      <div className="nm">Google Workspace</div>
                      <div className="mt">Attach files from Drive · deep link to Passport</div>
                    </div>
                    <button className="btn btn-sm btn-secondary">Connect</button>
                  </div>
                  <div className="doc">
                    <span className="ft">
                      <Database className="ic" aria-hidden="true" />
                    </span>
                    <div className="grow">
                      <div className="nm">QuickBooks</div>
                      <div className="mt">Actuals for budget reports · deep link to Passport</div>
                    </div>
                    <button className="btn btn-sm btn-secondary">Connect</button>
                  </div>
                  <p className="small muted">Connections live in Passport, so every funder on the GMS reads the same source.</p>
                </div>
              </div>
            </section>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
            <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">Step 4 · Readiness (end card, L3)</span>
              <div
                className="card"
                style={{ padding: "24px", display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "24px" }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="row" style={{ gap: "12px" }}>
                    <span className="lvl lvl-3" style={{ height: "26px", fontSize: "13px", padding: "0 9px" }}>
                      <Shield className="ic" aria-hidden="true" />
                      L3
                    </span>
                    <h2 style={{ fontSize: "20px" }}>You are ready to apply</h2>
                  </div>
                  <div className="rc">
                    <div className="rc-row rc-pass" style={{ borderTop: "0" }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Identity verified</div>
                        <div className="r">Organization and representative confirmed in Passport</div>
                      </div>
                      <span></span>
                    </div>
                    <div className="rc-row rc-pass">
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Documents verified</div>
                        <div className="r">Determination letter, financials, board roster</div>
                      </div>
                      <span></span>
                    </div>
                    <div className="rc-row rc-pass">
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Payee verified</div>
                        <div className="r">River City Credit Union •••• 4821 · active</div>
                      </div>
                      <span></span>
                    </div>
                  </div>
                  <Link to="/w/alder-creek/find" className="btn btn-primary btn-lg" style={{ alignSelf: "flex-start" }}>
                    Find funding
                    <ArrowRight className="ic" aria-hidden="true" />
                  </Link>
                </div>
                <div
                  className="muted"
                  style={{
                    fontSize: "14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    borderLeft: "1px solid #D6DEDE",
                    paddingLeft: "20px",
                  }}
                >
                  <div className="b" style={{ color: "#1E2D2B" }}>
                    What each level unlocks
                  </div>
                  <div>
                    <span className="lvl lvl-2">L2</span> Submit applications; funders see verified documents without asking for them again.
                  </div>
                  <div>
                    <span className="lvl lvl-3">
                      <Shield className="ic" aria-hidden="true" />
                      L3
                    </span>{" "}
                    Receive payments through Passport; tranches release without a paper W-9 round trip.
                  </div>
                </div>
              </div>
            </section>
            <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">Step 4 · Readiness (end card, L2 state)</span>
              <div
                className="card"
                style={{ padding: "24px", display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "24px" }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="row" style={{ gap: "12px" }}>
                    <span className="lvl lvl-2" style={{ height: "26px", fontSize: "13px", padding: "0 9px" }}>
                      L2
                    </span>
                    <h2 style={{ fontSize: "20px" }}>Ready to apply — one step before you can be paid</h2>
                  </div>
                  <div className="rc">
                    <div className="rc-row rc-pass" style={{ borderTop: "0" }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Identity verified</div>
                        <div className="r">Organization and representative confirmed in Passport</div>
                      </div>
                      <span></span>
                    </div>
                    <div className="rc-row rc-pass">
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Documents verified</div>
                        <div className="r">Determination letter, financials, board roster</div>
                      </div>
                      <span></span>
                    </div>
                    <div className="rc-row rc-fail">
                      <CircleX className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Payee not verified</div>
                        <div className="r">No destination on file. Verification takes about 2 business days.</div>
                      </div>
                      <Link to="/w/alder-creek/organization" className="fix">
                        Verify in Passport →
                      </Link>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "12px", flexWrap: "wrap" }}>
                    <Link to="/w/alder-creek/organization" className="btn btn-primary btn-lg">
                      Verify payee in Passport
                    </Link>
                    <Link to="/w/alder-creek/find" className="btn btn-secondary btn-lg">
                      Find funding anyway
                    </Link>
                  </div>
                </div>
                <div
                  className="muted"
                  style={{
                    fontSize: "14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    borderLeft: "1px solid #D6DEDE",
                    paddingLeft: "20px",
                  }}
                >
                  <div className="b" style={{ color: "#1E2D2B" }}>
                    Why verify now
                  </div>
                  <p>
                    You can apply at L2. If an award comes, the first tranche stays Held until your payee is verified — so do it before
                    decision day.
                  </p>
                  <span className="pay pay-none">
                    <CircleMinus className="ic" aria-hidden="true" />
                    No destination
                  </span>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </>
  );
}
