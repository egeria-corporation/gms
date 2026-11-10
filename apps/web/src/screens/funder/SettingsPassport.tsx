// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Payments: the workspace's connection to OpenGrants Passport.
import { Link } from "react-router";
import { useWorkspace } from "../../app/workspace.tsx";
import { PassportLinkPanel } from "../../components/PassportLinkPanel.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { PageHeader } from "../../components/ui.tsx";

/** The sections of funder settings. Sections not built yet are not listed. */
export function SettingsNav({ base, active }: { base: string; active: "passport" | "mcp" }) {
  const items = [
    { key: "passport", label: "Payments · Passport", to: `${base}/settings/passport` },
    { key: "mcp", label: "Agents & MCP", to: `${base}/settings/mcp` },
  ] as const;
  return (
    <nav className="card snav" style={{ padding: "8px" }} aria-label="Settings sections">
      {items.map((i) => (
        <Link key={i.key} to={i.to} className={i.key === active ? "on" : undefined} aria-current={i.key === active ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export default function SettingsPassport() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  return (
    <FunderShell active="Settings">
      <title>{`Payments settings — ${ws.name}`}</title>
      <main className="main">
        <PageHeader crumbs={[{ label: ws.name, to: base }, { label: "Settings" }, { label: "Payments" }]} title="Settings" meta={<span>{ws.name}</span>} />
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
          <SettingsNav base={base} active="passport" />
          <section className="card" aria-labelledby="passport-title">
            <div className="card-h">
              <div>
                <h2 id="passport-title">OpenGrants Passport</h2>
                <p className="small muted">Passport holds each grantee's verified payout destination and moves the money. The GMS sends release instructions and reads back what was paid; it never stores bank details.</p>
              </div>
            </div>
            <div className="card-b">
              <PassportLinkPanel workspaceId={ws.id} />
            </div>
          </section>
        </div>
      </main>
    </FunderShell>
  );
}
