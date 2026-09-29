// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Shared pieces for writing staff messages: merge-field picker (inserts at the cursor), debounced
// server-rendered branded preview, unknown-token warning, and an unsaved-changes guard.
import { Alert, Button, Field, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@gms/ui';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition, type RefObject } from 'react';
import { previewMessageAction } from '@/app/console/(app)/comms/actions';

export interface MergeFieldOption {
  key: string;
  label: string;
  example: string;
}

export interface PreviewState {
  html: string;
  subject: string;
  tokens: { key: string; known: boolean }[];
}

type Target = 'subject' | 'body';

/**
 * Tracks which of subject/body was focused last and inserts `{{token}}` at its cursor (or appends to the body).
 */
export function useTokenInsert(opts: {
  subjectRef: RefObject<HTMLInputElement | null>;
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  subject: string;
  body: string;
  setSubject: (v: string) => void;
  setBody: (v: string) => void;
}) {
  const last = useRef<Target>('body');
  const onFocusSubject = useCallback(() => {
    last.current = 'subject';
  }, []);
  const onFocusBody = useCallback(() => {
    last.current = 'body';
  }, []);
  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const target = last.current;
    const el = target === 'subject' ? opts.subjectRef.current : opts.bodyRef.current;
    const value = target === 'subject' ? opts.subject : opts.body;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    if (target === 'subject') opts.setSubject(next);
    else opts.setBody(next);
    // After the picker closes (it returns focus to itself), put the cursor back after the token.
    setTimeout(() => {
      if (!el) return;
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    }, 30);
  };
  return { insert, onFocusSubject, onFocusBody };
}

export function MergeFieldPicker({ fields, onInsert, disabled, id = 'merge-field-picker' }: { fields: MergeFieldOption[]; onInsert: (key: string) => void; disabled?: boolean; id?: string }) {
  const [value, setValue] = useState('');
  return (
    <Field label="Insert a merge field" htmlFor={id} description="Goes in wherever your cursor was, in the subject or the message.">
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(v) => {
          onInsert(v);
          setValue('');
        }}
      >
        <SelectTrigger id={id} size="sm">
          <SelectValue placeholder="Choose a field…" />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              <span>{f.label}</span>{' '}
              <code className="font-mono text-xs text-muted-foreground">{`{{${f.key}}}`}</code>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Re-renders the preview on the server after typing pauses (and on demand). */
export function useMessagePreview(initial: PreviewState, subject: string, body: string, opts: { auto?: boolean; delayMs?: number } = {}) {
  const [preview, setPreview] = useState(initial);
  const [pending, start] = useTransition();
  const seq = useRef(0);
  const key = `${subject}\u0000${body}`;
  // The content the current preview was rendered from (the server rendered the initial one).
  const rendered = useRef(key);
  const refresh = useCallback(() => {
    const n = ++seq.current;
    const k = `${subject}\u0000${body}`;
    start(async () => {
      try {
        const p = await previewMessageAction({ subject, bodyMd: body });
        if (n === seq.current) {
          rendered.current = k;
          setPreview(p);
        }
      } catch {
        /* keep the last good preview */
      }
    });
  }, [subject, body]);
  useEffect(() => {
    if (opts.auto === false || key === rendered.current) return;
    const t = setTimeout(refresh, opts.delayMs ?? 800);
    return () => clearTimeout(t);
  }, [key, refresh, opts.auto, opts.delayMs]);
  return { preview, pending, refresh };
}

export function EmailPreviewFrame({ preview, pending, onRefresh, height = 640 }: { preview: PreviewState; pending: boolean; onRefresh?: () => void; height?: number }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm">
          <span className="text-muted-foreground">Subject: </span>
          <span className="font-medium">{preview.subject}</span>
        </p>
        {onRefresh ? (
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} pending={pending} pendingLabel="Updating…">
            <RefreshCw aria-hidden="true" />
            Update preview
          </Button>
        ) : null}
      </div>
      <iframe sandbox="" srcDoc={preview.html} title="Email preview" className="w-full rounded-md border" style={{ height }} />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {pending ? 'Updating preview…' : 'Preview uses example values for merge fields.'}
      </p>
    </div>
  );
}

export function UnknownTokens({ tokens }: { tokens: { key: string; known: boolean }[] }) {
  const unknown = tokens.filter((t) => !t.known);
  if (!unknown.length) return null;
  return (
    <Alert variant="warning" title={unknown.length === 1 ? 'One merge field isn’t recognized' : `${unknown.length} merge fields aren’t recognized`}>
      <p>
        These will be sent exactly as typed:{' '}
        {unknown.map((t, i) => (
          <span key={t.key}>
            {i ? ', ' : ''}
            <code className="font-mono text-xs">{`{{${t.key}}}`}</code>
          </span>
        ))}
        . Check the spelling or pick a field from the list.
      </p>
    </Alert>
  );
}

/** Warns before leaving the page (reload, close, typed URL) while there are unsaved changes. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
