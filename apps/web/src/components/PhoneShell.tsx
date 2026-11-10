// SPDX-License-Identifier: AGPL-3.0-only
// The applicant workspace at phone width, as the design's 390px artboards draw it: a compact bar
// (menu, mark, screen title, notifications, account), the page, an optional sticky sheet, and the
// five bottom tabs. The menu opens the full list of workspace destinations.
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bell, Menu, X } from "lucide-react";
import { useWorkspace } from "../app/workspace.tsx";
import { APPLICANT_RAIL, APPLICANT_TABS, tenantStyle } from "./shells.tsx";

export interface PhoneShellProps {
  /** Shown in the bar; the page's own heading. */
  title: string;
  /** Label of the rail item this screen belongs to. */
  active: string;
  /** Sticks above the bottom tabs (the editor's validation and comments sheet). */
  sheet?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}

export function PhoneShell({ title, active, sheet, overlay, children }: PhoneShellProps) {
  const ws = useWorkspace("applicant");
  const [menu, setMenu] = useState(false);
  const unread = ws.unreadNotifications;
  return (
    <div className="gms gms-applicant gms-phone gms-frame" style={{ ...tenantStyle(ws), background: "var(--og-gray-50)" }}>
      <header className="phone-bar">
        <button className="iconbtn" type="button" aria-label={menu ? "Close menu" : "Menu"} aria-expanded={menu} aria-controls="phone-menu" style={{ width: "44px", height: "44px" }} onClick={() => setMenu(!menu)}>
          {menu ? <X className="ic ic-md" aria-hidden="true" /> : <Menu className="ic ic-md" aria-hidden="true" />}
        </button>
        <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "24px", height: "24px" }} />
        <h1 style={{ fontSize: "17px", flex: 1, minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h1>
        <Link to="/notifications" className="iconbtn" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} style={{ width: "44px", height: "44px" }}>
          <Bell className="ic ic-md" aria-hidden="true" />
          {unread > 0 && <span className="dot"></span>}
        </Link>
        <Link to="/account/agents" className="av av-t" style={{ width: "36px", height: "36px", fontSize: "12px" }}>
          <span aria-hidden="true">{ws.member.initials}</span>
          <span className="sr">Account: {ws.member.name}</span>
        </Link>
      </header>
      {menu && (
        <nav id="phone-menu" className="rail" aria-label="Applicant workspace" style={{ flex: "none", borderRight: 0, borderBottom: "1px solid var(--og-gray-200)" }}>
          <div className="rail-brand">
            <div>
              <div className="name">{ws.name}</div>
              <div className="small muted">{ws.sub}</div>
            </div>
          </div>
          <ul>
            {APPLICANT_RAIL.map(({ label, icon: Icon, path }) => (
              <li key={label}>
                <Link to={`/w/${ws.handle}${path}`} className={label === active ? "on" : undefined} aria-current={label === active ? "page" : undefined} style={{ height: "44px" }} onClick={() => setMenu(false)}>
                  <Icon className="ic" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/workspaces" style={{ height: "44px" }}>
                Switch workspace
              </Link>
            </li>
          </ul>
        </nav>
      )}
      {children}
      {sheet}
      <nav className="phone-tabs" aria-label="Primary" style={{ position: "sticky", bottom: 0, zIndex: 4 }}>
        {APPLICANT_TABS.map(({ label, icon: Icon, path, rail }) => {
          const on = rail.includes(active);
          return (
            <Link key={label} to={`/w/${ws.handle}${path}`} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
              <Icon className="ic ic-md" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
      {overlay}
    </div>
  );
}
