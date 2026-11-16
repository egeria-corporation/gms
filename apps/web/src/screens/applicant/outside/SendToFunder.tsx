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
import { t } from "../i18n.ts";

/** The package's plain-text file, by its name. */
const ANSWERS_FILE = "answers.txt";
const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`);

/** The button for the application's header, with its dialog. One line to mount. */
export function SendToFunderButton({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Package className="ic" aria-hidden="true" />
        {t("outsideSendToFunder.sendToTheFunder")}
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
            {t("outsideSendToFunder.sendToTheFunder")}
          </h3>
          <p className="small muted">{t("outsideSendToFunder.aCleanPackageForAFunder")}</p>
        </div>
        <button className="iconbtn" type="button" aria-label={t("outsideSendToFunder.close")} onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      {query.status === "loading" && (
        <div className="bd">
          <Loading label={t("outsideSendToFunder.puttingThePackageTogether")} />
        </div>
      )}
      {query.status === "error" && (
        <div className="bd">
          <ErrorBanner error={query.error} onRetry={query.reload} title={t("outsideSendToFunder.thePackageCouldNotBeRead")} />
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
              <div className="b">{t("outsideSendToFunder.thisPackageCannotBeMadeYet")}</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                {pkg.blocked.map((b) => (
                  <li key={b.questionId}>{b.message}</li>
                ))}
              </ul>
              <p className="small" style={{ marginTop: "4px" }}>
                {t("outsideSendToFunder.bankCardAndIdentityNumbersNever")}
              </p>
            </div>
          </div>
        )}
        <section aria-labelledby="stf-contents">
          <h4 id="stf-contents" style={{ fontSize: "14px", marginBottom: "6px" }}>
            {t("outsideSendToFunder.whatThePackageHolds")}
          </h4>
          <ul aria-label={t("outsideSendToFunder.filesInThePackage")} style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
            <li className="row" style={{ gap: "8px" }}>
              <FileText className="ic ic-sm" aria-hidden="true" />
              <span>
                <span className="b">{pkg.files.pdf}</span>
                <span className="muted"> — {pkg.budget ? t("outsideSendToFunder.pdfHoldsBudget", { count: pkg.questions.length }) : t("outsideSendToFunder.pdfHolds", { count: pkg.questions.length })}</span>
              </span>
            </li>
            {pkg.attachments.map((f) => (
              <li key={f.documentId} className="row" style={{ gap: "8px" }}>
                <FileArchive className="ic ic-sm" aria-hidden="true" />
                <span>
                  {f.name}
                  <span className="muted">
                    {" "}
                    — {f.source === "vault" ? t("outsideSendToFunder.fromVault", { doc: f.requiredFor }) : t("outsideSendToFunder.attachedToThisApplication")}, {sizeText(f.size)}
                  </span>
                </span>
              </li>
            ))}
            <li className="row" style={{ gap: "8px" }}>
              <FileText className="ic ic-sm" aria-hidden="true" />
              <span>
                {ANSWERS_FILE}
                <span className="muted"> {t("outsideSendToFunder.theAnswersAsPlainTextTo")}</span>
              </span>
            </li>
          </ul>
          {unanswered > 0 && (
            <p className="small muted" style={{ marginTop: "6px" }}>
              {t("outsideSendToFunder.unanswered", { count: unanswered })}
            </p>
          )}
          <p className="small muted" style={{ marginTop: "6px" }}>
            {t("outsideSendToFunder.onlyFilesAttachedToThisApplication")}
          </p>
          {pkg.notIncluded.map((n) => (
            <p key={n.documentId} className="small" style={{ marginTop: "6px" }}>
              {t.rich("outsideSendToFunder.notIncluded", { name: n.name, b: (chunks) => <span className="b">{chunks}</span> })} {n.message}
            </p>
          ))}
        </section>

        <section aria-labelledby="stf-footer">
          <h4 id="stf-footer" style={{ fontSize: "14px", marginBottom: "6px" }}>
            {t("outsideSendToFunder.footerLine")}
          </h4>
          <p className="small">{pkg.footer.shown ? t("outsideSendToFunder.footerShown", { text: pkg.footer.text }) : t("outsideSendToFunder.packagesFromThisWorkspaceCarryNo")}</p>
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
              {t("outsideSendToFunder.showThisLineOnPackagesFrom")}
            </label>
          )}
          {footer.error ? <ErrorBanner error={footer.error} title={t("outsideSendToFunder.theSettingWasNotSaved")} /> : null}
        </section>

        <section aria-labelledby="stf-download">
          <h4 id="stf-download" style={{ fontSize: "14px", marginBottom: "6px" }}>
            {t("outsideSendToFunder.download")}
          </h4>
          <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" disabled={blocked || download.state === "saving"} onClick={() => download.run("pdf")}>
              <Download className="ic" aria-hidden="true" />
              {t("outsideSendToFunder.downloadPdf")}
            </button>
            <button type="button" className="btn btn-secondary" disabled={blocked || download.state === "saving"} onClick={() => download.run("zip")}>
              <FileArchive className="ic" aria-hidden="true" />
              {t("outsideSendToFunder.downloadZip", { size: sizeText(pkg.totalBytes) })}
            </button>
          </div>
          {download.error ? <ErrorBanner error={download.error} title={t("outsideSendToFunder.thePackageCouldNotBeDownloaded")} /> : null}
        </section>

        <EmailSection pkg={pkg} applicationId={applicationId} blocked={blocked} onSent={onChanged} />
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("outsideSendToFunder.close")}
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
        {t("outsideSendToFunder.emailItToTheFunder")}
      </h4>
      {sent ? (
        <Notice tone="ok" title={t("outsideSendToFunder.sentTo", { email: sent.to })}>
          {t("outsideSendToFunder.sentBody", { replyTo: sent.replyTo, count: sent.remainingToday })}
        </Notice>
      ) : unavailable ? (
        <Notice tone="neu" title={t("outsideSendToFunder.itCannotBeEmailedFromHere")}>
          {pkg.email.reason}
        </Notice>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <p className="small muted">{t("outsideSendToFunder.emailIntro", { perDay: pkg.email.perDay, remaining: pkg.email.remainingToday })}</p>
          <Field id="stf-to" label={t("outsideSendToFunder.funderContactsEmail")} required error={problemFor(look.error ?? send.error, "to")}>
            <input id="stf-to" type="email" className="inp" autoComplete="off" value={to} disabled={blocked} onChange={(e) => edit(() => setTo(e.target.value))} />
          </Field>
          <Field id="stf-msg" label={t("outsideSendToFunder.message")} help={t("outsideSendToFunder.aFewWordsAboveThePackage")}>
            <textarea id="stf-msg" className="ta" style={{ minHeight: "64px" }} value={message} maxLength={2000} disabled={blocked} onChange={(e) => edit(() => setMessage(e.target.value))} />
          </Field>
          {preview && <EmailPreview p={preview} />}
          {look.error ? <ErrorBanner error={look.error} title={t("outsideSendToFunder.thePreviewCouldNotBeMade")} /> : null}
          {send.error ? <ErrorBanner error={send.error} title={t("outsideSendToFunder.theEmailWasNotSent")} /> : null}
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
                {send.state === "saving" ? t("outsideSendToFunder.sending") : t("outsideSendToFunder.sendTheEmail")}
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
                {look.state === "saving" ? t("outsideSendToFunder.preparing") : t("outsideSendToFunder.previewTheEmail")}
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
    <section aria-label={t("outsideSendToFunder.theEmailThatWillBeSent")} style={{ border: "1px solid var(--og-gray-200)", borderRadius: "8px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px", background: "var(--og-gray-50)" }}>
      <dl className="kv" style={{ fontSize: "14px", overflowWrap: "anywhere" }}>
        <dt>{t("outsideSendToFunder.from")}</dt>
        <dd>{p.from}</dd>
        <dt>{t("outsideSendToFunder.to")}</dt>
        <dd>{p.to}</dd>
        <dt>{t("outsideSendToFunder.repliesGoTo")}</dt>
        <dd>{p.replyTo}</dd>
        <dt>{t("outsideSendToFunder.subject")}</dt>
        <dd>{p.subject}</dd>
        <dt>{t("outsideSendToFunder.attached")}</dt>
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
        {t("outsideSendToFunder.thisIsExactlyWhatWillBe")}
      </p>
    </section>
  );
}
