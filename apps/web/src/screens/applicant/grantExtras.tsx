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
import { t } from "./i18n.ts";

const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 4)}…${h.slice(-4)}` : t("grantExtras.notRecorded"));

export function GrantDocuments({ award, base }: { award: AwardDetail; base: string }) {
  const ag = award.agreement;
  return (
    <section className="card" id="documents" aria-labelledby="grant-docs-h">
      <div className="card-h">
        <h2 id="grant-docs-h" style={{ fontSize: "18px" }}>
          {t("grantExtras.documents")}
        </h2>
        <span className="small muted">{award.funder.name ? t("grantExtras.fromFunder", { funder: award.funder.name }) : t("grantExtras.fromYourFunder")}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {ag ? (
          <div className="doc">
            <span className="ft ft-pdf">PDF</span>
            <div className="grow">
              <div className="nm">{ag.status === "executed" ? t("grantExtras.agreementExecutedFile") : t("grantExtras.agreementFile")}</div>
              <div className="mt">
                <StatusBadge kind="agreement" status={ag.status} />
                {ag.executedAt ? <span>{formatDate(ag.executedAt)}</span> : null}
                <samp className="mono">sha256 {shortHash(ag.documentSha256)}</samp>
              </div>
            </div>
            <Link to={`${base}/grants/${award.id}/offer`} className="btn btn-sm btn-ghost" aria-label={t("grantExtras.openTheGrantAgreement")}>
              {t("grantExtras.open")}
            </Link>
          </div>
        ) : (
          <p className="muted">{award.funder.name ? t("grantExtras.noDocuments", { funder: award.funder.name }) : t("grantExtras.noDocumentsTheFunder")}</p>
        )}
        {award.applicationId ? (
          <div className="doc">
            <span className="ft ft-doc">{t("grantExtras.app")}</span>
            <div className="grow">
              <div className="nm">{t("grantExtras.applicationAsSubmitted")}</div>
              <div className="mt">
                <span>{t("grantExtras.theRecordThisAwardWasDecided")}</span>
              </div>
            </div>
            <Link to={`${base}/applications/${award.applicationId}`} className="btn btn-sm btn-ghost" aria-label={t("grantExtras.openTheApplicationAsSubmitted")}>
              {t("grantExtras.open")}
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function GrantMessages({ award }: { award: AwardDetail }) {
  const appId = award.applicationId ?? "";
  const funder = award.funder.name ?? t("grantExtras.theFunder");
  const query = useApplicantQuery(async (a) => (appId ? ((await a.threads(appId)).find((t) => t.visibility === "shared") ?? null) : null), [appId]);
  const [reply, setReply] = useState("");
  const send = useApplicantMutation(async (a, thread: Thread | null, body: string) => {
    const open = thread ?? (await a.openThread(appId));
    const m = await a.postMessage(open.id, body);
    return { ...open, messages: [...open.messages, m] };
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
            {t("grantExtras.messages")}
          </h2>
          <span className="shared-mark">{t("grantExtras.sharedWith", { funder })}</span>
        </div>
        <span className="small muted">{t("grantExtras.bothSidesSeeThisThread")}</span>
      </div>
      <div className="card-b th">
        {!appId ? (
          <p className="muted">{t("grantExtras.thisGrantHasNoSharedThread")}</p>
        ) : (
          <>
            {(thread?.messages ?? []).length === 0 && <p className="muted">{t("grantExtras.noMessagesYet", { funder })}</p>}
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
                {t("grantExtras.messageTo", { funder })}
              </label>
              <textarea className="ta" id="grant-reply" style={{ minHeight: "56px", flex: 1 }} placeholder={t("grantExtras.messageToPlaceholder", { funder })} value={reply} onChange={(e) => setReply(e.target.value)} />
              <button className="btn btn-primary" type="submit" style={{ height: "44px" }} disabled={send.state === "saving" || !reply.trim()}>
                <Send className="ic" aria-hidden="true" />
                {t("grantExtras.send")}
              </button>
            </form>
            {send.error ? <ErrorBanner error={send.error} title={t("grantExtras.theMessageWasNotSent")} /> : null}
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
        ? { key: "payee", state: "pass", label: dest.level ? t("grantExtras.payeeVerifiedLevel", { level: dest.level }) : t("grantExtras.payeeVerified"), reason: [dest.bankName && dest.last4 ? `${dest.bankName} •••• ${dest.last4}` : dest.bankName, dest.status].filter(Boolean).join(" · ") || t("grantExtras.verifiedInPassport"), fixHref: null }
        : dest?.state === "ok"
          ? { key: "payee", state: "fail", label: t("grantExtras.changePending"), reason: t("grantExtras.changePendingReason"), fixHref: null }
          : dest?.state === "none"
            ? { key: "payee", state: "fail", label: t("grantExtras.noDestination"), reason: t("grantExtras.noDestinationReason"), fixHref: null }
            : { key: "payee", state: "unknown", label: t("grantExtras.payeeNotShown"), reason: dest?.state === "not_shared" ? t("grantExtras.notShared") : t("grantExtras.passportNotAsked"), fixHref: null };
    const approved = book?.approved;
    const budget: Item = approved
      ? { key: "budget", state: "pass", label: t("grantExtras.budgetOnFile"), reason: t("grantExtras.budgetAcross", { amount: formatMinor(award.awardedAmountMinor, award.currency), count: approved.lines.length }), fixHref: null }
      : { key: "budget", state: "unknown", label: t("grantExtras.noBudget"), reason: award.funder.name ? t("grantExtras.noBudgetReason", { funder: award.funder.name }) : t("grantExtras.noBudgetReasonTheFunder"), fixHref: null };
    const reqs = award.requirements ?? [];
    const plan: Item = reqs.length
      ? { key: "reports", state: "pass", label: t("grantExtras.reportingPlan"), reason: reqs.map((r) => `${r.title}${r.dueAt ? ` ${formatDate(r.dueAt)}` : ""}`).join(" · "), fixHref: null }
      : { key: "reports", state: "pass", label: t("grantExtras.noReports"), reason: t("grantExtras.noReportsReason"), fixHref: null };
    const items = [payee, budget, plan];
    const count = (st: Item["state"]) => items.filter((i) => i.state === st).length;
    return { ready: count("fail") === 0 && count("unknown") === 0, summary: { pass: count("pass"), fail: count("fail"), unknown: count("unknown") }, items } as Checklist;
  }, [award.id]);
  return (
    <section className="card" aria-labelledby="before-sign-h">
      <div className="card-h">
        <h2 id="before-sign-h" style={{ fontSize: "18px" }}>
          {t("grantExtras.beforeYouSign")}
        </h2>
      </div>
      <div className="card-b" style={{ paddingTop: "8px" }}>
        {query.status === "ready" ? <ReadinessChecklist checklist={query.data} /> : query.status === "error" ? <ErrorBanner error={query.error} onRetry={query.reload} /> : <p className="muted">{t("grantExtras.checking")}</p>}
      </div>
    </section>
  );
}
