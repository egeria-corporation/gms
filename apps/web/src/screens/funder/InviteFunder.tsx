// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Invite a funder (E4, loop 1). A funder admin invites a peer funder by email with a
// short note of their own, reads a preview of exactly the email that goes out, and sends it. One
// email, never a reminder, at most five a week for the workspace; the list shows who was invited
// (masked), whether they joined, and how many joined. A person's act: agents cannot send one.
import { useState, type FormEvent } from "react";
import { CircleDashed, Info, Mail, Send, UserCheck, UserPlus } from "lucide-react";
import { PEER_INVITE_NOTE_MAX, type PeerInvitation, type PeerInvitePreview } from "../../api/loops.ts";
import { useLoopsMutation, useLoopsQuery } from "../../api/loopsHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { DataTable, EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, problemFor } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { SettingsNav } from "./SettingsPassport.tsx";
import { t, useFunderMessages } from "./i18n.ts";

const STATUS = {
  not_sent: { icon: CircleDashed, cls: "bdg bdg-neutral", key: "inviteFunder.status.notSent" },
  sent: { icon: Send, cls: "bdg bdg-info", key: "inviteFunder.status.sent" },
  joined: { icon: UserCheck, cls: "bdg bdg-ok", key: "inviteFunder.status.joined" },
} as const;

function InvitationStatus({ status }: { status: PeerInvitation["status"] }) {
  const s = STATUS[status] ?? STATUS.not_sent;
  return (
    <span className={s.cls}>
      <s.icon className="ic" aria-hidden="true" />
      {t(s.key)}
    </span>
  );
}

