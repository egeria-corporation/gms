// SPDX-License-Identifier: AGPL-3.0-only
// Sign in: email → one-time code → second step when a workspace requires it → first run.
// One state at a time; the markup follows design board P4, which shows the states side by side.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CopyButton } from "../../components/CopyButton.tsx";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, CircleX, ExternalLink, Info, Lock, TriangleExclamationPoint } from "lucide-react";
import { useServices } from "../../app/services.tsx";
import type { TotpEnrollment } from "../../auth/types.ts";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { PassportButton } from "../../components/PassportButton.tsx";
import { passportProblem, safeNext } from "../../lib/passportSignIn.ts";
import { isReviewOnly } from "../../lib/roles.ts";
import { MOCK_CODE } from "../../mocks/auth.ts";

type Step = "email" | "code" | "mfa" | "first-run";
type Choice = "funder" | "applicant" | "invite";


function Problem({ children }: { children: ReactNode }) {
  return (
    <span className="err-msg" role="alert">
      <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
      {children}
    </span>
  );
}

function CodeInputs({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const set = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length > 1) {
      // A pasted code fills every box.
      onChange(digits.slice(0, 6));
      refs.current[Math.min(digits.length, 6) - 1]?.focus();
      return;
    }
    const next = (value.slice(0, i) + digits + value.slice(i + 1)).slice(0, 6);
    onChange(next);
    if (digits && i < 5) refs.current[i + 1]?.focus();
  };
  return (
    <div role="group" aria-label="One-time code" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "8px" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={invalid ? "inp err" : "inp"}
          aria-label={`Digit ${i + 1}`}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={i === 0}
          value={value[i] ?? ""}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            // A pasted code replaces whatever is in the boxes.
            const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            if (!digits) return;
            e.preventDefault();
            onChange(digits);
            refs.current[Math.min(digits.length, 6) - 1]?.focus();
          }}
          style={{ height: "48px", textAlign: "center", fontSize: "20px", fontWeight: 700, padding: "0" }}
        />
      ))}
    </div>
  );
}

