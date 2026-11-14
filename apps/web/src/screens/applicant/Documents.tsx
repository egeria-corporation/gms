// SPDX-License-Identifier: AGPL-3.0-only
// Organization → Documents: the document vault. The files funders ask for again and again (IRS
// letter, audit, financials, board list, budget, annual report, logo), each with its type and expiry,
// so a checklist can use one in a click. Bank letters, voided checks, ACH forms and anything with a
// person's identity numbers are refused. The vault is never read by AI.
import { useState } from "react";
import { Link } from "react-router";
import { FileText, FolderLock, Lock, Pencil, Plus, Trash, X } from "lucide-react";
import type { VaultDocument } from "../../api/writeKeep.ts";
import { useWKMutation, useWKQuery } from "../../api/writeKeepHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Loaded } from "../../components/applicant.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { DataTable, EmptyState, ErrorBanner, Field, Notice, type Column } from "../../components/ui.tsx";
import { openBlob } from "../../lib/browser.ts";
import { formatDate } from "../../lib/format.ts";
import { DOC_TYPE_LABELS, DOC_TYPES, EXPIRY_WARN_DAYS, expiryState, type DocType } from "../../lib/writeKeep.ts";
import { ExpiryBadge, VaultUploadDialog } from "./outside/keep.tsx";
import { sizeText } from "./outside/shared.tsx";

