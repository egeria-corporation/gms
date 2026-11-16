// SPDX-License-Identifier: AGPL-3.0-only
// Funder onboarding at `/onboarding/funder/:step`: organization → brand → team → payments →
// first program. Each step writes through the API as it is completed, so leaving midway keeps
// what was done; the workspace exists from the first step on.
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Check, RefreshCw, TriangleExclamationPoint } from "lucide-react";
import { initialsOf } from "../../api/client.ts";
import { useApiMutation } from "../../api/hooks.ts";
import type { Invitation, WorkspaceRecord } from "../../api/types.ts";
import { useServices } from "../../app/services.tsx";
import { Busy } from "../../auth/RequireAuth.tsx";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { PassportLinkPanel } from "../../components/PassportLinkPanel.tsx";
import { ErrorBanner, Field, problemFor } from "../../components/ui.tsx";
import { needsSecondStep, SecondStepNotice } from "../../components/SecondStep.tsx";
import { signInPath } from "../../auth/RequireAuth.tsx";
import { checkBrand, isHexColor, suggestOnAccent, SYSTEM_BRAND } from "../../lib/contrast.ts";
import { parseDollars, slugify } from "../../lib/format.ts";
import { markOf } from "./PublicFrame.tsx";

import { translator } from "../../i18n/index.tsx";


const t = translator("public");
/** The steps; each title and hint is read in the current language when it is shown. */
const STEP_TEXT = {
  organization: ["funderOnboarding.steps.organization.title", "funderOnboarding.steps.organization.hint"],
  brand: ["funderOnboarding.steps.brand.title", "funderOnboarding.steps.brand.hint"],
  team: ["funderOnboarding.steps.team.title", "funderOnboarding.steps.team.hint"],
  payments: ["funderOnboarding.steps.payments.title", "funderOnboarding.steps.payments.hint"],
  program: ["funderOnboarding.steps.program.title", "funderOnboarding.steps.program.hint"],
} as const;
const step = (key: keyof typeof STEP_TEXT) => ({
  key,
  get title() {
    return t(STEP_TEXT[key][0]);
  },
  get hint() {
    return t(STEP_TEXT[key][1]);
  },
});
const STEPS = [step("organization"), step("brand"), step("team"), step("payments"), step("program")] as const;
type StepKey = (typeof STEPS)[number]["key"];
const isStep = (v: string | undefined): v is StepKey => STEPS.some((s) => s.key === v);

const FUNDER_ROLES = () => ([
  { value: "program_officer", label: t("funderOnboarding.funderRoles.n0.label") },
  { value: "finance", label: t("funderOnboarding.funderRoles.n1.label") },
  { value: "reviewer", label: t("funderOnboarding.funderRoles.n2.label") },
  { value: "admin", label: t("funderOnboarding.funderRoles.n3.label") },
  { value: "observer", label: t("funderOnboarding.funderRoles.n4.label") },
]);

function StepCard({ title, note, children, footer }: { title: string; note?: string; children: ReactNode; footer: ReactNode }) {
  return (
    <section className="card" aria-labelledby="onboarding-step-title">
      <div className="card-h">
        <h2 id="onboarding-step-title" style={{ fontSize: "15px" }}>
          {title}
        </h2>
        {note && <span className="muted small">{note}</span>}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {children}
      </div>
      <div className="card-f" style={{ justifyContent: "space-between" }}>
        {footer}
      </div>
    </section>
  );
}

