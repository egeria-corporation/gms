// SPDX-License-Identifier: AGPL-3.0-only
// Top bar for the screens that belong to the person, not to one workspace: notifications, account
// settings and the workspace list.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Bell, LayoutGrid } from "lucide-react";
import { initialsOf } from "../api/client.ts";
import { useServices } from "../app/services.tsx";

export function AccountShell({ active, children }: { active: "notifications" | "account" | "workspaces"; children: ReactNode }) {
  const { sessionState, meState } = useServices();
  const email = sessionState.status === "signedIn" ? sessionState.session.email : "";
  const home = meState.status === "ready" && meState.me.workspaces[0] ? `/w/${meState.me.workspaces[0].handle}` : "/";
  return (
    <div className="gms gms-frame">
      <header className="topbar">
        <Link to={home} className="logo">
          <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
          <span className="suffix">GMS</span>
        </Link>
        <Link to="/workspaces" className="ws" aria-current={active === "workspaces" ? "page" : undefined}>
          <LayoutGrid className="ic" aria-hidden="true" />
          Workspaces
        </Link>
        <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
          <Link to="/notifications" className="iconbtn" aria-label="Notifications" aria-current={active === "notifications" ? "page" : undefined} style={active === "notifications" ? { background: "var(--og-gray-100)", color: "var(--og-navy-dark)" } : undefined}>
            <Bell className="ic ic-md" aria-hidden="true" />
          </Link>
          <Link to="/account/agents" className="av" aria-label={`Account: ${email}`} aria-current={active === "account" ? "page" : undefined}>
            {initialsOf(email)}
          </Link>
        </div>
      </header>
      <main className="main" style={{ flex: "1 1 auto" }}>
        {children}
      </main>
    </div>
  );
}
