// SPDX-License-Identifier: AGPL-3.0-only
// Applicant onboarding: either link the organization in Passport (consent, confirm what came across,
// see readiness, go), or set up without Passport from a short profile. Passport is recommended, never required.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { wantedFrom, wantedQuery } from "../../lib/wantedOpportunity.ts";
import { BadgeCheck, Check, CircleCheck, CircleDashed, CircleX, ShieldOff, Star } from "lucide-react";
import type { ApplicantReadiness, MyOrganization } from "../../api/applicant.ts";
import { useApplicantApi } from "../../api/applicantHooks.ts";
import { ApiError, initialsOf } from "../../api/client.ts";
import type { SelfDeclaredProfile } from "../../api/types.ts";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { useServices } from "../../app/services.tsx";
import { ProfileForm } from "../../components/ProfileForm.tsx";
import { LevelBadge } from "../../components/status.tsx";
import { slugify } from "../../lib/format.ts";
import { safeNext } from "../../lib/passportSignIn.ts";
import { ErrorBanner, errorMessage, Loading } from "../../components/ui.tsx";
import { ConnectApps, InviteTeammates } from "./onboardingExtras.tsx";
import { pendingReferral } from "../../api/loops.ts";

import { translator } from "../../i18n/index.tsx";
import { readinessWords } from "../../lib/readinessText.ts";



const t = translator("public");
const REASONS: Record<string, string> = {
  get declined() {
    return t("applicantOnboarding.reasons.declined");
  },
  get expired() {
    return t("applicantOnboarding.reasons.expired");
  },
  get invalid_state() {
    return t("applicantOnboarding.reasons.invalid_state");
  },
  get not_configured() {
    return t("applicantOnboarding.reasons.not_configured");
  },
  get passport_unavailable() {
    return t("applicantOnboarding.reasons.passport_unavailable");
  },
  get passport_refused() {
    return t("applicantOnboarding.reasons.passport_refused");
  },
  get passport_error() {
    return t("applicantOnboarding.reasons.passport_error");
  },
};

const SCOPES = () => ([t("applicantOnboarding.scopes.n0"), t("applicantOnboarding.scopes.n1"), t("applicantOnboarding.scopes.n2")]);

const STEPS = () => ([t("applicantOnboarding.steps.n0"), t("applicantOnboarding.steps.n1"), t("applicantOnboarding.steps.n2")] as const);
/** The email path never imports a Passport profile, so its stepper does not say that it does. */
const EMAIL_STEPS = () => ([t("applicantOnboarding.steps.email0"), t("applicantOnboarding.steps.email1"), t("applicantOnboarding.steps.n2")] as const);

