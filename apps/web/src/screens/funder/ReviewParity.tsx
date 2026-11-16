// SPDX-License-Identifier: AGPL-3.0-only
// Review parity (v1.8.0) on the review screens: the stage's review settings (anonymized review,
// whether reviewers see each other's scores, the panel), the competition's conflict-of-interest
// policy and its conflicts register for program staff, the reviewer's signature, and the board
// docket PDF for the decision meeting. Mounted from ReviewAssignment, ReviewerAssignments and Panel.
import { useState } from "react";
import { CircleCheck, Clock, Download, Eye, EyeOff, FileText, Plus, ShieldCheck, Signature, X } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { CoiPolicyInput, CoiSigned, DeclaredOrg, Docket, StageReviewSettings } from "../../api/funder.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { ErrorBanner, Field, Loading, Notice } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

/** Hand a file the API answered with to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MODE_TEXT: Record<StageReviewSettings["reviewMode"], string> = {
  blind: "Not until the panel opens",
  see_after_submit: "After they submit their own review",
  open: "Always",
};

// ------------------------------------------------------------------------------------ staff: settings

/** The review settings of one stage, with the policy and the register a click away. */
export function ReviewSettingsCard({ competitionId, stageKey }: { competitionId: string; stageKey: string }) {
  const settings = useApiQuery((api) => api.getReviewSettings(competitionId), [competitionId]);
  const save = useApiMutation((api, patch: { anonymized?: boolean; reviewMode?: StageReviewSettings["reviewMode"]; panelOpen?: boolean }) => api.putReviewSettings(competitionId, { stage: stageKey, ...patch }));
  const [dialog, setDialog] = useState<"policy" | "register" | null>(null);
  if (settings.status === "loading") return <Loading label="Loading review settings" />;
  if (settings.status === "error") return <ErrorBanner error={settings.error} onRetry={settings.reload} title="Review settings could not be loaded" />;
  const stage = settings.data.stages.find((s) => s.key === stageKey);
  if (!stage) return null;
  const apply = async (patch: Parameters<typeof save.run>[0]) => {
    if (await save.run(patch)) settings.reload();
  };
  return (
    <section className="card" aria-labelledby="review-settings-h" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <h2 id="review-settings-h" style={{ fontSize: "16px" }}>
          Review settings · {stage.label}
        </h2>
        <span className={stage.anonymized ? "bdg bdg-info" : "bdg bdg-neutral"}>
          {stage.anonymized ? <EyeOff className="ic" aria-hidden="true" /> : <Eye className="ic" aria-hidden="true" />}
          {stage.anonymized ? "Anonymized review on" : "Reviewers see who applied"}
        </span>
      </div>
      {save.error !== null && <ErrorBanner error={save.error} title="That setting was not changed" />}
      <label className="cb">
        <input type="checkbox" checked={stage.anonymized} disabled={save.state === "saving"} onChange={(e) => apply({ anonymized: e.target.checked })} />
        <span>
          <strong>Anonymized review</strong>
          <span className="help" style={{ display: "block" }}>
            Reviewers in this stage do not see who applied: no organization name, EIN, website, address or contacts, no fields the form marks identifying, and attachments under neutral names. Names in answers show as [applicant], and the application shows as a code such as Applicant A-1042. Program staff always see everything.
          </span>
        </span>
      </label>
      <div className="row" style={{ gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field id="review-mode" label="Reviewers see each other's scores">
          <select className="sel" id="review-mode" value={stage.reviewMode} disabled={save.state === "saving"} onChange={(e) => apply({ reviewMode: e.target.value as StageReviewSettings["reviewMode"] })} style={{ width: "auto" }}>
            {Object.entries(MODE_TEXT).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <label className="cb" style={{ marginBottom: "8px" }}>
          <input type="checkbox" checked={stage.panelOpen} disabled={save.state === "saving"} onChange={(e) => apply({ panelOpen: e.target.checked })} />
          <span>The panel is open</span>
        </label>
        <div className="row" style={{ marginLeft: "auto", marginBottom: "4px" }}>
          <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setDialog("policy")}>
            <ShieldCheck className="ic" aria-hidden="true" />
            Conflict-of-interest policy…
          </button>
          <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setDialog("register")}>
            <FileText className="ic" aria-hidden="true" />
            Conflicts register…
          </button>
        </div>
      </div>
      {dialog === "policy" && <PolicyDialog competitionId={competitionId} onClose={() => setDialog(null)} />}
      {dialog === "register" && <RegisterDialog competitionId={competitionId} onClose={() => setDialog(null)} />}
    </section>
  );
}

function PolicyDialog({ competitionId, onClose }: { competitionId: string; onClose: () => void }) {
  const policy = useApiQuery((api) => api.getCoiPolicy(competitionId), [competitionId]);
  const [text, setText] = useState<string | null>(null);
  const save = useApiMutation((api, input: CoiPolicyInput) => api.putCoiPolicy(competitionId, input));
  const current = text ?? (policy.data?.text ?? "");
  const required = policy.data?.required ?? true;
  const [lastSave, setLastSave] = useState<"text" | "required" | null>(null);
  const run = async (input: CoiPolicyInput) => {
    setLastSave("text" in input || "useDefault" in input ? "text" : "required");
    if (await save.run(input)) {
      setText(null);
      policy.reload();
    }
  };
  return (
    <Dialog open onClose={onClose} labelledBy="policy-title" size="lg">
      <div className="hd">
        <div>
          <h2 id="policy-title">Conflict-of-interest policy</h2>
          {policy.data && (
            <p className="small muted">
              <span className={required ? "bdg bdg-ok" : "bdg bdg-neutral"} style={{ marginRight: "8px" }}>
                {required ? <ShieldCheck className="ic" aria-hidden="true" /> : <Clock className="ic" aria-hidden="true" />}
                {required ? "Reviewers sign it" : "Signing is off"}
              </span>
              Version {policy.data.version}
              {policy.data.isDefault ? " · the plain-language default" : " · your own text"}
              {policy.data.updatedAt ? ` · since ${formatDate(policy.data.updatedAt)}` : ""}
            </p>
          )}
        </div>
      </div>
      <div className="bd">
        {policy.status === "loading" && <Loading label="Loading the policy" />}
        {policy.status === "error" && <ErrorBanner error={policy.error} onRetry={policy.reload} />}
        {save.error !== null && <ErrorBanner error={save.error} title="The policy was not saved" />}
        {save.state === "saved" && lastSave === "text" && <Notice tone="ok" title="Policy saved">{required ? "Reviewers who signed an earlier version sign this one before more applications open for them." : "Reviewers are not asked to sign while signing is off."}</Notice>}
        {save.state === "saved" && lastSave === "required" && <Notice tone="ok" title={required ? "Reviewers now sign the policy" : "Signing turned off"}>{required ? "Each reviewer signs before their applications in this competition open again." : "Reviewers in this competition are not asked to sign."}</Notice>}
        {policy.data && (
          <label className="cb" style={{ marginBottom: "12px" }}>
            <input type="checkbox" checked={required} disabled={save.state === "saving"} onChange={(e) => void run({ required: e.target.checked })} />
            <span>
              <strong>Reviewers sign this policy before applications open for them</strong>
              <span className="help" style={{ display: "block" }}>
                On for new competitions. A competition that was already reviewing when conflict-of-interest policies arrived starts with this off, so its reviewers carry on as before. When you turn it on, each reviewer signs before their applications in this competition open again.
              </span>
            </span>
          </label>
        )}
        {policy.data && (
          <Field id="policy-text" label="What reviewers agree to" help="Every reviewer signs it once per competition, before any application in it opens for them. Changing it asks everyone to sign again.">
            <textarea className="ta" id="policy-text" style={{ minHeight: "260px" }} value={current} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" style={{ marginRight: "auto" }} disabled={!policy.data || policy.data.isDefault || save.state === "saving"} onClick={() => void run({ useDefault: true })}>
          Use the default
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn btn-primary" disabled={!policy.data || current.trim().length < 20 || current.trim() === policy.data.text.trim() || save.state === "saving"} onClick={() => void run({ text: current.trim() })}>
          Save policy
        </button>
      </div>
    </Dialog>
  );
}

function RegisterDialog({ competitionId, onClose }: { competitionId: string; onClose: () => void }) {
  const reg = useApiQuery((api) => api.getConflictsRegister(competitionId), [competitionId]);
  const csv = useApiMutation(async (api) => {
    downloadBlob(await api.conflictsRegisterCsv(competitionId), `conflicts-register.csv`);
    return true;
  });
  return (
    <Dialog open onClose={onClose} labelledBy="register-title" size="lg">
      <div className="hd">
        <div>
          <h2 id="register-title">Conflicts register</h2>
          {reg.data && (
            <p className="small muted">
              {reg.data.competitionTitle} · policy version {reg.data.policy.version} · {reg.data.counts.signed} of {reg.data.counts.reviewers} reviewers signed · {reg.data.counts.declared} declared · {reg.data.counts.recusals} recused
            </p>
          )}
        </div>
      </div>
      <div className="bd">
        {reg.status === "loading" && <Loading label="Loading the register" />}
        {reg.status === "error" && <ErrorBanner error={reg.error} onRetry={reg.reload} />}
        {csv.error !== null && <ErrorBanner error={csv.error} title="The CSV could not be downloaded" />}
        {reg.data && (
          <>
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Signatures, scrollable">
              <table className="tbl" aria-label="Signatures">
                <thead>
                  <tr>
                    <th>Reviewer</th>
                    <th>Signed</th>
                    <th>Declared conflicts</th>
                  </tr>
                </thead>
                <tbody>
                  {reg.data.reviewers.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        <div className="ent">
                          <span className="nm">{r.name ?? r.email ?? "Reviewer"}</span>
                          <span className="small muted">{r.role?.replace(/_/g, " ") ?? ""}</span>
                        </div>
                      </td>
                      <td>
                        {r.signed ? (
                          <span className="bdg bdg-ok">
                            <CircleCheck className="ic" aria-hidden="true" />
                            Signed {formatDate(r.signature!.signedAt)} as {r.signature!.signedName}
                          </span>
                        ) : (
                          <span className="bdg bdg-warn">
                            <Clock className="ic" aria-hidden="true" />
                            {r.signature ? `Signed version ${r.signature.policyVersion}; not the current one` : "Not signed"}
                          </span>
                        )}
                      </td>
                      <td>{r.signature?.declared.length ? r.signature.declared.map((d) => `${d.name}${d.matches.length ? ` (applied: ${d.matches.map((m) => m.name).join(", ")})` : ""}`).join("; ") : <span className="muted">None</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 style={{ fontSize: "14px", marginTop: "12px" }}>Recusals</h3>
            {reg.data.recusals.length === 0 ? (
              <p className="small muted">No reviewer has recused from an application in this competition.</p>
            ) : (
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Recusals, scrollable">
                <table className="tbl" aria-label="Recusals">
                  <thead>
                    <tr>
                      <th>Reviewer</th>
                      <th>Application</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reg.data.recusals.map((x) => (
                      <tr key={x.assignmentId}>
                        <td>{x.reviewerName ?? "Reviewer"}</td>
                        <td>
                          {x.applicant ?? ""} · {x.applicationTitle}
                        </td>
                        <td>
                          {x.source === "declared_at_signing" ? "Declared when signing the policy" : x.source === "declared_conflict" ? "Declared a conflict" : "Recused"}
                          {x.reason ? `: ${x.reason}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn btn-primary" disabled={!reg.data || csv.state === "saving"} onClick={() => csv.run()}>
          <Download className="ic" aria-hidden="true" />
          Download CSV
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------ staff: docket

/** The board docket for the panel's stage: built on request, kept privately, downloaded as a PDF. */
export function DocketDialog({ competitionId, stage, onClose }: { competitionId: string; stage: string; onClose: () => void }) {
  const [funderOnly, setFunderOnly] = useState(false);
  const [docket, setDocket] = useState<Docket | null>(null);
  const build = useApiMutation((api) => api.createDocket(competitionId, { stage, includeFunderOnlyComments: funderOnly }));
  const download = useApiMutation(async (api) => {
    downloadBlob(await api.docketPdf(competitionId, docket!.docketId), "board-docket.pdf");
    return true;
  });
  return (
    <Dialog open onClose={onClose} labelledBy="docket-title">
      <div className="hd">
        <h2 id="docket-title">Board docket</h2>
      </div>
      <div className="bd">
        <p>One PDF for the decision meeting: a cover page, a summary table (applicant, request, recommended amount, average score, recommendation), then a page per application with its summary, budget total, scores by criterion and the reviewers&rsquo; comments for the panel.</p>
        {build.error !== null && <ErrorBanner error={build.error} title="The docket was not built" />}
        {download.error !== null && <ErrorBanner error={download.error} title="The docket could not be downloaded" />}
        <label className="cb">
          <input type="checkbox" checked={funderOnly} disabled={!!docket} onChange={(e) => setFunderOnly(e.target.checked)} />
          <span>
            Include comments reviewers marked for program staff only
            <span className="help" style={{ display: "block" }}>
              Leave this off for a docket that goes to board members.
            </span>
          </span>
        </label>
        {docket && (
          <Notice tone="ok" title="Docket ready">
            {docket.applications} {docket.applications === 1 ? "application" : "applications"}
            {docket.includeFunderOnlyComments ? ", with comments for program staff only" : ""}. Kept privately in this workspace&rsquo;s exports.
          </Notice>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
        {docket ? (
          <button type="button" className="btn btn-primary" disabled={download.state === "saving"} onClick={() => download.run()}>
            <Download className="ic" aria-hidden="true" />
            Download the docket (PDF)
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={build.state === "saving"} onClick={async () => setDocket((await build.run()) ?? null)}>
            <FileText className="ic" aria-hidden="true" />
            Build the docket
          </button>
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------ reviewer: sign

/** The reviewer reads the competition's policy, types their name, lists any conflicts and signs. */
export function SignPolicyDialog({ competitionId, onClose, onSigned }: { competitionId: string; onClose: () => void; onSigned: (s: CoiSigned) => void }) {
  const policy = useApiQuery((api) => api.getCoiPolicy(competitionId), [competitionId]);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [conflicts, setConflicts] = useState<DeclaredOrg[]>([]);
  const sign = useApiMutation((api) => api.signCoiPolicy(competitionId, { policyVersion: policy.data!.version, signedName: name.trim(), agree: true, conflicts: conflicts.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), ...(c.website?.trim() ? { website: c.website.trim() } : {}) })) }));
  const ready = !!policy.data && name.trim().length >= 2 && agree;
  return (
    <Dialog open onClose={onClose} labelledBy="sign-title" size="lg">
      <div className="hd">
        <div>
          <h2 id="sign-title">Conflict-of-interest policy</h2>
          {policy.data && (
            <p className="small muted">
              {policy.data.competitionTitle} · version {policy.data.version}
            </p>
          )}
        </div>
      </div>
      <div className="bd">
        {policy.status === "loading" && <Loading label="Loading the policy" />}
        {policy.status === "error" && <ErrorBanner error={policy.error} onRetry={policy.reload} />}
        {sign.error !== null && <ErrorBanner error={sign.error} title="Your signature was not recorded" />}
        {policy.data && (
          <>
            <div className="card" style={{ padding: "12px 16px", whiteSpace: "pre-wrap", maxHeight: "260px", overflowY: "auto" }} tabIndex={0} role="region" aria-label="Policy text">
              {policy.data.text}
            </div>
            <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="lbl">Organizations you have a conflict with</legend>
              <span className="help">Optional. You are not assigned to their applications, and you are recused from any you already hold. You are not told whether they applied.</span>
              {conflicts.map((c, i) => (
                <div key={i} className="row" style={{ gap: "8px" }}>
                  <input className="inp" aria-label={`Organization ${i + 1} name`} placeholder="Organization name" value={c.name} onChange={(e) => setConflicts((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className="inp" aria-label={`Organization ${i + 1} website`} placeholder="Website (optional)" value={c.website ?? ""} onChange={(e) => setConflicts((all) => all.map((x, j) => (j === i ? { ...x, website: e.target.value } : x)))} />
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove organization ${i + 1}`} onClick={() => setConflicts((all) => all.filter((_, j) => j !== i))}>
                    <X className="ic" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} disabled={conflicts.length >= 50} onClick={() => setConflicts((all) => [...all, { name: "" }])}>
                <Plus className="ic" aria-hidden="true" />
                Add an organization
              </button>
            </fieldset>
            <Field id="sign-name" label="Type your full name to sign" required>
              <input className="inp" id="sign-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <label className="cb">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I have read this policy and agree to it</span>
            </label>
          </>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!ready || sign.state === "saving"} onClick={async () => { const s = await sign.run(); if (s) onSigned(s); }}>
          <Signature className="ic" aria-hidden="true" />
          Sign the policy
        </button>
      </div>
    </Dialog>
  );
}
