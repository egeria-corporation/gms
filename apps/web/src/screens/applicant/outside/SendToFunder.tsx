// SPDX-License-Identifier: AGPL-3.0-only
// "Send to the funder" on an outside application (C4): the package for a funder who is not on the
// GMS. The dialog says what the package holds, downloads it as a PDF or a ZIP, and emails it to an
// address the person types, under their name, after a preview of exactly what goes out. An answer
// that looks like a bank, card or identity number stops it, naming the question.
import { useState } from "react";
import { CircleCheck, Download, FileArchive, FileText, Mail, Package, Send, TriangleExclamationPoint, X } from "lucide-react";
import type { PackageEmailPreview, SendPackage } from "../../../api/sendPackage.ts";
import { useSendPackageMutation, useSendPackageQuery } from "../../../api/sendPackageHooks.ts";
import { Dialog } from "../../../components/Dialog.tsx";
import { ErrorBanner, Field, Loading, Notice, problemFor } from "../../../components/ui.tsx";
import { downloadBlob } from "../../../lib/browser.ts";

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`);

/** The button for the application's header, with its dialog. One line to mount. */
export function SendToFunderButton({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Package className="ic" aria-hidden="true" />
        Send to the funder
      </button>
      {open && <SendToFunderDialog applicationId={applicationId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function SendToFunderDialog({ applicationId, onClose }: { applicationId: string; onClose: () => void }) {
  const query = useSendPackageQuery((api) => api.get(applicationId), [applicationId]);
  return (
    <Dialog open onClose={onClose} labelledBy="stf-title" size="lg">
      <div className="hd">
        <div>
          <h3 id="stf-title" style={{ fontSize: "16px" }}>
            Send to the funder
          </h3>
          <p className="small muted">A clean package for a funder who is not on the GMS: your answers as a PDF, with the files you attached to this application.</p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      {query.status === "loading" && (
        <div className="bd">
          <Loading label="Putting the package together" />
        </div>
      )}
      {query.status === "error" && (
        <div className="bd">
          <ErrorBanner error={query.error} onRetry={query.reload} title="The package could not be read" />
        </div>
      )}
      {query.status === "ready" && <PackageBody pkg={query.data} applicationId={applicationId} onChanged={query.reload} onClose={onClose} />}
    </Dialog>
  );
}

function PackageBody({ pkg, applicationId, onChanged, onClose }: { pkg: SendPackage; applicationId: string; onChanged: () => void; onClose: () => void }) {
  const blocked = pkg.blocked.length > 0;
  const unanswered = pkg.questions.filter((q) => !q.answered).length;
  const download = useSendPackageMutation(async (api, kind: "pdf" | "zip") => {
    const f = await api.download(applicationId, kind);
    downloadBlob(f.blob, f.filename);
    return f.filename;
  });
  const footer = useSendPackageMutation((api, on: boolean) => api.setFooter(on));
  return (
    <>
      <div className="bd" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {blocked && (
          <div className="bnr bnr-warn" role="alert">
            <TriangleExclamationPoint className="ic" aria-hidden="true" />
            <div>
              <div className="b">This package cannot be made yet</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                {pkg.blocked.map((b) => (
                  <li key={b.questionId}>{b.message}</li>
                ))}
              </ul>
              <p className="small" style={{ marginTop: "4px" }}>
                Bank, card and identity numbers never leave the GMS. Passport keeps payment details.
              </p>
            </div>
          </div>
        )}
        <section aria-labelledby="stf-contents">
          <h4 id="stf-contents" style={{ fontSize: "14px", marginBottom: "6px" }}>
            What the package holds
          </h4>
          <ul aria-label="Files in the package" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
            <li className="row" style={{ gap: "8px" }}>
              <FileText className="ic ic-sm" aria-hidden="true" />
              <span>
                <span className="b">{pkg.files.pdf}</span>
                <span className="muted"> — cover, {pkg.questions.length} question{pkg.questions.length === 1 ? "" : "s"} and answers{pkg.budget ? ", budget summary" : ""}, list of files</span>
              </span>
            </li>
            {pkg.attachments.map((f) => (
              <li key={f.documentId} className="row" style={{ gap: "8px" }}>
                <FileArchive className="ic ic-sm" aria-hidden="true" />
                <span>
                  {f.name}
                  <span className="muted">
                    {" "}
                    — {f.source === "vault" ? `from your vault, for “${f.requiredFor}”` : "attached to this application"}, {sizeText(f.size)}
                  </span>
                </span>
              </li>
            ))}
            <li className="row" style={{ gap: "8px" }}>
              <FileText className="ic ic-sm" aria-hidden="true" />
              <span>
                answers.txt<span className="muted"> — the answers as plain text, to paste into a portal (ZIP only)</span>
              </span>
            </li>
          </ul>
          {unanswered > 0 && (
            <p className="small muted" style={{ marginTop: "6px" }}>
              {unanswered} question{unanswered === 1 ? " has" : "s have"} no answer yet and will show “No answer given.”
            </p>
          )}
          <p className="small muted" style={{ marginTop: "6px" }}>
            Only files attached to this application and vault documents you used for its checklist are included. Your team’s internal deadline is left out.
          </p>
          {pkg.notIncluded.map((n) => (
            <p key={n.documentId} className="small" style={{ marginTop: "6px" }}>
              <span className="b">{n.name}</span> is not included. {n.message}
            </p>
          ))}
        </section>

        <section aria-labelledby="stf-footer">
          <h4 id="stf-footer" style={{ fontSize: "14px", marginBottom: "6px" }}>
            Footer line
          </h4>
          <p className="small">{pkg.footer.shown ? `Every page ends with “${pkg.footer.text}”.` : "Packages from this workspace carry no footer line."}</p>
          {pkg.footer.canChange && (
            <label className="row small" style={{ gap: "8px", marginTop: "6px" }}>
              <input
                type="checkbox"
                checked={pkg.footer.shown}
                disabled={footer.state === "saving"}
                onChange={async (e) => {
                  if (await footer.run(e.target.checked)) onChanged();
                }}
              />
              Show this line on packages from this workspace
            </label>
          )}
          {footer.error ? <ErrorBanner error={footer.error} title="The setting was not saved" /> : null}
        </section>

        <section aria-labelledby="stf-download">
          <h4 id="stf-download" style={{ fontSize: "14px", marginBottom: "6px" }}>
            Download
          </h4>
          <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" disabled={blocked || download.state === "saving"} onClick={() => download.run("pdf")}>
              <Download className="ic" aria-hidden="true" />
              Download PDF
            </button>
            <button type="button" className="btn btn-secondary" disabled={blocked || download.state === "saving"} onClick={() => download.run("zip")}>
              <FileArchive className="ic" aria-hidden="true" />
              Download ZIP ({sizeText(pkg.totalBytes)} of files)
            </button>
          </div>
          {download.error ? <ErrorBanner error={download.error} title="The package could not be downloaded" /> : null}
        </section>

        <EmailSection pkg={pkg} applicationId={applicationId} blocked={blocked} onSent={onChanged} />
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}

function EmailSection({ pkg, applicationId, blocked, onSent }: { pkg: SendPackage; applicationId: string; blocked: boolean; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<PackageEmailPreview | null>(null);
  const [sent, setSent] = useState<{ to: string; replyTo: string; remainingToday: number } | null>(null);
  const input = () => ({ to: to.trim(), ...(message.trim() ? { message: message.trim() } : {}) });
  const look = useSendPackageMutation((api) => api.previewEmail(applicationId, input()));
  const send = useSendPackageMutation((api, digest: string) => api.sendEmail(applicationId, { ...input(), digest }));
  const edit = (f: () => void) => {
    f();
    setPreview(null);
    look.reset();
    send.reset();
  };
  const unavailable = !pkg.email.available && !sent;
  return (
    <section aria-labelledby="stf-email">
      <h4 id="stf-email" style={{ fontSize: "14px", marginBottom: "6px" }}>
        Email it to the funder
      </h4>
      {sent ? (
        <Notice tone="ok" title={`Sent to ${sent.to}`}>
          Replies go to you at {sent.replyTo}. {sent.remainingToday} more {sent.remainingToday === 1 ? "email" : "emails"} of this package can go today.
        </Notice>
      ) : unavailable ? (
        <Notice tone="neu" title="It cannot be emailed from here now">
          {pkg.email.reason}
        </Notice>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <p className="small muted">It goes out under your name, and replies come to you. You see exactly what is sent first. Up to {pkg.email.perDay} a day for this application; {pkg.email.remainingToday} left today.</p>
          <Field id="stf-to" label="Funder contact’s email" required error={problemFor(look.error ?? send.error, "to")}>
            <input id="stf-to" type="email" className="inp" autoComplete="off" value={to} disabled={blocked} onChange={(e) => edit(() => setTo(e.target.value))} />
          </Field>
          <Field id="stf-msg" label="Message" help="A few words above the package, for example who you spoke with.">
            <textarea id="stf-msg" className="ta" style={{ minHeight: "64px" }} value={message} maxLength={2000} disabled={blocked} onChange={(e) => edit(() => setMessage(e.target.value))} />
          </Field>
          {preview && <EmailPreview p={preview} />}
          {look.error ? <ErrorBanner error={look.error} title="The preview could not be made" /> : null}
          {send.error ? <ErrorBanner error={send.error} title="The email was not sent" /> : null}
          <div className="row" style={{ gap: "8px" }}>
            {preview ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={send.state === "saving"}
                onClick={async () => {
                  const r = await send.run(preview.digest);
                  if (r) {
                    setSent({ to: r.to, replyTo: r.replyTo, remainingToday: r.remainingToday });
                    onSent();
                  }
                }}
              >
                <Send className="ic" aria-hidden="true" />
                {send.state === "saving" ? "Sending…" : "Send the email"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={blocked || !to.trim() || look.state === "saving"}
                onClick={async () => {
                  const p = await look.run();
                  if (p) setPreview(p);
                }}
              >
                <Mail className="ic" aria-hidden="true" />
                {look.state === "saving" ? "Preparing…" : "Preview the email"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function EmailPreview({ p }: { p: PackageEmailPreview }) {
  return (
    <section aria-label="The email that will be sent" style={{ border: "1px solid var(--og-gray-200)", borderRadius: "8px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px", background: "var(--og-gray-50)" }}>
      <dl className="kv" style={{ fontSize: "14px", overflowWrap: "anywhere" }}>
        <dt>From</dt>
        <dd>{p.from}</dd>
        <dt>To</dt>
        <dd>{p.to}</dd>
        <dt>Replies go to</dt>
        <dd>{p.replyTo}</dd>
        <dt>Subject</dt>
        <dd>{p.subject}</dd>
        <dt>Attached</dt>
        <dd>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {p.attachments.map((a) => (
              <li key={a.filename}>{a.filename}</li>
            ))}
          </ul>
        </dd>
      </dl>
      <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>
        {p.text}
      </pre>
      <p className="small muted row" style={{ gap: "6px" }}>
        <CircleCheck className="ic ic-sm" aria-hidden="true" />
        This is exactly what will be sent.
      </p>
    </section>
  );
}
