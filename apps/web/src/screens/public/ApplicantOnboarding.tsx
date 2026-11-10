// SPDX-License-Identifier: AGPL-3.0-only
// Applicant onboarding: consent in Passport, confirm what came across, see readiness, go.
// The GMS never asks for organization details here; they are read from Passport with consent.
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { BadgeCheck, Check, CircleCheck, CircleDashed, CircleQuestionMark, CircleX } from "lucide-react";
import type { ApplicantReadiness, MyOrganization } from "../../api/applicant.ts";
import { useApplicantApi } from "../../api/applicantHooks.ts";
import { initialsOf } from "../../api/client.ts";
import { useServices } from "../../app/services.tsx";
import { LevelBadge } from "../../components/status.tsx";
import { ErrorBanner, errorMessage, Loading } from "../../components/ui.tsx";
import { ConnectApps, InviteTeammates } from "./onboardingExtras.tsx";

const REASONS: Record<string, string> = {
  declined: "You chose not to share your Passport record. Nothing was linked.",
  expired: "That took too long and the request expired. Start again.",
  invalid_state: "The request could not be verified. Start again.",
  not_configured: "Passport linking is not configured on this server.",
  passport_unavailable: "Passport can’t be reached right now. Try again in a few minutes.",
  passport_refused: "Passport refused the request for this organization.",
  passport_error: "Passport reported an error. Try again.",
};

const SCOPES = ["Read your organization profile", "Read your Common App profile (budget, staff, tax status) where you have confirmed it", "Propose changes to your profile (you approve each one in Passport)"];

const STEPS = ["Continue with Passport", "Confirm imported profile", "Ready"] as const;

