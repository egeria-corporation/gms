// SPDX-License-Identifier: AGPL-3.0-only
// Awards, and one award's agreement. The agreement moves draft → sent → signed by grantee →
// executed; the funder countersigns only after the grantee has signed, by typing their name and
// attesting, against the hash of the document that was sent. Payments stay on their own tab.
import { useState } from "react";
import { openBlob } from "../../lib/browser.ts";
import { Link, useLocation, useParams } from "react-router";
import { Award as AwardIcon, Check, FileText, Hash, PenLine, Plus, Send } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { Agreement, AwardDetail, AwardSummary } from "../../api/funder.ts";
import { invitationOf } from "../../api/directAwards.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge, VerificationBadge, WorkspaceName } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, TabPanel } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { canCancelAward, canGiveDirectAward } from "../../lib/roles.ts";
import { AwardActivity, AwardCloseout, AwardDocuments, AwardTabs, SignatureRecords, useAwardTab } from "./AwardSections.tsx";
import { InvitationBadge, InvitationPanel, type MailNote } from "./DirectAwardPanels.tsx";
import { dateTime } from "./shared.tsx";

const STEPS: [Agreement["status"], string][] = [
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["signed_by_grantee", "Signed by grantee"],
  ["executed", "Executed"],
];
const shortHash = (h: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : "—");

