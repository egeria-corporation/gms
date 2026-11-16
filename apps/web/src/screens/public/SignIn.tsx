// SPDX-License-Identifier: AGPL-3.0-only
// Sign in: email → one-time code → second step when a workspace requires it → first run. Funder
// staff whose organization uses single sign-on take the "Use single sign-on" step instead of the code.
// One state at a time; the markup follows design board P4, which shows the states side by side.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CopyButton } from "../../components/CopyButton.tsx";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Building2, CircleX, ExternalLink, Info, Lock, TriangleExclamationPoint } from "lucide-react";
import { useServices } from "../../app/services.tsx";
import { rememberSsoNext, takeSsoNext } from "../../auth/sso.ts";
import { ssoPortFor } from "../../auth/ssoHooks.ts";
import type { TotpEnrollment } from "../../auth/types.ts";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { PassportButton } from "../../components/PassportButton.tsx";
import { passportProblem, safeNext } from "../../lib/passportSignIn.ts";
import { isReviewOnly } from "../../lib/roles.ts";
import { MOCK_CODE } from "../../mocks/auth.ts";

import { translator } from "../../i18n/index.tsx";


const t = translator("public");
type Step = "email" | "code" | "mfa" | "first-run" | "sso";
type Choice = "funder" | "applicant" | "invite";


/** The one problem a sign-in step shows. Its id lets that step's field point at it (WCAG 3.3.1). */
const PROBLEM_ID = "signin-problem";

function Problem({ children }: { children: ReactNode }) {
  return (
    <span className="err-msg" role="alert" id={PROBLEM_ID}>
      <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
      {children}
    </span>
  );
}

