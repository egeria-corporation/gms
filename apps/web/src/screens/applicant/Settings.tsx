// SPDX-License-Identifier: AGPL-3.0-only
// Workspace settings for the signed-in member: which events reach them in this workspace, in the
// app and by email, and how email is batched. Account-level settings live in Account settings.
import { useState } from "react";
import { Link } from "react-router";
import type { NotificationPreferences } from "../../api/applicantMore.ts";
import { useMoreMutation, useMoreQuery } from "../../api/applicantMoreHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { OrganizationProfileCard } from "../../components/OrganizationProfileCard.tsx";
import { Loaded } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { ErrorBanner, SaveNote } from "../../components/ui.tsx";
import { DangerZone, ExportsCard, TokensCard } from "./settingsCards.tsx";
import { CalendarFeedCard } from "./outside/CalendarFeedCard.tsx";
import { GrantSettingsCard } from "./outside/GrantSettingsCard.tsx";

/** The events an applicant workspace produces, in the order people meet them. */
export const EVENTS: { key: string; label: string; detail: string }[] = [
  { key: "application", label: "Application status changes", detail: "Submitted, under review, revision requested, withdrawn" },
  { key: "decision", label: "Decisions", detail: "Accepted, declined or waitlisted" },
  { key: "award", label: "Awards and amendments", detail: "Offers, acceptance, amendment decisions" },
  { key: "agreement", label: "Agreements", detail: "Sent for signature, countersigned, executed" },
  { key: "payment", label: "Payments", detail: "Sent, settled or paused; bank name and last four only" },
  { key: "requirement", label: "Report reminders", detail: "A requirement is coming due or overdue" },
  { key: "outside_deadline", label: "Application deadlines", detail: "Applications you track here: 14, 7 and 2 days before a deadline, and on the day" },
  { key: "outside_obligation_due", label: "Grant reports and conditions", detail: "Outside awards: 30, 14 and 7 days before, on the day, and 3 and 14 days after if not done" },
  { key: "outside_next_cycle", label: "Next cycle", detail: "The day a funder that said no opens its next cycle" },
  { key: "document_expiring", label: "Documents expiring", detail: "A document in your vault expires within 30 days" },
  { key: "submission", label: "Report reviews", detail: "A report was accepted or returned with comments" },
  { key: "organization", label: "Organization and consent", detail: "Passport record changes, funders asking to read more" },
  { key: "approval", label: "Approvals", detail: "An agent is waiting for your decision" },
  { key: "agent", label: "Agent activity", detail: "Agents connected or disconnected" },
];
const DIGESTS: { value: NotificationPreferences["digest"]; label: string }[] = [
  { value: "immediate", label: "Send each email at once" },
  { value: "daily", label: "Daily digest" },
  { value: "weekly", label: "Weekly digest" },
  { value: "off", label: "No email" },
];

function Preferences({ initial }: { initial: NotificationPreferences }) {
  const [prefs, setPrefs] = useState(initial);
  const save = useMoreMutation((api, next: NotificationPreferences) => api.saveNotificationPreferences(next));
  const update = async (next: NotificationPreferences) => {
    setPrefs(next);
    const saved = await save.run(next);
    if (saved) setPrefs(saved);
  };
  const channel = (key: string) => prefs.channels[key] ?? { inApp: true, email: true };
  const toggle = (key: string, which: "inApp" | "email") => void update({ ...prefs, channels: { ...prefs.channels, [key]: { ...channel(key), [which]: !channel(key)[which] } } });
  return (
    <div className="card" id="notifications">
      <div className="card-h">
        <div>
          <h2 style={{ fontSize: "18px" }}>Notifications</h2>
          <p className="small muted">Per event, for you, in this workspace. Email can be sent at once or in a digest.</p>
        </div>
        <SaveNote state={save.state} />
      </div>
      <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label="Notification preferences, scrollable">
        <table className="tbl" style={{ fontSize: "15px" }}>
          <caption className="sr">Notification preferences by event</caption>
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">In-app</th>
              <th scope="col">Email</th>
            </tr>
          </thead>
          <tbody>
            {EVENTS.map((e) => (
              <tr key={e.key}>
                <td style={{ whiteSpace: "normal" }}>
                  <div className="ent">
                    <span className="nm">{e.label}</span>
                    <span className="small muted">{e.detail}</span>
                  </div>
                </td>
                <td>
                  <button type="button" className={`tog${channel(e.key).inApp ? " on" : ""}`} role="switch" aria-checked={channel(e.key).inApp} aria-label={`${e.label}, in-app`} onClick={() => toggle(e.key, "inApp")}></button>
                </td>
                <td>
                  <button type="button" className={`tog${channel(e.key).email ? " on" : ""}`} role="switch" aria-checked={channel(e.key).email} aria-label={`${e.label}, email`} onClick={() => toggle(e.key, "email")}></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-f" style={{ gap: "14px", flexWrap: "wrap" }}>
        <label className="lbl" htmlFor="digest">
          Email digest
        </label>
        <select className="sel" id="digest" style={{ maxWidth: "260px" }} value={prefs.digest} onChange={(e) => void update({ ...prefs, digest: e.target.value as NotificationPreferences["digest"] })}>
          {DIGESTS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="help">In-app choices take effect now. Email delivery follows these choices once email notifications are switched on for your workspace.</span>
      </div>
      {save.error ? (
        <div style={{ padding: "0 20px 16px" }}>
          <ErrorBanner error={save.error} title="Your preferences were not saved" />
        </div>
      ) : null}
    </div>
  );
}

export default function Settings() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useMoreQuery((api) => api.notificationPreferences(), [ws.id]);
  return (
    <>
      <title>{`Settings — ${ws.name}`}</title>
      <ApplicantShell active="Settings">
        <main className="main">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to={base}>Dashboard</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">Settings</span>
          </nav>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Workspace settings</h1>
              </div>
              <div className="meta">
                <span>{ws.name}</span>
                <span aria-hidden="true">·</span>
                <span>
                  Account-level settings (profile, authenticator, sessions, connected agents) live in <Link to="/account/agents">Account settings</Link>
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <OrganizationProfileCard workspaceId={ws.id} connectTo="/onboarding/applicant" />
              <Loaded query={query} label="Loading your preferences">
                {(prefs) => <Preferences initial={prefs} />}
              </Loaded>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <GrantSettingsCard />
              <CalendarFeedCard />
              <TokensCard base={base} />
              <ExportsCard handle={ws.handle} />
              <DangerZone workspaceId={ws.id} name={ws.name} />
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
