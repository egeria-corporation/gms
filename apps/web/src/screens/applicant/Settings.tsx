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
import { WhatWeEmailYouCard } from "../public/whatWeEmailYou.tsx";
import { t, useApplicantText } from "./i18n.ts";

/** The events an applicant workspace produces, in the order people meet them. */
export const EVENTS: { key: string; readonly label: string; readonly detail: string }[] = [
  { key: "application", get label() { return t("settings.event.application"); }, get detail() { return t("settings.event.applicationDetail"); } },
  { key: "decision", get label() { return t("settings.event.decision"); }, get detail() { return t("settings.event.decisionDetail"); } },
  { key: "award", get label() { return t("settings.event.award"); }, get detail() { return t("settings.event.awardDetail"); } },
  { key: "agreement", get label() { return t("settings.event.agreement"); }, get detail() { return t("settings.event.agreementDetail"); } },
  { key: "payment", get label() { return t("settings.event.payment"); }, get detail() { return t("settings.event.paymentDetail"); } },
  { key: "requirement", get label() { return t("settings.event.requirement"); }, get detail() { return t("settings.event.requirementDetail"); } },
  { key: "outside_deadline", get label() { return t("settings.event.outsideDeadline"); }, get detail() { return t("settings.event.outsideDeadlineDetail"); } },
  { key: "outside_obligation_due", get label() { return t("settings.event.outsideObligationDue"); }, get detail() { return t("settings.event.outsideObligationDueDetail"); } },
  { key: "outside_next_cycle", get label() { return t("settings.event.outsideNextCycle"); }, get detail() { return t("settings.event.outsideNextCycleDetail"); } },
  { key: "document_expiring", get label() { return t("settings.event.documentExpiring"); }, get detail() { return t("settings.event.documentExpiringDetail"); } },
  { key: "submission", get label() { return t("settings.event.submission"); }, get detail() { return t("settings.event.submissionDetail"); } },
  { key: "organization", get label() { return t("settings.event.organization"); }, get detail() { return t("settings.event.organizationDetail"); } },
  { key: "approval", get label() { return t("settings.event.approval"); }, get detail() { return t("settings.event.approvalDetail"); } },
  { key: "agent", get label() { return t("settings.event.agent"); }, get detail() { return t("settings.event.agentDetail"); } },
];
const DIGESTS = (): { value: NotificationPreferences["digest"]; label: string }[] => [
  { value: "immediate", label: t("settings.digest.immediate") },
  { value: "daily", label: t("settings.digest.daily") },
  { value: "weekly", label: t("settings.digest.weekly") },
  { value: "off", label: t("settings.digest.off") },
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
          <h2 style={{ fontSize: "18px" }}>{t("settings.notifications")}</h2>
          <p className="small muted">{t("settings.perEventForYouInThis")}</p>
        </div>
        <SaveNote state={save.state} />
      </div>
      <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label={t("settings.notificationPreferencesScrollable")}>
        <table className="tbl" style={{ fontSize: "15px" }}>
          <caption className="sr">{t("settings.notificationPreferencesByEvent")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("settings.event")}</th>
              <th scope="col">{t("settings.inApp")}</th>
              <th scope="col">{t("settings.email")}</th>
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
                  <button type="button" className={`tog${channel(e.key).inApp ? " on" : ""}`} role="switch" aria-checked={channel(e.key).inApp} aria-label={t("settings.eventInApp", { event: e.label })} onClick={() => toggle(e.key, "inApp")}></button>
                </td>
                <td>
                  <button type="button" className={`tog${channel(e.key).email ? " on" : ""}`} role="switch" aria-checked={channel(e.key).email} aria-label={t("settings.eventEmail", { event: e.label })} onClick={() => toggle(e.key, "email")}></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-f" style={{ gap: "14px", flexWrap: "wrap" }}>
        <label className="lbl" htmlFor="digest">
          {t("settings.emailDigest")}
        </label>
        <select className="sel" id="digest" style={{ maxWidth: "260px" }} value={prefs.digest} onChange={(e) => void update({ ...prefs, digest: e.target.value as NotificationPreferences["digest"] })}>
          {DIGESTS().map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="help">{t("settings.inAppChoicesTakeEffectNow")}</span>
      </div>
      {save.error ? (
        <div style={{ padding: "0 20px 16px" }}>
          <ErrorBanner error={save.error} title={t("settings.yourPreferencesWereNotSaved")} />
        </div>
      ) : null}
    </div>
  );
}

export default function Settings() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useMoreQuery((api) => api.notificationPreferences(), [ws.id]);
  return (
    <>
      <title>{t("settings.pageTitle", { workspace: ws.name })}</title>
      <ApplicantShell active="Settings">
        <main className="main">
          <nav className="crumbs" aria-label={t("settings.breadcrumb")}>
            <Link to={base}>{t("settings.dashboard")}</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{t("settings.settings")}</span>
          </nav>
          <div className="ph">
            <div>
              <div className="title">
                <h1>{t("settings.workspaceSettings")}</h1>
              </div>
              <div className="meta">
                <span>{ws.name}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {t.rich("settings.accountLevel", { link: (chunks) => <Link to="/account/agents">{chunks}</Link> })}
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <OrganizationProfileCard workspaceId={ws.id} connectTo="/onboarding/applicant" />
              <Loaded query={query} label={t("settings.loadingYourPreferences")}>
                {(prefs) => <Preferences initial={prefs} />}
              </Loaded>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <WhatWeEmailYouCard workspaceId={ws.id} />
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