/** The token in a pasted invitation: the whole link from the email, or the token on its own. */
export function invitationToken(pasted: string): string | null {
  const text = pasted.trim();
  const fromLink = /[?&]token=([^&#\s]+)/.exec(text)?.[1];
  const token = fromLink ? decodeURIComponent(fromLink) : text;
  return /^[A-Za-z0-9_-]{10,200}$/.test(token) ? token : null;
}

export default function SignIn() {
  const { auth, sessionState, meState, reloadMe, mock } = useServices();
  const passportFlags = usePassportFlags();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  // The landing page's two start buttons carry who the person is, so they are not asked again.
  const asParam = params.get("as");
  const as: "funder" | "grantee" | null = asParam === "funder" || asParam === "grantee" ? asParam : null;
  // Passport sent the person back without a session: say why, and what to do next.
  const passport = sessionState.status === "signedIn" ? null : passportProblem(params.get("passport_error"));

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>("funder");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mfaStarted = useRef(false);

  const signedInEmail = sessionState.status === "signedIn" ? sessionState.session.email : email;

  // Once signed in, the memberships decide what comes next.
  useEffect(() => {
    if (sessionState.status !== "signedIn" || meState.status !== "ready") return;
    const { me } = meState;
    const target = next ? me.workspaces.find((w) => next === `/w/${w.handle}` || next.startsWith(`/w/${w.handle}/`)) : undefined;
    const needsMfa = !me.mfaVerified && (target ? target.requiresMfa : me.workspaces.some((w) => w.requiresMfa));
    if (needsMfa) return setStep("mfa");
    if (me.workspaces.length === 0 && !next) {
      if (as === "funder") return navigate("/onboarding/funder/organization", { replace: true });
      if (as === "grantee") return navigate("/onboarding/applicant?start=email", { replace: true });
      return setStep("first-run");
    }
    // Someone whose only job here is reviewing works in the reviewer portal, not the funder workspace.
    const first = me.workspaces[0]!;
    navigate(next ?? (isReviewOnly(first.role) && me.workspaces.every((w) => isReviewOnly(w.role)) ? "/review/assignments" : `/w/${first.handle}`), { replace: true });
  }, [sessionState.status, meState, next, as, navigate]);

  // Entering the second step: challenge an enrolled authenticator, or start enrollment.
  useEffect(() => {
    if (step !== "mfa" || mfaStarted.current) return;
    mfaStarted.current = true;
    (async () => {
      try {
        const factors = await auth.listTotpFactors();
        if (factors[0]) return setFactorId(factors[0]);
        const e = await auth.enrollTotp();
        setEnrollment(e);
        setFactorId(e.factorId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Two-step verification could not be started.");
      }
    })();
  }, [step, auth]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      await auth.sendCode(email.trim());
      setCode("");
      setStep("code");
    });
  };
  const verifyCode = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      try {
        await auth.verifyCode(email.trim(), code);
      } catch (err) {
        setCode("");
        throw err;
      }
    });
  };
  const verifyTotp = (e: FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    return run(async () => {
      await auth.verifyTotp(factorId, totp.replace(/\s/g, ""));
      reloadMe();
    });
  };
  const continueFirstRun = () => {
    if (choice === "funder") navigate("/onboarding/funder");
    else if (choice === "applicant") navigate("/onboarding/applicant");
    else {
      const token = invitationToken(invite);
      if (!token) setError("Paste the link from your invitation email.");
      else navigate(`/invitations/accept?token=${encodeURIComponent(token)}`);
    }
  };

  const waiting = sessionState.status === "signedIn" && meState.status === "loading";
  const profileError = sessionState.status === "signedIn" && meState.status === "error";

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
              Sign up or sign in with your email. No password and no Passport account needed{passportFlags.signIn ? ", though you can continue with Passport instead" : ""}.
            </p>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", maxWidth: "440px", alignSelf: "center" }}
            aria-busy={busy || waiting}
          >
            {profileError && (
              <div className="bnr bnr-dng" role="alert">
                <TriangleExclamationPoint className="ic" aria-hidden="true" />
                <div>
                  <div className="t">Your workspaces could not be loaded</div>
                  <div className="d">You are signed in, but the GMS did not answer. Try again in a moment.</div>
                </div>
                <button className="btn btn-sm btn-secondary act" type="button" onClick={reloadMe}>
                  Retry
                </button>
              </div>
            )}

            {passport && step === "email" && (
              <div className={`bnr bnr-${passport.tone}`} role={passport.tone === "dng" ? "alert" : "status"}>
                {passport.tone === "info" ? <Info className="ic" aria-hidden="true" /> : passport.tone === "dng" ? <CircleX className="ic" aria-hidden="true" /> : <TriangleExclamationPoint className="ic" aria-hidden="true" />}
                <div>
                  <div className="t">{passport.title}</div>
                  <div className="d">{passport.detail}</div>
                  {passport.action && (
                    <a className="d" href={passport.action.href} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
                      {passport.action.label}
                      <ExternalLink className="ic ic-sm" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {step === "email" && (
              <div className="card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}>
                <h2 style={{ fontSize: "20px" }}>Enter Your Email</h2>
                <form style={{ display: "flex", flexDirection: "column", gap: "14px" }} onSubmit={sendCode}>
                  <div className="fld">
                    <label className="lbl" htmlFor="email">
                      Work email
                    </label>
                    <input
                      className="inp"
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      style={{ height: "44px", fontSize: "16px" }}
                    />
                    <span className="help">We'll send a one-time code. No password to remember.</span>
                    <span className="help">Admins add an authenticator app as a second step. It takes a minute.</span>
                  </div>
                  {error && <Problem>{error}</Problem>}
                  <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
                    Send code
                    <ArrowRight className="ic" aria-hidden="true" />
                  </button>
                </form>
                {passportFlags.signIn && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "#4A5C5A", fontSize: "13px" }}>
                      <span className="divider" style={{ flex: 1 }}></span>Applying for funding?
                      <span className="divider" style={{ flex: 1 }}></span>
                    </div>
                    <PassportButton returnTo={next} />
                    <p className="help" style={{ textAlign: "center" }}>
                      Sign in at Passport and choose your organization. You come back signed in, with applications pre-filled from its record.
                    </p>
                  </>
                )}
              </div>
            )}

            {step === "code" && (
              <form
                className="card"
                style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}
                onSubmit={verifyCode}
              >
                <div>
                  <h2 style={{ fontSize: "20px" }}>Check Your Email</h2>
                  <p style={{ fontSize: "14px", color: "#4A5C5A", marginTop: "4px" }}>
                    We sent a 6-digit code to <b>{email}</b>. The link in the same email signs you in too.
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span className="lbl">Enter the 6-digit code</span>
                    {error && (
                      <span className="bdg bdg-dng">
                        <CircleX className="ic" aria-hidden="true" />
                        Invalid code
                      </span>
                    )}
                  </div>
                  <CodeInputs value={code} onChange={setCode} invalid={!!error} />
                  {error && <Problem>{error}</Problem>}
                  {mock && <span className="help">Mock mode: the code is {MOCK_CODE}.</span>}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "13px" }}>
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => sendCode()} disabled={busy}>
                      Send a new code
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      onClick={() => {
                        setError(null);
                        setStep("email");
                      }}
                    >
                      Use a different email
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary btn-lg" type="submit" disabled={busy || code.length < 6}>
                  Verify and continue
                </button>
              </form>
            )}

            {step === "mfa" && (
              <form
                className="card"
                style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}
                onSubmit={verifyTotp}
              >
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
                    <h2 style={{ fontSize: "20px" }}>{enrollment ? "Set Up Two-Step Verification" : "Two-Step Verification"}</h2>
                    <p style={{ fontSize: "14px", color: "#4A5C5A", marginTop: "4px" }}>
                      {enrollment
                        ? "Your role in this workspace requires a second step. This takes about two minutes."
                        : "Your role in this workspace requires a second step. Open your authenticator app for the current code."}
                    </p>
                  </div>
                </div>
                {enrollment && (
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
                    {enrollment.qrCode ? (
                      <img
                        src={enrollment.qrCode}
                        alt="QR code to scan with an authenticator app"
                        style={{
                          width: "120px",
                          height: "120px",
                          border: "2px solid #0D2A43",
                          borderRadius: "6px",
                          background: "#FFFFFF",
                          flex: "none",
                        }}
                      />
                    ) : (
                      <div
                        role="img"
                        aria-label="QR code unavailable; enter the key manually"
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
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
                      <span className="help">Can't scan? Enter this key manually:</span>
                      <span
                        className="mono"
                        style={{ fontSize: "14px", fontWeight: 700, color: "#0D2A43", letterSpacing: ".06em", overflowWrap: "anywhere" }}
                      >
                        {enrollment.secret}
                      </span>
                      <span style={{ alignSelf: "flex-start" }}>
                        <CopyButton value={enrollment.secret} label="Copy key" what="setup key" className="btn btn-sm btn-secondary" />
                      </span>
                    </div>
                  </div>
                )}
                <div className="fld">
                  <label className="lbl" htmlFor="totp">
                    Enter the 6-digit code from your app
                  </label>
                  <input
                    className={error ? "inp err" : "inp"}
                    id="totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000 000"
                    autoFocus
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    style={{ height: "44px", fontSize: "18px", letterSpacing: ".12em", fontWeight: 700 }}
                  />
                  {error && <Problem>{error}</Problem>}
                  {mock && <span className="help">Mock mode: the code is {MOCK_CODE}.</span>}
                </div>
                <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !factorId || totp.replace(/\D/g, "").length < 6}>
                  Verify and continue
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => void auth.signOut().then(() => setStep("email"))}>
                  Sign out
                </button>
              </form>
            )}

            {step === "first-run" && (
              <div className="card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}>
                <div>
                  <h2 style={{ fontSize: "20px" }}>How Will You Use OpenGrants GMS?</h2>
                  <p style={{ fontSize: "14px", color: "#4A5C5A", marginTop: "4px" }}>
                    Signed in as <b>{signedInEmail}</b>. You can add more workspaces later.
                  </p>
                </div>
                <div
                  role="radiogroup"
                  aria-label="How will you use OpenGrants GMS?"
                  style={{ display: "flex", flexDirection: "column", gap: "10px" }}
                >
                  {(
                    [
                      [
                        "funder",
                        "Create a funder workspace",
                        "For foundations, agencies and corporate giving programs. Name your organization, set your brand, invite your team.",
                      ],
                      [
                        "applicant",
                        "Set up my applicant organization",
                        passportFlags.linking ? "For nonprofits and other grant seekers. Link your Passport record, or enter a few details yourself." : "For nonprofits and other grant seekers. Enter a few details about your organization.",
                      ],
                      ["invite", "Join by invitation", "Someone invited you as a teammate, reviewer or consultant."],
                    ] as const
                  ).map(([key, title, help]) => {
                    const on = choice === key;
                    return (
                      <div
                        key={key}
                        className="radio"
                        style={{
                          padding: "14px",
                          border: `1px solid ${on ? "#29A79F" : "#D6DEDE"}`,
                          borderRadius: "10px",
                          background: on ? "#E1F8F6" : undefined,
                        }}
                      >
                        <span className={on ? "r on" : "r"} aria-hidden="true"></span>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => {
                              setChoice(key);
                              setError(null);
                            }}
                            style={{
                              background: "none",
                              border: 0,
                              padding: 0,
                              font: "inherit",
                              color: "inherit",
                              textAlign: "left",
                              cursor: "pointer",
                              display: "block",
                              width: "100%",
                            }}
                          >
                            <div className="b" style={{ color: "#0D2A43" }}>
                              {title}
                            </div>
                            <div className="help">{help}</div>
                          </button>
                          {key === "invite" && on && (
                            <div className="fld">
                              <label className="sr" htmlFor="invite">
                                Invitation link
                              </label>
                              <input
                                className="inp"
                                id="invite"
                                placeholder="Paste the link from your invitation email"
                                value={invite}
                                onChange={(e) => setInvite(e.target.value)}
                                style={{ height: "40px" }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {error && <Problem>{error}</Problem>}
                <button className="btn btn-primary btn-lg" type="button" onClick={continueFirstRun}>
                  Continue
                </button>
                <p className="help">
                  An organization that both funds and applies gets two workspaces under one account; the switcher shows both.
                </p>
              </div>
            )}
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
            <span>OpenGrants GMS is free and open source.</span>
            <a href="https://github.com/egeria-corporation/gms">Source</a>
            <Link to="/agents">For agents</Link>
          </div>
        </main>
      </div>
    </>
  );
}
