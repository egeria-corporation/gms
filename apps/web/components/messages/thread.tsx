// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Threaded messages between an applicant and the foundation (used in the portal and the console).
import { formatInZone } from '@gms/domain';
import { Alert, Badge, Button, Field, Textarea } from '@gms/ui';
import { Bot, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export interface ThreadMessage {
  id: string;
  body: string;
  side: 'staff' | 'applicant' | 'system';
  authorName: string | null;
  viaAgent: string | null;
  createdAt: string;
}

export function MessageThread({
  messages,
  timeZone,
  viewerSide,
  foundationName,
  onSend,
  emptyText,
  disabled,
}: {
  messages: ThreadMessage[];
  timeZone: string;
  viewerSide: 'staff' | 'applicant';
  foundationName: string;
  onSend: (body: string) => Promise<{ ok: boolean; problem?: { detail: string } }>;
  emptyText?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-4">
      {messages.length ? (
        <ol className="grid gap-3" aria-label="Messages">
          {messages.map((m) => {
            const mine = m.side === viewerSide;
            return (
              <li key={m.id} className={mine ? 'justify-self-end' : 'justify-self-start'}>
                <article className={`max-w-prose rounded-xl border p-4 ${mine ? 'bg-brand-50' : 'bg-card'}`} aria-label={`Message from ${m.side === 'staff' ? foundationName : m.authorName ?? 'applicant'}`}>
                  <header className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{m.side === 'staff' ? (viewerSide === 'staff' ? m.authorName : foundationName) : m.authorName ?? 'Applicant'}</span>
                    {m.viaAgent ? (
                      <Badge variant="agent">
                        <Bot aria-hidden="true" /> via {m.viaAgent}
                      </Badge>
                    ) : null}
                    <time dateTime={m.createdAt}>{formatInZone(m.createdAt, timeZone)}</time>
                  </header>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </article>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText ?? 'No messages yet.'}</p>
      )}
      {!disabled ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) {
              setError('Write a message first.');
              return;
            }
            setError(null);
            start(async () => {
              const r = await onSend(body.trim());
              if (!r.ok) setError(r.problem?.detail ?? 'Your message wasn’t sent. Try again.');
              else {
                setBody('');
                router.refresh();
              }
            });
          }}
        >
          <Field label={viewerSide === 'staff' ? 'Reply to the applicant' : `Message ${foundationName}`} htmlFor="msg-body" error={error ?? undefined}>
            <Textarea id="msg-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" pending={pending} pendingLabel="Sending…">
              <Send aria-hidden="true" /> Send message
            </Button>
          </div>
        </form>
      ) : (
        <Alert variant="info" title="Messaging is closed">This conversation is read-only.</Alert>
      )}
    </div>
  );
}