function CountersignDialog({ agreement, award, onClose, onDone }: { agreement: Agreement; award: AwardDetail; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [attest, setAttest] = useState(false);
  const sign = useApiMutation((api) => api.countersignAgreement(agreement.id, { name: name.trim(), attest: true, ...(agreement.documentSha256 ? { documentSha256: agreement.documentSha256 } : {}) }));
  return (
    <Dialog open onClose={onClose} labelledBy="countersign-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await sign.run()) onDone();
        }}
      >
        <div className="hd">
          <div>
            <h2 id="countersign-title">Countersign the grant agreement</h2>
            <p className="small muted">
              {award.recipient?.name} · {award.title} · {formatMinor(award.awardedAmountMinor, award.currency)}
            </p>
          </div>
        </div>
        <div className="bd">
          {sign.error !== null && <ErrorBanner error={sign.error} />}
          <p className="row small">
            <Hash className="ic" aria-hidden="true" />
            Document hash <span className="mono">sha256 {shortHash(agreement.documentSha256)}</span> · signed by {agreement.granteeSignature?.name} on {formatDate(agreement.granteeSignedAt)}
          </p>
          <Field id="countersign-name" label="Type your full legal name" required>
            <input className="inp" id="countersign-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </Field>
          <label className="cb">
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            <span>I am authorized to sign for {award.funder.name} and agree to the terms of this agreement.</span>
          </label>
          <p className="help">Recorded: your typed name, the time, the network address of this session and the document hash. Signing is a human gate: an agent can prepare an agreement but never sign one.</p>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !attest || sign.state === "saving"}>
            <PenLine className="ic" aria-hidden="true" />
            Countersign
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AgreementPanel({ award, onChanged }: { award: AwardDetail; onChanged: () => void }) {
  const summary = award.agreement;
  const agreement = useApiQuery(async (api) => (summary ? api.getAgreement(summary.id) : null), [summary?.id, summary?.status]);
  const create = useApiMutation((api) => api.createAgreement(award.id));
  const send = useApiMutation((api, id: string) => api.sendAgreement(id));
  const pdf = useApiMutation(async (api, id: string) => {
    openBlob(await api.agreementPdf(id), "grant-agreement.pdf");
    return true;
  });
  const [signing, setSigning] = useState(false);
  const g = agreement.data;
  const at = g ? STEPS.findIndex(([s]) => s === (g.status === "countersigned" ? "executed" : g.status)) : -1;

  return (
    <section className="card" aria-labelledby="agreement-h">
      <div className="card-h">
        <div>
          <h2 id="agreement-h" style={{ fontSize: "18px" }}>
            Grant agreement
          </h2>
          {g && (
            <p className="small muted">
              Version {g.version} · created {formatDate(g.createdAt)}
            </p>
          )}
        </div>
        {g && <StatusBadge kind="agreement" status={g.status} />}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {agreement.status === "loading" && <Loading label="Loading the agreement" />}
        {agreement.status === "error" && <ErrorBanner error={agreement.error} onRetry={agreement.reload} />}
        {(create.error !== null || send.error !== null || pdf.error !== null) && <ErrorBanner error={create.error ?? send.error ?? pdf.error} />}
        {agreement.status === "ready" && !g && (
          <EmptyState
            icon={FileText}
            title="No agreement yet"
            actions={
              <button type="button" className="btn btn-primary" disabled={create.state === "saving"} onClick={async () => (await create.run()) && onChanged()}>
                Generate agreement
              </button>
            }
          >
            Generate the agreement from your standard template. Nothing is sent until you send it.
          </EmptyState>
        )}
        {g && (
          <>
            <ol className="stp" aria-label="Agreement progress" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {STEPS.map(([key, label], i) => (
                <li key={key} style={{ display: "contents" }}>
                  <span className={i < at || g.status === "executed" ? "s done" : i === at ? "s on" : "s"} aria-current={i === at ? "step" : undefined}>
                    <span className="n">{i < at || g.status === "executed" ? <Check className="ic ic-sm" aria-hidden="true" /> : i + 1}</span>
                    {label}
                  </span>
                  {i < STEPS.length - 1 && <span className={i < at ? "ln done" : "ln"} aria-hidden="true"></span>}
                </li>
              ))}
            </ol>
            <dl className="kv">
              <dt>Document</dt>
              <dd className="mono">sha256 {shortHash(g.documentSha256)}</dd>
              <dt>Grantee signature</dt>
              <dd>{g.granteeSignature ? `${g.granteeSignature.name} · ${dateTime(g.granteeSignature.at)}` : "Not signed yet"}</dd>
              <dt>Funder signature</dt>
              <dd>{g.funderSignature ? `${g.funderSignature.name} · ${dateTime(g.funderSignature.at)}` : "Not signed yet"}</dd>
              <dt>Executed</dt>
              <dd>{g.executedAt ? dateTime(g.executedAt) : "—"}</dd>
            </dl>
            {g.status === "sent" && <Notice tone="info" title="Waiting for the grantee to sign">You can countersign once they have signed.</Notice>}
            {g.status === "executed" && <Notice tone="ok" title="Agreement executed">The award is active and tranches that were waiting on execution are now due.</Notice>}
            <div className="row wrap">
              {g.status === "draft" && (
                <button type="button" className="btn btn-primary" disabled={send.state === "saving"} onClick={async () => (await send.run(g.id)) && onChanged()}>
                  <Send className="ic" aria-hidden="true" />
                  Send to grantee
                </button>
              )}
              {g.status === "signed_by_grantee" && (
                <button type="button" className="btn btn-primary" onClick={() => setSigning(true)}>
                  <PenLine className="ic" aria-hidden="true" />
                  Countersign…
                </button>
              )}
              {g.hasStoredPdf && (
                <button type="button" className="btn btn-secondary" disabled={pdf.state === "saving"} onClick={() => pdf.run(g.id)}>
                  <FileText className="ic" aria-hidden="true" />
                  {g.status === "executed" ? "Open executed PDF" : "Open PDF"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {signing && g && (
        <CountersignDialog
          agreement={g}
          award={award}
          onClose={() => setSigning(false)}
          onDone={() => {
            setSigning(false);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function Amendments({ award, onChanged }: { award: AwardDetail; onChanged: () => void }) {
  const decide = useApiMutation((api, id: string, status: "approved" | "declined") => api.decideAmendment(id, { status }));
  if (!award.amendments.length) return <div className="card card-b muted">No amendment requests on this award.</div>;
  return (
    <div className="card">
      {decide.error !== null && <ErrorBanner error={decide.error} />}
      <table className="tbl" aria-label="Amendments">
        <thead>
          <tr>
            <th>Type</th>
            <th>Requested</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {award.amendments.map((m) => (
            <tr key={m.id}>
              <td className="b">{m.type}</td>
              <td>{formatDate(m.createdAt)}</td>
              <td>{m.status}</td>
              <td>
                {m.status === "requested" && (
                  <span className="row">
                    <button type="button" className="btn btn-sm btn-primary" onClick={async () => (await decide.run(m.id, "approved")) && onChanged()}>
                      Approve
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await decide.run(m.id, "declined")) && onChanged()}>
                      Decline
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgreementSignatures({ award, funderName }: { award: AwardDetail; funderName: string }) {
  const summary = award.agreement;
  const agreement = useApiQuery(async (api) => (summary ? api.getAgreement(summary.id) : null), [summary?.id, summary?.status]);
  if (!agreement.data) return null;
  return <SignatureRecords awardId={award.id} agreement={agreement.data} recipientName={award.recipient?.name ?? "the recipient"} funderName={funderName} />;
}

export default function AwardAgreement() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const canGive = canGiveDirectAward(ws.member.role ?? "admin");
  const canWithdraw = canCancelAward(ws.member.role ?? "admin");
  // Set by New award when the email could not be sent.
  const [mail, setMail] = useState<MailNote>((useLocation().state as { emailed?: boolean } | null)?.emailed === false ? "failed" : null);
  const { awardId } = useParams();
  const awards = useApiQuery((api) => api.listAwards(), []);
  const programs = useApiQuery((api) => api.listPrograms(), []);
  const current: AwardSummary | undefined = awards.data?.find((a) => a.id === awardId) ?? awards.data?.[0];
  const award = useApiQuery(async (api) => (current ? api.getAward(current.id) : null), [current?.id]);
  const [tab, setTab] = useAwardTab("agreement", current?.id, base);
  const tranches = useApiQuery((api) => api.listTranches(), []);
  const nextDue = (id: string) => {
    const open = (tranches.data ?? []).filter((t) => t.awardId === id && ["scheduled", "due", "ready", "held"].includes(t.status));
    const dated = open.filter((t) => t.dueAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))[0];
    if (dated) return `Tranche ${dated.seq} · ${formatDate(dated.dueAt)}`;
    return open[0] ? `Tranche ${open[0].seq} · when its condition is met` : "—";
  };
  const total = (awards.data ?? []).reduce((n, a) => n + (a.awardedAmountMinor ?? 0), 0);
  const reload = () => {
    award.reload();
    awards.reload();
  };
  const invitation = award.data ? invitationOf(award.data) : null;
  // Until the organization accepts there is no agreement, schedule or payment to show.
  const awaitingAcceptance = invitation !== null && invitation.status !== "accepted";

  return (
    <>
      <title>{`Awards — ${ws.name}`}</title>
      <FunderShell active="Awards">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: "Awards" }]}
            title="Awards"
            actions={
              canGive && (
                <Link to={`${base}/awards/new`} className="btn btn-primary">
                  <Plus className="ic" aria-hidden="true" />
                  New award
                </Link>
              )
            }
            meta={
              <span>
                {awards.data?.length === 1 ? "1 award" : `${awards.data?.length ?? 0} awards`} · {formatMinor(total)} awarded
              </span>
            }
          />
          {awards.status === "loading" && <Loading label="Loading awards" />}
          {awards.status === "error" && <ErrorBanner error={awards.error} onRetry={awards.reload} />}
          {awards.status === "ready" && awards.data.length === 0 && (
            <EmptyState icon={AwardIcon} title="No awards yet">
              An award is created when a panel decision to approve is committed, or you can give one directly to an organization that has not applied.
            </EmptyState>
          )}
          {awards.status === "ready" && awards.data.length > 0 && (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Awards, scrollable">
              <table className="tbl" aria-label="Awards">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Title</th>
                    <th>Program</th>
                    <th className="num">Awarded</th>
                    <th className="num">Disbursed</th>
                    <th className="num">Remaining</th>
                    <th>Status</th>
                    <th>Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {awards.data.map((a) => (
                    <tr key={a.id} className={a.id === current?.id ? "sel" : undefined}>
                      <td style={{ padding: "6px 12px" }}>
                        <div className="ent">
                          <Link to={`${base}/awards/${a.id}/agreement`} className="nm" aria-current={a.id === current?.id ? "true" : undefined}>
                            {a.recipient?.name ?? "Recipient"}
                          </Link>
                          <div className="sub">
                            {invitationOf(a) && invitationOf(a)!.status !== "accepted" ? (
                              <InvitationBadge invitation={invitationOf(a)!} />
                            ) : (
                              <VerificationBadge verification={a.recipient?.verification} level={a.recipient?.level} />
                            )}
                            <WorkspaceName name={a.recipient?.workspaceName} />
                          </div>
                        </div>
                      </td>
                      <td>{a.title}</td>
                      <td>{programs.data?.find((p) => p.id === a.programId)?.name ?? "—"}</td>
                      <td className="num">{formatMinor(a.awardedAmountMinor, a.currency)}</td>
                      <td className="num">{formatMinor(a.disbursedAmountMinor ?? 0, a.currency)}</td>
                      <td className="num">{formatMinor(Math.max(0, (a.awardedAmountMinor ?? 0) - (a.disbursedAmountMinor ?? 0)), a.currency)}</td>
                      <td>
                        <StatusBadge kind="award" status={a.status} />
                      </td>
                      <td className="small">{nextDue(a.id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {award.status === "error" && <ErrorBanner error={award.error} onRetry={award.reload} />}
          {award.data && (
            <>
              <div className="card" style={{ padding: "16px 20px" }}>
                <div className="row wrap" style={{ justifyContent: "space-between", gap: "12px" }}>
                  <div className="col" style={{ gap: "4px" }}>
                    <div className="row wrap">
                      <span className="b" style={{ color: "#0D2A43" }}>
                        {award.data.recipient?.name}
                      </span>
                      {invitation && invitation.status !== "accepted" ? <InvitationBadge invitation={invitation} /> : <VerificationBadge verification={award.data.recipient?.verification} level={award.data.recipient?.level} />}
                      <WorkspaceName name={award.data.recipient?.workspaceName} />
                      <StatusBadge kind="award" status={award.data.status} />
                    </div>
                    <h2>{award.data.title}</h2>
                  </div>
                  <div className="row">
                    {award.data.applicationId && (
                      <Link to={`${base}/applications/${award.data.applicationId}`} className="btn btn-secondary">
                        Application
                      </Link>
                    )}
                    {!awaitingAcceptance && (
                      <Link to={`${base}/awards/${award.data.id}/payments`} className="btn btn-secondary">
                        Payments
                      </Link>
                    )}
                  </div>
                </div>
              </div>
              <div className="amounts">
                <div>
                  <div className="stat-l">Awarded</div>
                  <div className="stat-v">{formatMinor(award.data.awardedAmountMinor, award.data.currency)}</div>
                </div>
                <div>
                  <div className="stat-l">Disbursed (from Passport)</div>
                  <div className="stat-v">{formatMinor(award.data.disbursedAmountMinor ?? 0, award.data.currency)}</div>
                </div>
                <div>
                  <div className="stat-l">Tranches</div>
                  <div className="stat-v">{award.data.tranches.length}</div>
                </div>
                <div>
                  <div className="stat-l">Passport mirror</div>
                  <div className="stat-d" style={{ marginTop: "8px" }}>
                    {{ synced: "Synced", pending: "Not synced yet", not_applicable: "Not applicable", disabled: "Connect Passport to pay" }[award.data.passport.mirror]}
                  </div>
                </div>
              </div>
              <AwardTabs active={tab} onChange={setTab} counts={{ amendments: award.data.amendments.length, payments: award.data.tranches.filter((t) => ["due", "ready", "held"].includes(t.status)).length }} />
              <TabPanel idPrefix="award" tab="agreement" active={tab}>
                {invitation && invitation.status !== "accepted" ? (
                  <InvitationPanel award={award.data} invitation={invitation} canAct={canGive} canWithdraw={canWithdraw} mail={mail} onMail={setMail} onChanged={reload} />
                ) : (
                  <>
                    {invitation && <InvitationPanel award={award.data} invitation={invitation} canAct={canGive} canWithdraw={canWithdraw} mail={mail} onMail={setMail} onChanged={reload} />}
                    <AgreementPanel award={award.data} onChanged={reload} />
                    <AgreementSignatures award={award.data} funderName={ws.name} />
                  </>
                )}
              </TabPanel>
              <TabPanel idPrefix="award" tab="amendments" active={tab}>
                <Amendments award={award.data} onChanged={reload} />
              </TabPanel>
              <TabPanel idPrefix="award" tab="documents" active={tab}>
                <AwardDocuments award={award.data} />
              </TabPanel>
              <TabPanel idPrefix="award" tab="messages" active={tab}>
                <div className="card card-b">
                  {award.data.applicationId ? (
                    <span>
                      Messages with this grantee continue in the thread on the <Link to={`${base}/applications/${award.data.applicationId}#messages`}>application</Link>.
                    </span>
                  ) : (
                    <span className="muted">No thread for this award.</span>
                  )}
                </div>
              </TabPanel>
              <TabPanel idPrefix="award" tab="activity" active={tab}>
                <AwardActivity award={award.data} />
              </TabPanel>
              <TabPanel idPrefix="award" tab="closeout" active={tab}>
                <AwardCloseout award={award.data} onChanged={reload} />
              </TabPanel>
            </>
          )}
        </main>
      </FunderShell>
    </>
  );
}
