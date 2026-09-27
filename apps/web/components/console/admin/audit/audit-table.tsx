// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// S-06: audit rows plus the "View change" drawer (before/after JSON side by side and a key-level diff).
// JSON is rendered as text inside <pre>, so React escapes it.
import { formatInZone, type RiskTier } from '@gms/domain';
import type { JsonValue } from '@gms/db';
import {
  ActorBadge,
  Button,
  DescriptionList,
  RiskChip,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToneChip,
} from '@gms/ui';
import { FileDiff, Minus, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export interface AuditRow {
  id: string;
  occurredAt: string;
  actorType: 'human' | 'agent' | 'system';
  actorName: string;
  onBehalfOfName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  riskTier: string | null;
  before: JsonValue | null;
  after: JsonValue | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  approvalRequestId: string | null;
}

type Change = { path: string; kind: 'added' | 'removed' | 'changed'; before?: string; after?: string };

function isObject(v: JsonValue | null | undefined): v is { [key: string]: JsonValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Flattens nested objects to dotted paths; arrays and scalars are leaves. */
function flatten(
  v: JsonValue | null,
  prefix = '',
  out: Map<string, string> = new Map(),
): Map<string, string> {
  if (isObject(v)) {
    const keys = Object.keys(v);
    if (!keys.length && prefix) out.set(prefix, '{}');
    for (const k of keys) flatten(v[k] ?? null, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out.set(prefix, JSON.stringify(v));
  else if (v !== null) out.set('(value)', JSON.stringify(v));
  return out;
}

export function diffJson(before: JsonValue | null, after: JsonValue | null): Change[] {
  const a = flatten(before);
  const b = flatten(after);
  const changes: Change[] = [];
  for (const [path, val] of b) {
    if (!a.has(path)) changes.push({ path, kind: 'added', after: val });
    else if (a.get(path) !== val) changes.push({ path, kind: 'changed', before: a.get(path), after: val });
  }
  for (const [path, val] of a) if (!b.has(path)) changes.push({ path, kind: 'removed', before: val });
  return changes.sort((x, y) => x.path.localeCompare(y.path));
}

const KIND = {
  added: { tone: 'success', icon: Plus, label: 'Added' },
  removed: { tone: 'danger', icon: Minus, label: 'Removed' },
  changed: { tone: 'warning', icon: Pencil, label: 'Changed' },
} as const;

function isTier(t: string | null): t is RiskTier {
  return t === 'R0' || t === 'R1' || t === 'R2' || t === 'R3';
}

function JsonPane({ title, value }: { title: string; value: JsonValue | null }) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      <pre
        className="max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed"
        tabIndex={0}
        aria-label={`${title} (JSON)`}
      >
        {value === null || value === undefined ? '(nothing recorded)' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function AuditTable({
  rows,
  timeZone,
  initialOpenId,
}: {
  rows: AuditRow[];
  timeZone: string;
  initialOpenId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const row = rows.find((r) => r.id === openId) ?? null;
  const changes = row ? diffJson(row.before, row.after) : [];

  return (
    <>
      <Table containerLabel="Audit log entries">
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Record</TableHead>
            <TableHead>Risk</TableHead>
            <TableHead className="sr-only">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-xs">
                {formatInZone(r.occurredAt, timeZone)}
              </TableCell>
              <TableCell className="max-w-72">
                <ActorBadge
                  size="sm"
                  actor={{ type: r.actorType, name: r.actorName, onBehalfOfName: r.onBehalfOfName }}
                />
              </TableCell>
              <TableCell className="font-mono text-xs">{r.action}</TableCell>
              <TableCell className="text-xs">
                {r.entityType ? <span className="font-medium">{r.entityType.replace(/_/g, ' ')}</span> : '—'}
                {r.entityId ? (
                  <span className="block font-mono text-muted-foreground">{r.entityId.slice(0, 8)}</span>
                ) : null}
              </TableCell>
              <TableCell>
                {isTier(r.riskTier) ? (
                  <RiskChip tier={r.riskTier} compact size="sm" />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" onClick={() => setOpenId(r.id)}>
                  <FileDiff aria-hidden="true" /> View change
                  <span className="sr-only">
                    : {r.action} at {formatInZone(r.occurredAt, timeZone)}
                  </span>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet open={Boolean(row)} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full sm:max-w-4xl">
          {row ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{row.action}</SheetTitle>
                <SheetDescription>
                  {formatInZone(row.occurredAt, timeZone)} ·{' '}
                  {row.entityType
                    ? `${row.entityType.replace(/_/g, ' ')} ${row.entityId ?? ''}`
                    : 'No record'}
                </SheetDescription>
              </SheetHeader>
              <SheetBody className="grid gap-6">
                <DescriptionList
                  layout="grid"
                  items={[
                    {
                      term: 'Who',
                      detail: (
                        <ActorBadge
                          size="sm"
                          actor={{
                            type: row.actorType,
                            name: row.actorName,
                            onBehalfOfName: row.onBehalfOfName,
                          }}
                        />
                      ),
                    },
                    {
                      term: 'Risk tier',
                      detail: isTier(row.riskTier) ? <RiskChip tier={row.riskTier} size="sm" /> : '—',
                    },
                    {
                      term: 'Request id',
                      detail: row.requestId ? (
                        <span className="font-mono text-xs break-all">{row.requestId}</span>
                      ) : (
                        '—'
                      ),
                    },
                    {
                      term: 'IP address',
                      detail: row.ip ? <span className="font-mono text-xs">{row.ip}</span> : '—',
                    },
                    {
                      term: 'Approval request',
                      detail: row.approvalRequestId ? (
                        <Link
                          href={`/console/approvals/${row.approvalRequestId}`}
                          className="text-link underline underline-offset-4"
                        >
                          Open approval request
                        </Link>
                      ) : (
                        'None'
                      ),
                    },
                    {
                      term: 'Browser / client',
                      detail: row.userAgent ? (
                        <span className="text-xs break-all">{row.userAgent}</span>
                      ) : (
                        '—'
                      ),
                    },
                  ]}
                />
                <section aria-labelledby="audit-diff-heading" className="grid gap-2">
                  <h3 id="audit-diff-heading" className="text-sm font-medium">
                    What changed
                  </h3>
                  {changes.length ? (
                    <ul className="grid gap-1.5">
                      {changes.map((c) => {
                        const k = KIND[c.kind];
                        return (
                          <li
                            key={`${c.kind}-${c.path}`}
                            className="grid gap-1 rounded-md border p-2 text-xs sm:grid-cols-[6rem_minmax(8rem,12rem)_1fr] sm:items-start"
                          >
                            <ToneChip tone={k.tone} icon={k.icon} label={k.label} size="sm" />
                            <code className="font-mono font-medium break-all">{c.path}</code>
                            <span className="grid gap-0.5 font-mono break-all">
                              {c.before !== undefined ? (
                                <span
                                  className={c.kind === 'changed' ? 'text-muted-foreground line-through' : ''}
                                >
                                  <span className="sr-only">Before: </span>
                                  {c.before}
                                </span>
                              ) : null}
                              {c.after !== undefined ? (
                                <span>
                                  <span className="sr-only">After: </span>
                                  {c.after}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No field-level changes were recorded for this entry.
                    </p>
                  )}
                </section>
                <div className="grid gap-4 md:grid-cols-2">
                  <JsonPane title="Before" value={row.before} />
                  <JsonPane title="After" value={row.after} />
                </div>
              </SheetBody>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
