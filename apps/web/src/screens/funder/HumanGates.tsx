// SPDX-License-Identifier: AGPL-3.0-only
// Human gates: the agent tools that create an approval request instead of acting. The default
// gates are locked on; a workspace can add gates to other tools and never remove one.
import { Circle, Info, Lock } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { useAppConfig } from "../../api/launchHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { ErrorBanner, Loading, SaveNote } from "../../components/ui.tsx";

const LOCKED: [string, string, string][] = [
  ["commit_decisions", "Commit decisions", "Creates awards and sends decision letters"],
  ["release_tranche", "Release a payment", "Moves money through Passport"],
  ["sign_agreement", "Sign an agreement", "A signature is always a person’s"],
  ["accept_award", "Accept an award", "The recipient’s own act"],
  ["submit_application", "Submit an application", "The applicant’s own act"],
  ["send_communication", "Send a communication", "Mail leaves in your name"],
  ["decline_application", "Decline an application", "A decline is a decision and sends a letter"],
];
const OPTIONAL: [string, string, string][] = [
  ["request_revision", "Request a revision", "Acts immediately unless gated; the applicant sees the agent attribution"],
  ["advance_application", "Advance an application", "Moves an application to the next stage"],
  ["publish_opportunity", "Publish an opportunity", "Makes an opportunity public"],
  ["assign_reviewer", "Assign a reviewer", "Adds a review assignment"],
  ["accept_submission", "Accept a report", "Can make a tranche due"],
];

export function HumanGates() {
  const { facilitatedPayments } = useAppConfig();
  const ws = useWorkspace("funder");
  const record = useApiQuery((api) => api.workspaceRecord(ws.id), [ws.id]);
  const save = useApiMutation((api, gatedTools: string[]) => api.updateWorkspace(ws.id, { settings: { ...(record.data?.settings ?? {}), gatedTools } }));
  const extra = ((record.data?.settings as { gatedTools?: unknown } | undefined)?.gatedTools as string[] | undefined) ?? [];

  async function toggle(tool: string) {
    const next = extra.includes(tool) ? extra.filter((t) => t !== tool) : [...extra, tool];
    if (await save.run(next)) record.reload();
  }

  return (
    <section className="card" id="gates" aria-labelledby="gates-h">
      <div className="card-h">
        <div>
          <h3 id="gates-h">Human gates</h3>
          <p className="small muted">Tools that create an approval request instead of acting. Locked gates cannot be turned off.</p>
        </div>
        <SaveNote state={save.state} />
      </div>
      <div className="card-b" style={{ paddingTop: "8px" }}>
        {record.status === "loading" && <Loading label="Loading gates" />}
        {record.status === "error" && <ErrorBanner error={record.error} onRetry={record.reload} />}
        {save.error !== null && <ErrorBanner error={save.error} />}
        {record.status === "ready" && (
          <div className="rc">
            {LOCKED.map(([tool, label, text]) => [tool, label, tool === "release_tranche" && !facilitatedPayments ? "Payments through Passport are not switched on for this install; recording a payment made elsewhere is done by a person" : text] as const).map(([tool, label, why]) => (
              <div key={tool} className="rc-row rc-pass">
                <Lock className="ic" aria-hidden="true" />
                <div>
                  <div className="l">{label}</div>
                  <div className="r">
                    <span className="mono">{tool}</span> · {why} · always needs a person
                  </div>
                </div>
                <button type="button" className="tog on" role="switch" aria-checked="true" aria-label={`${label} requires approval (locked)`} disabled></button>
              </div>
            ))}
            {OPTIONAL.map(([tool, label, why]) => {
              const on = extra.includes(tool);
              return (
                <div key={tool} className={on ? "rc-row rc-pass" : "rc-row rc-unk"}>
                  {on ? <Lock className="ic" aria-hidden="true" /> : <Circle className="ic" aria-hidden="true" />}
                  <div>
                    <div className="l">{label}</div>
                    <div className="r">
                      <span className="mono">{tool}</span> · {why}
                    </div>
                  </div>
                  <button type="button" className={on ? "tog on" : "tog"} role="switch" aria-checked={on} aria-label={`${label} requires approval`} disabled={save.state === "saving"} onClick={() => toggle(tool)}></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="card-f small muted">
        <Info className="ic" aria-hidden="true" />
        A gate you add applies to every connected agent. Approvals are resolved by people, in Approvals.
      </div>
    </section>
  );
}
