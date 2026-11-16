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
import { t } from "./i18n.ts";

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
  if (settings.status === "loading") return <Loading label={t("reviewParity.loadingReviewSettings")} />;
  if (settings.status === "error") return <ErrorBanner error={settings.error} onRetry={settings.reload} title={t("reviewParity.reviewSettingsCouldNot")} />;
  const stage = settings.data.stages.find((s) => s.key === stageKey);
  if (!stage) return null;
  const apply = async (patch: Parameters<typeof save.run>[0]) => {
    if (await save.run(patch)) settings.reload();
  };
  return (
    <section className="card" aria-labelledby="review-settings-h" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <h2 id="review-settings-h" style={{ fontSize: "16px" }}>
          {t("reviewParity.reviewSettings", { label: stage.label })}
        </h2>
        <span className={stage.anonymized ? "bdg bdg-info" : "bdg bdg-neutral"}>
          {stage.anonymized ? <EyeOff className="ic" aria-hidden="true" /> : <Eye className="ic" aria-hidden="true" />}
          {stage.anonymized ? t("reviewParity.anonymizedReviewOn") : t("reviewParity.reviewersSeeWhoApplied")}
        </span>
      </div>
      {save.error !== null && <ErrorBanner error={save.error} title={t("reviewParity.thatSettingWasNot")} />}
      <label className="cb">
        <input type="checkbox" checked={stage.anonymized} disabled={save.state === "saving"} onChange={(e) => apply({ anonymized: e.target.checked })} />
        <span>
          <strong>{t("reviewParity.anonymizedReview")}</strong>
          <span className="help" style={{ display: "block" }}>
            {t("reviewParity.reviewersInThisStage")}
          </span>
        </span>
      </label>
      <div className="row" style={{ gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field id="review-mode" label={t("reviewParity.reviewersSeeEachOthers")}>
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
          <span>{t("reviewParity.thePanelIsOpen")}</span>
        </label>
        <div className="row" style={{ marginLeft: "auto", marginBottom: "4px" }}>
          <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setDialog("policy")}>
            <ShieldCheck className="ic" aria-hidden="true" />
            {t("reviewParity.conflictOfInterestPolicy")}
          </button>
          <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setDialog("register")}>
            <FileText className="ic" aria-hidden="true" />
            {t("reviewParity.conflictsRegister")}
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
          <h2 id="policy-title">{t("reviewParity.conflictOfInterestPolicy2")}</h2>
          {policy.data && (
            <p className="small muted">
              <span className={required ? "bdg bdg-ok" : "bdg bdg-neutral"} style={{ marginRight: "8px" }}>
                {required ? <ShieldCheck className="ic" aria-hidden="true" /> : <Clock className="ic" aria-hidden="true" />}
                {required ? t("reviewParity.reviewersSignIt") : t("reviewParity.signingIsOff")}
              </span>
              {t("reviewParity.version", { version: policy.data.version })}
              {policy.data.isDefault ? t("reviewParity.thePlainLanguageDefault") : t("reviewParity.yourOwnText")}
              {policy.data.updatedAt ? t("reviewParity.since", { date: formatDate(policy.data.updatedAt) }) : ""}
            </p>
          )}
        </div>
      </div>
      <div className="bd">
        {policy.status === "loading" && <Loading label={t("reviewParity.loadingThePolicy")} />}
        {policy.status === "error" && <ErrorBanner error={policy.error} onRetry={policy.reload} />}
        {save.error !== null && <ErrorBanner error={save.error} title={t("reviewParity.thePolicyWasNot")} />}
        {save.state === "saved" && lastSave === "text" && <Notice tone="ok" title={t("reviewParity.policySaved")}>{required ? t("reviewParity.reviewersWhoSignedAn") : t("reviewParity.reviewersAreNotAsked")}</Notice>}
        {save.state === "saved" && lastSave === "required" && <Notice tone="ok" title={required ? t("reviewParity.reviewersNowSignThe") : t("reviewParity.signingTurnedOff")}>{required ? t("reviewParity.eachReviewerSignsBefore") : t("reviewParity.reviewersInThisCompetition")}</Notice>}
        {policy.data && (
          <label className="cb" style={{ marginBottom: "12px" }}>
            <input type="checkbox" checked={required} disabled={save.state === "saving"} onChange={(e) => void run({ required: e.target.checked })} />
            <span>
              <strong>{t("reviewParity.reviewersSignThisPolicy")}</strong>
              <span className="help" style={{ display: "block" }}>
                {t("reviewParity.onForNewCompetitions")}
              </span>
            </span>
          </label>
        )}
        {policy.data && (
          <Field id="policy-text" label={t("reviewParity.whatReviewersAgreeTo")} help={t("reviewParity.everyReviewerSignsIt")}>
            <textarea className="ta" id="policy-text" style={{ minHeight: "260px" }} value={current} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" style={{ marginRight: "auto" }} disabled={!policy.data || policy.data.isDefault || save.state === "saving"} onClick={() => void run({ useDefault: true })}>
          {t("reviewParity.useTheDefault")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("reviewParity.close")}
        </button>
        <button type="button" className="btn btn-primary" disabled={!policy.data || current.trim().length < 20 || current.trim() === policy.data.text.trim() || save.state === "saving"} onClick={() => void run({ text: current.trim() })}>
          {t("reviewParity.savePolicy")}
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
          <h2 id="register-title">{t("reviewParity.conflictsRegister2")}</h2>
          {reg.data && (
            <p className="small muted">
              {t("reviewParity.policyVersionOfReviewers", { competitionTitle: reg.data.competitionTitle, version: reg.data.policy.version, signed: reg.data.counts.signed, reviewers: reg.data.counts.reviewers, declared: reg.data.counts.declared, recusals: reg.data.counts.recusals })}
            </p>
          )}
        </div>
      </div>
      <div className="bd">
        {reg.status === "loading" && <Loading label={t("reviewParity.loadingTheRegister")} />}
        {reg.status === "error" && <ErrorBanner error={reg.error} onRetry={reg.reload} />}
        {csv.error !== null && <ErrorBanner error={csv.error} title={t("reviewParity.theCsvCouldNot")} />}
        {reg.data && (
          <>
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("reviewParity.signaturesScrollable")}>
              <table className="tbl" aria-label={t("reviewParity.signatures")}>
                <thead>
                  <tr>
                    <th>{t("reviewParity.reviewer")}</th>
                    <th>{t("reviewParity.signed")}</th>
                    <th>{t("reviewParity.declaredConflicts")}</th>
                  </tr>
                </thead>
                <tbody>
                  {reg.data.reviewers.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        <div className="ent">
                          <span className="nm">{r.name ?? r.email ?? t("reviewParity.reviewer")}</span>
                          <span className="small muted">{r.role?.replace(/_/g, " ") ?? ""}</span>
                        </div>
                      </td>
                      <td>
                        {r.signed ? (
                          <span className="bdg bdg-ok">
                            <CircleCheck className="ic" aria-hidden="true" />
                            {t("reviewParity.signedAs", { date: formatDate(r.signature!.signedAt), signedName: r.signature!.signedName })}
                          </span>
                        ) : (
                          <span className="bdg bdg-warn">
                            <Clock className="ic" aria-hidden="true" />
                            {r.signature ? t("reviewParity.signedVersionNotThe", { policyVersion: r.signature.policyVersion }) : t("reviewParity.notSigned")}
                          </span>
                        )}
                      </td>
                      <td>{r.signature?.declared.length ? r.signature.declared.map((d) => `${d.name}${d.matches.length ? ` (applied: ${d.matches.map((m) => m.name).join(", ")})` : ""}`).join("; ") : <span className="muted">{t("reviewParity.none")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 style={{ fontSize: "14px", marginTop: "12px" }}>{t("reviewParity.recusals")}</h3>
            {reg.data.recusals.length === 0 ? (
              <p className="small muted">{t("reviewParity.noReviewerHasRecused")}</p>
            ) : (
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("reviewParity.recusalsScrollable")}>
                <table className="tbl" aria-label={t("reviewParity.recusals")}>
                  <thead>
                    <tr>
                      <th>{t("reviewParity.reviewer")}</th>
                      <th>{t("reviewParity.application")}</th>
                      <th>{t("reviewParity.reason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reg.data.recusals.map((x) => (
                      <tr key={x.assignmentId}>
                        <td>{x.reviewerName ?? t("reviewParity.reviewer")}</td>
                        <td>
                          {x.applicant ?? ""} · {x.applicationTitle}
                        </td>
                        <td>
                          {x.source === "declared_at_signing" ? t("reviewParity.declaredWhenSigningThe") : x.source === "declared_conflict" ? t("reviewParity.declaredAConflict") : t("reviewParity.recused")}
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
          {t("reviewParity.close")}
        </button>
        <button type="button" className="btn btn-primary" disabled={!reg.data || csv.state === "saving"} onClick={() => csv.run()}>
          <Download className="ic" aria-hidden="true" />
          {t("reviewParity.downloadCsv")}
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
        <h2 id="docket-title">{t("reviewParity.boardDocket")}</h2>
      </div>
      <div className="bd">
        <p>{t("reviewParity.onePdfForThe")}</p>
        {build.error !== null && <ErrorBanner error={build.error} title={t("reviewParity.theDocketWasNot")} />}
        {download.error !== null && <ErrorBanner error={download.error} title={t("reviewParity.theDocketCouldNot")} />}
        <label className="cb">
          <input type="checkbox" checked={funderOnly} disabled={!!docket} onChange={(e) => setFunderOnly(e.target.checked)} />
          <span>
            {t.rich("reviewParity.includeCommentsReviewersMarked", { span: (chunks) => <span className="help" style={{ display: "block" }}>{chunks}</span> })}
          </span>
        </label>
        {docket && (
          <Notice tone="ok" title={t("reviewParity.docketReady")}>
            {docket.applications} {docket.applications === 1 ? t("reviewParity.application2") : t("reviewParity.applications")}
            {docket.includeFunderOnlyComments ? t("reviewParity.withCommentsForProgram") : ""}{t("reviewParity.keptPrivatelyInThis")}
          </Notice>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("reviewParity.close")}
        </button>
        {docket ? (
          <button type="button" className="btn btn-primary" disabled={download.state === "saving"} onClick={() => download.run()}>
            <Download className="ic" aria-hidden="true" />
            {t("reviewParity.downloadTheDocketPdf")}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={build.state === "saving"} onClick={async () => setDocket((await build.run()) ?? null)}>
            <FileText className="ic" aria-hidden="true" />
            {t("reviewParity.buildTheDocket")}
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
          <h2 id="sign-title">{t("reviewParity.conflictOfInterestPolicy2")}</h2>
          {policy.data && (
            <p className="small muted">
              {t("reviewParity.version2", { competitionTitle: policy.data.competitionTitle, version: policy.data.version })}
            </p>
          )}
        </div>
      </div>
      <div className="bd">
        {policy.status === "loading" && <Loading label={t("reviewParity.loadingThePolicy")} />}
        {policy.status === "error" && <ErrorBanner error={policy.error} onRetry={policy.reload} />}
        {sign.error !== null && <ErrorBanner error={sign.error} title={t("reviewParity.yourSignatureWasNot")} />}
        {policy.data && (
          <>
            <div className="card" style={{ padding: "12px 16px", whiteSpace: "pre-wrap", maxHeight: "260px", overflowY: "auto" }} tabIndex={0} role="region" aria-label={t("reviewParity.policyText")}>
              {policy.data.text}
            </div>
            <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="lbl">{t("reviewParity.organizationsYouHaveA")}</legend>
              <span className="help">{t("reviewParity.optionalYouAreNot")}</span>
              {conflicts.map((c, i) => (
                <div key={i} className="row" style={{ gap: "8px" }}>
                  <input className="inp" aria-label={t("reviewParity.organizationName", { i: i + 1 })} placeholder={t("reviewParity.organizationName2")} value={c.name} onChange={(e) => setConflicts((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className="inp" aria-label={t("reviewParity.organizationWebsite", { i: i + 1 })} placeholder={t("reviewParity.websiteOptional")} value={c.website ?? ""} onChange={(e) => setConflicts((all) => all.map((x, j) => (j === i ? { ...x, website: e.target.value } : x)))} />
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={t("reviewParity.removeOrganization", { i: i + 1 })} onClick={() => setConflicts((all) => all.filter((_, j) => j !== i))}>
                    <X className="ic" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} disabled={conflicts.length >= 50} onClick={() => setConflicts((all) => [...all, { name: "" }])}>
                <Plus className="ic" aria-hidden="true" />
                {t("reviewParity.addAnOrganization")}
              </button>
            </fieldset>
            <Field id="sign-name" label={t("reviewParity.typeYourFullName")} required>
              <input className="inp" id="sign-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <label className="cb">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{t("reviewParity.iHaveReadThis")}</span>
            </label>
          </>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("reviewParity.cancel")}
        </button>
        <button type="button" className="btn btn-primary" disabled={!ready || sign.state === "saving"} onClick={async () => { const s = await sign.run(); if (s) onSigned(s); }}>
          <Signature className="ic" aria-hidden="true" />
          {t("reviewParity.signThePolicy")}
        </button>
      </div>
    </Dialog>
  );
}
