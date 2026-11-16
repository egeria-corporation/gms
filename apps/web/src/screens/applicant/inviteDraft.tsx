// SPDX-License-Identifier: AGPL-3.0-only
// Invite someone into a draft (v1.7.0): the "Invite someone by email" choice in an assignee
// picker, the dialog behind it, and the one-time "Writing with others? Invite a teammate" note.
// One click on "Send invitation" sends one email; nothing is ever sent again for it, and no
// address book is read. The invited person can open this one draft and write its answers.
import { useRef, useState, type FormEvent, type KeyboardEvent, type SelectHTMLAttributes } from "react";
import { MailCheck, UserPlus, Users, X } from "lucide-react";
import { INVITE_TEAMMATE_NOTE, type DraftInvitation, type DraftInvitationList, type DraftKind, type DraftRef } from "../../api/invites.ts";
import { useInvitesMutation, useInvitesQuery } from "../../api/invitesHooks.ts";
import type { Query } from "../../api/hooks.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { ErrorBanner, Field, problemFor } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { t } from "./i18n.ts";

/** The picker value that opens the invite dialog instead of assigning anyone. */
export const INVITE_OPTION = "__invite__";

/** Invitations into this draft still waiting, and whether the signed-in person may send one. */
export function useDraftInvites(kind: DraftKind, id: string, enabled = true): Query<DraftInvitationList | null> {
  return useInvitesQuery((api) => (enabled ? api.draftInvitations(kind, id).catch(() => null) : Promise.resolve(null)), [kind, id, enabled]);
}

/**
 * The extra choices at the end of an assignee picker: one disabled line per invitation still
 * waiting for this question or section, then "Invite someone by email…" for those who may invite.
 */
export function InviteOptions({ list, match }: { list: DraftInvitationList | null; match: (d: DraftInvitationList["invitations"][number]["draft"]) => boolean }) {
  if (!list) return null;
  const waiting = list.invitations.filter((i) => match(i.draft));
  return (
    <>
      {waiting.map((i) => (
        <option key={i.id} value={`invited:${i.id}`} disabled>
          {t("inviteDraft.invitedWaiting", { email: i.email })}
        </option>
      ))}
      {list.canInvite && <option value={INVITE_OPTION}>{t("inviteDraft.inviteSomeoneByEmail")}</option>}
    </>
  );
}

const MOVES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/**
 * An assignee picker whose last choice, "Invite someone by email…", opens a dialog. Picked with a
 * pointer, or with Enter in the open list, it opens at once. Reached by moving through the closed
 * picker with the arrow keys or by typing (Windows and Linux change the value on each key), it waits
 * for Enter, so going through the choices never opens a dialog by itself (WCAG 3.2.2).
 */