type Json = Record<string, unknown>;
const at = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), obj);
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export default function ApplicantOnboarding() {
  const { meState, reloadMe, sessionState } = useServices();
  const [params] = useSearchParams();
  const outcome = params.get("passport");
  const reason = params.get("reason") ?? "";
  const linkedHandle = params.get("ws");

  const memberships = meState.status === "ready" ? meState.me.workspaces.filter((w) => w.kind === "applicant") : [];
  const workspace = memberships.find((w) => w.handle === linkedHandle) ?? memberships[0] ?? null;
  const api = useApplicantApi(workspace?.id);

  const [start, setStart] = useState<{ state: "idle" | "going"; error?: unknown }>({ state: "idle" });
  const [record, setRecord] = useState<{ org: MyOrganization; readiness: ApplicantReadiness } | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Coming back from Passport: the new workspace is not in the cached memberships yet.
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

  const o = record?.org.organization as unknown as Json | null | undefined;
  const address = [at(o, "addresses.primary.street1"), at(o, "addresses.primary.city"), at(o, "addresses.primary.stateOrProvince")].map(text).filter(Boolean).join(", ");
  const imported = [
    { id: "p-legal", label: "Legal name", value: text(at(o, "name")) },
    { id: "p-ein", label: "EIN", value: text(at(o, "identifiers.org:us:ein.id")).replace(/^(\d{2})(\d{7})$/, "$1-$2") },
    { id: "p-addr", label: "Address", value: address },
    { id: "p-email", label: "Primary email", value: text(at(o, "emails.primary")) },
  ].filter((f) => f.value);

  return (
    <>
      <title>Set up your applicant workspace — OpenGrants GMS</title>
      <div className="gms gms-applicant gms-frame">
        <header className="topbar">
          <Link to="/" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <span className="muted small" style={{ marginLeft: "8px" }}>
            Set up your applicant workspace
          </span>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            <button className="iconbtn" type="button" aria-label="Help">
              <CircleQuestionMark className="ic ic-md" aria-hidden="true" />
            </button>
            {email && (
              <Link to="/account/agents" className="av av-t">
                <span aria-hidden="true">{initialsOf(email)}</span>
                <span className="sr">Account: {email}</span>
              </Link>
            )}
          </div>
        </header>

        <main className="main" style={{ maxWidth: "960px", width: "100%", margin: "0 auto" }}>
          <div className="ph">
            <div>
              <h1>{record?.org.displayName ? `Welcome, ${record.org.displayName}` : "Link your organization"}</h1>
              <div className="meta">
                <span>Your Passport record does the typing. Confirm what came across and you are ready to apply.</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: "16px 24px" }}>
            <ol className="stp" aria-label="Onboarding steps" style={{ flexWrap: "wrap", rowGap: "8px" }}>
              {STEPS.map((label, i) => (
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

          {outcome === "error" && (
            <div className="bnr bnr-dng" role="alert">
              <CircleX className="ic" aria-hidden="true" />
              <div>
                <div className="t">Your organization was not linked</div>
                <div className="d">{REASONS[reason] ?? "Something went wrong while linking. Try again."}</div>
              </div>
            </div>
          )}
          {start.error ? <ErrorBanner error={start.error} title="Passport could not be opened" /> : null}
          {loadError && workspace ? <ErrorBanner error={loadError} title="Your Passport record could not be read" /> : null}
          {meState.status === "loading" && <Loading />}

          {step === 0 && meState.status !== "loading" && (
            <section className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px", maxWidth: "560px" }} aria-labelledby="consent-h">
              <div className="row" style={{ gap: "12px" }}>
                <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "32px", height: "32px" }} />
                <div>
                  <div className="b" style={{ fontSize: "15px" }}>
                    OpenGrants Passport
                  </div>
                  <div className="small muted">You will be asked there what to share with OpenGrants GMS</div>
                </div>
              </div>
              <h2 id="consent-h" style={{ fontSize: "18px" }}>
                Continue with Passport to link your organization
              </h2>
              <ul style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px" }}>
                {SCOPES.map((s) => (
                  <li className="cb" key={s}>
                    <span className="c on" aria-hidden="true">
                      <Check className="ic ic-sm" />
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
              <p className="small muted">The GMS never sees account details and cannot change your bank destination. You can withdraw this consent in Passport at any time.</p>
              <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-lg" type="button" onClick={onContinue} disabled={start.state === "going"}>
                  {start.state === "going" ? "Opening Passport…" : "Continue with Passport"}
                </button>
                <Link to="/" className="btn btn-secondary btn-lg">
                  Not now
                </Link>
              </div>
            </section>
          )}

          {step >= 1 && record && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
              <section className="card" aria-labelledby="imp-h">
                <div className="card-h">
                  <h3 id="imp-h">From your Passport record</h3>
                  <span className="prov prov-passport">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    From Passport
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
                        Something wrong? Edit in Passport
                      </a>
                    )}
                    {!confirmed && (
                      <button className="btn btn-primary" type="button" onClick={() => setConfirmed(true)}>
                        This looks right
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section className="card" aria-labelledby="ready-h">
                <div className="card-h">
                  <h3 id="ready-h">Readiness</h3>
                  <LevelBadge level={record.readiness.level} />
                </div>
                <div className="card-b">
                  <ul className="rc">
                    {record.readiness.checks.map((c, i) => {
                      const Icon = c.state === "pass" ? CircleCheck : c.state === "fail" ? CircleX : CircleDashed;
                      return (
                        <li key={c.key} className={`rc-row rc-${c.state === "unknown" ? "unk" : c.state}`} style={i === 0 ? { borderTop: 0 } : undefined}>
                          <Icon className="ic" role="img" aria-label={c.state === "pass" ? "Passes" : c.state === "fail" ? "Needs attention" : "Unknown"} />
                          <div>
                            <div className="l">{c.label}</div>
                            <div className="r">{c.reason}</div>
                          </div>
                          <span />
                        </li>
                      );
                    })}
                  </ul>
                  <p className="small muted" style={{ marginTop: "10px" }}>
                    You can apply at any level. Payments through the GMS need a verified payee (L3).
                  </p>
                  {step === 2 && workspace && (
                    <Link to={`/w/${workspace.handle}`} className="btn btn-primary btn-lg" style={{ marginTop: "12px" }}>
                      Go to your workspace
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
