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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InvitationBadge({ invitation }: { invitation: AwardInvitation }) {
  return <StatusBadge kind="invitation" status={invitation.status} />;
}

function ChangeAddressDialog({ award, onClose, onDone }: { award: AwardDetail; onClose: () => void; onDone: (emailed: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const resend = useApiMutation((api, contactEmail: string) => api.resendInvitation(award.id, { contactEmail }));
  const problem = !email.trim() ? "Enter the new email address." : !EMAIL.test(email.trim()) ? "Enter a full email address, like name@example.org." : null;
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
            <h2 id="change-address-title">Change the contact address</h2>
            <p className="small muted">{award.recipient?.name} · {award.title}</p>
          </div>
        </div>
        <div className="bd">
          {resend.error !== null && <InvitationError error={resend.error} title="The invitation was not sent" />}
          <Field id="ca-email" label="New email address" required error={touched ? problem : null} help="We send a new link here. The link already sent stops working.">
            <input className="inp" id="ca-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={resend.state === "saving"}>
            <Send className="ic" aria-hidden="true" />
            Send to this address
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
  const problem = reason.trim() ? null : "Say why you are withdrawing this award.";
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
            <h2 id="withdraw-title">Withdraw this award</h2>
            <p className="small muted">{award.recipient?.name} · {award.title}</p>
          </div>
        </div>
        <div className="bd">
          {cancel.error !== null && <ErrorBanner error={cancel.error} title="The award was not withdrawn" />}
          <p>The link in the invitation stops working and the award is cancelled. This cannot be undone.</p>
          <Field id="wd-reason" label="Reason" required error={touched ? problem : null}>
            <textarea className="ta" id="wd-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Keep the award
          </button>
          <button type="submit" className="btn btn-danger" disabled={cancel.state === "saving"}>
            <Ban className="ic" aria-hidden="true" />
            Withdraw award
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** What the last send did, shown above the invitation: it went out, or the award was saved without the email. */
export type MailNote = "sent" | "failed" | null;

const WHAT_NEXT: Record<AwardInvitation["status"], (name: string, inv: AwardInvitation) => string> = {
  sent: (name, inv) => `Waiting for ${name}. The link works until ${formatDate(inv.expiresAt)} (${daysLeft(inv.expiresAt)} days). The agreement and payment schedule start once they accept.`,
  expired: (name, inv) => `The link expired on ${formatDate(inv.expiresAt)}. Send a new one, or withdraw the award.`,
  declined: (name) => `${name} declined this award. Withdraw it, or send the invitation again to a different address.`,
  accepted: (name) => `${name} accepted. The agreement and payments continue as for any award.`,
  revoked: () => "You withdrew this award, and its link no longer works.",
};

/** Where the invitation stands, with the actions the funder may take. `canAct` is admin or finance. */
export function InvitationPanel({ award, invitation, canAct, canWithdraw, mail, onMail, onChanged }: { award: AwardDetail; invitation: AwardInvitation; canAct: boolean; canWithdraw: boolean; mail: MailNote; onMail: (note: MailNote) => void; onChanged: () => void }) {
  const [dialog, setDialog] = useState<"address" | "withdraw" | null>(null);
  const resend = useApiMutation((api) => api.resendInvitation(award.id));
  // The award is saved either way; "failed" means the email did not go out and the funder should resend.
  // Held by the page, because reloading the award rebuilds this panel.
  const unsent = mail === "failed";
  const resent = mail === "sent";
  const name = award.recipient?.name ?? "the organization";
  const open = award.status === "offered" && invitation.status !== "accepted" && invitation.status !== "revoked";
  // Resend is refused once the invitation is accepted, declined or withdrawn.
  const canResend = open && (invitation.status === "sent" || invitation.status === "expired");

  return (
    <section className="card" aria-labelledby="invitation-h">
      <div className="card-h">
        <div>
          <h2 id="invitation-h" style={{ fontSize: "18px" }}>
            Invitation
          </h2>
          <p className="small muted">
            Sent to {invitation.email} · {formatDate(invitation.sentAt)}
          </p>
        </div>
        <InvitationBadge invitation={invitation} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {resend.error !== null && <InvitationError error={resend.error} title="The invitation was not sent" />}
        {unsent && (
          <div role="alert">
            <Notice tone="warn" title="The award was saved, but the email could not be sent">
              {name} has not been told yet. Choose Resend invitation to try again{canAct ? "" : ", or ask a workspace admin or finance member to"}.
            </Notice>
          </div>
        )}
        {resent && !unsent && <div role="status"><Notice tone="ok" title="Invitation sent again">A new link is on its way to {invitation.email}. The earlier link no longer works.</Notice></div>}
        <p>
          <Mail className="ic" aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: "6px" }} />
          {WHAT_NEXT[invitation.status](name, invitation)}
        </p>
        <dl className="kv">
          <dt>Organization</dt>
          <dd>{name}</dd>
          <dt>Contact address</dt>
          <dd>{invitation.email}</dd>
          <dt>Link expires</dt>
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
                Resend invitation
              </button>
            )}
            {canAct && canResend && (
              <button type="button" className="btn btn-secondary" onClick={() => setDialog("address")}>
                Change address…
              </button>
            )}
            {canWithdraw && (
              <button type="button" className="btn btn-danger" onClick={() => setDialog("withdraw")}>
                <Ban className="ic" aria-hidden="true" />
                Withdraw…
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
