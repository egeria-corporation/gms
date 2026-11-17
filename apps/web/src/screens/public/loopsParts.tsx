// SPDX-License-Identifier: AGPL-3.0-only
// What the funder loops' public pages share (E4): their frame, and funder setup's first step in
// place (name and handle, the same `POST /gms/workspaces` as funder setup), after which the new
// workspace is counted for the link the person came from and the normal funder setup continues
// with its brand step. Signed out, the person signs in with the normal sign-in first and comes back.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowRight, Handshake, Mail, Sparkles } from "lucide-react";
import { forgetReferral, rememberReferral, type ReferralSource } from "../../api/loops.ts";
import { useLoopsApi } from "../../api/loopsHooks.ts";
import { useServices } from "../../app/services.tsx";
import { signInPath } from "../../auth/RequireAuth.tsx";
import { LanguageSwitcher } from "../../components/LanguageSwitcher.tsx";
import { ErrorBanner, Field, problemFor } from "../../components/ui.tsx";
import { translator } from "../../i18n/index.tsx";
import { slugify } from "../../lib/format.ts";

const t = translator("public");

/** Funder setup keeps the workspace it is setting up here (FunderOnboarding.tsx's RESUME_KEY), so it opens at the brand step. */
export const FUNDER_SETUP_RESUME_KEY = "gms.onboarding.funder";

export function LoopsFrame({ children }: { children: ReactNode }) {
  const { sessionState } = useServices();
  const signedIn = sessionState.status === "signedIn";
  return (
    <div className="gms pub gms-frame" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid var(--og-gray-200)", background: "var(--og-white)" }}>
        <div className="wrap-c" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", minHeight: "64px", flexWrap: "wrap" }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--og-navy-dark)", fontSize: "16px" }}>
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" style={{ height: "22px", width: "auto", display: "block" }} />
            <span style={{ color: "var(--og-teal-dark)", fontWeight: 500 }}>GMS</span>
          </Link>
          <nav aria-label={t("loops.nav.primary")} style={{ display: "flex", alignItems: "center", gap: "24px", fontSize: "14px", fontWeight: 700, flexWrap: "wrap" }}>
            <Link to="/for-funders" style={{ color: "var(--og-gray-800)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <Sparkles className="ic" aria-hidden="true" />
              {t("loops.nav.forFunders")}
            </Link>
            <Link to="/partners" style={{ color: "var(--og-gray-800)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <Handshake className="ic" aria-hidden="true" />
              {t("loops.nav.partners")}
            </Link>
            {signedIn ? (
              <Link to="/workspaces" className="btn btn-secondary">
                {t("loops.nav.yourWorkspaces")}
              </Link>
            ) : (
              <Link to="/signin" className="btn btn-secondary">
                {t("loops.nav.signIn")}
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
      <footer className="pub-foot">
        <div className="wrap-c">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
            <span>{t("loops.footer.free")}</span>
          </div>
          <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
            <Link to="/">{t("loops.footer.about")}</Link>
          </div>
        </div>
        <div className="wrap-c lang-row">
          <LanguageSwitcher />
        </div>
      </footer>
    </div>
  );
}

/**
 * Funder setup's first step, where the person is: sign in (the normal sign-in) when signed out,
 * then the organization's name and public handle. The workspace is made the way funder setup makes
 * it, counted for `source`'s link, and the person continues with funder setup's brand step (after
 * the second step of sign-in, which a funder admin needs).
 */
export function FunderQuickStart({ source, token, joiningWith, headingId }: { source: ReferralSource; token: string | null; joiningWith?: string | null; headingId: string }) {
  const { api, sessionState, meState, reloadMe } = useServices();
  const loops = useLoopsApi();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const handleValue = handleTouched ? handle : slugify(name).slice(0, 40);

  if (sessionState.status !== "signedIn") {
    const back = `${location.pathname}${location.search ? `${location.search}&` : "?"}setup=1`;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <p className="muted">{t("loops.quickStart.signInFirst")}</p>
        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (token) rememberReferral({ source, token, name: joiningWith ?? null });
              navigate(signInPath(back));
            }}
          >
            <Mail className="ic" aria-hidden="true" />
            {t("loops.quickStart.continueWithEmail")}
          </button>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await api.createWorkspace({ kind: "funder", handle: handleValue, displayName: name.trim() });
      // Counting never stands in the way of setup: a refusal is not shown.
      if (token) await loops.claim({ workspaceId: made.workspace.id, source, token }).catch(() => undefined);
      forgetReferral();
      try {
        window.sessionStorage.setItem(FUNDER_SETUP_RESUME_KEY, made.workspace.id);
      } catch {
        // Without session storage funder setup starts again from its first step, which finds the workspace made.
      }
      reloadMe();
      const verified = meState.status === "ready" && meState.me.mfaVerified;
      navigate(verified ? "/onboarding/funder/brand" : signInPath("/onboarding/funder/brand", "mfa"));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "12px" }} aria-labelledby={headingId}>
      {joiningWith && <p className="small muted">{t("loops.quickStart.joiningWith", { name: joiningWith })}</p>}
      <Field id={`${headingId}-name`} label={t("loops.quickStart.organizationName")} required help={t("loops.quickStart.organizationNameHelp")} error={problemFor(error, "displayName")}>
        <input id={`${headingId}-name`} className="inp" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
      </Field>
      <Field id={`${headingId}-handle`} label={t("loops.quickStart.publicHandle")} help={t("loops.quickStart.publicHandleHelp", { handle: handleValue || t("loops.quickStart.yourHandle") })} error={problemFor(error, "handle")}>
        <input
          id={`${headingId}-handle`}
          className="inp mono"
          value={handleValue}
          onChange={(e) => {
            setHandleTouched(true);
            setHandle(e.target.value.toLowerCase());
          }}
        />
      </Field>
      {error ? <ErrorBanner error={error} title={t("loops.quickStart.notCreated")} /> : null}
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || handleValue.length < 3}>
          {busy ? t("loops.quickStart.creating") : t("loops.quickStart.create")}
          <ArrowRight className="ic" aria-hidden="true" />
        </button>
      </div>
      <p className="small muted">{t("loops.quickStart.free")}</p>
    </form>
  );
}
