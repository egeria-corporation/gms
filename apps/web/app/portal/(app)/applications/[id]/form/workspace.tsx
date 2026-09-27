// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// B-05 Application workspace: multi-page form, progress rail, autosave with revision conflicts,
// uploads through signed URLs with scan status, validation summary, team comments.
import { compileForm, FormModelSchema, type ResponseError } from '@gms/forms';
import { ConflictNotice, FormProgressRail, GmsForm, GmsFormPager, pickChanged, useAutosave, type FileRef } from '@gms/forms/react';
import { Alert, AutosaveIndicator, Badge, Button, DeadlineChip, type FileScanStatus } from '@gms/ui';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { putToSignedUrl } from '@/components/upload';
import { confirmUploadAction, requestUploadAction, saveAnswersAction } from './actions';

export interface WorkspaceProps {
  applicationId: string;
  formId: string;
  model: unknown;
  initialData: Record<string, unknown>;
  etag: string;
  initialPageId: string | null;
  closesAt: string | null;
  timeZone: string;
  inGrace: boolean;
  deadlinePassed: boolean;
  infoRequestNote: string | null;
  collaboratorCount: number;
  fileStatus: Record<string, FileScanStatus>;
}

export function ApplicationWorkspace(p: WorkspaceProps) {
  const router = useRouter();
  const compiled = useMemo(() => compileForm(FormModelSchema.parse(p.model)), [p.model]);
  const [data, setData] = useState<Record<string, unknown>>(p.initialData);
  const [pageId, setPageId] = useState<string>(p.initialPageId ?? compiled.pages[0]?.id ?? '');
  const [fileStatus, setFileStatus] = useState<Record<string, FileScanStatus>>(p.fileStatus);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const autosave = useAutosave({
    etag: p.etag,
    save: async (changed, etag) => {
      const r = await saveAnswersAction(p.applicationId, p.formId, changed, etag);
      if (!r.ok) {
        setSaveMessage(r.message ?? null);
        throw new Error(r.message ?? 'Save failed');
      }
      setSaveMessage(null);
      return { etag: r.etag, errors: r.errors, conflicts: r.conflicts };
    },
  });

  const pages = compiled.pages;
  const idx = Math.max(0, pages.findIndex((x) => x.id === pageId));
  const goTo = (id: string) => {
    void autosave.flush();
    setPageId(id);
    const u = new URL(window.location.href);
    u.searchParams.set('page', id);
    window.history.replaceState(null, '', u);
    document.getElementById('main')?.scrollIntoView({ block: 'start' });
  };

  const onUpload = async (fieldId: string, file: File): Promise<FileRef> => {
    await autosave.flush();
    const req = await requestUploadAction({ applicationId: p.applicationId, formId: p.formId, fieldId, fileName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size });
    if (!req.ok) throw new Error(req.problem.detail);
    await putToSignedUrl(req.data, file);
    const done = await confirmUploadAction(req.data.attachmentId);
    if (!done.ok) throw new Error(done.problem.detail);
    setFileStatus((s) => ({ ...s, [done.data.attachmentId]: done.data.scanStatus === 'clean' ? 'clean' : done.data.scanStatus === 'infected' ? 'infected' : 'clean' }));
    return { fileId: done.data.attachmentId, name: done.data.fileName, size: done.data.sizeBytes, mimeType: file.type };
  };

  const errors: ResponseError[] = autosave.errors;

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="grid content-start gap-4 lg:sticky lg:top-4">
        <FormProgressRail compiled={compiled} data={data} errors={errors} currentPageId={pages[idx]?.id ?? ''} onSelect={goTo} />
        <div className="grid gap-2 rounded-lg border bg-card p-3 text-sm">
          <AutosaveIndicator {...autosave.indicator} />
          {p.closesAt ? <DeadlineChip at={p.closesAt} timeZone={p.timeZone} label="Due" /> : null}
          <Link href={`/portal/applications/${p.applicationId}/collaborators`} className="inline-flex items-center gap-1 text-link underline underline-offset-2">
            <Users aria-hidden="true" className="size-4" /> Collaborators{p.collaboratorCount ? ` (${p.collaboratorCount})` : ''}
          </Link>
        </div>
      </aside>
      <div className="grid content-start gap-5">
        {p.deadlinePassed ? (
          <Alert variant="danger" title="The deadline has passed">
            You can still read your answers, but you can’t submit. If something went wrong, message the foundation from your application page.
          </Alert>
        ) : p.inGrace ? (
          <Alert variant="warning" title="You’re in the grace period">
            The deadline has passed, but the foundation allows a short grace period. Submit as soon as you can.
          </Alert>
        ) : null}
        {p.infoRequestNote ? (
          <Alert variant="warning" title="The foundation asked for changes">
            <p className="whitespace-pre-wrap">{p.infoRequestNote}</p>
          </Alert>
        ) : null}
        {autosave.status === 'offline' ? (
          <Alert variant="warning" title="You’re offline">
            Keep working — your changes are saved in this tab and we’ll send them as soon as you’re back online.
          </Alert>
        ) : null}
        {saveMessage && autosave.status === 'error' ? (
          <Alert variant="danger" title="We couldn’t save your last change">
            {saveMessage}{' '}
            <Button variant="link" onClick={autosave.retry}>
              Try again
            </Button>
          </Alert>
        ) : null}
        <ConflictNotice
          conflicts={autosave.conflicts}
          compiled={compiled}
          onKeepMine={(c) => autosave.keepMine(c)}
          onUseTheirs={(c) => setData((d) => ({ ...d, [c.fieldId]: autosave.acceptTheirs(c) }))}
        />
        <GmsForm
          compiled={compiled}
          data={data}
          onChange={(next, ids) => {
            setData(next);
            autosave.queue(pickChanged(next, ids));
          }}
          mode="edit"
          errors={errors}
          currentPageId={pages[idx]?.id}
          onPageChange={goTo}
          onUpload={onUpload}
          fileHref={(f) => `/portal/applications/${p.applicationId}/files/${f.fileId}`}
          fileStatus={fileStatus}
          density="applicant"
        />
        <GmsFormPager
          pages={pages.map((x) => ({ id: x.id, title: x.title }))}
          currentPageId={pages[idx]?.id ?? ''}
          onPageChange={goTo}
          density="applicant"
          finishLabel="Review and submit"
          onFinish={async () => {
            await autosave.flush();
            router.push(`/portal/applications/${p.applicationId}/review`);
          }}
        />
        {autosave.pendingFieldIds.length ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            <Badge variant="neutral">{autosave.pendingFieldIds.length}</Badge> change{autosave.pendingFieldIds.length === 1 ? '' : 's'} waiting to save
          </p>
        ) : null}
      </div>
    </div>
  );
}
