// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// S-07: outbound webhook endpoints. Creating one is people-only (R3); the signing secret is shown once.
import { formatInZone } from '@gms/domain';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldSet,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  ToneChip,
} from '@gms/ui';
import { CircleCheck, CirclePause, Pause, Pencil, Play, Plus, Trash2, Webhook } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteWebhookAction, saveWebhookAction } from '@/app/console/(app)/settings/developers/actions';
import { SecretOnce } from '@/components/console/admin/secret-once';
import { useStepUp } from '@/components/console/step-up';

export interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  status: string;
  createdAt: string;
}

type Draft = {
  id?: string;
  url: string;
  description: string;
  events: string[];
  status: 'active' | 'disabled';
};
const EMPTY: Draft = {
  url: '',
  description: '',
  events: ['application.submitted', 'award.created', 'payment.sent'],
  status: 'active',
};

export function Webhooks({
  endpoints,
  events,
  timeZone,
  canEdit,
  previewSecret,
}: {
  endpoints: WebhookRow[];
  events: readonly string[];
  timeZone: string;
  canEdit: boolean;
  previewSecret?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { withStepUp, dialog } = useStepUp({ actionLabel: 'Save endpoint' });
  const [open, setOpen] = useState(Boolean(previewSecret));
  const [secret, setSecret] = useState<string | null>(previewSecret ?? null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<WebhookRow | null>(null);

  const edit = (d: Draft) => {
    setDraft(d);
    setSecret(null);
    setError(null);
    setFieldErrors({});
    setOpen(true);
  };

  const toggle = (w: WebhookRow) =>
    start(async () => {
      const next = w.status === 'active' ? 'disabled' : 'active';
      const r = await withStepUp(() =>
        saveWebhookAction({
          id: w.id,
          url: w.url,
          description: w.description ?? undefined,
          events: w.events,
          status: next,
        }),
      );
      if (r.ok) {
        toast.success(next === 'active' ? 'Endpoint enabled.' : 'Endpoint disabled. Deliveries are paused.');
        router.refresh();
      } else toast.error(r.problem.detail);
    });

  const save = () => {
    const errs: Record<string, string> = {};
    let parsed: URL | null = null;
    try {
      parsed = new URL(draft.url.trim());
    } catch {
      parsed = null;
    }
    if (!parsed) errs.url = 'Enter the full URL, starting with https://.';
    else if (parsed.protocol !== 'https:') errs.url = 'Webhook URLs must use HTTPS.';
    if (!draft.events.length) errs.events = 'Choose at least one event.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setError('Check the highlighted fields.');
      return;
    }
    setError(null);
    start(async () => {
      const r = await withStepUp(() =>
        saveWebhookAction({
          ...(draft.id ? { id: draft.id } : {}),
          url: draft.url.trim(),
          description: draft.description.trim() || undefined,
          events: draft.events,
          status: draft.status,
        }),
      );
      if (r.ok) {
        router.refresh();
        if (r.data.secret) {
          setSecret(r.data.secret);
          toast.success('Endpoint added.');
        } else {
          toast.success('Endpoint saved.');
          setOpen(false);
        }
      } else {
        setError(r.problem.detail);
        const fe: Record<string, string> = {};
        for (const i of r.problem.errors ?? []) {
          const f = i.pointer.split('/')[1];
          if (f) fe[f] = i.message;
        }
        setFieldErrors(fe);
      }
    });
  };

  return (
    <div className="grid gap-3">
      {endpoints.length ? (
        <Table containerLabel="Webhook endpoints">
          <TableHeader>
            <TableRow>
              <TableHead>Endpoint</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              {canEdit ? <TableHead className="sr-only">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoints.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="max-w-80">
                  <span className="block truncate font-mono text-xs" title={w.url}>
                    {w.url}
                  </span>
                  {w.description ? (
                    <span className="block truncate text-xs text-muted-foreground">{w.description}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <ul className="flex max-w-sm flex-wrap gap-1" aria-label={`Events for ${w.url}`}>
                    {w.events.map((e) => (
                      <li key={e}>
                        <Badge variant="neutral">{e}</Badge>
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>
                  {w.status === 'active' ? (
                    <ToneChip tone="success" icon={CircleCheck} label="Active" size="sm" />
                  ) : (
                    <ToneChip tone="muted" icon={CirclePause} label="Disabled" size="sm" />
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatInZone(w.createdAt, timeZone, { dateOnly: true })}
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <span className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          edit({
                            id: w.id,
                            url: w.url,
                            description: w.description ?? '',
                            events: w.events,
                            status: w.status === 'active' ? 'active' : 'disabled',
                          })
                        }
                      >
                        <Pencil aria-hidden="true" /> Edit<span className="sr-only"> {w.url}</span>
                      </Button>
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => toggle(w)}>
                        {w.status === 'active' ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                        {w.status === 'active' ? 'Disable' : 'Enable'}
                        <span className="sr-only"> {w.url}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={pending}
                        onClick={() => setDeleting(w)}
                      >
                        <Trash2 aria-hidden="true" /> Delete<span className="sr-only"> {w.url}</span>
                      </Button>
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          level={3}
          icon={Webhook}
          title="No webhook endpoints yet"
          description="GMS can POST a signed JSON event to your system when something happens, such as an application being submitted or a payment being sent."
        />
      )}
      {canEdit ? (
        <Button className="justify-self-start" onClick={() => edit(EMPTY)}>
          <Plus aria-hidden="true" /> Add endpoint
        </Button>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setSecret(null);
            setDraft(EMPTY);
          }
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {secret ? 'Copy the signing secret' : draft.id ? 'Edit endpoint' : 'Add endpoint'}
            </DialogTitle>
            <DialogDescription>
              {secret
                ? 'Use it to check the GMS-Signature header (HMAC-SHA256) on every delivery.'
                : 'Sending data out of GMS is a people-only step. Deliveries are signed and retried with backoff.'}
            </DialogDescription>
          </DialogHeader>
          {secret ? (
            <SecretOnce
              label="Signing secret"
              value={secret}
              note="GMS keeps it in the secret store and never shows it again. If you lose it, delete the endpoint and add it again."
            />
          ) : (
            <form
              id="webhook-form"
              className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              {error ? (
                <Alert variant="danger" title="The endpoint wasn’t saved">
                  {error}
                </Alert>
              ) : null}
              <Field
                label="URL"
                htmlFor="wh-url"
                required
                error={fieldErrors.url}
                description="HTTPS only, for example https://hooks.example.org/gms."
              >
                <Input
                  id="wh-url"
                  type="url"
                  inputMode="url"
                  value={draft.url}
                  maxLength={500}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </Field>
              <Field label="Description" htmlFor="wh-desc" optional error={fieldErrors.description}>
                <Input
                  id="wh-desc"
                  value={draft.description}
                  maxLength={300}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              <FieldSet legend="Events" required error={fieldErrors.events}>
                <div className="grid gap-1 sm:grid-cols-2">
                  {events.map((ev) => (
                    <CheckboxField
                      key={ev}
                      id={`wh-ev-${ev}`}
                      label={<span className="font-mono text-xs">{ev}</span>}
                      checked={draft.events.includes(ev)}
                      onCheckedChange={(c) =>
                        setDraft({
                          ...draft,
                          events: c === true ? [...draft.events, ev] : draft.events.filter((x) => x !== ev),
                        })
                      }
                    />
                  ))}
                </div>
              </FieldSet>
            </form>
          )}
          <DialogFooter>
            {secret ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" form="webhook-form" pending={pending} pendingLabel="Saving…">
                  {draft.id ? 'Save endpoint' : 'Add endpoint'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              GMS stops sending events to <span className="font-mono break-all">{deleting?.url}</span>.
              Pending retries are dropped. To pause deliveries instead, disable it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep endpoint</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                const w = deleting;
                if (!w) return;
                start(async () => {
                  const r = await deleteWebhookAction(w.id);
                  if (r.ok) {
                    toast.success('Endpoint deleted.');
                    setDeleting(null);
                    router.refresh();
                  } else toast.error(r.problem.detail);
                });
              }}
            >
              Delete endpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog}
    </div>
  );
}
