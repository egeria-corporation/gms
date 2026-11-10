// SPDX-License-Identifier: AGPL-3.0-only
// The award detail's nine sections, as the design lays them out: Agreement, Payments, Requirements,
// Budget, Amendments, Documents, Messages / Notes, Activity, Closeout. Two routes share the strip
// (`…/agreement` owns the paperwork tabs, `…/payments` owns the money tabs); choosing a tab the
// other route owns navigates there with `?tab=`. This file also holds the sections both lack:
// signature records, documents, activity and closeout.
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CircleCheck, CircleDashed, CircleX, Download, FileText } from "lucide-react";
import type { Agreement, AwardDetail } from "../../api/funder.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { ActivityTimeline } from "../../components/ActivityTimeline.tsx";
import { ReasonDialog } from "../../components/payments.tsx";
import { ErrorBanner, Loading, Notice, Tabs } from "../../components/ui.tsx";
import { openBlob } from "../../lib/browser.ts";
import { formatMinor } from "../../lib/format.ts";
import { dateTime, usePeople } from "./shared.tsx";

export type AwardTab = "agreement" | "payments" | "requirements" | "budget" | "amendments" | "documents" | "messages" | "activity" | "closeout";
type Owner = "agreement" | "payments";

const TABS: { key: AwardTab; label: string; owner: Owner }[] = [
  { key: "agreement", label: "Agreement", owner: "agreement" },
  { key: "payments", label: "Payments", owner: "payments" },
  { key: "requirements", label: "Requirements", owner: "payments" },
  { key: "budget", label: "Budget", owner: "payments" },
  { key: "amendments", label: "Amendments", owner: "agreement" },
  { key: "documents", label: "Documents", owner: "agreement" },
  { key: "messages", label: "Messages / Notes", owner: "agreement" },
  { key: "activity", label: "Activity", owner: "agreement" },
  { key: "closeout", label: "Closeout", owner: "agreement" },
];

/** The current tab for one of the two award routes, kept in `?tab=` so a tab can be linked to. */
export function useAwardTab(owner: Owner, awardId: string | undefined, base: string): [AwardTab, (tab: AwardTab) => void] {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const asked = TABS.find((t) => t.key === params.get("tab") && t.owner === owner)?.key;
  const tab: AwardTab = asked ?? owner;
  const setTab = (next: AwardTab) => {
    const target = TABS.find((t) => t.key === next)!;
    if (target.owner === owner) {
      setParams(next === owner ? {} : { tab: next }, { replace: true });
    } else if (awardId) {
      navigate(`${base}/awards/${awardId}/${target.owner}${next === target.owner ? "" : `?tab=${next}`}`);
    }
  };
  return [tab, setTab];
}

export function AwardTabs({ active, onChange, counts = {} }: { active: AwardTab; onChange: (tab: AwardTab) => void; counts?: Partial<Record<AwardTab, number>> }) {
  return <Tabs label="Award sections" idPrefix="award" active={active} onChange={onChange} tabs={TABS.map((t) => ({ key: t.key, label: t.label, ...(counts[t.key] !== undefined ? { count: counts[t.key] } : {}) }))} />;
}

const shortHash = (sha: string | null | undefined) => (sha ? `${sha.slice(0, 8)}…${sha.slice(-4)}` : "—");