/** A public handle for a workspace, from the legal name; applicants never see or choose it. */
function handleFor(name: string, attempt: number): string {
  let base = slugify(name).slice(0, 40).replace(/-+$/, "");
  if (base.length < 3) base = `${base}-org`.replace(/^-/, "org");
  return attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

type Json = Record<string, unknown>;
const at = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), obj);
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export default function ApplicantOnboarding() {
  const { meState, reloadMe, sessionState } = useServices();
  const [params] = useSearchParams();
  const outcome = params.get("passport");
  const reason = params.get("reason") ?? "";
  const linkedHandle = params.get("ws");
  // The opportunity the person clicked Apply on, if that is how they got here.
  const wanted = wantedFrom(params);
  // Hand-offs from other screens: open the email setup first, pre-fill the name, return afterwards.
  const startWithEmail = params.get("start") === "email";
  const presetName = (params.get("name") ?? "").slice(0, 200);
  const returnNext = safeNext(params.get("next"));
  // Arriving from an intermediary's onboarding link (/join/{token}): name it while the person sets up.
  const [joiningThrough] = useState(() => {
    const r = pendingReferral();
    return r?.source === "onboarding" && r.name ? r.name : null;
  });

  const memberships = meState.status === "ready" ? meState.me.workspaces.filter((w) => w.kind === "applicant") : [];
  const workspace = memberships.find((w) => w.handle === linkedHandle) ?? memberships[0] ?? null;
  const api = useApplicantApi(workspace?.id);

  const flags = usePassportFlags();
  const [withoutPassport, setWithoutPassport] = useState(startWithEmail);
  const [creating, setCreating] = useState<{ state: "idle" | "saving"; error?: unknown }>({ state: "idle" });
  const { api: gms } = useServices();
  const [start, setStart] = useState<{ state: "idle" | "going"; error?: unknown }>({ state: "idle" });
  const [record, setRecord] = useState<{ org: MyOrganization; readiness: ApplicantReadiness } | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Coming back from Passport with a code to finish: the server linked nothing yet. This account
  // finishes what it started; the code leaves the address bar before anything else happens.
  const navigate = useNavigate();
  const finishing = useRef(false);
  const [finishError, setFinishError] = useState<unknown>(null);
  useEffect(() => {
    if (outcome !== "finish" || finishing.current) return;
    finishing.current = true;
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const code = fragment.get("code");
    const state = fragment.get("state");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!code || !state) {
      navigate("/onboarding/applicant?passport=error&reason=invalid_state", { replace: true });
      return;
    }
    api.finishConsent({ code, state }).then(
      (done) => {
        const next = new URL(done.redirect, window.location.origin);
        navigate(next.pathname + next.search, { replace: true });
      },
      (e: unknown) => setFinishError(e),
    );
  }, [outcome, api, navigate]);

  // Linked: the new workspace is not in the cached memberships yet.
  const reloaded = useRef(false);
  useEffect(() => {
    if (outcome === "linked" && !reloaded.current) {
      reloaded.current = true;
      reloadMe();
    }
  }, [outcome, reloadMe]);

  useEffect(() => {
    if (!workspace) return;
    let live = true;
    Promise.all([api.organization(), api.readiness()]).then(
      ([org, readiness]) => live && setRecord({ org, readiness }),
      (e: unknown) => live && setLoadError(e),
    );
    return () => {
      live = false;
    };
  }, [api, workspace?.id]);

  const linked = !!record?.org.linked;
  const step = !linked ? 0 : confirmed ? 2 : 1;
  const email = sessionState.status === "signedIn" ? sessionState.session.email : "";

  const onContinue = async () => {
    setStart({ state: "going" });
    try {
      const { authorizeUrl } = await api.startConsent({ returnTo: "/onboarding/applicant", ...(workspace && !linked ? { workspaceId: workspace.id } : {}) });
      window.location.assign(authorizeUrl);
    } catch (error) {
      setStart({ state: "idle", error });
    }
  };

  // No Passport: the workspace is made from the profile and the person goes straight in.
  const createWithoutPassport = async (profile: SelfDeclaredProfile) => {
    setCreating({ state: "saving" });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const made = await gms.createWorkspace({ kind: "applicant", handle: handleFor(profile.legalName, attempt), displayName: profile.displayName ?? profile.legalName, profile });
        reloadMe();
        navigate(returnNext ?? (wanted ? `/w/${made.workspace.handle}/find?${wantedQuery(wanted)}` : `/w/${made.workspace.handle}`), { replace: true });
        return;
      } catch (error) {
        // A taken handle is not the person's problem: try another.
        if (error instanceof ApiError && error.status === 409 && attempt < 2) continue;
        setCreating({ state: "idle", error });
        return;
      }
    }
  };

  const o = record?.org.organization as unknown as Json | null | undefined;
  const address = [at(o, "addresses.primary.street1"), at(o, "addresses.primary.city"), at(o, "addresses.primary.stateOrProvince")].map(text).filter(Boolean).join(", ");
  const imported = [
    { id: "p-legal", label: t("applicantOnboarding.legalName"), value: text(at(o, "name")) },
    { id: "p-ein", label: "EIN", value: text(at(o, "identifiers.org:us:ein.id")).replace(/^(\d{2})(\d{7})$/, "$1-$2") },
    { id: "p-addr", label: t("applicantOnboarding.address"), value: address },
    { id: "p-email", label: t("applicantOnboarding.primaryEmail"), value: text(at(o, "emails.primary")) },
  ].filter((f) => f.value);

  return (
    <>
      <title>{t("applicantOnboarding.setUpYourApplicantWorkspace")}</title>
      <div className="gms gms-applicant gms-frame">
        <header className="topbar">
          <Link to="/" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <span className="muted small" style={{ marginLeft: "8px" }}>
            {t("applicantOnboarding.setUpYourApplicantWorkspace2")}
          </span>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            {email && (
              <Link to="/account/agents" className="av av-t">
                <span aria-hidden="true">{initialsOf(email)}</span>
                <span className="sr">{t("applicantOnboarding.account", { email })}</span>
              </Link>
            )}
          </div>
        </header>

        <main className="main" style={{ maxWidth: "960px", width: "100%", margin: "0 auto" }}>
          <div className="ph">
            <div>
              <h1>{record?.org.displayName ? t("applicantOnboarding.welcome", { displayName: record.org.displayName }) : t("applicantOnboarding.setUpYourOrganization")}</h1>
              <div className="meta">
                <span>{flags.linking ? t("applicantOnboarding.linkYourPassportRecordOr") : t("applicantOnboarding.tellUsAboutYourOrganization")}</span>
              </div>
            </div>
          </div>
          {joiningThrough && <p className="notice">{t("applicantOnboarding.joiningThrough", { name: joiningThrough })}</p>}

          <div className="card" style={{ padding: "16px 24px" }}>
            <ol className="stp" aria-label={t("applicantOnboarding.onboardingSteps")} style={{ flexWrap: "wrap", rowGap: "8px" }}>
              {(withoutPassport ? EMAIL_STEPS() : STEPS()).map((label, i) => (
                <li key={label} style={{ display: "contents" }}>
                  {i > 0 && <span className={i <= step ? "ln done" : "ln"} aria-hidden="true"></span>}
                  <div className={i < step ? "s done" : i === step ? "s on" : "s"} aria-current={i === step ? "step" : undefined}>
                    <span className="n">{i < step ? <Check className="ic ic-sm" aria-hidden="true" /> : i + 1}</span>
                    {label}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {outcome === "finish" && finishError === null && <Loading label={t("applicantOnboarding.linkingYourOrganization")} />}
          {finishError !== null && <ErrorBanner error={finishError} title={t("applicantOnboarding.yourOrganizationWasNotLinked")} />}
          {outcome === "error" && (
            <div className="bnr bnr-dng" role="alert">
              <CircleX className="ic" aria-hidden="true" />
              <div>
                <div className="t">{t("applicantOnboarding.yourOrganizationWasNotLinked")}</div>
                <div className="d">{REASONS[reason] ?? t("applicantOnboarding.somethingWentWrongWhileLinking")}</div>
              </div>
            </div>
          )}
          {start.error ? <ErrorBanner error={start.error} title={t("applicantOnboarding.passportCouldNotBeOpened")} /> : null}
          {loadError && workspace ? <ErrorBanner error={loadError} title={t("applicantOnboarding.yourPassportRecordCouldNot")} /> : null}
          {meState.status === "loading" && <Loading />}

          {step === 0 && meState.status !== "loading" && !flags.ready && <Loading />}
          {step === 0 && meState.status !== "loading" && flags.ready && (
            <div style={{ display: "grid", gridTemplateColumns: flags.linking ? "repeat(auto-fit, minmax(min(100%, 360px), 1fr))" : "minmax(0, 560px)", gap: "20px", alignItems: "start" }}>
              {flags.linking && (
                <section className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }} aria-labelledby="consent-h">
                  <div className="row" style={{ gap: "12px" }}>
                    <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "32px", height: "32px" }} />
                    <div>
                      <div className="b" style={{ fontSize: "15px" }}>
                        OpenGrants Passport
                      </div>
                      <div className="small muted">{t("applicantOnboarding.youWillBeAskedThere")}</div>
                    </div>
                    <span className="bdg bdg-ok" style={{ marginLeft: "auto" }}>
                      <Star className="ic" aria-hidden="true" />
                      {t("applicantOnboarding.recommended")}
                    </span>
                  </div>
                  <h2 id="consent-h" style={{ fontSize: "18px" }}>
                    {t("applicantOnboarding.continueWithPassport")}
                  </h2>
                  <p className="small">{t("applicantOnboarding.verifiedFormsFillThemselvesIn")}</p>
                  <ul style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px" }}>
                    {SCOPES().map((s) => (
                      <li className="cb" key={s}>
                        <span className="c on" aria-hidden="true">
                          <Check className="ic ic-sm" />
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="small muted">{t("applicantOnboarding.theGmsNeverSeesAccount")}</p>
                  <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                    <button className="btn btn-primary btn-lg" type="button" onClick={onContinue} disabled={start.state === "going"}>
                      {start.state === "going" ? t("applicantOnboarding.openingPassport") : t("applicantOnboarding.continueWithPassport")}
                    </button>
                    <button type="button" className="btn btn-secondary btn-lg" onClick={() => setWithoutPassport(true)}>
                      {t("applicantOnboarding.notNow")}
                    </button>
                  </div>
                </section>
              )}

              <section className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }} aria-labelledby="own-h">
                <div className="row" style={{ gap: "12px" }}>
                  <ShieldOff className="ic" aria-hidden="true" />
                  <h2 id="own-h" style={{ fontSize: "18px" }}>
                    {t("applicantOnboarding.setUpWithoutPassport")}
                  </h2>
                </div>
                <p className="small">
                  {t.rich("applicantOnboarding.enterAFewDetailsYourself", { b: (chunks) => <b>{chunks}</b> })}
                  {flags.linking && ` ${t("applicantOnboarding.youCanLinkPassportLater")}`}
                </p>
                {workspace ? (
                  <Link to={wanted ? `/w/${workspace.handle}/find?${wantedQuery(wanted)}` : `/w/${workspace.handle}`} className="btn btn-secondary btn-lg" style={{ alignSelf: "flex-start" }}>
                    {t("applicantOnboarding.continueWithoutPassport")}
                  </Link>
                ) : !withoutPassport ? (
                  <button type="button" className="btn btn-secondary btn-lg" style={{ alignSelf: "flex-start" }} onClick={() => setWithoutPassport(true)}>
                    {t("applicantOnboarding.setUpWithoutPassport")}
                  </button>
                ) : (
                  <ProfileForm idPrefix="onb" initial={{ contactEmail: email, ...(presetName ? { legalName: presetName } : {}) }} submitLabel={t("applicantOnboarding.createMyWorkspace")} busy={creating.state === "saving"} error={creating.error ?? null} onSubmit={createWithoutPassport} />
                )}
              </section>
            </div>
          )}

          {step >= 1 && record && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
              <section className="card" aria-labelledby="imp-h">
                <div className="card-h">
                  <h3 id="imp-h">{t("applicantOnboarding.fromYourPassportRecord")}</h3>
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    {t("applicantOnboarding.fromPassport")}
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {imported.map((f) => (
                    <div className="fld" key={f.id}>
                      <label className="lbl" htmlFor={f.id}>
                        {f.label}
                      </label>
                      <input className="inp" id={f.id} value={f.value} readOnly />
                    </div>
                  ))}
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                    {record.org.editUrl && (
                      <a href={record.org.editUrl} className="small b">
                        {t("applicantOnboarding.somethingWrongEditInPassport")}
                      </a>
                    )}
                    {!confirmed && (
                      <button className="btn btn-primary" type="button" onClick={() => setConfirmed(true)}>
                        {t("applicantOnboarding.thisLooksRight")}
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section className="card" aria-labelledby="ready-h">
                <div className="card-h">
                  <h3 id="ready-h">{t("applicantOnboarding.readiness")}</h3>
                  <LevelBadge level={record.readiness.level} />
                </div>
                <div className="card-b">
                  <ul className="rc">
                    {record.readiness.checks.map((c, i) => {
                      const Icon = c.state === "pass" ? CircleCheck : c.state === "fail" ? CircleX : CircleDashed;
                      return (
                        <li key={c.key} className={`rc-row rc-${c.state === "unknown" ? "unk" : c.state}`} style={i === 0 ? { borderTop: 0 } : undefined}>
                          <Icon className="ic" role="img" aria-label={c.state === "pass" ? t("applicantOnboarding.passes") : c.state === "fail" ? t("applicantOnboarding.needsAttention") : t("applicantOnboarding.unknown")} />
                          <div>
                            <div className="l">{readinessWords(c).label}</div>
                            <div className="r">{readinessWords(c).reason}</div>
                          </div>
                          <span />
                        </li>
                      );
                    })}
                  </ul>
                  <p className="small muted" style={{ marginTop: "10px" }}>
                    {t("applicantOnboarding.youCanApplyAtAny")}
                  </p>
                  {step === 2 && workspace && (
                    <Link to={wanted ? `/w/${workspace.handle}/find?${wantedQuery(wanted)}` : `/w/${workspace.handle}`} className="btn btn-primary btn-lg" style={{ marginTop: "12px" }}>
                      {t("applicantOnboarding.goToYourWorkspace")}
                    </Link>
                  )}
                </div>
              </section>
            </div>
          )}
          {step === 2 && record && workspace ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
              <InviteTeammates api={api} />
              <ConnectApps passportUrl={record.org.editUrl} />
            </div>
          ) : null}
          {step === 0 && loadError && !workspace ? <p className="small muted">{errorMessage(loadError)}</p> : null}
        </main>
      </div>
    </>
  );
}
