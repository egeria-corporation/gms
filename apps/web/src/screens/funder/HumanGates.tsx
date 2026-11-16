// SPDX-License-Identifier: AGPL-3.0-only
// Human gates: the agent tools that create an approval request instead of acting. The default
// gates are locked on; a workspace can add gates to other tools and never remove one. A switch
// flips at once and the save follows; if the save fails the switch goes back and says why.
import { useState } from "react";
import { Circle, Info, Lock } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { useAppConfig } from "../../api/launchHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { ErrorBanner, Loading, SaveNote } from "../../components/ui.tsx";
import { t } from "./i18n.ts";

const LOCKED = (): [string, string, string][] => [
  ["commit_decisions", t("humanGates.commitDecisions.label"), t("humanGates.commitDecisions.why")],
  ["release_tranche", t("humanGates.releaseTranche.label"), t("humanGates.releaseTranche.why")],
  ["sign_agreement", t("humanGates.signAgreement.label"), t("humanGates.signAgreement.why")],
  ["accept_award", t("humanGates.acceptAward.label"), t("humanGates.acceptAward.why")],
  ["submit_application", t("humanGates.submitApplication.label"), t("humanGates.submitApplication.why")],
  ["send_communication", t("humanGates.sendCommunication.label"), t("humanGates.sendCommunication.why")],
  ["decline_application", t("humanGates.declineApplication.label"), t("humanGates.declineApplication.why")],
];
const OPTIONAL = (): [string, string, string][] => [
  ["request_revision", t("humanGates.requestRevision.label"), t("humanGates.requestRevision.why")],
  ["advance_application", t("humanGates.advanceApplication.label"), t("humanGates.advanceApplication.why")],
  ["publish_opportunity", t("humanGates.publishOpportunity.label"), t("humanGates.publishOpportunity.why")],
  ["assign_reviewer", t("humanGates.assignReviewer.label"), t("humanGates.assignReviewer.why")],
  ["accept_submission", t("humanGates.acceptSubmission.label"), t("humanGates.acceptSubmission.why")],
];

export function HumanGates() {
  const { facilitatedPayments } = useAppConfig();
  const ws = useWorkspace("funder");
  const record = useApiQuery((api) => api.workspaceRecord(ws.id), [ws.id]);
  const save = useApiMutation((api, gatedTools: string[]) => api.updateWorkspace(ws.id, { settings: { ...(record.data?.settings ?? {}), gatedTools } }));
  const saved = ((record.data?.settings as { gatedTools?: unknown } | undefined)?.gatedTools as string[] | undefined) ?? [];
  // The switches as the person just set them, shown while the save is in flight.
  const [pending, setPending] = useState<string[] | null>(null);
  // The gate whose change did not save, named in the message under the heading.
  const [failed, setFailed] = useState<string | null>(null);
  const extra = pending ?? saved;

  async function toggle(tool: string) {
    const next = extra.includes(tool) ? extra.filter((item) => item !== tool) : [...extra, tool];
    setFailed(null);
    setPending(next);
    const out = await save.run(next);
    if (out) record.set(out.workspace);
    else setFailed(tool);
    setPending(null);
  }
  const failedLabel = failed === null ? null : (OPTIONAL().find(([item]) => item === failed)?.[1] ?? failed);

  return (
    <section className="card" id="gates" aria-labelledby="gates-h">
      <div className="card-h">
        <div>
          <h3 id="gates-h">{t("humanGates.humanGates")}</h3>
          <p className="small muted">{t("humanGates.toolsThatCreateAn")}</p>
        </div>
        <SaveNote state={save.state} />
      </div>
      <div className="card-b" style={{ paddingTop: "8px" }}>
        {record.status === "loading" && <Loading label={t("humanGates.loadingGates")} />}
        {record.status === "error" && <ErrorBanner error={record.error} onRetry={record.reload} />}
        {save.error !== null && <ErrorBanner error={save.error} title={failedLabel ? t("humanGates.didNotChangeThe", { failedLabel }) : undefined} />}
        {record.status === "ready" && (
          <div className="rc">
            {LOCKED().map(([tool, label, text]) => [tool, label, tool === "release_tranche" && !facilitatedPayments ? t("humanGates.releaseTranche.whyOff") : text] as const).map(([tool, label, why]) => (
              <div key={tool} className="rc-row rc-pass">
                <Lock className="ic" aria-hidden="true" />
                <div>
                  <div className="l">{label}</div>
                  <div className="r">
                    {t.rich("humanGates.alwaysNeedsAPerson", { tool, why, span: (chunks) => <span className="mono">{chunks}</span> })}
                  </div>
                </div>
                <button type="button" className="tog on" role="switch" aria-checked="true" aria-label={t("humanGates.requiresApprovalLocked", { label })} disabled></button>
              </div>
            ))}
            {OPTIONAL().map(([tool, label, why]) => {
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
                  <button type="button" className={on ? "tog on" : "tog"} role="switch" aria-checked={on} aria-label={t("humanGates.requiresApproval", { label })} disabled={save.state === "saving"} onClick={() => void toggle(tool)}></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="card-f small muted">
        <Info className="ic" aria-hidden="true" />
        {t("humanGates.aGateYouAdd")}
      </div>
    </section>
  );
}
