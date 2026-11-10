// SPDX-License-Identifier: AGPL-3.0-only
// The Documents and Messages sections of a grant, shared by the offer and the payments screens.
// Documents are the ones this award produced (the agreement, with its hash); messages are the
// shared thread on the application the award came from.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Send } from "lucide-react";
import type { AwardDetail, Thread } from "../../api/applicant.ts";
import { useApplicantMutation, useApplicantQuery } from "../../api/applicantHooks.ts";
import { useFullApi } from "../../api/applicantFullHooks.ts";
import { useMoreApi } from "../../api/applicantMoreHooks.ts";
import type { Checklist } from "../../api/types.ts";
import { Avatar, timeAgo } from "../../components/applicant.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { ErrorBanner, ReadinessChecklist } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";

const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 4)}…${h.slice(-4)}` : "not recorded");

export function GrantDocuments({ award, base }: { award: AwardDetail; base: string }) {
  const ag = award.agreement;
  return (
    <section className="card" id="documents" aria-labelledby="grant-docs-h">
      <div className="card-h">
        <h2 id="grant-docs-h" style={{ fontSize: "18px" }}>
          Documents
        </h2>
        <span className="small muted">From {award.funder.name ?? "your funder"}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {ag ? (
          <div className="doc">
            <span className="ft ft-pdf">PDF</span>
            <div className="grow">
              <div className="nm">Grant agreement{ag.status === "executed" ? " — executed" : ""}.pdf</div>
              <div className="mt">
                <StatusBadge kind="agreement" status={ag.status} />
                {ag.executedAt ? <span>{formatDate(ag.executedAt)}</span> : null}
                <span className="mono">sha256 {shortHash(ag.documentSha256)}</span>
              </div>
            </div>
            <Link to={`${base}/grants/${award.id}/offer`} className="btn btn-sm btn-ghost">
              Open
            </Link>
          </div>
        ) : (
          <p className="muted">No documents yet. The agreement appears here when {award.funder.name ?? "the funder"} sends it.</p>
        )}
        {award.applicationId ? (
          <div className="doc">
            <span className="ft ft-doc">APP</span>
            <div className="grow">
              <div className="nm">Application as submitted</div>
              <div className="mt">
                <span>The record this award was decided on</span>
              </div>
            </div>
            <Link to={`${base}/applications/${award.applicationId}`} className="btn btn-sm btn-ghost">
              Open
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function GrantMessages({ award }: { award: AwardDetail }) {
  const appId = award.applicationId ?? "";
  const funder = award.funder.name ?? "the funder";
  const query = useApplicantQuery(async (a) => (appId ? ((await a.threads(appId)).find((t) => t.visibility === "shared") ?? null) : null), [appId]);
  const [reply, setReply] = useState("");
  const send = useApplicantMutation(async (a, thread: Thread | null, body: string) => {
    const t = thread ?? (await a.openThread(appId));
    const m = await a.postMessage(t.id, body);
    return { ...t, messages: [...t.messages, m] };
  });
  const thread = query.status === "ready" ? query.data : null;
  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    const next = await send.run(thread, reply.trim());
    if (next) {
      query.set(next);
      setReply("");
    }
  };
  return (
    <section className="card" id="messages" aria-labelledby="grant-msg-h">
      <div className="card-h">
        <div className="row" style={{ gap: "8px" }}>
          <h2 id="grant-msg-h" style={{ fontSize: "18px" }}>
            Messages
          </h2>
          <span className="shared-mark">Shared with {funder}</span>
        </div>
        <span className="small muted">Both sides see this thread</span>
      </div>
      <div className="card-b th">
        {!appId ? (
          <p className="muted">This grant has no shared thread.</p>
        ) : (
          <>
            {(thread?.messages ?? []).length === 0 && <p className="muted">No messages yet. Write to {funder} here; replies arrive by email too.</p>}
            {(thread?.messages ?? []).map((m) => (
              <div className="msg" key={m.id}>
                <Avatar name={m.author} index={m.authorUserId ? 0 : 3} />
                <div className="bub">
                  <div className="hd">
                    <span className="who">{m.author}</span>
                    <span>· {timeAgo(m.createdAt)}</span>
                  </div>
                  <div className="bd">{m.body}</div>
                </div>
              </div>
            ))}
            <form className="composer" onSubmit={onSend}>
              <label className="sr" htmlFor="grant-reply">
                Message {funder}
              </label>
              <textarea className="ta" id="grant-reply" style={{ minHeight: "56px", flex: 1 }} placeholder={`Message ${funder}…`} value={reply} onChange={(e) => setReply(e.target.value)} />
              <button className="btn btn-primary" type="submit" style={{ height: "44px" }} disabled={send.state === "saving" || !reply.trim()}>
                <Send className="ic" aria-hidden="true" />
                Send
              </button>
            </form>
            {send.error ? <ErrorBanner error={send.error} title="The message was not sent" /> : null}
          </>
        )}
      </div>
    </section>
  );
}

type Item = Checklist["items"][number];

/** What should be true before the grantee signs: payee, budget and reporting plan. */
export function BeforeYouSign({ award }: { award: AwardDetail }) {
  const full = useFullApi();
  const more = useMoreApi();
  const query = useApplicantQuery(async (): Promise<Checklist> => {
    const [dest, book] = await Promise.all([full.payoutDestination(award.id).catch(() => null), more.budget(award.id).catch(() => null)]);
    const payee: Item =
      dest?.state === "ok" && !dest.pendingChange
        ? { key: "payee", state: "pass", label: `Payee verified${dest.level ? ` (${dest.level})` : ""}`, reason: [dest.bankName && dest.last4 ? `${dest.bankName} •••• ${dest.last4}` : dest.bankName, dest.status].filter(Boolean).join(" · ") || "Verified in Passport", fixHref: null }
        : dest?.state === "ok"
          ? { key: "payee", state: "fail", label: "A destination change is pending", reason: "Payments wait until the change clears in Passport.", fixHref: null }
          : dest?.state === "none"
            ? { key: "payee", state: "fail", label: "No payout destination yet", reason: "Verify a bank account in Passport so payments can be released.", fixHref: null }
            : { key: "payee", state: "unknown", label: "Payee status not shown here", reason: dest?.state === "not_shared" ? "Your Passport consent does not share payee details with the GMS. Check the destination in Passport." : "Passport could not be asked just now.", fixHref: null };
    const approved = book?.approved;
    const budget: Item = approved
      ? { key: "budget", state: "pass", label: "Approved budget on file", reason: `${formatMinor(award.awardedAmountMinor, award.currency)} across ${approved.lines.length} ${approved.lines.length === 1 ? "category" : "categories"}`, fixHref: null }
      : { key: "budget", state: "unknown", label: "No approved budget yet", reason: `${award.funder.name ?? "The funder"} has not recorded an approved budget for this award.`, fixHref: null };
    const reqs = award.requirements ?? [];
    const plan: Item = reqs.length
      ? { key: "reports", state: "pass", label: "Reporting plan", reason: reqs.map((r) => `${r.title}${r.dueAt ? ` ${formatDate(r.dueAt)}` : ""}`).join(" · "), fixHref: null }
      : { key: "reports", state: "pass", label: "No reports required", reason: "This award has no reporting requirements.", fixHref: null };
    const items = [payee, budget, plan];
    const count = (st: Item["state"]) => items.filter((i) => i.state === st).length;
    return { ready: count("fail") === 0 && count("unknown") === 0, summary: { pass: count("pass"), fail: count("fail"), unknown: count("unknown") }, items } as Checklist;
  }, [award.id]);
  return (
    <section className="card" aria-labelledby="before-sign-h">
      <div className="card-h">
        <h2 id="before-sign-h" style={{ fontSize: "18px" }}>
          Before you sign
        </h2>
      </div>
      <div className="card-b" style={{ paddingTop: "8px" }}>
        {query.status === "ready" ? <ReadinessChecklist checklist={query.data} /> : query.status === "error" ? <ErrorBanner error={query.error} onRetry={query.reload} /> : <p className="muted">Checking…</p>}
      </div>
    </section>
  );
}
