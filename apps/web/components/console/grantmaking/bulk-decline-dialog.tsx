// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Bulk decline (decisions.bulk_decline, R3 — people only) with a preview of the exact letter applicants
// get. The preview is rendered on the server with the real email template and shown in a sandboxed iframe.
import {
  Alert,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@gms/ui';
import { Eye, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { bulkDeclineAction, previewDeclineLetterAction, type LetterPreview } from './actions';
import { problemMessage } from './run-action';

export interface BulkDeclineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationIds: string[];
  /** Short labels of the selected applications (shown as a summary). */
  labels?: string[];
  onDone?: () => void;
}

export function BulkDeclineDialog({ open, onOpenChange, applicationIds, labels = [], onDone }: BulkDeclineDialogProps) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [sendLetter, setSendLetter] = useState(true);
  const [preview, setPreview] = useState<LetterPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [pending, start] = useTransition();
  const n = applicationIds.length;

  const loadPreview = () => {
    setError(null);
    startPreview(async () => {
      const r = await previewDeclineLetterAction({ applicationIds, reason });
      if (r.ok) setPreview(r.data);
      else setError(r.problem.detail);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setPreview(null);
          setError(null);
        }
      }}
    >
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>
            Decline {n} application{n === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription>
            This records a final decision. Applicants see the status change{sendLetter ? ' and get the letter below' : ''}. It can’t be undone.
          </DialogDescription>
        </DialogHeader>
        {labels.length ? (
          <p className="text-sm text-muted-foreground">
            {labels.slice(0, 5).join(', ')}
            {labels.length > 5 ? ` and ${labels.length - 5} more` : ''}
          </p>
        ) : null}
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) {
              setError('Give a reason. It is recorded with the decision and shown to applicants in the letter.');
              return;
            }
            setError(null);
            start(async () => {
              const r = await bulkDeclineAction({ applicationIds, reason: reason.trim(), sendLetter });
              if (r.ok) {
                const skipped = r.data.skipped.length;
                toast.success(`Declined ${r.data.declined} application${r.data.declined === 1 ? '' : 's'}${skipped ? `; ${skipped} skipped (already decided or not eligible for this change)` : ''}.`);
                onOpenChange(false);
                setReason('');
                setPreview(null);
                onDone?.();
                router.refresh();
              } else setError(problemMessage(r.problem));
            });
          }}
        >
          <Field label="Reason" htmlFor="decline-reason" required description="Shown to applicants as a note from the foundation in the letter." error={error ?? undefined}>
            <Textarea id="decline-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={5000} />
          </Field>
          <CheckboxField label="Email the decline letter to each applicant" checked={sendLetter} onCheckedChange={(v) => setSendLetter(v === true)} />
          <div className="grid gap-2">
            <div>
              <Button type="button" variant="outline" size="sm" onClick={loadPreview} pending={previewing} pendingLabel="Rendering…">
                <Eye aria-hidden="true" /> {preview ? 'Refresh letter preview' : 'Preview the letter'}
              </Button>
            </div>
            {preview ? (
              <div className="grid gap-2 rounded-lg border p-3">
                <p className="text-sm">
                  <span className="text-muted-foreground">Subject: </span>
                  <span className="font-medium">{preview.subject}</span>
                  <span className="text-muted-foreground"> · sample for {preview.sampleReference}; each applicant gets their own name and reference</span>
                </p>
                <Tabs defaultValue="html">
                  <TabsList>
                    <TabsTrigger value="html">Email</TabsTrigger>
                    <TabsTrigger value="text">Plain text</TabsTrigger>
                  </TabsList>
                  <TabsContent value="html">
                    <iframe title={`Decline letter preview for ${preview.sampleReference}`} sandbox="" srcDoc={preview.html} className="h-96 w-full rounded-md border bg-white" />
                  </TabsContent>
                  <TabsContent value="text">
                    <pre className="max-h-96 overflow-auto rounded-md border bg-muted p-3 text-sm whitespace-pre-wrap">{preview.text}</pre>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Preview shows the real email template with your reason, rendered for the first selected application.</p>
            )}
          </div>
          {!sendLetter ? (
            <Alert variant="warning" title="No letter will be sent">
              Applicants will only see the status change in their portal.
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" pending={pending} pendingLabel="Declining…">
              <XCircle aria-hidden="true" /> Decline {n}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
