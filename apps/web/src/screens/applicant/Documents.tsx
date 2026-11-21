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
import { applicantAccess } from "../../lib/roles.ts";
import { DOC_TYPES, EXPIRY_WARN_DAYS, expiryState, type DocType } from "../../lib/writeKeep.ts";
import { docTypeLabel } from "./labels.ts";
import { ExpiryBadge, VaultUploadDialog } from "./outside/keep.tsx";
import { sizeText } from "./outside/shared.tsx";
import { t, useApplicantText } from "./i18n.ts";

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
          <p className="small muted">{t("documents.changeWhatItIsOrWhen")}</p>
        </div>
        <button className="iconbtn" type="button" aria-label={t("documents.close")} onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <Field id="vedit-type" label={t("documents.whatItIs")}>
          <select id="vedit-type" className="sel" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>
                {docTypeLabel(d)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="vedit-exp" label={t("documents.expiresOn")}>
          <input id="vedit-exp" type="date" className="inp" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        {save.error ? <ErrorBanner error={save.error} title={t("documents.theChangeWasNotSaved")} /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("documents.cancel")}
        </button>
        <button className="btn btn-primary" type="button" disabled={save.state === "saving"} onClick={async () => (await save.run()) && onDone()}>
          {t("documents.save")}
        </button>
      </div>
    </Dialog>
  );
}

export default function Documents() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const canChange = applicantAccess(ws.member.role).draft;
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

  const allColumns: Column<VaultDocument>[] = [
    {
      key: "name",
      header: t("documents.col.document"),
      sort: (d) => d.name.toLowerCase(),
      cell: (d) => (
        <div className="row" style={{ gap: "10px" }}>
          <FileText className="ic" aria-hidden="true" style={{ flex: "none" }} />
          <div className="ent">
            <button type="button" className="nm" style={{ background: "none", border: 0, padding: 0, font: "inherit", fontWeight: 700, color: "var(--og-teal-dark)", cursor: "pointer", textAlign: "left" }} onClick={() => void open.run(d)} aria-label={t("documents.openName", { name: d.name })}>
              {d.name}
            </button>
            <span className="small muted">
              {sizeText(d.size)} · {t("documents.addedOn", { date: formatDate(d.uploadedAt) })}
            </span>
          </div>
        </div>
      ),
    },
    { key: "type", header: t("documents.col.type"), sort: (d) => docTypeLabel(d.docType), cell: (d) => docTypeLabel(d.docType) },
    { key: "expires", header: t("documents.col.expiry"), sort: (d) => d.expiresOn ?? "9999", cell: (d) => <ExpiryBadge expiresOn={d.expiresOn} /> },
    {
      key: "actions",
      header: t("documents.col.actions"),
      cell: (d) =>
        confirm === d.id ? (
          <span className="row" style={{ gap: "6px" }}>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={async () => {
                if (await remove.run(d.id)) {
                  setConfirm(null);
                  setNote(t("documents.removed", { name: d.name }));
                  query.reload();
                }
              }}
            >
              {t("documents.removeName", { name: d.name })}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>
              {t("documents.keepIt")}
            </button>
          </span>
        ) : (
          <span className="row" style={{ gap: "4px" }}>
            <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="dialog" aria-label={t("documents.editName", { name: d.name })} onClick={() => setDialog(d)}>
              <Pencil className="ic" aria-hidden="true" />
              {t("documents.edit")}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={t("documents.removeName", { name: d.name })} onClick={() => setConfirm(d.id)}>
              <Trash className="ic" aria-hidden="true" />
              {t("documents.remove")}
            </button>
          </span>
        ),
    },
  ];
  const columns = allColumns.filter((c) => canChange || c.key !== "actions");

  return (
    <>
      <title>{t("documents.pageTitle", { workspace: ws.name })}</title>
      <ApplicantShell active="Organization">
        <main className="main">
          <nav className="crumbs" aria-label={t("documents.breadcrumb")}>
            <Link to={`${base}/organization`}>{t("documents.organization")}</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{t("documents.documents")}</span>
          </nav>
          <div className="ph">
            <div>
              <div className="title">
                <h1>{t("documents.documents")}</h1>
              </div>
              <div className="meta">
                <span>{t("documents.theDocumentsFundersAskForKept")}</span>
              </div>
            </div>
            <div className="actions">
              {canChange ? (
              <button type="button" className="btn btn-primary" aria-haspopup="dialog" onClick={() => setDialog("upload")}>
                <Plus className="ic" aria-hidden="true" />
                {t("documents.addADocument")}
              </button>
              ) : (
                <p className="small muted">{t("access.cannotChangeDocuments")}</p>
              )}
            </div>
          </div>
          {note && <Notice tone="ok" title={note} />}
          {open.error ? <ErrorBanner error={open.error} title={t("documents.theFileCouldNotBeOpened")} /> : null}
          {remove.error ? <ErrorBanner error={remove.error} title={t("documents.theDocumentWasNotRemoved")} /> : null}
          <Loaded query={query} label={t("documents.loadingYourDocuments")}>
            {(docs) => {
              const soon = docs.filter((d) => expiryState(d.expiresOn).state === "soon").length;
              const expired = docs.filter((d) => expiryState(d.expiresOn).state === "expired").length;
              return (
                <>
                  {(soon > 0 || expired > 0) && (
                    <Notice tone="warn" title={[expired ? t("documents.expiredCount", { count: expired }) : null, soon ? t("documents.expiringCount", { count: soon, days: EXPIRY_WARN_DAYS }) : null].filter(Boolean).join(" · ")}>
                      {t("documents.uploadCurrent", { days: EXPIRY_WARN_DAYS })}
                    </Notice>
                  )}
                  <DataTable
                    label={t("documents.documents")}
                    columns={columns}
                    rows={docs}
                    rowKey={(d) => d.id}
                    empty={
                      <EmptyState icon={FolderLock} title={t("documents.noDocumentsYet")} actions={canChange ? <button type="button" className="btn btn-primary" onClick={() => setDialog("upload")}>{t("documents.addADocument")}</button> : <p className="small muted">{t("access.cannotChangeDocuments")}</p>}>
                        {t("documents.yourIrsDeterminationLetterLatestAudit")}
                      </EmptyState>
                    }
                  />
                </>
              );
            }}
          </Loaded>
          <p className="small muted row" style={{ gap: "6px", alignItems: "flex-start" }}>
            <Lock className="ic ic-sm" aria-hidden="true" style={{ marginTop: "2px" }} />
            <span>{t("documents.theAssistantNeverReadsTheseDocuments")}</span>
          </p>
        </main>
      </ApplicantShell>
      {dialog === "upload" && (
        <VaultUploadDialog
          onClose={() => setDialog(null)}
          onDone={(d) => {
            setDialog(null);
            setNote(t("documents.added", { name: d.name }));
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
            setNote(t("documents.saved"));
            query.reload();
          }}
        />
      )}
    </>
  );
}
