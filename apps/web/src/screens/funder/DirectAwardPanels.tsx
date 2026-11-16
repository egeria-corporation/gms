// SPDX-License-Identifier: AGPL-3.0-only
// What a funder sees of an award given directly: where the invitation stands, and the three things
// that can be done about it. Resend sends a new link (the old one stops working); Change address
// sends it somewhere else; Withdraw is the ordinary cancel, with a reason, and revokes the link.
import { useState } from "react";
import { Ban, Mail, Send } from "lucide-react";
import { useApiMutation } from "../../api/hooks.ts";
import { type AwardInvitation } from "../../api/directAwards.ts";
import type { AwardDetail } from "../../api/funder.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { InvitationError } from "../../components/InvitationError.tsx";
import { ErrorBanner, Field, Notice } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { daysLeft } from "../../lib/directAward.ts";
import { t } from "./i18n.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InvitationBadge({ invitation }: { invitation: AwardInvitation }) {
  return <StatusBadge kind="invitation" status={invitation.status} />;
}

function ChangeAddressDialog({ award, onClose, onDone }: { award: AwardDetail; onClose: () => void; onDone: (emailed: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const resend = useApiMutation((api, contactEmail: string) => api.resendInvitation(award.id, { contactEmail }));
  const problem = !email.trim() ? t("directAwardPanels.problem.noEmail") : !EMAIL.test(email.trim()) ? t("directAwardPanels.problem.fullEmail") : null;
  return (
    <Dialog open onClose={onClose} labelledBy="change-address-title">
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched(true);
          if (problem) return;
          const sent = await resend.run(email.trim());
          if (sent) onDone(sent.emailed);
        }}
      >
        <div className="hd">
          <div>
            <h2 id="change-address-title">{t("directAwardPanels.changeTheContactAddress")}</h2>
            <p className="small muted">{award.recipient?.name} · {award.title}</p>
          </div>
        </div>
        <div className="bd">
          {resend.error !== null && <InvitationError error={resend.error} title={t("directAwardPanels.theInvitationWasNot")} />}
          <Field id="ca-email" label={t("directAwardPanels.newEmailAddress")} required error={touched ? problem : null} help={t("directAwardPanels.weSendANew")}>
            <input className="inp" id="ca-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("directAwardPanels.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={resend.state === "saving"}>
            <Send className="ic" aria-hidden="true" />
            {t("directAwardPanels.sendToThisAddress")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function WithdrawDialog({ award, onClose, onDone }: { award: AwardDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const cancel = useApiMutation((api, why: string) => api.cancelAward(award.id, why));
  const problem = reason.trim() ? null : t("directAwardPanels.problem.noReason");
  return (
    <Dialog open onClose={onClose} labelledBy="withdraw-title">
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched(true);
          if (problem) return;
          if (await cancel.run(reason.trim())) onDone();
        }}
      >
        <div className="hd">
          <div>
            <h2 id="withdraw-title">{t("directAwardPanels.withdrawThisAward")}</h2>
            <p className="small muted">{award.recipient?.name} · {award.title}</p>
          </div>
        </div>
        <div className="bd">
          {cancel.error !== null && <ErrorBanner error={cancel.error} title={t("directAwardPanels.theAwardWasNot")} />}
          <p>{t("directAwardPanels.theLinkInThe")}</p>
          <Field id="wd-reason" label={t("directAwardPanels.reason")} required error={touched ? problem : null}>
            <textarea className="ta" id="wd-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("directAwardPanels.keepTheAward")}
          </button>
          <button type="submit" className="btn btn-danger" disabled={cancel.state === "saving"}>
            <Ban className="ic" aria-hidden="true" />
            {t("directAwardPanels.withdrawAward")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** What the last send did, shown above the invitation: it went out, or the award was saved without the email. */
export type MailNote = "sent" | "failed" | null;

const WHAT_NEXT: Record<AwardInvitation["status"], (name: string, inv: AwardInvitation) => string> = {
  sent: (name, inv) => t("directAwardPanels.next.sent", { name, date: formatDate(inv.expiresAt), days: daysLeft(inv.expiresAt) }),
  expired: (_name, inv) => t("directAwardPanels.next.expired", { date: formatDate(inv.expiresAt) }),
  declined: (name) => t("directAwardPanels.next.declined", { name }),
  accepted: (name) => t("directAwardPanels.next.accepted", { name }),
  revoked: () => t("directAwardPanels.next.revoked"),
};

/** Where the invitation stands, with the actions the funder may take. `canAct` is admin or finance. */
export function InvitationPanel({ award, invitation, canAct, canWithdraw, mail, onMail, onChanged }: { award: AwardDetail; invitation: AwardInvitation; canAct: boolean; canWithdraw: boolean; mail: MailNote; onMail: (note: MailNote) => void; onChanged: () => void }) {
  const [dialog, setDialog] = useState<"address" | "withdraw" | null>(null);
  const resend = useApiMutation((api) => api.resendInvitation(award.id));
  // The award is saved either way; "failed" means the email did not go out and the funder should resend.
  // Held by the page, because reloading the award rebuilds this panel.
  const unsent = mail === "failed";
  const resent = mail === "sent";
  const name = award.recipient?.name ?? t("directAwardPanels.theOrganization");
  const open = award.status === "offered" && invitation.status !== "accepted" && invitation.status !== "revoked";
  // Resend is refused once the invitation is accepted, declined or withdrawn.
  const canResend = open && (invitation.status === "sent" || invitation.status === "expired");

  return (
    <section className="card" aria-labelledby="invitation-h">
      <div className="card-h">
        <div>
          <h2 id="invitation-h" style={{ fontSize: "18px" }}>
            {t("directAwardPanels.invitation")}
          </h2>
          <p className="small muted">
            {t("directAwardPanels.sentTo", { email: invitation.email, date: formatDate(invitation.sentAt) })}
          </p>
        </div>
        <InvitationBadge invitation={invitation} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {resend.error !== null && <InvitationError error={resend.error} title={t("directAwardPanels.theInvitationWasNot")} />}
        {unsent && (
          <div role="alert">
            <Notice tone="warn" title={t("directAwardPanels.theAwardWasSaved")}>
              {canAct ? t("directAwardPanels.notToldResend", { name }) : t("directAwardPanels.notToldAsk", { name })}
            </Notice>
          </div>
        )}
        {resent && !unsent && <div role="status"><Notice tone="ok" title={t("directAwardPanels.invitationSentAgain")}>{t("directAwardPanels.aNewLinkIs", { email: invitation.email })}</Notice></div>}
        <p>
          <Mail className="ic" aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: "6px" }} />
          {WHAT_NEXT[invitation.status](name, invitation)}
        </p>
        <dl className="kv">
          <dt>{t("directAwardPanels.organization")}</dt>
          <dd>{name}</dd>
          <dt>{t("directAwardPanels.contactAddress")}</dt>
          <dd>{invitation.email}</dd>
          <dt>{t("directAwardPanels.linkExpires")}</dt>
          <dd>{formatDate(invitation.expiresAt)}</dd>
        </dl>
        {open && (
          <div className="row wrap">
            {canAct && canResend && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={resend.state === "saving"}
                onClick={async () => {
                  onMail(null);
                  const sent = await resend.run();
                  if (sent) {
                    onMail(sent.emailed ? "sent" : "failed");
                    onChanged();
                  }
                }}
              >
                <Send className="ic" aria-hidden="true" />
                {t("directAwardPanels.resendInvitation")}
              </button>
            )}
            {canAct && canResend && (
              <button type="button" className="btn btn-secondary" onClick={() => setDialog("address")}>
                {t("directAwardPanels.changeAddress")}
              </button>
            )}
            {canWithdraw && (
              <button type="button" className="btn btn-danger" onClick={() => setDialog("withdraw")}>
                <Ban className="ic" aria-hidden="true" />
                {t("directAwardPanels.withdraw")}
              </button>
            )}
          </div>
        )}
      </div>
      {dialog === "address" && (
        <ChangeAddressDialog
          award={award}
          onClose={() => setDialog(null)}
          onDone={(emailed) => {
            setDialog(null);
            onMail(emailed ? "sent" : "failed");
            onChanged();
          }}
        />
      )}
      {dialog === "withdraw" && (
        <WithdrawDialog
          award={award}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