function EditDialog({ doc, onClose, onDone }: { doc: VaultDocument; onClose: () => void; onDone: () => void }) {
  const [docType, setDocType] = useState<DocType>(doc.docType);
  const [expires, setExpires] = useState(doc.expiresOn ?? "");
  const save = useWKMutation((api) => api.updateVault(doc.id, { docType, expiresOn: expires || null }));
  return (
    <Dialog open onClose={onClose} labelledBy="vedit-title">
      <div className="hd">
        <div>
          <h3 id="vedit-title" style={{ fontSize: "16px" }}>
            {doc.name}
          </h3>
          <p className="small muted">Change what it is or when it expires.</p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <Field id="vedit-type" label="What it is">
          <select id="vedit-type" className="sel" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="vedit-exp" label="Expires on">
          <input id="vedit-exp" type="date" className="inp" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        {save.error ? <ErrorBanner error={save.error} title="The change was not saved" /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" type="button" disabled={save.state === "saving"} onClick={async () => (await save.run()) && onDone()}>
          Save
        </button>
      </div>
    </Dialog>
  );
}

export default function Documents() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useWKQuery((api) => api.vault(), [ws.id]);
  const [dialog, setDialog] = useState<null | "upload" | VaultDocument>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const open = useWKMutation(async (api, d: VaultDocument) => {
    const f = await api.vaultFile(d.id);
    openBlob(f.blob, f.filename);
    return true;
  });
  const remove = useWKMutation(async (api, id: string) => {
    await api.deleteVault(id);
    return true;
  });

  const columns: Column<VaultDocument>[] = [
    {
      key: "name",
      header: "Document",
      sort: (d) => d.name.toLowerCase(),
      cell: (d) => (
        <div className="row" style={{ gap: "10px" }}>
          <FileText className="ic" aria-hidden="true" style={{ flex: "none" }} />
          <div className="ent">
            <button type="button" className="nm" style={{ background: "none", border: 0, padding: 0, font: "inherit", fontWeight: 700, color: "var(--og-teal-dark)", cursor: "pointer", textAlign: "left" }} onClick={() => void open.run(d)} aria-label={`Open ${d.name}`}>
              {d.name}
            </button>
            <span className="small muted">
              {sizeText(d.size)} · added {formatDate(d.uploadedAt)}
            </span>
          </div>
        </div>
      ),
    },
    { key: "type", header: "Type", sort: (d) => DOC_TYPE_LABELS[d.docType], cell: (d) => DOC_TYPE_LABELS[d.docType] },
    { key: "expires", header: "Expiry", sort: (d) => d.expiresOn ?? "9999", cell: (d) => <ExpiryBadge expiresOn={d.expiresOn} /> },
    {
      key: "actions",
      header: "Actions",
      cell: (d) =>
        confirm === d.id ? (
          <span className="row" style={{ gap: "6px" }}>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={async () => {
                if (await remove.run(d.id)) {
                  setConfirm(null);
                  setNote(`${d.name} was removed from the vault`);
                  query.reload();
                }
              }}
            >
              Remove {d.name}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>
              Keep it
            </button>
          </span>
        ) : (
          <span className="row" style={{ gap: "4px" }}>
            <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="dialog" aria-label={`Edit ${d.name}`} onClick={() => setDialog(d)}>
              <Pencil className="ic" aria-hidden="true" />
              Edit
            </button>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={`Remove ${d.name}`} onClick={() => setConfirm(d.id)}>
              <Trash className="ic" aria-hidden="true" />
              Remove
            </button>
          </span>
        ),
    },
  ];

  return (
    <>
      <title>{`Documents — ${ws.name}`}</title>
      <ApplicantShell active="Organization">
        <main className="main">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to={`${base}/organization`}>Organization</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">Documents</span>
          </nav>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Documents</h1>
              </div>
              <div className="meta">
                <span>The documents funders ask for, kept once and used on any application’s checklist. Only your team sees them.</span>
              </div>
            </div>
            <div className="actions">
              <button type="button" className="btn btn-primary" aria-haspopup="dialog" onClick={() => setDialog("upload")}>
                <Plus className="ic" aria-hidden="true" />
                Add a document
              </button>
            </div>
          </div>
          {note && <Notice tone="ok" title={note} />}
          {open.error ? <ErrorBanner error={open.error} title="The file could not be opened" /> : null}
          {remove.error ? <ErrorBanner error={remove.error} title="The document was not removed" /> : null}
          <Loaded query={query} label="Loading your documents">
            {(docs) => {
              const soon = docs.filter((d) => expiryState(d.expiresOn).state === "soon").length;
              const expired = docs.filter((d) => expiryState(d.expiresOn).state === "expired").length;
              return (
                <>
                  {(soon > 0 || expired > 0) && (
                    <Notice tone="warn" title={[expired ? `${expired} expired` : null, soon ? `${soon} expiring within ${EXPIRY_WARN_DAYS} days` : null].filter(Boolean).join(" · ")}>
                      Upload a current copy before you use it on an application. The workspace is emailed {EXPIRY_WARN_DAYS} days before a document expires.
                    </Notice>
                  )}
                  <DataTable
                    label="Documents"
                    columns={columns}
                    rows={docs}
                    rowKey={(d) => d.id}
                    empty={
                      <EmptyState icon={FolderLock} title="No documents yet" actions={<button type="button" className="btn btn-primary" onClick={() => setDialog("upload")}>Add a document</button>}>
                        Your IRS determination letter, latest audit, board list and budget: add each once and use it on every checklist.
                      </EmptyState>
                    }
                  />
                </>
              );
            }}
          </Loaded>
          <p className="small muted row" style={{ gap: "6px", alignItems: "flex-start" }}>
            <Lock className="ic ic-sm" aria-hidden="true" style={{ marginTop: "2px" }} />
            <span>The assistant never reads these documents. It reads only a funder’s guidelines that you paste or upload on an application.</span>
          </p>
        </main>
      </ApplicantShell>
      {dialog === "upload" && (
        <VaultUploadDialog
          onClose={() => setDialog(null)}
          onDone={(d) => {
            setDialog(null);
            setNote(`${d.name} was added to the vault`);
            query.reload();
          }}
        />
      )}
      {dialog && dialog !== "upload" && (
        <EditDialog
          doc={dialog}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setNote("Saved");
            query.reload();
          }}
        />
      )}
    </>
  );
}