function PreviewDialog({ preview, workspaceId, onClose, onSent }: { preview: PeerInvitePreview; workspaceId: string; onClose: () => void; onSent: (to: string) => void }) {
  const send = useLoopsMutation((api, input: Parameters<typeof api.sendPeerInvite>[1]) => api.sendPeerInvite(workspaceId, input));
  return (
    <Dialog open onClose={onClose} labelledBy="invite-preview-title" size="lg">
      <div className="hd">
        <h2 id="invite-preview-title">{t("inviteFunder.preview.title")}</h2>
      </div>
      <div className="bd" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p className="small muted">{t("inviteFunder.preview.exactly")}</p>
        {preview.alreadyInvited && <Notice tone="warn" title={t("inviteFunder.preview.alreadyInvited")} />}
        {send.error !== null && <ErrorBanner error={send.error} title={t("inviteFunder.preview.notSent")} />}
        <dl className="kv">
          <dt>{t("inviteFunder.preview.from")}</dt>
          <dd>{preview.from}</dd>
          <dt>{t("inviteFunder.preview.to")}</dt>
          <dd>{preview.to}</dd>
          <dt>{t("inviteFunder.preview.replyTo")}</dt>
          <dd>{preview.replyTo}</dd>
          <dt>{t("inviteFunder.preview.subject")}</dt>
          <dd>{preview.subject}</dd>
        </dl>
        <section aria-label={t("inviteFunder.preview.body")} style={{ whiteSpace: "pre-wrap", border: "1px solid var(--og-gray-200)", borderRadius: "8px", padding: "16px", background: "var(--og-gray-50)", fontSize: "14px" }} tabIndex={0}>
          {preview.text}
        </section>
        <p className="small muted row" style={{ gap: "6px" }}>
          <Info className="ic ic-sm" aria-hidden="true" />
          {t("inviteFunder.preview.remaining", { count: preview.remainingThisWeek, perWeek: preview.perWeek })}
        </p>
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={send.state === "saving"}>
          {t("inviteFunder.preview.edit")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={send.state === "saving" || preview.alreadyInvited || preview.remainingThisWeek <= 0}
          onClick={async () => {
            const out = await send.run({ email: preview.to, ...(noteOf(preview) ? { note: noteOf(preview)! } : {}), token: preview.token, digest: preview.digest });
            if (out) onSent(out.invitation.to);
          }}
        >
          <Send className="ic" aria-hidden="true" />
          {send.state === "saving" ? t("inviteFunder.preview.sending") : t("inviteFunder.preview.send")}
        </button>
      </div>
    </Dialog>
  );
}

/** The note the preview was made from, kept beside it so the send repeats exactly the same input. */
const notes = new WeakMap<PeerInvitePreview, string>();
const noteOf = (p: PeerInvitePreview) => notes.get(p) ?? null;

export default function InviteFunder() {
  useFunderMessages();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const isAdmin = (ws.member.role ?? "admin") === "admin";
  const list = useLoopsQuery((api) => (isAdmin ? api.peerInvitations(ws.id) : Promise.resolve(null)), [ws.id, isAdmin]);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<PeerInvitePreview | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const make = useLoopsMutation((api, input: { email: string; note?: string }) => api.previewPeerInvite(ws.id, input));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSentTo(null);
    const n = note.trim();
    const p = await make.run({ email: email.trim(), ...(n ? { note: n } : {}) });
    if (p) {
      if (n) notes.set(p, n);
      setPreview(p);
    }
  }

  const data = list.status === "ready" ? list.data : null;
  return (
    <FunderShell active="Settings">
      <title>{t("inviteFunder.pageTitle", { name: ws.name })}</title>
      <main className="main">
        <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("inviteFunder.settings") }, { label: t("inviteFunder.title") }]} title={t("inviteFunder.settings")} />
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
          <SettingsNav base={base} active="invite-funders" />
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <section className="card" aria-labelledby="invite-intro">
              <div className="card-b row" style={{ gap: "12px", alignItems: "flex-start" }}>
                <UserPlus className="ic ic-md" aria-hidden="true" />
                <div>
                  <h2 id="invite-intro" style={{ fontSize: "16px" }}>
                    {t("inviteFunder.title")}
                  </h2>
                  <p className="small muted">{t("inviteFunder.intro")}</p>
                </div>
              </div>
            </section>
            {!isAdmin ? (
              <Notice tone="neu" title={t("inviteFunder.adminsOnly")} />
            ) : (
              <>
                {sentTo && (
                  <Notice tone="ok" title={t("inviteFunder.sent", { to: sentTo })}>
                    {t("inviteFunder.sentNote")}
                  </Notice>
                )}
                <section className="card" aria-labelledby="invite-form">
                  <div className="card-h">
                    <h2 id="invite-form" style={{ fontSize: "15px" }}>
                      {t("inviteFunder.form.title")}
                    </h2>
                    {data && <span className="small muted">{t("inviteFunder.remaining", { count: data.remainingThisWeek, perWeek: data.perWeek })}</span>}
                  </div>
                  <form onSubmit={submit} noValidate>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      {make.error !== null && !problemFor(make.error, "email") && !problemFor(make.error, "note") && <ErrorBanner error={make.error} title={t("inviteFunder.form.notPreviewed")} />}
                      <Field id="invite-email" label={t("inviteFunder.form.email")} required help={t("inviteFunder.form.emailHelp")} error={problemFor(make.error, "email")}>
                        <input id="invite-email" className="inp" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
                      </Field>
                      <Field id="invite-note" label={t("inviteFunder.form.note")} help={t("inviteFunder.form.noteHelp", { count: note.length, max: PEER_INVITE_NOTE_MAX })} error={problemFor(make.error, "note")}>
                        <textarea id="invite-note" className="ta" value={note} maxLength={PEER_INVITE_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
                      </Field>
                    </div>
                    <div className="card-f" style={{ justifyContent: "flex-end" }}>
                      <button type="submit" className="btn btn-primary" disabled={make.state === "saving" || !email.trim() || (data !== null && !data.canInvite)}>
                        <Mail className="ic" aria-hidden="true" />
                        {make.state === "saving" ? t("inviteFunder.form.previewing") : t("inviteFunder.form.preview")}
                      </button>
                    </div>
                  </form>
                  {data && !data.canInvite && data.reason && (
                    <div className="card-b">
                      <Notice tone="neu" title={t("inviteFunder.cannotInvite")}>
                        {data.reason}
                      </Notice>
                    </div>
                  )}
                </section>
                <section className="card" aria-labelledby="invite-list">
                  <div className="card-h">
                    <h2 id="invite-list" style={{ fontSize: "15px" }}>
                      {t("inviteFunder.list.title")}
                    </h2>
                    {data && <span className="small muted">{t("inviteFunder.list.joined", { count: data.joined })}</span>}
                  </div>
                  <div className="card-b">
                    {list.status === "loading" && <Loading />}
                    {list.status === "error" && <ErrorBanner error={list.error} onRetry={list.reload} />}
                    {data &&
                      (data.items.length === 0 ? (
                        <EmptyState icon={UserPlus} title={t("inviteFunder.list.empty")} />
                      ) : (
                        <DataTable
                          label={t("inviteFunder.list.title")}
                          rowKey={(r) => r.id}
                          rows={data.items}
                          empty={null}
                          columns={[
                            { key: "to", header: t("inviteFunder.list.to"), cell: (r) => r.to },
                            { key: "status", header: t("inviteFunder.list.status"), cell: (r) => <InvitationStatus status={r.status} /> },
                            { key: "sent", header: t("inviteFunder.list.sentOn"), cell: (r) => (r.sentAt ? formatDate(r.sentAt) : "—") },
                            { key: "joined", header: t("inviteFunder.list.joinedCount"), cell: (r) => t("inviteFunder.list.joinedValue", { count: r.joinedCount }) },
                          ]}
                        />
                      ))}
                  </div>
                </section>
                <p className="small muted row" style={{ gap: "6px" }}>
                  <Info className="ic ic-sm" aria-hidden="true" />
                  {t("inviteFunder.noReminders")}
                </p>
              </>
            )}
          </div>
        </div>
      </main>
      {preview && (
        <PreviewDialog
          preview={preview}
          workspaceId={ws.id}
          onClose={() => setPreview(null)}
          onSent={(to) => {
            setPreview(null);
            setSentTo(to);
            setEmail("");
            setNote("");
            list.reload();
          }}
        />
      )}
    </FunderShell>
  );
}
