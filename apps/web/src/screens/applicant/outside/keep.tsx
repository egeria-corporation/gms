// SPDX-License-Identifier: AGPL-3.0-only
// Small views the vault, the checklist and the award pages share: a document's expiry as icon and
// words, and the upload dialog that keeps bank and identity paperwork out of the vault.
import { DriveAttachButton } from "../../../components/DriveAttach.tsx";
import { useState } from "react";
import { Link } from "react-router";
import { CalendarCheck, CalendarClock, CalendarX, FolderLock, ShieldAlert, Upload, X } from "lucide-react";
import type { VaultDocument } from "../../../api/writeKeep.ts";
import { useWKMutation, useWKQuery } from "../../../api/writeKeepHooks.ts";
import { Dialog } from "../../../components/Dialog.tsx";
import { ErrorBanner, Field, problemFor } from "../../../components/ui.tsx";
import { formatDate } from "../../../lib/format.ts";
import { blockedFilename, DOC_TYPES, expiryState, VAULT_MAX_BYTES, type DocType } from "../../../lib/writeKeep.ts";
import { docTypeLabel, vaultWarning } from "../labels.ts";
import { toBase64 } from "./shared.tsx";
import { t } from "../i18n.ts";

/** "Expires in 21 days", "Expired Nov 5, 2026", "Current until …", "No expiry": always an icon and words. */
export function ExpiryBadge({ expiresOn, now = new Date() }: { expiresOn: string | null | undefined; now?: Date }) {
  const { state, days } = expiryState(expiresOn, now);
  if (state === "none") return <span className="small muted">{t("outsideKeep.noExpiryDate")}</span>;
  if (state === "expired")
    return (
      <span className="bdg bdg-dng">
        <CalendarX className="ic" aria-hidden="true" />
        {t("outsideKeep.expiredOn", { date: formatDate(expiresOn) })}
      </span>
    );
  if (state === "soon")
    return (
      <span className="bdg bdg-warn">
        <CalendarClock className="ic" aria-hidden="true" />
        {days === 0 ? t("outsideKeep.expiresToday") : t("outsideKeep.expiresIn", { count: days ?? 0 })}
      </span>
    );
  return (
    <span className="bdg bdg-ok">
      <CalendarCheck className="ic" aria-hidden="true" />
      {t("outsideKeep.currentUntil", { date: formatDate(expiresOn) })}
    </span>
  );
}

/** Upload one document to the vault, with its type and expiry. Bank-like file names are refused here and by the server. */
export function VaultUploadDialog({ onClose, onDone }: { onClose: () => void; onDone: (d: VaultDocument) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocType | "">("");
  const [expires, setExpires] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useWKMutation(async (api) => api.uploadVault({ name: file!.name, mime: file!.type || "application/octet-stream", contentBase64: await toBase64(file!), docType: docType as DocType, ...(expires ? { expiresOn: expires } : {}) }));
  // The same checks for a file from the computer and one copied from Google Drive.
  const choose = (f: File | null) => {
    setProblem(null);
    setFile(null);
    if (!f) return;
    if (blockedFilename(f.name)) return setProblem(t("outsideKeep.blocked", { name: f.name, warning: vaultWarning() }));
    if (f.size > VAULT_MAX_BYTES) return setProblem(t("outsideKeep.tooLarge", { name: f.name }));
    setFile(f);
  };
  return (
    <Dialog open onClose={onClose} labelledBy="vup-title">
      <div className="hd">
        <div>
          <h3 id="vup-title" style={{ fontSize: "16px" }}>
            {t("outsideKeep.addADocumentToTheVault")}
          </h3>
          <p className="small muted">{t("outsideKeep.keepTheDocumentsFundersAskFor")}</p>
        </div>
        <button className="iconbtn" type="button" aria-label={t("outsideKeep.close")} onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <div className="bnr bnr-warn" role="note">
          <ShieldAlert className="ic" aria-hidden="true" />
          <div>
            <div className="t">{t("outsideKeep.neverUploadBankOrIdentityPaperwork")}</div>
            <div className="d">{vaultWarning()}</div>
          </div>
        </div>
        <div className="fld">
          <span className="lbl">{t("outsideKeep.file")}</span>
          <label className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
            <Upload className="ic" aria-hidden="true" />
            {file ? t("outsideKeep.chooseAnotherFile") : t("outsideKeep.chooseAFile")}
            <input
              type="file"
              className="sr"
              aria-label={t("outsideKeep.chooseAFile")}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                choose(f);
              }}
            />
          </label>
          <DriveAttachButton onFile={choose} />
          {file && <span className="small b">{file.name}</span>}
          {problem && (
            <span className="err-msg" role="alert">
              {problem}
            </span>
          )}
        </div>
        <Field id="vup-type" label={t("outsideKeep.whatItIs")} required error={problemFor(upload.error, "docType")}>
          <select id="vup-type" className="sel" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            <option value="" disabled>
              {t("outsideKeep.chooseOne")}
            </option>
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>
                {docTypeLabel(d)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="vup-exp" label={t("outsideKeep.expiresOn")} help={t("outsideKeep.ifItHasOneSuchAs")}>
          <input id="vup-exp" type="date" className="inp" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        {upload.error ? <ErrorBanner error={upload.error} title={t("outsideKeep.theDocumentWasNotAdded")} /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("outsideKeep.cancel")}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!file || !docType || upload.state === "saving"}
          onClick={async () => {
            const d = await upload.run();
            if (d) onDone(d);
          }}
        >
          {upload.state === "saving" ? t("outsideKeep.adding") : t("outsideKeep.addToTheVault")}
        </button>
      </div>
    </Dialog>
  );
}

/** On the Organization page: the vault in one line, and the way in. */
export function VaultCard({ base }: { base: string }) {
  const vault = useWKQuery((api) => api.vault(), []);
  const docs = vault.status === "ready" ? vault.data : [];
  const soon = docs.filter((d) => expiryState(d.expiresOn).state !== "current" && expiryState(d.expiresOn).state !== "none").length;
  return (
    <section className="card" aria-labelledby="vault-h">
      <div className="card-h">
        <div>
          <h2 id="vault-h" style={{ fontSize: "18px" }}>
            {t("outsideKeep.documentVault")}
          </h2>
          <p className="small muted">{t("outsideKeep.theDocumentsFundersAskForReady")}</p>
        </div>
        <FolderLock className="ic ic-md" aria-hidden="true" />
      </div>
      <div className="card-b row" style={{ gap: "10px", flexWrap: "wrap" }}>
        <span>{vault.status === "ready" ? t("outsideKeep.documentCount", { count: docs.length }) : "…"}</span>
        {soon > 0 && (
          <span className="bdg bdg-warn">
            <CalendarClock className="ic" aria-hidden="true" />
            {t("outsideKeep.expiringSoon", { count: soon })}
          </span>
        )}
        <Link to={`${base}/organization/documents`} className="btn btn-sm btn-secondary" style={{ marginLeft: "auto" }}>
          {t("outsideKeep.openDocuments")}
        </Link>
      </div>
    </section>
  );
}
