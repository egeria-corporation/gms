// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { ArrowRight, CircleX, Copy, Lock, ShieldCheck, TriangleExclamationPoint } from "lucide-react";

export default function SignIn() {
  return (
    <>
      <title>{"Sign in — OpenGrants GMS"}</title>
      <div className="gms pub" style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--grad-hero)" }}>
        <header style={{ background: "#FFFFFF", borderBottom: "1px solid #D6DEDE" }}>
          <div
            className="wrap-c"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", height: "64px" }}
          >
            <Link
              to="/"
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
            <div style={{ fontSize: "14px", color: "#4A5C5A" }}>
              New here?{" "}
              <Link to="/" style={{ fontWeight: 700 }}>
                Learn how OpenGrants GMS works
              </Link>
            </div>
          </div>
        </header>
        <main
          className="wrap-c"
          style={{ paddingTop: "48px", paddingBottom: "56px", display: "flex", flexDirection: "column", gap: "28px", width: "100%" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", textAlign: "center", alignItems: "center" }}>
            <h1 style={{ fontSize: "32px" }}>Sign In to OpenGrants GMS</h1>
            <p style={{ fontSize: "16px", color: "#4A5C5A", maxWidth: "560px" }}>
              One account for every workspace you belong to. Funders sign in with email; applicants can continue with their Passport.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "24px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span className="eyebrow">Step 1 · Email</span>
              <div className="card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}>
                <h2 style={{ fontSize: "20px" }}>Enter Your Email</h2>
                <form style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="fld">
                    <label className="lbl" htmlFor="email">
                      Work email
                    </label>
                    <input
                      className="inp"
                      id="email"
                      type="email"
                      defaultValue="dana.ortiz@riverbendcf.example"
                      style={{ height: "44px", fontSize: "16px" }}
                    />
                    <span className="help">We'll send a one-time code. No password to remember.</span>
                  </div>
                  <button className="btn btn-primary btn-lg" type="button">
                    Send code
                    <ArrowRight className="ic" aria-hidden="true" />
                  </button>
                </form>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "#4A5C5A", fontSize: "13px" }}>
                  <span className="divider" style={{ flex: 1 }}></span>Applying for funding?
                  <span className="divider" style={{ flex: 1 }}></span>
                </div>
                <Link to="/onboarding/applicant" className="btn btn-cta btn-lg">
                  <ShieldCheck className="ic" aria-hidden="true" />
                  Continue with Passport
                </Link>
                <p className="help" style={{ textAlign: "center" }}>
                  Your organization's Passport record signs you in and pre-fills applications.
                </p>
                <div className="divider"></div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span className="lbl">Enter the 6-digit code</span>
                    <span className="bdg bdg-dng">
                      <CircleX className="ic" aria-hidden="true" />
                      Invalid code
                    </span>
                  </div>
                  <div
                    role="group"
                    aria-label="One-time code"
                    style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "8px" }}
                  >
                    <input
                      className="inp err"
                      aria-label="Digit 1"
                      defaultValue="4"
                      style={{ height: "48px", textAlign: "center", fontSize: "20px", fontWeight: 700, padding: "0" }}
                    />
                    <input
                      className="inp err"
                      aria-label="Digit 2"
                      defaultValue="8"
                      style={{ height: "48px", textAlign: "center", fontSize: "20px", fontWeight: 700, padding: "0" }}
                    />
                    <input
                      className="inp err"
                      aria-label="Digit 3"
                      defaultValue="1"
                      style={{ height: "48px", textAlign: "center", fontSize: "20px", fontWeight: 700, padding: "0" }}
                    />
                    <input
                      className="inp err"
                      aria-label="Digit 4"
                      defaultValue="0"
                      style={{ height: "48px", textAlign: "center", fontSize: "20px", fontWeight: 700, padding: "0" }}
                    />
                    <input
                      className="inp err"
                      aria-label="Digit 5"
                      defaultValue="2"
                      style={{ height: "48px", textAlign: "center", fontSize: "20px", fontWeight: 700, padding: "0" }}
                    />
                    <input
                      className="inp err"
                      aria-label="Digit 6"
                      defaultValue="7"
                      style={{ height: "48px", textAlign: "center", fontSize: "20px", fontWeight: 700, padding: "0" }}
                    />
                  </div>
                  <span className="err-msg" role="alert">
                    <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                    That code didn't match. 2 attempts left.
                  </span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "13px" }}>
                    <Link to="/signin" style={{ fontWeight: 700 }}>
                      Send a new code
                    </Link>
                    <span className="muted">Code expires in 8:42</span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span className="eyebrow">State · MFA required</span>
              <div className="card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
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
                      flex: "none",
                    }}
                  >
                    <Lock className="ic ic-md" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 style={{ fontSize: "20px" }}>Set Up Two-Step Verification</h2>
                    <p style={{ fontSize: "14px", color: "#4A5C5A", marginTop: "4px" }}>
                      Riverbend Community Foundation requires a second step for everyone in its workspace. This takes about two minutes.
                    </p>
                  </div>
                </div>
                <div className="radio">
                  <span className="r on" aria-hidden="true"></span>
                  <div>
                    <div className="b" style={{ color: "#0D2A43" }}>
                      Authenticator app
                    </div>
                    <div className="help">Recommended. Works with any TOTP app.</div>
                  </div>
                </div>
                <div className="radio">
                  <span className="r" aria-hidden="true"></span>
                  <div>
                    <div className="b" style={{ color: "#0D2A43" }}>
                      Security key
                    </div>
                    <div className="help">Hardware key or platform passkey.</div>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    alignItems: "center",
                    padding: "14px",
                    border: "1px solid #D6DEDE",
                    borderRadius: "10px",
                    background: "#F7FAFA",
                  }}
                >
                  <div
                    role="img"
                    aria-label="QR code to scan with an authenticator app"
                    style={{
                      width: "120px",
                      height: "120px",
                      border: "2px solid #0D2A43",
                      borderRadius: "6px",
                      background: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#4A5C5A",
                      flex: "none",
                      textAlign: "center",
                    }}
                  >
                    QR code
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
                    <span className="help">Can't scan? Enter this key manually:</span>
                    <span className="mono" style={{ fontSize: "14px", fontWeight: 700, color: "#0D2A43", letterSpacing: ".06em" }}>
                      QHX7-R2MP-4TLC-W9KD
                    </span>
                    <button className="btn btn-sm btn-secondary" type="button" style={{ alignSelf: "flex-start" }}>
                      <Copy className="ic" aria-hidden="true" />
                      Copy key
                    </button>
                  </div>
                </div>
                <div className="fld">
                  <label className="lbl" htmlFor="totp">
                    Enter the 6-digit code from your app
                  </label>
                  <input
                    className="inp"
                    id="totp"
                    inputMode="numeric"
                    placeholder="000 000"
                    style={{ height: "44px", fontSize: "18px", letterSpacing: ".12em", fontWeight: 700 }}
                  />
                </div>
                <button className="btn btn-primary btn-lg" type="button">
                  Verify and continue
                </button>
                <p className="help">You'll get 8 recovery codes on the next screen. Store them somewhere safe.</p>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span className="eyebrow">Step 2 · First run</span>
              <div className="card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}>
                <div>
                  <h2 style={{ fontSize: "20px" }}>How Will You Use OpenGrants GMS?</h2>
                  <p style={{ fontSize: "14px", color: "#4A5C5A", marginTop: "4px" }}>
                    Signed in as <b>dana.ortiz@riverbendcf.example</b>. You can add more workspaces later.
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <Link
                    to="/onboarding/funder/brand"
                    className="radio"
                    style={{
                      padding: "14px",
                      border: "1px solid #29A79F",
                      borderRadius: "10px",
                      background: "#E1F8F6",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <span className="r on" aria-hidden="true"></span>
                    <div>
                      <div className="b" style={{ color: "#0D2A43" }}>
                        Create a funder workspace
                      </div>
                      <div className="help">
                        For foundations, agencies and corporate giving programs. Claim your organization in Passport, set your brand, invite
                        your team.
                      </div>
                    </div>
                  </Link>
                  <Link
                    to="/onboarding/applicant"
                    className="radio"
                    style={{ padding: "14px", border: "1px solid #D6DEDE", borderRadius: "10px", textDecoration: "none", color: "inherit" }}
                  >
                    <span className="r" aria-hidden="true"></span>
                    <div>
                      <div className="b" style={{ color: "#0D2A43" }}>
                        Link my applicant organization with Passport
                      </div>
                      <div className="help">
                        For nonprofits and other grant seekers. Your Passport record becomes your applicant workspace.
                      </div>
                    </div>
                  </Link>
                  <div className="radio" style={{ padding: "14px", border: "1px solid #D6DEDE", borderRadius: "10px" }}>
                    <span className="r" aria-hidden="true"></span>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div>
                        <div className="b" style={{ color: "#0D2A43" }}>
                          Join by invitation
                        </div>
                        <div className="help">Someone invited you as a teammate, reviewer or consultant.</div>
                      </div>
                      <div className="fld">
                        <label className="sr" htmlFor="invite">
                          Invitation code
                        </label>
                        <input className="inp" id="invite" placeholder="Paste invitation code" style={{ height: "40px" }} />
                      </div>
                    </div>
                  </div>
                </div>
                <button className="btn btn-primary btn-lg" type="button">
                  Continue
                </button>
                <p className="help">
                  An organization that both funds and applies gets two workspaces under one account; the switcher shows both.
                </p>
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "18px",
              fontSize: "13px",
              color: "#4A5C5A",
              flexWrap: "wrap",
            }}
          >
            <span>By continuing you agree to the OpenGrants GMS terms.</span>
            <Link to="/">Terms</Link>
            <Link to="/">Privacy</Link>
            <Link to="/">Status</Link>
          </div>
        </main>
      </div>
    </>
  );
}
