// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Payments: the workspace's connection to OpenGrants Passport.
import { Link } from "react-router";
import { useWorkspace } from "../../app/workspace.tsx";
import { usePassportFlags } from "../../api/launchHooks.ts";
import { OrganizationProfileCard } from "../../components/OrganizationProfileCard.tsx";
import { PassportLinkPanel } from "../../components/PassportLinkPanel.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { PageHeader } from "../../components/ui.tsx";
import { t } from "./i18n.ts";

/** The sections of funder settings. Sections not built yet are not listed. */
export function SettingsNav({
  base,
  active,
}: {
  base: string;
  active: "passport" | "mcp" | "public-page" | "funds" | "security" | "social";
}) {
  const items = [
    {
      key: "passport",
      label: t("settingsPassport.paymentsPassport"),
      to: `${base}/settings/passport`,
    },
    { key: "public-page", label: t("settingsPassport.publicPage"), to: `${base}/settings/public-page` },
    { key: "funds", label: t("settingsPassport.funds"), to: `${base}/settings/funds` },
    { key: "mcp", label: t("settingsPassport.agentsMcp"), to: `${base}/settings/mcp` },
    { key: "security", label: t("settingsPassport.securitySingleSignOn"), to: `${base}/settings/security` },
    { key: "social", label: t("settingsPassport.socialAccounts"), to: `${base}/settings/social` },
  ] as const;
  return (
    <nav
      className="card snav"
      style={{ padding: "8px" }}
      aria-label={t("settingsPassport.settingsSections")}
    >
      {items.map((i) => (
        <Link
          key={i.key}
          to={i.to}
          className={i.key === active ? "on" : undefined}
          aria-current={i.key === active ? "page" : undefined}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export default function SettingsPassport() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const flags = usePassportFlags();
  return (
    <FunderShell active="Settings">
      <title>{t("settingsPassport.paymentsSettings", { name: ws.name })}</title>
      <main className="main">
        <PageHeader
          crumbs={[
            { label: ws.name, to: base },
            { label: t("settingsPassport.settings") },
            { label: t("settingsPassport.payments") },
          ]}
          title={t("settingsPassport.settings")}
          meta={<span>{ws.name}</span>}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "220px minmax(0, 1fr)",
            gap: "20px",
            alignItems: "start",
          }}
        >
          <SettingsNav base={base} active="passport" />
          <div
            style={{ display: "flex", flexDirection: "column", gap: "20px" }}
          >
            <OrganizationProfileCard
              workspaceId={ws.id}
              connectTo={`${base}/settings/passport#passport-title`}
            />
            {flags.linking && (
              <section className="card" aria-labelledby="passport-title">
                <div className="card-h">
                  <div>
                    <h2 id="passport-title">OpenGrants Passport</h2>
                    <p className="small muted">
                      {t("settingsPassport.passportHoldsEachGrantees")}
                    </p>
                  </div>
                </div>
                <div className="card-b">
                  <PassportLinkPanel workspaceId={ws.id} />
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </FunderShell>
  );
}
