// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { formatDateOnly } from '@gms/domain';
import { Alert, Badge, Button, Field, FileDropzone, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from '@gms/ui';
import { FileText, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { putToSignedUrl } from '@/components/upload';
import { confirmDocUploadAction, deleteDocAction, requestDocUploadAction } from '../actions';

const DOC_TYPES: { value: string; label: string }[] = [
  { value: 'determination_letter', label: 'IRS determination letter' },
  { value: 'form_990', label: 'Form 990' },
  { value: 'audit', label: 'Audit' },
  { value: 'financial_statement', label: 'Financial statement' },
  { value: 'budget', label: 'Budget' },
  { value: 'board_list', label: 'Board list' },
  { value: 'fiscal_sponsor_agreement', label: 'Fiscal sponsor agreement' },
  { value: 'w9', label: 'W-9' },
  { value: 'other', label: 'Other' },
];

export interface VaultDoc {
  id: string;
  title: string;
  docType: string;
  sizeBytes: number;
  scanStatus: string;
  expiresOn: string | null;
  createdAt: string;
}

export function Vault({ orgId, docs, canEdit, today }: { orgId: string; docs: VaultDoc[]; canEdit: boolean; today: string }) {
  const router = useRouter();
  const [docType, setDocType] = useState('determination_letter');
  const [title, setTitle] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const soon = new Date(Date.parse(today) + 60 * 86400000).toISOString().slice(0, 10);

  async function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setError(null);
    const r = await requestDocUploadAction({ orgId, docType, title: title || file.name, fileName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size, expiresOn: expiresOn || null });
    if (!r.ok) {
      setError(r.problem.detail);
      return;
    }
    try {
      setUploading({ name: file.name, pct: 0 });
      await putToSignedUrl(r.data, file, (pct) => setUploading({ name: file.name, pct }));
      const c = await confirmDocUploadAction(r.data.documentId, orgId);
      if (!c.ok) throw new Error(c.problem.detail);
      toast.success(c.data.scanStatus === 'clean' ? 'Uploaded and scanned.' : 'Uploaded.');
      setTitle('');
      setExpiresOn('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="grid gap-5">
      {docs.length ? (
        <ul className="grid gap-2">
          {docs.map((d) => {
            const expired = d.expiresOn && d.expiresOn < today;
            const expiring = d.expiresOn && !expired && d.expiresOn <= soon;
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                  <div className="grid min-w-0">
                    <span className="truncate font-medium">{d.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {DOC_TYPES.find((t) => t.value === d.docType)?.label ?? d.docType} · added {formatDateOnly(d.createdAt.slice(0, 10))}
                      {d.expiresOn ? ` · expires ${formatDateOnly(d.expiresOn)}` : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {expired ? <Badge variant="danger">Expired — upload a new copy</Badge> : expiring ? <Badge variant="warning">Expires soon</Badge> : null}
                  <Badge variant={d.scanStatus === 'clean' ? 'success' : d.scanStatus === 'infected' ? 'danger' : 'neutral'}>
                    {d.scanStatus === 'clean' ? 'Scanned' : d.scanStatus === 'not_scanned' ? 'Not scanned' : d.scanStatus === 'infected' ? 'Removed (unsafe)' : 'Checking…'}
                  </Badge>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${d.title}`}
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await deleteDocAction(d.id, orgId);
                          if (!r.ok) toast.error(r.problem.detail);
                          else router.refresh();
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No documents yet. Documents you save here can be reused in any application.</p>
      )}
      <div className="grid gap-4 rounded-xl border bg-muted/40 p-4">
        <h3 className="font-semibold">Add a document</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type" htmlFor="doc-type">
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger id="doc-type" size="lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Title" htmlFor="doc-title" optional>
            <Input id="doc-title" inputSize="lg" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Expires on" htmlFor="doc-exp" optional>
            <Input id="doc-exp" type="date" inputSize="lg" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </Field>
        </div>
        {error ? <Alert variant="danger" title="Upload didn’t work">{error}</Alert> : null}
        <FileDropzone
          accept=".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg"
          acceptLabel="PDF, Word, Excel, CSV, PNG or JPEG"
          maxSizeBytes={25 * 1024 * 1024}
          maxFiles={1}
          files={uploading ? [{ id: 'u', name: uploading.name, size: 0, status: uploading.pct < 100 ? 'uploading' : 'scanning', progress: uploading.pct }] : []}
          onFilesSelected={(accepted) => void onFiles(accepted)}
        />
      </div>
    </div>
  );
}