function BrandPreview({ name, handle, accent, onAccent, logoUrl }: { name: string; handle: string; accent: string; onAccent: string; logoUrl: string }) {
  const { effective } = checkBrand(accent, onAccent);
  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-label={t("funderOnboarding.livePreviewOfYourPublic")}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="eyebrow">{t("funderOnboarding.livePreviewPublicPage")}</span>
        <span className="notice">
          <RefreshCw className="ic ic-sm" aria-hidden="true" />
          {t("funderOnboarding.updatesAsYouType")}
        </span>
      </div>
      <div className="pub" style={{ "--tenant": effective.accent, "--on-tenant": effective.onAccent, border: "1px solid #D6DEDE", borderRadius: "12px", overflow: "hidden", fontSize: "14px", lineHeight: 1.5 } as CSSProperties}>
        <div className="pub-hd">
          <div style={{ padding: "0 20px" }}>
            <div className="bar" style={{ height: "52px" }}>
              <div className="lg" style={{ fontSize: "15px" }}>
                {logoUrl ? <img src={logoUrl} alt="" style={{ height: "30px", width: "auto", borderRadius: "6px" }} /> : <span className="mark" style={{ width: "30px", height: "30px", fontSize: "11px" }}>{markOf(name || t("funderOnboarding.yourOrganization"))}</span>}
                {name || t("funderOnboarding.yourOrganization")}
              </div>
            </div>
            <div className="mission" style={{ padding: "12px 0 22px", gap: "6px" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "22px", color: "var(--on-tenant)" }}>{name || t("funderOnboarding.yourOrganization")}</div>
              <p className="sub" style={{ fontSize: "13px", color: "var(--on-tenant)" }}>
                {t("funderOnboarding.yourMissionLineAppearsHere")}
              </p>
            </div>
          </div>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px", background: "#FFFFFF" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", color: "var(--og-navy-dark)" }}>{t("funderOnboarding.openOpportunities")}</div>
          <div className="oc" style={{ padding: "16px", gap: "8px" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", color: "var(--og-navy-dark)" }}>{t("funderOnboarding.yourFirstOpportunity")}</div>
            <div className="amt" style={{ fontSize: "16px" }}>
              $25,000 – $100,000
            </div>
            <span className="btn btn-tenant btn-sm" style={{ alignSelf: "flex-start" }}>
              {t("funderOnboarding.apply")}
            </span>
          </div>
        </div>
        <div className="pub-foot" style={{ padding: "10px 20px", fontSize: "11px" }}>
          <span>{t("funderOnboarding.poweredByAddress", { handle: handle || t("funderOnboarding.yourHandle") })}</span>
        </div>
      </div>
    </aside>
  );
}

/** The workspace this tab is setting up, kept so a reload resumes instead of starting over. */
const RESUME_KEY = "gms.onboarding.funder";
function keptWorkspaceId(): string | null {
  try {
    return window.sessionStorage.getItem(RESUME_KEY);
  } catch {
    return null;
  }
}
function keepWorkspaceId(id: string | null): void {
  try {
    if (id) window.sessionStorage.setItem(RESUME_KEY, id);
    else window.sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // No session storage: a reload starts the steps again, as before.
  }
}

export default function FunderOnboarding() {
  const { step: stepParam } = useParams();
  const navigate = useNavigate();
  const { api, meState, reloadMe } = useServices();
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null);
  // After a reload the workspace made in step one is still there: pick it up again.
  const [resuming, setResuming] = useState(() => keptWorkspaceId() !== null);
  useEffect(() => {
    if (!resuming || workspace || meState.status === "loading") return;
    const id = keptWorkspaceId();
    const mine = meState.status === "ready" && id ? meState.me.workspaces.find((w) => w.id === id && w.kind === "funder" && w.role === "admin") : undefined;
    if (!mine) {
      keepWorkspaceId(null);
      setResuming(false);
      return;
    }
    let live = true;
    api.workspaceRecord(mine.id).then(
      (record) => live && (setWorkspace(record), setResuming(false)),
      () => live && setResuming(false),
    );
    return () => {
      live = false;
    };
  }, [api, meState, resuming, workspace]);
  const [warnings, setWarnings] = useState<string[]>([]);

  // organization
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  // brand
  const [accent, setAccent] = useState<string>(SYSTEM_BRAND.accent);
  const [onAccent, setOnAccent] = useState<string>(SYSTEM_BRAND.onAccent);
  const [logoUrl, setLogoUrl] = useState("");
  // team
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("program_officer");
  const [invited, setInvited] = useState<Invitation[]>([]);
  // program
  const [programName, setProgramName] = useState("");
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear()));
  const [budget, setBudget] = useState("");
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const passportFlags = usePassportFlags();
  const create = useApiMutation((a) => a.createWorkspace({ kind: "funder", handle, displayName: name.trim() }));
  const saveBrand = useApiMutation((a, id: string) => a.updateWorkspace(id, { brand: { accent, onAccent, ...(logoUrl.trim() ? { logoUrl: logoUrl.trim() } : {}) } }));
  const invite = useApiMutation((a, id: string) => a.createInvitation(id, { email: inviteEmail.trim(), role: inviteRole }));
  const createProgram = useApiMutation(async (a, ws: WorkspaceRecord, budgetMinor: number | null) => {
    // Program routes act in the workspace the client last opened.
    await a.workspace(ws.handle);
    return a.createProgram({ name: programName.trim(), fiscalYear: /^\d{4}$/.test(fiscalYear) ? Number(fiscalYear) : null, budgetAmountMinor: budgetMinor });
  });

  useEffect(() => {
    if (!handleTouched) setHandle(slugify(name).slice(0, 40));
  }, [name, handleTouched]);

  if (!isStep(stepParam)) return <Navigate to="/onboarding/funder/organization" replace />;
  const step = stepParam;
  // Later steps need the workspace the first step creates.
  if (resuming && !workspace) return <Busy />;
  if (step !== "organization" && !workspace) return <Navigate to="/onboarding/funder/organization" replace />;
  // Every later step is an admin action, and an admin needs the second step of sign-in. Workspace
  // pages send the person there on their own; these setup pages are outside them, so do it here.
  if (step !== "organization" && workspace && meState.status === "ready") {
    const membership = meState.me.workspaces.find((m) => m.id === workspace.id);
    if (membership?.requiresMfa && !meState.me.mfaVerified) return <Navigate to={signInPath(`/onboarding/funder/${step}`, "mfa")} replace />;
  }

  const index = STEPS.findIndex((s) => s.key === step);
  const go = (key: StepKey) => navigate(`/onboarding/funder/${key}`);
  const brand = checkBrand(accent, onAccent);
  const email = meState.status === "ready" ? meState.me.email : "";
  const back = (key: StepKey) => (
    <button type="button" className="btn btn-secondary" onClick={() => go(key)}>
      <ArrowLeft className="ic" aria-hidden="true" />
      {t("funderOnboarding.back")}
    </button>
  );

  async function submitOrganization(e: FormEvent) {
    e.preventDefault();
    if (workspace) return go("brand");
    const result = await create.run();
    if (!result) return;
    setWorkspace(result.workspace);
    keepWorkspaceId(result.workspace.id);
    reloadMe();
    // The person is the new workspace's admin. Without the second step of sign-in every save from
    // here would be refused, so take them through it now; it comes back to the brand step.
    if (meState.status === "ready" && !meState.me.mfaVerified) return navigate(signInPath("/onboarding/funder/brand", "mfa"));
    go("brand");
  }
  async function submitBrand(e: FormEvent) {
    e.preventDefault();
    if (!workspace || !brand.passes) return;
    const result = await saveBrand.run(workspace.id);
    if (!result) return;
    setWorkspace(result.workspace);
    setWarnings(result.warnings);
    go("team");
  }
  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    if (!workspace) return;
    const result = await invite.run(workspace.id);
    if (!result) return;
    setInvited((list) => [...list, result]);
    setInviteEmail("");
  }
  async function submitProgram(e: FormEvent) {
    e.preventDefault();
    if (!workspace) return;
    const minor = budget.trim() ? parseDollars(budget) : null;
    if (budget.trim() && minor === null) return setBudgetError(t("funderOnboarding.enterAnAmountInDollars"));
    setBudgetError(null);
    const program = await createProgram.run(workspace, minor);
    if (program) {
      keepWorkspaceId(null);
      navigate(`/w/${workspace.handle}/programs/${program.id}`);
    }
  }

  return (
    <div className="gms gms-frame">
      <title>{t("funderOnboarding.setUpYourFunderWorkspace", { title: STEPS[index]!.title })}</title>
      <header className="topbar">
        <Link to="/" className="logo">
          <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
          <span className="suffix">GMS</span>
        </Link>
        <span className="muted small" style={{ marginLeft: "8px" }}>
          {t("funderOnboarding.setUpYourFunderWorkspace2")}
        </span>
        <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
          <Link to="/account/agents" className="av">
            <span aria-hidden="true">{initialsOf(email)}</span>
            <span className="sr">{t("funderOnboarding.account", { email })}</span>
          </Link>
        </div>
      </header>
      <main style={{ flex: "1 1 auto", padding: "32px 40px 48px", display: "flex", flexDirection: "column", gap: "24px" }} className="main">
        <div className="ph">
          <div>
            <h1>{step === "brand" ? t("funderOnboarding.brandYourPublicPage") : step === "organization" ? t("funderOnboarding.tellUsWhoIsFunding") : step === "team" ? t("funderOnboarding.inviteYourTeam") : step === "payments" ? t("funderOnboarding.connectPayments") : t("funderOnboarding.createYourFirstProgram")}</h1>
            <div className="meta">
              <span>
                {t("funderOnboarding.stepOf", { step: index + 1, count: STEPS.length })}
              </span>
              <span>·</span>
              <span>{STEPS[index]!.hint}</span>
            </div>
          </div>
          {workspace && (
            <div className="actions">
              <Link to={`/w/${workspace.handle}`} className="btn btn-ghost" onClick={() => keepWorkspaceId(null)}>
                {t("funderOnboarding.finishLater")}
              </Link>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: step === "brand" ? "260px minmax(0, 1fr) 420px" : "260px minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
          <nav className="card" style={{ padding: "20px" }} aria-label={t("funderOnboarding.setupSteps")}>
            <div className="eyebrow" style={{ marginBottom: "14px" }}>
              {t("funderOnboarding.setupSteps")}
            </div>
            <ol className="stp-v">
              {STEPS.map((s, i) => (
                <li key={s.key} className={i < index ? "s done" : i === index ? "s on" : "s"} aria-current={i === index ? "step" : undefined}>
                  <span className="n">{i < index ? <Check className="ic ic-sm" role="img" aria-label={t("funderOnboarding.done")} /> : i + 1}</span>
                  <div>
                    <div className="t">{s.title}</div>
                    <div className="d">{s.hint}</div>
                  </div>
                </li>
              ))}
            </ol>
          </nav>

          {step === "organization" && (
            <form onSubmit={submitOrganization} noValidate>
              <StepCard
                title={t("funderOnboarding.organization")}
                footer={
                  <>
                    <span />
                    <button type="submit" className="btn btn-primary" disabled={create.state === "saving" || !name.trim() || handle.length < 3}>
                      {t("funderOnboarding.continueToBrand")}
                      <ArrowRight className="ic" aria-hidden="true" />
                    </button>
                  </>
                }
              >
                {create.error !== null && <ErrorBanner error={create.error} title={t("funderOnboarding.theWorkspaceCouldNotBe")} />}
                <Field id="org-name" label={t("funderOnboarding.organizationName")} required>
                  <input className="inp" id="org-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!!workspace} required autoComplete="organization" />
                </Field>
                <Field id="org-handle" label={t("funderOnboarding.handle")} required help={t("funderOnboarding.yourPublicPageWillBe", { value: handle || "your-handle" })} error={problemFor(create.error, "handle")}>
                  <div className="row" style={{ gap: "0" }}>
                    <span className="mono" style={{ height: "36px", display: "inline-flex", alignItems: "center", padding: "0 10px", background: "#EEF3F3", border: "1px solid #D6DEDE", borderRight: "0", borderRadius: "6px 0 0 6px", color: "#4A5C5A" }}>
                      {t("funderOnboarding.f")}
                    </span>
                    <input
                      className={problemFor(create.error, "handle") ? "inp mono err" : "inp mono"}
                      id="org-handle"
                      value={handle}
                      disabled={!!workspace}
                      onChange={(e) => {
                        setHandleTouched(true);
                        setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                      }}
                      style={{ borderRadius: "0 6px 6px 0", fontSize: "14px" }}
                      required
                    />
                  </div>
                </Field>
              </StepCard>
            </form>
          )}

          {step === "brand" && workspace && (
            <>
              <form onSubmit={submitBrand} noValidate>
                <StepCard
                  title={t("funderOnboarding.brand")}
                  note={t("funderOnboarding.yourAccentAppearsOnThe")}
                  footer={
                    <>
                      {back("organization")}
                      <button type="submit" className="btn btn-primary" disabled={!brand.passes || saveBrand.state === "saving"} aria-describedby="contrast-result">
                        {t("funderOnboarding.continueToTeam")}
                        <ArrowRight className="ic" aria-hidden="true" />
                      </button>
                    </>
                  }
                >
                  {saveBrand.error !== null && (needsSecondStep(saveBrand.error) ? <SecondStepNotice next="/onboarding/funder/brand" /> : <ErrorBanner error={saveBrand.error} title={t("funderOnboarding.theBrandCouldNotBe")} />)}
                  <div className="fld-row">
                    <Field id="accent" label={t("funderOnboarding.accentColor")} help={t("funderOnboarding.aHexColorSuchAs")}>
                      <div className="row" style={{ gap: "10px" }}>
                        <input type="color" aria-label={t("funderOnboarding.pickTheAccentColor")} value={isHexColor(accent) && accent.length === 7 ? accent : SYSTEM_BRAND.accent} onChange={(e) => setAccent(e.target.value.toUpperCase())} style={{ width: "36px", height: "36px", padding: 0, border: "1px solid #D6DEDE", borderRadius: "6px", flex: "none" }} />
                        <input className={isHexColor(accent) ? "inp mono" : "inp mono err"} id="accent" value={accent} onChange={(e) => setAccent(e.target.value.trim())} style={{ fontSize: "14px" }} />
                      </div>
                    </Field>
                    <Field id="onaccent" label={t("funderOnboarding.textOnAccent")}>
                      <div className="row" style={{ gap: "10px" }}>
                        <input type="color" aria-label={t("funderOnboarding.pickTheTextColor")} value={isHexColor(onAccent) && onAccent.length === 7 ? onAccent : SYSTEM_BRAND.onAccent} onChange={(e) => setOnAccent(e.target.value.toUpperCase())} style={{ width: "36px", height: "36px", padding: 0, border: "1px solid #D6DEDE", borderRadius: "6px", flex: "none" }} />
                        <input className={isHexColor(onAccent) ? "inp mono" : "inp mono err"} id="onaccent" value={onAccent} onChange={(e) => setOnAccent(e.target.value.trim())} style={{ fontSize: "14px" }} />
                      </div>
                    </Field>
                  </div>
                  <div id="contrast-result" role="status" aria-live="polite">
                    {brand.passes ? (
                      <span className="help row" style={{ gap: "5px", color: "var(--s-ok-fg)", fontWeight: 700 }}>
                        <Check className="ic ic-sm" aria-hidden="true" />
                        {t("funderOnboarding.contrast1PassesWcagAa", { toFixed: brand.ratio!.toFixed(1) })}
                      </span>
                    ) : (
                      <div className="bnr bnr-warn">
                        <TriangleExclamationPoint className="ic" aria-hidden="true" />
                        <div>
                          <div className="t">{brand.ratio === null ? t("funderOnboarding.enterBothColorsAsHex") : t("funderOnboarding.contrast1TextOnAccent", { toFixed: brand.ratio.toFixed(1) })}</div>
                          <div className="d">{brand.warning}</div>
                          <div className="clears">{t("funderOnboarding.continueStaysDisabledUntilThe")}</div>
                        </div>
                        {isHexColor(accent) && (
                          <button type="button" className="btn btn-sm btn-secondary act" onClick={() => (checkBrand(accent, suggestOnAccent(accent)).passes ? setOnAccent(suggestOnAccent(accent)) : (setAccent(SYSTEM_BRAND.accent), setOnAccent(SYSTEM_BRAND.onAccent)))}>
                            {t("funderOnboarding.useSuggestedPair")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <Field id="logo" label={t("funderOnboarding.logoAddress")} help={t("funderOnboarding.anHttpsLinkToAn")}>
                    <input className="inp" id="logo" type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder={t("funderOnboarding.https")} />
                  </Field>
                </StepCard>
              </form>
              <BrandPreview name={workspace.displayName} handle={workspace.handle} accent={accent} onAccent={onAccent} logoUrl={logoUrl.trim()} />
            </>
          )}

          {step === "team" && workspace && (
            <StepCard
              title={t("funderOnboarding.team")}
              note={t("funderOnboarding.youCanDoThisLater")}
              footer={
                <>
                  {back("brand")}
                  <button type="button" className="btn btn-primary" onClick={() => go("payments")}>
                    {t("funderOnboarding.continueToPayments")}
                    <ArrowRight className="ic" aria-hidden="true" />
                  </button>
                </>
              }
            >
              {warnings.map((w) => (
                <div className="bnr bnr-warn" role="status" key={w}>
                  <TriangleExclamationPoint className="ic" aria-hidden="true" />
                  <div className="d">{w}</div>
                </div>
              ))}
              {invite.error !== null && (needsSecondStep(invite.error) ? <SecondStepNotice next="/onboarding/funder/team" /> : <ErrorBanner error={invite.error} title={t("funderOnboarding.theInvitationCouldNotBe")} />)}
              <form onSubmit={submitInvite} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) auto", gap: "12px", alignItems: "end" }}>
                <Field id="invite-email" label={t("funderOnboarding.email")} error={problemFor(invite.error, "email")}>
                  <input className="inp" id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
                </Field>
                <Field id="invite-role" label={t("funderOnboarding.role")}>
                  <select className="sel" id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    {FUNDER_ROLES().map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <button type="submit" className="btn btn-secondary" disabled={invite.state === "saving" || !inviteEmail.trim()}>
                  {t("funderOnboarding.invite")}
                </button>
              </form>
              <span className="help">{t("funderOnboarding.adminsAndFinanceMustSet")}</span>
              {invited.length > 0 && (
                <ul aria-label={t("funderOnboarding.invitationsSent")} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {invited.map((i) => (
                    <li key={i.id} className="row" style={{ justifyContent: "space-between" }}>
                      <span className="b">{i.email}</span>
                      <span className="tag">{t("funderOnboarding.roleInvited", { role: FUNDER_ROLES().find((r) => r.value === i.role)?.label ?? i.role })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </StepCard>
          )}

          {step === "payments" && workspace && (
            <StepCard
              title={t("funderOnboarding.payments")}
              note={t("funderOnboarding.optionalNowAwardsWorkWithout")}
              footer={
                <>
                  {back("team")}
                  <button type="button" className="btn btn-primary" onClick={() => go("program")}>
                    {t("funderOnboarding.continueToFirstProgram")}
                    <ArrowRight className="ic" aria-hidden="true" />
                  </button>
                </>
              }
            >
              <p>
                {t("funderOnboarding.youDoNotNeedPassport")}
                {passportFlags.linking && ` ${t("funderOnboarding.connectOpengrantsPassportOnlyIf")}`}
              </p>
              {passportFlags.linking && <PassportLinkPanel workspaceId={workspace.id} />}
            </StepCard>
          )}

          {step === "program" && workspace && (
            <form onSubmit={submitProgram} noValidate>
              <StepCard
                title={t("funderOnboarding.firstProgram")}
                footer={
                  <>
                    {back("payments")}
                    <button type="submit" className="btn btn-primary" disabled={createProgram.state === "saving" || !programName.trim()}>
                      {t("funderOnboarding.createProgramAndFinish")}
                    </button>
                  </>
                }
              >
                {createProgram.error !== null && (needsSecondStep(createProgram.error) ? <SecondStepNotice next="/onboarding/funder/program" /> : <ErrorBanner error={createProgram.error} title={t("funderOnboarding.theProgramCouldNotBe")} />)}
                <p>{t("funderOnboarding.aProgramHoldsABudget")}</p>
                <Field id="first-program-name" label={t("funderOnboarding.programName")} required>
                  <input className="inp" id="first-program-name" value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder={t("funderOnboarding.communityHealth2027")} required />
                </Field>
                <div className="fld-row">
                  <Field id="first-program-fy" label={t("funderOnboarding.fiscalYear")}>
                    <input className="inp" id="first-program-fy" inputMode="numeric" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} />
                  </Field>
                  <Field id="first-program-budget" label={t("funderOnboarding.budgetUsd")} error={budgetError}>
                    <input className={budgetError ? "inp err" : "inp"} id="first-program-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="1,200,000" />
                  </Field>
                </div>
              </StepCard>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