/** Who signed, when, and which document: the audit record behind a click-to-sign agreement. */
export function SignatureRecords({ agreement, recipientName, funderName }: { agreement: Agreement; recipientName: string; funderName: string }) {
  const rows = [
    { signature: agreement.granteeSignature, role: `Grantee · ${recipientName}` },
    { signature: agreement.funderSignature, role: `Funder · ${funderName}` },
  ];
  return (
    <section className="card" aria-labelledby="signatures-h">
      <div className="card-h">
        <h3 id="signatures-h">Signature records</h3>
        <span className="small muted">Typed name, time, IP address and document hash are recorded in the ledger at signing.</span>
      </div>
      <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="Signature records, scrollable">
        <table className="tbl" aria-label="Signature records">
          <thead>
            <tr>
              <th>Signer</th>
              <th>Role</th>
              <th>Signed</th>
              <th>IP</th>
              <th>Document hash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.role}>
                <td className="b">{r.signature?.name ?? <span className="muted">Not signed yet</span>}</td>
                <td>{r.role}</td>
                <td>{r.signature ? dateTime(r.signature.at) : "—"}</td>
                <td>{r.signature ? "Recorded" : "—"}</td>
                <td className="mono">{r.signature ? `sha256 ${shortHash(agreement.documentSha256)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The documents the GMS itself produced for this award. Uploaded grantee files arrive with reports. */
export function AwardDocuments({ award }: { award: AwardDetail }) {
  const agreement = award.agreement;
  const letter = useApiMutation(async (api) => openBlob(await api.awardLetterPdf(award.id), "award-letter.pdf"));
  const pdf = useApiMutation(async (api) => {
    if (agreement) openBlob(await api.agreementPdf(agreement.id), agreement.status === "executed" ? "grant-agreement-executed.pdf" : "grant-agreement.pdf");
  });
  return (
    <section className="card" aria-labelledby="award-docs-h">
      <div className="card-h">
        <h3 id="award-docs-h">Documents</h3>
        <span className="small muted">Generated by the GMS for this award</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {(letter.error !== null || pdf.error !== null) && <ErrorBanner error={letter.error ?? pdf.error} />}
        <div className="doc">
          <span className="ft ft-pdf">PDF</span>
          <div className="grow">
            <div className="nm">Award letter.pdf</div>
            <div className="mt">
              <span>
                {formatMinor(award.awardedAmountMinor, award.currency)} to {award.recipient?.name ?? "the recipient"}
              </span>
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void letter.run()} disabled={letter.state === "saving"}>
            <Download className="ic" aria-hidden="true" />
            Open
          </button>
        </div>
        {agreement && agreement.documentSha256 ? (
          <div className="doc">
            <span className="ft ft-pdf">PDF</span>
            <div className="grow">
              <div className="nm">{agreement.status === "executed" ? "Grant agreement — executed.pdf" : "Grant agreement.pdf"}</div>
              <div className="mt">
                <span>Version {agreement.version}</span>
                <span>·</span>
                <span className="mono">sha256 {shortHash(agreement.documentSha256)}</span>
                {agreement.executedAt && (
                  <>
                    <span>·</span>
                    <span>executed {dateTime(agreement.executedAt)}</span>
                  </>
                )}
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void pdf.run()} disabled={pdf.state === "saving"}>
              <Download className="ic" aria-hidden="true" />
              Open
            </button>
          </div>
        ) : (
          <div className="doc">
            <span className="ft">
              <FileText className="ic" aria-hidden="true" />
            </span>
            <div className="grow">
              <div className="nm">Grant agreement</div>
              <div className="mt">
                <span>{agreement ? "Drafted, not sent yet" : "Not generated yet"}</span>
              </div>
            </div>
          </div>
        )}
        <p className="small muted">Report attachments from the grantee are on each received report under Reporting.</p>
      </div>
    </section>
  );
}

const bare = (id: string | null | undefined) => (id ?? "").replace(/^[a-z]{3}_/, "");

/** Ledger events about this award, its agreement and its tranches, newest first. */
export function AwardActivity({ award }: { award: AwardDetail }) {
  const { person } = usePeople();
  const ledger = useApiQuery((api) => api.listLedger({ pageSize: 100 }), [award.id]);
  const subjects = new Set([bare(award.id), bare(award.agreement?.id), bare(award.applicationId), ...award.tranches.map((t) => bare(t.id))].filter(Boolean));
  return (
    <section className="card" aria-labelledby="award-activity-h">
      <div className="card-h">
        <h3 id="award-activity-h">Activity</h3>
        <span className="small muted">From the append-only ledger</span>
      </div>
      <div className="card-b">
        {ledger.status === "loading" && <Loading label="Loading activity" />}
        {ledger.status === "error" && <ErrorBanner error={ledger.error} onRetry={ledger.reload} />}
        {ledger.data && <ActivityTimeline events={ledger.data.items.filter((e) => subjects.has(bare(e.subjectId)))} personName={(id) => person(id)?.name} when={(iso) => dateTime(iso)} compact={false} empty="Nothing has been recorded for this award yet." />}
      </div>
    </section>
  );
}

type CheckState = "pass" | "fail" | "unknown";
const CHECK_ICON = { pass: CircleCheck, fail: CircleX, unknown: CircleDashed } as const;
const CHECK_CLASS = { pass: "rc-pass", fail: "rc-fail", unknown: "rc-unk" } as const;

/**
 * Closeout: what must be true before the award can be completed, and the lifecycle actions.
 * The checks are read from the award and its requirements; the API refuses completion itself
 * while a tranche is open, so the list explains the refusal before it happens.
 */
export function AwardCloseout({ award, onChanged }: { award: AwardDetail; onChanged: () => void }) {
  const [dialog, setDialog] = useState<"suspend" | "cancel" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const requirements = useApiQuery((api) => api.listRequirements(award.id), [award.id]);
  const complete = useApiMutation((api) => api.completeAward(award.id));
  const resume = useApiMutation((api) => api.resumeAward(award.id));
  const stop = useApiMutation((api, kind: "suspend" | "cancel", reason: string) => (kind === "suspend" ? api.suspendAward(award.id, reason) : api.cancelAward(award.id, reason)));

  const live = award.tranches.filter((t) => t.status !== "cancelled");
  const open = live.filter((t) => t.status !== "settled");
  const owed = (requirements.data ?? []).filter((r) => !["accepted", "waived"].includes(r.status));
  const awarded = award.awardedAmountMinor ?? 0;
  const disbursed = award.disbursedAmountMinor;
  const checks: { key: string; state: CheckState; label: string; reason: string }[] = [
    { key: "agreement", state: award.agreement?.status === "executed" ? "pass" : "fail", label: "Agreement executed", reason: award.agreement?.status === "executed" ? "Both parties have signed." : "The agreement is not executed." },
    { key: "tranches", state: live.length === 0 ? "unknown" : open.length ? "fail" : "pass", label: "Every tranche settled", reason: live.length === 0 ? "No payment schedule." : open.length ? `${open.length} of ${live.length} still open.` : `${live.length} of ${live.length} settled.` },
    {
      key: "requirements",
      state: requirements.status !== "ready" ? "unknown" : owed.length ? "fail" : "pass",
      label: "Every requirement accepted or waived",
      reason: requirements.status !== "ready" ? "Requirements could not be read." : owed.length ? `${owed.length} still owed: ${owed.map((r) => r.title).join(", ")}.` : requirements.data.length ? "All reports and documents are in." : "No requirements on this award.",
    },
    {
      key: "disbursed",
      state: disbursed === null ? "unknown" : disbursed >= awarded ? "pass" : "fail",
      label: "Disbursed equals awarded",
      reason: disbursed === null ? "Passport has not reported a disbursed amount yet." : `${formatMinor(disbursed, award.currency)} of ${formatMinor(awarded, award.currency)} disbursed, as read from Passport.`,
    },
  ];
  const blocking = checks.filter((c) => c.state !== "pass").length;
  const finished = (message: string) => {
    setDone(message);
    onChanged();
  };

  return (
    <section className="card" aria-labelledby="closeout-h">
      <div className="card-h">
        <h3 id="closeout-h">Closeout</h3>
        <span className="small muted">{award.status === "completed" ? "This award is complete" : blocking ? `${blocking} of ${checks.length} not met` : "Ready to complete"}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {done && <Notice tone="ok" title={done} />}
        {(complete.error !== null || resume.error !== null || stop.error !== null) && <ErrorBanner error={complete.error ?? resume.error ?? stop.error} />}
        <ul className="rc" aria-label="Closeout checklist">
          {checks.map((c, i) => {
            const Icon = CHECK_ICON[c.state];
            return (
              <li key={c.key} className={`rc-row ${CHECK_CLASS[c.state]}`} style={i === 0 ? { borderTop: 0 } : undefined}>
                <Icon className="ic" aria-hidden="true" />
                <div>
                  <div className="l">
                    <span className="sr">{c.state === "pass" ? "Met: " : c.state === "fail" ? "Not met: " : "Unknown: "}</span>
                    {c.label}
                  </div>
                  <div className="r">{c.reason}</div>
                </div>
                <span></span>
              </li>
            );
          })}
        </ul>
        <div className="row wrap" style={{ gap: "8px" }}>
          {award.status === "active" && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={blocking > 0 || complete.state === "saving"}
                onClick={async () => {
                  if (await complete.run()) finished("Award completed. Passport has been told.");
                }}
              >
                Complete award
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setDialog("suspend")}>
                Suspend
              </button>
            </>
          )}
          {award.status === "suspended" && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={resume.state === "saving"}
              onClick={async () => {
                if (await resume.run()) finished("Award resumed.");
              }}
            >
              Resume award
            </button>
          )}
          {["offered", "accepted", "active", "suspended"].includes(award.status) && (
            <button type="button" className="btn btn-danger" onClick={() => setDialog("cancel")}>
              Cancel award
            </button>
          )}
        </div>
        {award.status === "active" && blocking > 0 && <p className="help">Complete award is unavailable until every line above is met.</p>}
        {award.status === "completed" && <p className="help">A completed award is read-only. Its closeout summary is part of the workspace export.</p>}
      </div>
      {dialog && (
        <ReasonDialog
          title={dialog === "suspend" ? "Suspend this award" : "Cancel this award"}
          label={dialog === "suspend" ? "Why is it suspended? The grantee sees this." : "Why is it cancelled? Open tranches are cancelled with it."}
          action={dialog === "suspend" ? "Suspend award" : "Cancel award"}
          danger={dialog === "cancel"}
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const kind = dialog;
            const ok = await stop.run(kind, reason);
            setDialog(null);
            if (ok) finished(kind === "suspend" ? "Award suspended. No tranche can be released until it is resumed." : "Award cancelled.");
          }}
        />
      )}
    </section>
  );
}
