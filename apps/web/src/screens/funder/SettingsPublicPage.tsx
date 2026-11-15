// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Public page: what the funder's public pages, apply widget and application receipt
// email show about OpenGrants. "Powered by" is on by default; an admin can turn it off. The switch
// flips at once and the save follows; if the save fails the switch goes back and says why.
import { useState } from "react";
import { Link } from "react-router";
import { Circle, CircleCheck, Info, Lock } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Loading, PageHeader, SaveNote } from "../../components/ui.tsx";
import { POWERED_BY_LABEL } from "../public/PublicFrame.tsx";
import { SettingsNav } from "./SettingsPassport.tsx";
import { AwardListingCard } from "./AwardListingSettings.tsx";

export function PoweredByCard() {
  const ws = useWorkspace("funder");
  const isAdmin = ws.member.role === "admin";
  const record = useApiQuery((api) => api.workspaceRecord(ws.id), [ws.id]);
  // Only this key is sent: the server merges it into the workspace's settings.
  const save = useApiMutation((api, poweredBy: boolean) => api.updateWorkspace(ws.id, { settings: { poweredBy } }));
  const [pending, setPending] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const saved = (record.data?.settings as { poweredBy?: unknown } | undefined)?.poweredBy !== false;
  const on = pending ?? saved;

  async function toggle() {
    setFailed(false);
    setPending(!on);
    const out = await save.run(!on);
    if (out) record.set(out.workspace);
    else setFailed(true);
    setPending(null);
  }

  return (
    <section className="card" aria-labelledby="powered-h">
      <div className="card-h">
        <div>
          <h2 id="powered-h">Public page</h2>
          <p className="small muted">
            Your opportunities are listed at{" "}
            <Link to={`/f/${ws.handle}`} className="mono">
              /f/{ws.handle}
            </Link>
            . Each one can also be embedded on your own website from its Publish step.
          </p>
        </div>
        <SaveNote state={save.state} />
      </div>
      <div className="card-b">
        {record.status === "loading" && <Loading label="Loading the setting" />}
        {record.status === "error" && <ErrorBanner error={record.error} onRetry={record.reload} />}
        {failed && save.error !== null && <ErrorBanner error={save.error} title="The setting did not change. The switch is back where it was." />}
        {record.status === "ready" && (
          <div className="rc">
            <div className={on ? "rc-row rc-pass" : "rc-row rc-unk"}>
              {!isAdmin ? <Lock className="ic" aria-hidden="true" /> : on ? <CircleCheck className="ic" aria-hidden="true" /> : <Circle className="ic" aria-hidden="true" />}
              <div>
                <div className="l" id="powered-label">
                  Show “{POWERED_BY_LABEL}”
                </div>
                <div className="r">
                  {on ? "On" : "Off"} · A link to the OpenGrants GMS home page in the footer of your public pages, on your apply widgets and under the email applicants get when they apply. It never appears in review, decision or award emails.
                </div>
              </div>
              <button
                type="button"
                className={on ? "tog on" : "tog"}
                role="switch"
                aria-checked={on}
                aria-labelledby="powered-label"
                disabled={!isAdmin || save.state === "saving"}
                onClick={() => void toggle()}
              ></button>
            </div>
          </div>
        )}
      </div>
      {!isAdmin && (
        <div className="card-f small muted">
          <Info className="ic" aria-hidden="true" />
          Only workspace admins can change this.
        </div>
      )}
    </section>
  );
}

export default function SettingsPublicPage() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  return (
    <FunderShell active="Settings">
      <title>{`Public page settings — ${ws.name}`}</title>
      <main className="main">
        <PageHeader crumbs={[{ label: ws.name, to: base }, { label: "Settings" }, { label: "Public page" }]} title="Settings" meta={<span>{ws.name}</span>} />
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
          <SettingsNav base={base} active="public-page" />
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <PoweredByCard />
            <AwardListingCard />
          </div>
        </div>
      </main>
    </FunderShell>
  );
}
