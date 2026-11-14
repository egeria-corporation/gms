// SPDX-License-Identifier: AGPL-3.0-only
// Small views the vault, the checklist and the award pages share: a document's expiry as icon and
// words, and the upload dialog that keeps bank and identity paperwork out of the vault.
import { useState } from "react";
import { Link } from "react-router";
import { CalendarCheck, CalendarClock, CalendarX, FolderLock, ShieldAlert, Upload, X } from "lucide-react";
import type { VaultDocument } from "../../../api/writeKeep.ts";
import { useWKMutation, useWKQuery } from "../../../api/writeKeepHooks.ts";
import { Dialog } from "../../../components/Dialog.tsx";
import { ErrorBanner, Field, problemFor } from "../../../components/ui.tsx";
import { formatDate } from "../../../lib/format.ts";
import { blockedFilename, DOC_TYPE_LABELS, DOC_TYPES, expiryState, VAULT_WARNING, type DocType } from "../../../lib/writeKeep.ts";
import { MAX_UPLOAD_BYTES, toBase64 } from "./shared.tsx";

/** "Expires in 21 days", "Expired Nov 5, 2026", "Current until …", "No expiry": always an icon and words. */
export function ExpiryBadge({ expiresOn, now = new Date() }: { expiresOn: string | null | undefined; now?: Date }) {
  const { state, days } = expiryState(expiresOn, now);
  if (state === "none") return <span className="small muted">No expiry date</span>;
  if (state === "expired")
    return (
      <span className="bdg bdg-dng">
        <CalendarX className="ic" aria-hidden="true" />
        Expired {formatDate(expiresOn)}
      </span>
    );
  if (state === "soon")
    return (
      <span className="bdg bdg-warn">
        <CalendarClock className="ic" aria-hidden="true" />
        {days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}`}
      </span>
    );
  return (
    <span className="bdg bdg-ok">
      <CalendarCheck className="ic" aria-hidden="true" />
      Current until {formatDate(expiresOn)}
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
  return (
    <Dialog open onClose={onClose} labelledBy="vup-title">
      <div className="hd">
        <div>
          <h3 id="vup-title" style={{ fontSize: "16px" }}>
            Add a document to the vault
          </h3>
          <p className="small muted">Keep the documents funders ask for again and again in one place.</p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <div className="bnr bnr-warn" role="note">
          <ShieldAlert className="ic" aria-hidden="true" />
          <div>
            <div className="t">Never upload bank or identity paperwork</div>
            <div className="d">{VAULT_WARNING}</div>
          </div>
        </div>
        <div className="fld">
          <span className="lbl">File</span>
          <label className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
            <Upload className="ic" aria-hidden="true" />
            {file ? "Choose another file" : "Choose a file"}
            <input
              type="file"
              className="sr"
              aria-label="Choose a file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                setProblem(null);
                setFile(null);
                if (!f) return;
                if (blockedFilename(f.name)) return setProblem(`${f.name} looks like bank or tax paperwork, so it was not added. ${VAULT_WARNING}`);
                if (f.size > MAX_UPLOAD_BYTES) return setProblem(`${f.name} is larger than 10 MB. Upload a smaller file.`);
                setFile(f);
              }}
            />
          </label>
          {file && <span className="small b">{file.name}</span>}
          {problem && (
            <span className="err-msg" role="alert">
              {problem}
            </span>
          )}
        </div>
        <Field id="vup-type" label="What it is" required error={problemFor(upload.error, "docType")}>
          <select id="vup-type" className="sel" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            <option value="" disabled>
              Choose one
            </option>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="vup-exp" label="Expires on" help="If it has one, such as an audit or an insurance certificate. You are warned 30 days before.">
          <input id="vup-exp" type="date" className="inp" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        {upload.error ? <ErrorBanner error={upload.error} title="The document was not added" /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
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
          {upload.state === "saving" ? "Adding…" : "Add to the vault"}
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
            Document vault
          </h2>
          <p className="small muted">The documents funders ask for, ready for any application’s checklist.</p>
        </div>
        <FolderLock className="ic ic-md" aria-hidden="true" />
      </div>
      <div className="card-b row" style={{ gap: "10px", flexWrap: "wrap" }}>
        <span>{vault.status === "ready" ? `${docs.length} document${docs.length === 1 ? "" : "s"}` : "…"}</span>
        {soon > 0 && (
          <span className="bdg bdg-warn">
            <CalendarClock className="ic" aria-hidden="true" />
            {soon} expired or expiring soon
          </span>
        )}
        <Link to={`${base}/organization/documents`} className="btn btn-sm btn-secondary" style={{ marginLeft: "auto" }}>
          Open documents
        </Link>
      </div>
    </section>
  );
}
