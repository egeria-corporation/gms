// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// S-07: workspace API keys. Creating one is people-only (R3 + step-up); the key is shown once.
import { formatInZone, SCOPES, STAFF_SCOPES, type Scope } from '@gms/domain';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  ToneChip,
} from '@gms/ui';
import { Ban, CircleCheck, Clock, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createApiKeyAction, revokeApiKeyAction } from '@/app/console/(app)/settings/developers/actions';
import { SecretOnce } from '@/components/console/admin/secret-once';
import { useStepUp } from '@/components/console/step-up';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  ownerName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

function KeyStatus({ k }: { k: ApiKeyRow }) {
  if (k.revokedAt) return <ToneChip tone="muted" icon={Ban} label="Revoked" size="sm" />;
  if (k.expiresAt && new Date(k.expiresAt).getTime() < Date.now())
    return <ToneChip tone="muted" icon={Clock} label="Expired" size="sm" />;
  return <ToneChip tone="success" icon={CircleCheck} label="Active" size="sm" />;
}

export function ApiKeys({
  keys,
  timeZone,
  canEdit,
  previewKey,
}: {
  keys: ApiKeyRow[];
  timeZone: string;
  canEdit: boolean;
  previewKey?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { withStepUp, dialog } = useStepUp({ actionLabel: 'Create API key' });
  const [open, setOpen] = useState(Boolean(previewKey));
  const [created, setCreated] = useState<string | null>(previewKey ?? null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['opportunities:read', 'pipeline:read']);
  const [days, setDays] = useState('365');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);

  const reset = () => {
    setCreated(null);
    setName('');
    setScopes(['opportunities:read', 'pipeline:read']);
    setDays('365');
    setError(null);
    setFieldErrors({});
  };

  return (
    <div className="grid gap-3">
      {keys.length ? (
        <Table containerLabel="API keys">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              {canEdit ? <TableHead className="sr-only">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                <TableCell>
                  <ul className="flex max-w-xs flex-wrap gap-1" aria-label={`Permissions for ${k.name}`}>
                    {k.scopes.map((s) => (
                      <li key={s}>
                        <Badge variant="neutral" title={SCOPES[s as Scope]?.label ?? s}>
                          {s}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>{k.ownerName ?? '—'}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatInZone(k.createdAt, timeZone, { dateOnly: true })}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {k.lastUsedAt ? formatInZone(k.lastUsedAt, timeZone) : 'Never'}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {k.expiresAt ? formatInZone(k.expiresAt, timeZone, { dateOnly: true }) : 'Never'}
                </TableCell>
                <TableCell>
                  <KeyStatus k={k} />
                </TableCell>
                {canEdit ? (
                  <TableCell className="text-right">
                    {!k.revokedAt ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setRevoking(k)}
                      >
                        <Trash2 aria-hidden="true" /> Revoke<span className="sr-only"> {k.name}</span>
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          level={3}
          icon={KeyRound}
          title="No API keys yet"
          description="API keys let your own scripts and systems use the GMS REST API with the permissions you choose."
        />
      )}
      {canEdit ? (
        <Button
          className="justify-self-start"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          <Plus aria-hidden="true" /> Create API key
        </Button>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{created ? 'Copy your API key' : 'Create API key'}</DialogTitle>
            <DialogDescription>
              {created
                ? 'Send it as a bearer token: Authorization: Bearer <key>.'
                : 'Creating a key is a people-only step, so we check your authenticator first.'}
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <SecretOnce label="API key" value={created} />
          ) : (
            <form
              id="api-key-form"
              className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1"
              onSubmit={(e) => {
                e.preventDefault();
                const errs: Record<string, string> = {};
                if (!name.trim()) errs.name = 'Name the key after the system that uses it.';
                if (!scopes.length) errs.scopes = 'Choose at least one permission.';
                setFieldErrors(errs);
                if (Object.keys(errs).length) {
                  setError('Check the highlighted fields.');
                  return;
                }
                setError(null);
                start(async () => {
                  const r = await withStepUp(() =>
                    createApiKeyAction({
                      name: name.trim(),
                      scopes,
                      expiresInDays: days === 'never' ? null : Number(days),
                    }),
                  );
                  if (r.ok) {
                    setCreated(r.data.key);
                    toast.success('API key created.');
                    router.refresh();
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
              }}
            >
              {error ? (
                <Alert variant="danger" title="The key wasn’t created">
                  {error}
                </Alert>
              ) : null}
              <Field
                label="Name"
                htmlFor="key-name"
                required
                error={fieldErrors.name}
                description="For example, “Board reporting sync”."
              >
                <Input id="key-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
              </Field>
              <FieldSet
                legend="Permissions"
                required
                error={fieldErrors.scopes}
                description="No permission allows people-only actions such as approving payments."
              >
                <div className="grid gap-1 sm:grid-cols-2">
                  {STAFF_SCOPES.map((s) => (
                    <CheckboxField
                      key={s}
                      id={`key-scope-${s}`}
                      label={SCOPES[s].label}
                      description={<span className="font-mono text-xs">{s}</span>}
                      checked={scopes.includes(s)}
                      onCheckedChange={(c) =>
                        setScopes(c === true ? [...scopes, s] : scopes.filter((x) => x !== s))
                      }
                    />
                  ))}
                </div>
              </FieldSet>
              <Field label="Expires after" htmlFor="key-expiry" error={fieldErrors.expiresInDays}>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger id="key-expiry" className="max-w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                    <SelectItem value="730">2 years</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </form>
          )}
          <DialogFooter>
            {created ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" form="api-key-form" pending={pending} pendingLabel="Creating…">
                  Create API key
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revoking?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything using this key stops working right away. You can’t undo this; create a new key instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep key</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                const k = revoking;
                if (!k) return;
                start(async () => {
                  const r = await revokeApiKeyAction(k.id);
                  if (r.ok) {
                    toast.success(`“${k.name}” is revoked.`);
                    setRevoking(null);
                    router.refresh();
                  } else toast.error(r.problem.detail);
                });
              }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog}
    </div>
  );
}
