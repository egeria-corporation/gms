// SPDX-License-Identifier: AGPL-3.0-only
// Every workspace the signed-in person belongs to, as a page: the same list the top bar's
// workspace menu opens (design board P5), for the places that have no workspace yet in view.
import { Link, useNavigate } from "react-router";
import { ArrowRight, Building, Landmark, LogOut, Plus } from "lucide-react";
import { roleTitle, type MeWorkspace } from "../../api/client.ts";
import { useServices } from "../../app/services.tsx";
import { signInPath } from "../../auth/RequireAuth.tsx";
import { AccountShell } from "../../components/AccountShell.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";

function Card({ ws }: { ws: MeWorkspace }) {
  const funder = ws.kind === "funder";
  const Icon = funder ? Landmark : Building;
  return (
    <li>
      <Link to={`/w/${ws.handle}`} className="card" style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) auto", gap: "14px", alignItems: "center", padding: "16px 20px", textDecoration: "none", color: "inherit" }}>
        <span aria-hidden="true" style={{ width: "44px", height: "44px", borderRadius: "10px", background: funder ? "var(--og-navy-dark)" : "var(--og-blue-light)", color: funder ? "var(--og-white)" : "var(--s-info-fg)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon className="ic ic-md" aria-hidden="true" />
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
          <span className="b" style={{ color: "var(--og-navy-dark)", fontSize: "16px" }}>
            {ws.name}
          </span>
          <span className="small muted">
            {roleTitle(ws.role)}
            {ws.requiresMfa ? " · authenticator required" : ""}
          </span>
        </span>
        <span className="row" style={{ gap: "10px" }}>
          <span className="role">{funder ? "Funder" : "Applicant"}</span>
          <ArrowRight className="ic" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

export default function WorkspaceSwitcher() {
  const { auth, sessionState, meState, reloadMe } = useServices();
  const navigate = useNavigate();
  const signedOut = sessionState.status === "signedOut";
  return (
    <>
      <title>Workspaces — OpenGrants GMS</title>
      <AccountShell active="workspaces">
        <div className="ph">
          <div>
            <div className="title">
              <h1>Workspaces</h1>
            </div>
            <div className="meta">
              <span>An organization that both funds and applies has one workspace for each side.</span>
            </div>
          </div>
          {!signedOut && (
            <div className="actions">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={async () => {
                  await auth.signOut();
                  navigate("/signin");
                }}
              >
                <LogOut className="ic" aria-hidden="true" />
                Sign out
              </button>
            </div>
          )}
        </div>
        {signedOut && (
          <div className="card">
            <EmptyState icon={Building} title="Sign in to see your workspaces" actions={<Link to={signInPath("/workspaces")} className="btn btn-primary">Sign in</Link>} />
          </div>
        )}
        {!signedOut && (meState.status === "loading" || sessionState.status === "loading") && <Loading label="Loading your workspaces" />}
        {!signedOut && meState.status === "error" && <ErrorBanner error={meState.error} onRetry={reloadMe} />}
        {!signedOut && meState.status === "ready" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "760px" }}>
            {meState.me.workspaces.length === 0 ? (
              <div className="card">
                <EmptyState icon={Building} title="You are not in a workspace yet">
                  Create a funder workspace, or connect your organization from Passport to apply.
                </EmptyState>
              </div>
            ) : (
              <ul style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {meState.me.workspaces.map((ws) => (
                  <Card key={ws.id} ws={ws} />
                ))}
              </ul>
            )}
            <div className="row" style={{ gap: "12px", flexWrap: "wrap" }}>
              <Link to="/onboarding/funder" className="btn btn-secondary">
                <Plus className="ic" aria-hidden="true" />
                Create a funder workspace
              </Link>
              <Link to="/onboarding/applicant" className="btn btn-secondary">
                <Plus className="ic" aria-hidden="true" />
                Set up an applicant organization
              </Link>
            </div>
          </div>
        )}
      </AccountShell>
    </>
  );
}