function CodeInputs({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  const problem = invalid ? { "aria-invalid": true as const, "aria-describedby": PROBLEM_ID } : {};
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
    <div role="group" aria-label={t("signIn.oneTimeCode")} style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "8px" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={invalid ? "inp err userback-ignore" : "inp userback-ignore"}
          aria-label={t("signIn.digit", { value: i + 1 })}
          {...problem}
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
  const services = useServices();
  const { auth, sessionState, meState, reloadMe, mock } = services;
  const passportFlags = usePassportFlags();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // After single sign-on the identity provider returns here without the query; the page to go back to was kept.
  const [ssoReturn, setSsoReturn] = useState<string | null>(null);
  const next = safeNext(params.get("next")) ?? ssoReturn;
  // The landing page's two start buttons carry who the person is, so they are not asked again.
  const asParam = params.get("as");
  const as: "funder" | "grantee" | null = asParam === "funder" || asParam === "grantee" ? asParam : null;
  // A page that was refused for want of the second step sends the person here with `step=mfa`. Honour
  // it even when the membership list has not caught up yet (a workspace created a moment ago).
  const wantsSecondStep = params.get("step") === "mfa";
  // A workspace that requires single sign-on sent the person here (`step=sso`).
  const wantsSso = params.get("step") === "sso";
  // Passport sent the person back without a session: say why, and what to do next.
  const passport = sessionState.status === "signedIn" ? null : passportProblem(params.get("passport_error"));

  const [step, setStep] = useState<Step>(wantsSso ? "sso" : "email");
  const [email, setEmail] = useState("");
  const [ssoEmail, setSsoEmail] = useState(() => (sessionState.status === "signedIn" ? sessionState.session.email : ""));
  // An SSO sign-in is its own account: it first joins the workspaces this address already belongs to.
  const [ssoJoin, setSsoJoin] = useState<"idle" | "running" | "done">("idle");
  const ssoStartedHere = useRef(false);
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
  const ssoSession = sessionState.status === "signedIn" ? (sessionState.session.ssoProviderId ?? null) : null;
  // Sent here for single sign-on while signed in some other way, or through another provider than the one
  // that was just used: stay on this step instead of going back to the page that refused.
  const holdForSso = wantsSso && sessionState.status === "signedIn" && (!ssoSession || !ssoStartedHere.current);

  // Sent here for single sign-on while signed in: start from the address already in use.
  const sessionEmail = sessionState.status === "signedIn" ? sessionState.session.email : "";
  useEffect(() => {
    if (sessionEmail) setSsoEmail((v) => v || sessionEmail);
  }, [sessionEmail]);

  // Back from the identity provider: join the workspaces this address belongs to, then load them again.
  useEffect(() => {
    if (!ssoSession || ssoJoin !== "idle" || holdForSso) return;
    setSsoJoin("running");
    setSsoReturn(safeNext(takeSsoNext()));
    ssoPortFor(services)
      .api.join()
      .catch(() => null)
      .finally(() => {
        setSsoJoin("done");
        reloadMe();
      });
  }, [ssoSession, ssoJoin, holdForSso, services, reloadMe]);

  // Once signed in, the memberships decide what comes next.
  useEffect(() => {
    if (sessionState.status !== "signedIn" || meState.status !== "ready") return;
    if (holdForSso || (ssoSession && ssoJoin !== "done")) return;
    const { me } = meState;
    const target = next ? me.workspaces.find((w) => next === `/w/${w.handle}` || next.startsWith(`/w/${w.handle}/`)) : undefined;
    const needsMfa = !me.mfaVerified && (wantsSecondStep || (target ? target.requiresMfa : me.workspaces.some((w) => w.requiresMfa)));
    if (needsMfa) return setStep("mfa");
    if (me.workspaces.length === 0 && !next) {
      if (as === "funder") navigate("/onboarding/funder/organization", { replace: true });
      else if (as === "grantee") navigate("/onboarding/applicant?start=email", { replace: true });
      else setStep("first-run");
      return;
    }
    // Someone whose only job here is reviewing works in the reviewer portal, not the funder workspace.
    const first = me.workspaces[0]!;
    navigate(next ?? (isReviewOnly(first.role) && me.workspaces.every((w) => isReviewOnly(w.role)) ? "/review/assignments" : `/w/${first.handle}`), { replace: true });
  }, [sessionState.status, meState, next, as, wantsSecondStep, navigate, holdForSso, ssoSession, ssoJoin]);

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
        setError(e instanceof Error ? e.message : t("signIn.twoStepVerificationCouldNot"));
      }
    })();
  }, [step, auth]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("signIn.somethingWentWrongTryAgain"));
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
  const startSso = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      rememberSsoNext(next);
      ssoStartedHere.current = true;
      try {
        await auth.signInWithSSO(ssoEmail.trim());
      } catch (err) {
        ssoStartedHere.current = false;
        rememberSsoNext(null);
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
      if (!token) setError(t("signIn.pasteTheLinkFromYour2"));
      else navigate(`/invitations/accept?token=${encodeURIComponent(token)}`);
    }
  };

  const waiting = (sessionState.status === "signedIn" && meState.status === "loading") || ssoJoin === "running";
  const profileError = sessionState.status === "signedIn" && meState.status === "error";

  return (
    <>
      <title>{t("signIn.signInOpengrantsGms")}</title>
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
              {t.rich("signIn.newHereLearnHowOpengrants", { link: (chunks) => <Link to="/" style={{ fontWeight: 700 }}>{chunks}</Link> })}
            </div>
          </div>
        </header>
        <main
          className="wrap-c"
          style={{ paddingTop: "48px", paddingBottom: "56px", display: "flex", flexDirection: "column", gap: "28px", width: "100%" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", textAlign: "center", alignItems: "center" }}>
            <h1 style={{ fontSize: "32px" }}>{t("signIn.signInToOpengrantsGms")}</h1>
            <p style={{ fontSize: "16px", color: "#4A5C5A", maxWidth: "560px" }}>
              {passportFlags.signIn ? t("signIn.signUpOrSignInOrPassport") : t("signIn.signUpOrSignIn")}
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
                  <div className="t">{t("signIn.yourWorkspacesCouldNotBe")}</div>
                  <div className="d">{t("signIn.youAreSignedInBut")}</div>
                </div>
                <button className="btn btn-sm btn-secondary act" type="button" onClick={reloadMe}>
                  {t("signIn.retry")}
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
                <h2 style={{ fontSize: "20px" }}>{t("signIn.enterYourEmail")}</h2>
                <form style={{ display: "flex", flexDirection: "column", gap: "14px" }} onSubmit={sendCode}>
                  <div className="fld">
                    <label className="lbl" htmlFor="email">
                      {t("signIn.workEmail")}
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
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${PROBLEM_ID} email-help email-help-2` : "email-help email-help-2"}
                      style={{ height: "44px", fontSize: "16px" }}
                    />
                    <span className="help" id="email-help">
                      {t("signIn.weLlSendAOne")}
                    </span>
                    <span className="help" id="email-help-2">
                      {t("signIn.adminsAddAnAuthenticatorApp")}
                    </span>
                  </div>
                  {error && <Problem>{error}</Problem>}
                  <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
                    {t("signIn.sendCode")}
                    <ArrowRight className="ic" aria-hidden="true" />
                  </button>
                </form>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    setError(null);
                    if (!ssoEmail) setSsoEmail(email);
                    setStep("sso");
                  }}
                >
                  <Building2 className="ic" aria-hidden="true" />
                  {t("signIn.useSingleSignOn")}
                </button>
                {passportFlags.signIn && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "#4A5C5A", fontSize: "13px" }}>
                      <span className="divider" style={{ flex: 1 }}></span>{t("signIn.applyingForFunding")}
                      <span className="divider" style={{ flex: 1 }}></span>
                    </div>
                    <PassportButton returnTo={next} />
                    <p className="help" style={{ textAlign: "center" }}>
                      {t("signIn.signInAtPassportAnd")}
                    </p>
                  </>
                )}
              </div>
            )}

            {step === "sso" && (
              <form className="card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }} onSubmit={startSso}>
                <div>
                  <h2 style={{ fontSize: "20px" }}>{t("signIn.useSingleSignOn2")}</h2>
                  <p style={{ fontSize: "14px", color: "#4A5C5A", marginTop: "4px" }}>
                    {t("signIn.signInThroughYourOrganization")}
                  </p>
                </div>
                {wantsSso && (
                  <div className="bnr bnr-warn" role="alert">
                    <Lock className="ic" aria-hidden="true" />
                    <div>
                      <div className="t">{t("signIn.thisWorkspaceRequiresSingleSign")}</div>
                      <div className="d">
                        {ssoSession && !ssoStartedHere.current
                          ? t("signIn.youAreSignedInWith")
                          : t("signIn.yourOrganizationSignsItsStaff")}
                      </div>
                    </div>
                  </div>
                )}
                <div className="fld">
                  <label className="lbl" htmlFor="sso-email">
                    {t("signIn.workEmail")}
                  </label>
                  <input
                    className="inp"
                    id="sso-email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    value={ssoEmail}
                    onChange={(e) => setSsoEmail(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${PROBLEM_ID} sso-email-help` : "sso-email-help"}
                    style={{ height: "44px", fontSize: "16px" }}
                  />
                  <span className="help" id="sso-email-help">{t("signIn.weSendYouToYour")}</span>
                </div>
                {error && <Problem>{error}</Problem>}
                <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !ssoEmail.trim()}>
                  {t("signIn.continueWithSingleSignOn")}
                  <ArrowRight className="ic" aria-hidden="true" />
                </button>
                {wantsSso && sessionState.status === "signedIn" ? (
                  <button className="btn btn-ghost" type="button" onClick={() => void auth.signOut().then(() => setStep("email"))}>
                    {t("signIn.signOut")}
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => {
                      setError(null);
                      setStep("email");
                    }}
                  >
                    {t("signIn.signInWithAnEmail")}
                  </button>
                )}
              </form>
            )}

            {step === "code" && (
              <form
                className="card"
                style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}
                onSubmit={verifyCode}
              >
                <div>
                  <h2 style={{ fontSize: "20px" }}>{t("signIn.checkYourEmail")}</h2>
                  <p style={{ fontSize: "14px", color: "#4A5C5A", marginTop: "4px" }}>
                    {t.rich("signIn.weSentA6Digit", { email, b: (chunks) => <b>{chunks}</b> })}
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span className="lbl">{t("signIn.enterThe6DigitCode")}</span>
                    {error && (
                      <span className="bdg bdg-dng">
                        <CircleX className="ic" aria-hidden="true" />
                        {t("signIn.invalidCode")}
                      </span>
                    )}
                  </div>
                  <CodeInputs value={code} onChange={setCode} invalid={!!error} />
                  {error && <Problem>{error}</Problem>}
                  {mock && <span className="help">{t("signIn.mockModeTheCodeIs", { MOCK_CODE })}</span>}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "13px" }}>
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => sendCode()} disabled={busy}>
                      {t("signIn.sendANewCode")}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      onClick={() => {
                        setError(null);
                        setStep("email");
                      }}
                    >
                      {t("signIn.useADifferentEmail")}
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary btn-lg" type="submit" disabled={busy || code.length < 6}>
                  {t("signIn.verifyAndContinue")}
                </button>
              </form>
            )}

            {step === "mfa" && (
              <form
                className="card userback-block"
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
                    <h2 style={{ fontSize: "20px" }}>{enrollment ? t("signIn.setUpTwoStepVerification") : t("signIn.twoStepVerification")}</h2>
                    {/* Until Supabase says whether an authenticator is already set up, say neither: the
                        "open your app" wording flashed for new admins before the set-up screen loaded. */}
                    <p style={{ fontSize: "14px", color: "#4A5C5A", marginTop: "4px" }} role="status" aria-live="polite">
                      {enrollment
                        ? t("signIn.yourRoleInThisWorkspace")
                        : factorId
                          ? t("signIn.yourRoleInThisWorkspace2")
                          : error
                            ? t("signIn.yourRoleInThisWorkspace3")
                            : t("signIn.gettingYourSecondStepReady")}
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
                        alt={t("signIn.qrCodeToScanWith")}
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
                        aria-label={t("signIn.qrCodeUnavailableEnterThe")}
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
                        {t("signIn.qrCode")}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
                      <span className="help">{t("signIn.canTScanEnterThis")}</span>
                      <span
                        className="mono"
                        style={{ fontSize: "14px", fontWeight: 700, color: "#0D2A43", letterSpacing: ".06em", overflowWrap: "anywhere" }}
                      >
                        {enrollment.secret}
                      </span>
                      <span style={{ alignSelf: "flex-start" }}>
                        <CopyButton value={enrollment.secret} label={t("signIn.copyKey")} what={t("signIn.whatSetupKey")} className="btn btn-sm btn-secondary" />
                      </span>
                    </div>
                  </div>
                )}
                {!enrollment && !factorId ? (
                  error && <Problem>{error}</Problem>
                ) : (
                  <>
                <div className="fld">
                  <label className="lbl" htmlFor="totp">
                    {t("signIn.enterThe6DigitCode2")}
                  </label>
                  <input
                    className={error ? "inp err" : "inp"}
                    id="totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? PROBLEM_ID : undefined}
                    placeholder="000 000"
                    autoFocus
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    style={{ height: "44px", fontSize: "18px", letterSpacing: ".12em", fontWeight: 700 }}
                  />
                  {error && <Problem>{error}</Problem>}
                  {mock && <span className="help">{t("signIn.mockModeTheCodeIs", { MOCK_CODE })}</span>}
                </div>
                <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !factorId || totp.replace(/\D/g, "").length < 6}>
                  {t("signIn.verifyAndContinue")}
                </button>
                  </>
                )}
                <button className="btn btn-ghost" type="button" onClick={() => void auth.signOut().then(() => setStep("email"))}>
                  {t("signIn.signOut")}
                </button>
              </form>
            )}

            {step === "first-run" && (
              <div className="card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}>
                <div>
                  <h2 style={{ fontSize: "20px" }}>{t("signIn.howWillYouUseOpengrants")}</h2>
                  <p style={{ fontSize: "14px", color: "#4A5C5A", marginTop: "4px" }}>
                    {t.rich("signIn.signedInAsYouCan", { signedInEmail, b: (chunks) => <b>{chunks}</b> })}
                  </p>
                </div>
                <div
                  role="radiogroup"
                  aria-label={t("signIn.howWillYouUseOpengrants2")}
                  style={{ display: "flex", flexDirection: "column", gap: "10px" }}
                >
                  {(
                    [
                      [
                        "funder",
                        t("signIn.createAFunderWorkspace"),
                        t("signIn.forFoundationsAgenciesAndCorporate"),
                      ],
                      [
                        "applicant",
                        t("signIn.setUpMyApplicantOrganization"),
                        passportFlags.linking ? t("signIn.forNonprofitsAndOtherGrant") : t("signIn.forNonprofitsAndOtherGrant2"),
                      ],
                      ["invite", t("signIn.joinByInvitation"), t("signIn.someoneInvitedYouAsA")],
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
                                {t("signIn.invitationLink")}
                              </label>
                              <input
                                className="inp"
                                id="invite"
                                placeholder={t("signIn.pasteTheLinkFromYour")}
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
                  {t("signIn.continue")}
                </button>
                <p className="help">
                  {t("signIn.anOrganizationThatBothFunds")}
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
            <span>{t("signIn.opengrantsGmsIsFreeAnd")}</span>
            <a href="https://github.com/egeria-corporation/gms">{t("signIn.source")}</a>
            <Link to="/agents">{t("signIn.forAgents")}</Link>
          </div>
        </main>
      </div>
    </>
  );
}