export function InvitePicker({ id, value, onChoose, onInvite, children, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "id"> & { id: string; value: string; onChoose: (value: string) => void; onInvite: () => void }) {
  const keyed = useRef(false);
  const [pending, setPending] = useState(false);
  const hintId = `${id}-invite-hint`;
  const invite = () => {
    setPending(false);
    onInvite();
  };
  return (
    <>
      <select
        {...rest}
        id={id}
        value={pending ? INVITE_OPTION : value}
        aria-describedby={pending ? hintId : undefined}
        onPointerDown={() => {
          keyed.current = false;
        }}
        onKeyDown={(e: KeyboardEvent<HTMLSelectElement>) => {
          if (pending && e.key === "Enter") {
            e.preventDefault();
            invite();
            return;
          }
          keyed.current = (MOVES.has(e.key) && !e.altKey) || (e.key.length === 1 && e.key !== " ");
        }}
        onBlur={() => setPending(false)}
        onChange={(e) => {
          if (e.target.value !== INVITE_OPTION) {
            setPending(false);
            onChoose(e.target.value);
          } else if (keyed.current) setPending(true);
          else invite();
        }}
      >
        {children}
      </select>
      {pending && (
        <span className="help" id={hintId}>
          {t("inviteDraft.pressEnterToInviteSomeoneBy")}
        </span>
      )}
    </>
  );
}

/** "Invite someone by email": one address, typed; one email, sent on this click only. */
export function InviteDialog({ draft, title, part, remainingToday, onClose, onSent }: { draft: DraftRef; title: string; part: string | null; remainingToday: number | null; onClose: () => void; onSent: (inv: DraftInvitation) => void }) {
  const [email, setEmail] = useState("");
  const send = useInvitesMutation((api) => api.inviteToDraft({ email: email.trim(), draft }));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await send.run();
    if (r) onSent(r);
  };
  const out = remainingToday !== null && remainingToday <= 0;
  return (
    <Dialog open onClose={onClose} labelledBy="inv-draft-title">
      <form onSubmit={onSubmit} style={{ display: "contents" }}>
        <div className="hd">
          <div>
            <h3 id="inv-draft-title" style={{ fontSize: "16px" }}>
              {t("inviteDraft.inviteSomeoneToHelpWriteThis")}
            </h3>
            <p className="small muted" style={{ overflowWrap: "anywhere" }}>
              {title}
              {part ? ` · ${part}` : ""}
            </p>
          </div>
          <button className="iconbtn" type="button" aria-label={t("inviteDraft.close")} onClick={onClose}>
            <X className="ic ic-md" aria-hidden="true" />
          </button>
        </div>
        <div className="bd">
          <Field id="inv-draft-email" label={t("inviteDraft.theirEmailAddress")} required error={problemFor(send.error, "email")} help={t("inviteDraft.typeTheAddressYourselfNothingIs")}>
            <input id="inv-draft-email" className="inp" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <ul className="small" style={{ listStyle: "disc", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }} aria-label={t("inviteDraft.whatHappens")}>
            <li>{t("inviteDraft.theyJoinYourWorkspaceAsA")}</li>
            {part ? <li>{t("inviteDraft.assignedOnAccept", { part })}</li> : null}
            <li>{t("inviteDraft.weSendOneEmailWhenYou")}</li>
            <li>{t("inviteDraft.theLinkWorksOnceForThat")}</li>
          </ul>
          {remainingToday !== null && (
            <p className="small muted" role="status">
              {out ? t("inviteDraft.yourWorkspaceHasSentTodays20") : t("inviteDraft.remainingToday", { count: remainingToday })}
            </p>
          )}
          {send.error && !problemFor(send.error, "email") ? <ErrorBanner error={send.error} title={t("inviteDraft.theInvitationWasNotSent")} /> : null}
        </div>
        <div className="ft">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            {t("inviteDraft.cancel")}
          </button>
          <button className="btn btn-primary" type="submit" disabled={!email.trim() || out || send.state === "saving"}>
            <UserPlus className="ic" aria-hidden="true" />
            {send.state === "saving" ? t("inviteDraft.sending") : t("inviteDraft.sendInvitation")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** What the inviter sees once it went: the masked address, and the link when no email could be sent. */
export function InviteSentNote({ sent, onDone }: { sent: DraftInvitation; onDone: () => void }) {
  return (
    <div className="bnr bnr-ok" role="status">
      <MailCheck className="ic" aria-hidden="true" />
      <div className="grow">
        <div className="t">{sent.emailed ? t("inviteDraft.sentTo", { email: sent.email }) : t("inviteDraft.readyFor", { email: sent.email })}</div>
        <div className="d">
          {sent.emailed ? t("inviteDraft.linkWorksUntil", { date: formatDate(sent.expiresAt) }) : t("inviteDraft.theEmailCouldNotBeSent")}
          {!sent.emailed && sent.acceptUrl ? (
            <code className="mono" style={{ display: "block", overflowWrap: "anywhere", marginTop: "4px" }}>
              {sent.acceptUrl}
            </code>
          ) : null}
        </div>
      </div>
      <button type="button" className="btn btn-sm btn-ghost act" onClick={onDone}>
        {t("inviteDraft.dismiss")}
      </button>
    </div>
  );
}

/**
 * The one-time note, after the first application is started: shown to those who may invite until
 * they dismiss it (kept per person and workspace on the server, so it stays dismissed everywhere).
 */
export function TeamNote({ canInvite, onInvite }: { canInvite: boolean; onInvite: () => void }) {
  const notes = useInvitesQuery((api) => api.dismissedNotes().catch(() => [INVITE_TEAMMATE_NOTE]), []);
  const dismiss = useInvitesMutation((api) => api.dismissNote(INVITE_TEAMMATE_NOTE));
  const [hidden, setHidden] = useState(false);
  if (!canInvite || hidden || notes.status !== "ready" || notes.data.includes(INVITE_TEAMMATE_NOTE)) return null;
  return (
    <div className="bnr bnr-info" role="region" aria-label={t("inviteDraft.writingWithOthers")}>
      <Users className="ic" aria-hidden="true" />
      <div className="grow">
        <div className="t">{t("inviteDraft.writingWithOthersInviteATeammate")}</div>
        <div className="d">{t("inviteDraft.inviteSomeoneByEmailToHelp")}</div>
      </div>
      <button type="button" className="btn btn-sm btn-secondary act" aria-haspopup="dialog" onClick={onInvite}>
        <UserPlus className="ic" aria-hidden="true" />
        {t("inviteDraft.inviteATeammate")}
      </button>
      <button
        type="button"
        className="btn btn-sm btn-ghost act"
        disabled={dismiss.state === "saving"}
        onClick={async () => {
          setHidden(true);
          await dismiss.run();
        }}
      >
        {t("inviteDraft.dismiss")}
      </button>
    </div>
  );
}
