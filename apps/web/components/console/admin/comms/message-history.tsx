// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// CM-02 history: bulk messages with a delivery breakdown per message and an expandable recipient list
// (loaded on demand) showing each delivery status, with the bounce reason.
import { Badge, Button, Card, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, ToneChip } from '@gms/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useEffect, useRef, useState, useTransition } from 'react';
import { loadRecipientsAction, type RecipientRow } from '@/app/console/(app)/comms/actions';
import { BULK_STATUS, chipMeta, DELIVERY_ORDER, DELIVERY_STATUS, formatDateTime, type DeliveryCounts } from './meta';

export interface HistoryMessage {
  id: string;
  subject: string;
  status: string;
  recipientCount: number;
  /** Sent date for sent messages, created date for drafts. */
  date: string;
  createdBy: string | null;
  viaAgent: boolean;
  counts: DeliveryCounts;
}

function DeliveryBreakdown({ counts }: { counts: DeliveryCounts }) {
  const present = DELIVERY_ORDER.filter((s) => (counts[s] ?? 0) > 0);
  if (!present.length) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Delivery results">
      {present.map((s) => {
        const m = chipMeta(DELIVERY_STATUS, s);
        return (
          <li key={s}>
            <ToneChip size="sm" tone={m.tone} icon={m.icon} label={`${(counts[s] ?? 0).toLocaleString('en-US')} ${m.label.toLowerCase()}`} />
          </li>
        );
      })}
    </ul>
  );
}

function Recipients({ rows, timeZone }: { rows: RecipientRow[]; timeZone: string }) {
  if (!rows.length) return <p className="px-2 py-3 text-sm text-muted-foreground">No deliveries recorded yet.</p>;
  const sorted = [...rows].sort((a, b) => Number(b.status === 'bounced' || b.status === 'failed') - Number(a.status === 'bounced' || a.status === 'failed'));
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead>Recipient</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Details</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => {
          const m = chipMeta(DELIVERY_STATUS, r.status);
          return (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.email}</TableCell>
              <TableCell>
                <ToneChip size="sm" tone={m.tone} icon={m.icon} label={m.label} />
              </TableCell>
              <TableCell className={r.error ? 'text-status-danger-fg' : 'text-muted-foreground'}>{r.error ?? (r.status === 'complained' ? 'The recipient marked this as spam.' : '—')}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.updatedAt, timeZone)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function MessageHistory({
  messages,
  timeZone,
  canEdit,
  previewRecipients,
  expandedId,
}: {
  messages: HistoryMessage[];
  timeZone: string;
  canEdit: boolean;
  previewRecipients: Record<string, RecipientRow[]>;
  expandedId: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(expandedId ? [expandedId] : []));
  const [loaded, setLoaded] = useState<Record<string, RecipientRow[] | { error: string }>>(previewRecipients);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [, start] = useTransition();

  const load = (id: string) => {
    if (loaded[id] && !('error' in loaded[id])) return;
    setLoadingId(id);
    start(async () => {
      const r = await loadRecipientsAction(id);
      setLoaded((prev) => ({ ...prev, [id]: r.ok ? r.data : { error: r.problem.detail } }));
      setLoadingId(null);
    });
  };

  // A preselected expansion (e.g. the message with bounces) loads once after mount.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (autoLoaded.current || !expandedId || previewRecipients[expandedId]) return;
    autoLoaded.current = true;
    void loadRecipientsAction(expandedId).then((r) => setLoaded((prev) => ({ ...prev, [expandedId]: r.ok ? r.data : { error: r.problem.detail } })));
  }, [expandedId, previewRecipients]);

  if (!messages.length) {
    return (
      <Card>
        <EmptyState
          level={3}
          title="No messages yet"
          description="Messages you draft or send show up here, with delivery results for every recipient."
        />
      </Card>
    );
  }

  return (
    <Card>
      <Table containerLabel="Message history">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Recipients</span>
            </TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Recipients</TableHead>
            <TableHead>Delivery</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Created by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {messages.map((m) => {
            const status = chipMeta(BULK_STATUS, m.status);
            const isOpen = open.has(m.id);
            const panelId = `recipients-${m.id}`;
            const data = loaded[m.id];
            const canExpand = m.status !== 'draft';
            return (
              <Fragment key={m.id}>
                <TableRow data-state={isOpen ? 'selected' : undefined}>
                  <TableCell>
                    {canExpand ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? panelId : undefined}
                        onClick={() => {
                          const next = new Set(open);
                          if (isOpen) next.delete(m.id);
                          else {
                            next.add(m.id);
                            load(m.id);
                          }
                          setOpen(next);
                        }}
                      >
                        {isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                        <span className="sr-only">{isOpen ? 'Hide' : 'Show'} recipients for “{m.subject}”</span>
                      </Button>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-sm">
                    <span className="block truncate font-medium">{m.subject}</span>
                    {m.status === 'draft' && canEdit ? (
                      <Link href={`/console/comms/compose?draft=${m.id}`} className="text-xs text-link underline">
                        Continue editing
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <ToneChip size="sm" tone={status.tone} icon={status.icon} label={status.label} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.recipientCount.toLocaleString('en-US')}</TableCell>
                  <TableCell>
                    <DeliveryBreakdown counts={m.counts} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <span className="sr-only">{m.status === 'draft' ? 'Created ' : 'Sent '}</span>
                    {formatDateTime(m.date, timeZone)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {m.createdBy ?? 'A teammate'}
                      {m.viaAgent ? <Badge variant="agent">Via agent</Badge> : null}
                    </span>
                  </TableCell>
                </TableRow>
                {canExpand && isOpen ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="bg-muted/30 p-3">
                      <div id={panelId} role="region" aria-label={`Recipients of “${m.subject}”`}>
                        {!data || loadingId === m.id ? (
                          <p className="px-2 py-3 text-sm text-muted-foreground" aria-live="polite">
                            Loading recipients…
                          </p>
                        ) : 'error' in data ? (
                          <p className="px-2 py-3 text-sm text-status-danger-fg" role="alert">
                            {data.error}
                          </p>
                        ) : (
                          <Recipients rows={data} timeZone={timeZone} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
