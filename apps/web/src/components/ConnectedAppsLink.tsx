// SPDX-License-Identifier: AGPL-3.0-only
// The applicant Settings card that leads to Settings › Connected apps (v1.12.0). Its own file, so
// the Settings page does not load the Connected apps screen. Shown only when this server has at
// least one connected app set up.
import { Link } from "react-router";
import { BellRing } from "lucide-react";
import { useAppConfig } from "../api/launchHooks.ts";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { translator, useExtrasMessages } from "../i18n/index.tsx";

const t = translator("extras");

/** A card on the applicant's Settings page that leads to Connected apps. */
export function ConnectedAppsLinkCard() {
  useExtrasMessages();
  const ws = useCurrentWorkspace()!;
  const available = useAppConfig().available;
  if (!available?.slack && !available?.googleCalendar && !available?.googleDrive && !available?.salesforce) return null;
  return (
    <section className="card" aria-labelledby="ca-link-h">
      <div className="card-h">
        <h3 id="ca-link-h" className="row" style={{ gap: "8px" }}>
          <BellRing className="ic" aria-hidden="true" />
          {t("connectedApps.title")}
        </h3>
      </div>
      <div className="card-b">
        <p className="small" style={{ marginTop: 0 }}>
          {t("connectedApps.linkCard")}
        </p>
        <Link to={`/w/${ws.handle}/settings/apps`} className="btn btn-sm btn-secondary">
          {t("connectedApps.open")}
        </Link>
      </div>
    </section>
  );
}
