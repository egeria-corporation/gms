// SPDX-License-Identifier: AGPL-3.0-only
// Workspace shells: top bar + navigation rail around every funder and applicant screen.
// Markup and class names follow the design canvas (theme/app.css: .topbar, .rail, .shell, .phone-*).
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import {
  Award,
  Banknote,
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  Building,
  ChartColumn,
  CircleQuestionMark,
  ClipboardCheck,
  FileText,
  House,
  Inbox,
  Landmark,
  Layers,
  LayoutDashboard,
  Mail,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useWorkspace, type Workspace } from "../app/workspace.tsx";
import { WorkspaceMenu } from "./WorkspaceMenu.tsx";

interface RailItem {
  label: string;
  icon: LucideIcon;
  /** Path under `/w/:handle`. */
  path: string;
  count?: number;
}

interface ShellProps {
  /** Label of the rail item to mark current. */
  active: string;
  /** Rendered after the shell, above the page: dialogs and overlays. */
  overlay?: ReactNode;
  children: ReactNode;
}

function tenantStyle(ws: Workspace): CSSProperties {
  return { "--tenant": ws.brand.accent, "--on-tenant": ws.brand.onAccent } as CSSProperties;
}

function TopBar({
  ws,
  roleLabel,
  searchLabel,
  avatarClass,
}: {
  ws: Workspace;
  roleLabel: string;
  searchLabel: string;
  avatarClass: string;
}) {
  const unread = ws.unreadNotifications;
  return (
    <header className="topbar">
      <Link to={`/w/${ws.handle}`} className="logo">
        <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
        <span className="suffix">GMS</span>
      </Link>
      <WorkspaceMenu currentHandle={ws.handle}>
        {ws.name} <span className="role">{roleLabel}</span>
      </WorkspaceMenu>
      <div className="search">
        <Search className="ic" aria-hidden="true" />
        <input type="search" aria-label={searchLabel} placeholder={searchLabel} />
        <span className="kbd">⌘K</span>
      </div>
      <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
        <Link to="/notifications" className="iconbtn" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell className="ic ic-md" aria-hidden="true" />
          {unread > 0 && <span className="dot"></span>}
        </Link>
        <button className="iconbtn" aria-label="Help">
          <CircleQuestionMark className="ic ic-md" aria-hidden="true" />
        </button>
        <Link to="/account/agents" className={avatarClass} aria-label={`Account: ${ws.member.name}`}>
          {ws.member.initials}
        </Link>
      </div>
    </header>
  );
}

function RailList({ ws, items, active }: { ws: Workspace; items: RailItem[]; active: string }) {
  return (
    <ul>
      {items.map(({ label, icon: Icon, path, count }) => {
        const on = label === active;
        return (
          <li key={label}>
            <Link to={`/w/${ws.handle}${path}`} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
              <Icon className="ic" aria-hidden="true" />
              {label}
              {count ? <span className="count">{count}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function funderRail(ws: Workspace): RailItem[] {
  return [
    { label: "Dashboard", icon: LayoutDashboard, path: "" },
    { label: "Programs", icon: Briefcase, path: "/programs" },
    { label: "Opportunities", icon: Layers, path: "/opportunities" },
    { label: "Applications", icon: Inbox, path: "/applications" },
    { label: "Reviews", icon: ClipboardCheck, path: "/reviews/assign" },
    { label: "Awards", icon: Award, path: "/awards" },
    { label: "Payments", icon: Banknote, path: "/payments/due" },
    { label: "Reporting", icon: FileText, path: "/reporting" },
    { label: "Grantees", icon: Users, path: "/grantees/org_alder-creek" },
    { label: "Analytics", icon: ChartColumn, path: "/analytics" },
    { label: "Communications", icon: Mail, path: "/communications" },
    { label: "Approvals", icon: Bot, path: "/approvals", count: ws.pendingApprovals },
    { label: "Settings", icon: Settings, path: "/settings" },
  ];
}

const APPLICANT_RAIL: RailItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "" },
  { label: "Organization", icon: Building, path: "/organization" },
  { label: "Find funding", icon: Search, path: "/find" },
  { label: "Applications", icon: FileText, path: "/applications" },
  { label: "My grants", icon: Award, path: "/grants" },
  { label: "Reports", icon: ClipboardCheck, path: "/reports" },
  { label: "Answer library", icon: BookOpen, path: "/library" },
  { label: "Funders", icon: Landmark, path: "/funders" },
  { label: "Team & access", icon: Users, path: "/team" },
  { label: "Settings", icon: Settings, path: "/settings" },
];

/** Bottom tabs shown at phone width in the applicant workspace. */
const APPLICANT_TABS: Array<RailItem & { rail: string[] }> = [
  { label: "Home", icon: House, path: "", rail: ["Dashboard"] },
  { label: "Apply", icon: FileText, path: "/applications", rail: ["Applications", "Find funding"] },
  { label: "Grants", icon: Award, path: "/grants", rail: ["My grants"] },
  { label: "Reports", icon: ClipboardCheck, path: "/reports", rail: ["Reports"] },
  { label: "Org", icon: Building, path: "/organization", rail: ["Organization"] },
];

export function FunderShell({ active, overlay, firstRun = false, children }: ShellProps & { firstRun?: boolean }) {
  const base = useWorkspace("funder");
  // A first-run workspace has nothing waiting on anyone yet.
  const ws = firstRun ? { ...base, unreadNotifications: 0, pendingApprovals: 0 } : base;
  return (
    <div className="gms gms-funder gms-frame" style={tenantStyle(ws)}>
      <TopBar ws={ws} roleLabel="Funder" searchLabel="Search applications, awards, grantees, opportunities" avatarClass="av" />
      <div className="shell">
        <nav className="rail" aria-label="Funder workspace">
          <div className="rail-tenant">
            <div className="name">{ws.name}</div>
            <div className="sub">{ws.sub}</div>
          </div>
          <RailList ws={ws} items={funderRail(ws)} active={active} />
          <div className="rail-foot">
            {ws.member.name} · {ws.member.title}
          </div>
        </nav>
        {children}
      </div>
      {overlay}
    </div>
  );
}

export function ApplicantShell({ active, overlay, children }: ShellProps) {
  const ws = useWorkspace("applicant");
  return (
    <div className="gms gms-applicant gms-frame" style={tenantStyle(ws)}>
      <TopBar ws={ws} roleLabel="Applicant" searchLabel="Search applications, grants, reports, funders" avatarClass="av av-t" />
      <div className="shell">
        <nav className="rail" aria-label="Applicant workspace">
          <div className="rail-brand">
            <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "24px", height: "24px" }} />
            <div>
              <div className="name">{ws.name}</div>
              <div className="small muted">{ws.sub}</div>
            </div>
          </div>
          <RailList ws={ws} items={APPLICANT_RAIL} active={active} />
          <div className="rail-foot">
            {ws.member.name} · {ws.member.title}
          </div>
        </nav>
        {children}
      </div>
      <nav className="phone-tabs gms-phone-only" aria-label="Primary">
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
