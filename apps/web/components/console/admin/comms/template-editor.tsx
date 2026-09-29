// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// CM-01 editor: key/name/subject/markdown body, merge-field picker, unknown-token warning, and a branded
// preview rendered on the server.
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Textarea, toast } from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { saveTemplateAction } from '@/app/console/(app)/comms/actions';
import { EmailPreviewFrame, MergeFieldPicker, UnknownTokens, useMessagePreview, useTokenInsert, useUnsavedGuard, type MergeFieldOption, type PreviewState } from './message-kit';

interface Values {
  key: string;
  name: string;
  subject: string;
  bodyMd: string;
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;

function validate(v: Values, isNew: boolean): Partial<Record<keyof Values, string>> {
  const e: Partial<Record<keyof Values, string>> = {};
  if (isNew) {
    if (!v.key) e.key = 'Enter a key.';
    else if (!KEY_RE.test(v.key) || v.key.length > 60) e.key = 'Use lowercase letters, numbers and underscores, starting with a letter (e.g. info_session_invite).';
  }
  if (!v.name.trim()) e.name = 'Enter a name your team will recognize.';
  if (!v.subject.trim()) e.subject = 'Enter a subject line.';
  else if (v.subject.length > 300) e.subject = 'Keep the subject under 300 characters.';
  if (!v.bodyMd.trim()) e.bodyMd = 'Write the message.';
  return e;
}

function suggestKey(name: string): string {
  const k = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 60);
  return k;
}

export function TemplateEditor({ isNew, canEdit, initial, initialPreview, mergeFields }: { isNew: boolean; canEdit: boolean; initial: Values; initialPreview: PreviewState; mergeFields: MergeFieldOption[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [key, setKey] = useState(initial.key);
  const [keyTouched, setKeyTouched] = useState(false);
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.bodyMd);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { insert, onFocusSubject, onFocusBody } = useTokenInsert({ subjectRef, bodyRef, subject, body, setSubject, setBody });
  const { preview, pending: previewPending, refresh } = useMessagePreview(initialPreview, subject, body);

  const values: Values = { key, name, subject, bodyMd: body };
  const dirty = canEdit && (key !== saved.key || name !== saved.name || subject !== saved.subject || body !== saved.bodyMd);
  useUnsavedGuard(dirty);

  const save = () => {
    const e = validate(values, isNew);
    setErrors(e);
    setServerError(null);
    if (Object.keys(e).length) {
      toast.error('Some fields need attention.');
      return;
    }
    start(async () => {
      const r = await saveTemplateAction({ key, name: name.trim(), subject: subject.trim(), bodyMd: body, isNew });
      if (!r.ok) {
        const fieldErrors: Partial<Record<keyof Values, string>> = {};
        for (const issue of r.problem.errors ?? []) {
          const f = issue.pointer.replace(/^\//, '').split('/')[0] as keyof Values;
          if (f && ['key', 'name', 'subject', 'bodyMd'].includes(f)) fieldErrors[f] = issue.message;
        }
        if (r.problem.code === 'conflict') fieldErrors.key = r.problem.detail;
        setErrors(fieldErrors);
        setServerError(Object.keys(fieldErrors).length ? null : r.problem.detail);
        toast.error(r.problem.detail);
        return;
      }
      setSaved(values);
      toast.success(isNew ? 'Template created.' : 'Template saved.');
      if (isNew) router.replace(`/console/comms/templates/${key}`);
      else router.refresh();
    });
  };

  return (
    <form
      className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (canEdit) save();
      }}
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle as="h2">Message</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {serverError ? (
            <Alert variant="danger" role="alert" title="We couldn’t save the template">
              {serverError}
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="tpl-name" required error={errors.name} description="Shown to your team, not to recipients.">
              <Input
                id="tpl-name"
                value={name}
                readOnly={!canEdit}
                maxLength={200}
                onChange={(e) => {
                  setName(e.target.value);
                  if (isNew && !keyTouched) setKey(suggestKey(e.target.value));
                }}
              />
            </Field>
            {isNew ? (
              <Field label="Key" htmlFor="tpl-key" required error={errors.key} description="Lowercase with underscores. Can’t be changed later.">
                <Input
                  id="tpl-key"
                  value={key}
                  maxLength={60}
                  className="font-mono"
                  spellCheck={false}
                  autoCapitalize="off"
                  onChange={(e) => {
                    setKeyTouched(true);
                    setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                  }}
                />
              </Field>
            ) : (
              <Field label="Key" htmlFor="tpl-key" description="Used by rules and integrations.">
                <Input id="tpl-key" value={key} readOnly className="font-mono" />
              </Field>
            )}
          </div>
          <Field label="Subject" htmlFor="tpl-subject" required error={errors.subject}>
            <Input id="tpl-subject" ref={subjectRef} value={subject} readOnly={!canEdit} maxLength={300} onFocus={onFocusSubject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field
            label="Message"
            htmlFor="tpl-body"
            required
            error={errors.bodyMd}
            description="Markdown: **bold**, *italic*, [link text](https://…), and lists starting with “- ”."
          >
            <Textarea id="tpl-body" ref={bodyRef} value={body} readOnly={!canEdit} rows={16} className="min-h-80 font-mono text-[13px] leading-relaxed" onFocus={onFocusBody} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {canEdit ? <MergeFieldPicker fields={mergeFields} onInsert={insert} /> : null}
          <UnknownTokens tokens={preview.tokens} />
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" pending={pending} pendingLabel="Saving…">
                {isNew ? 'Create template' : 'Save template'}
              </Button>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {dirty ? 'Unsaved changes' : isNew ? '' : 'All changes saved'}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="xl:sticky xl:top-4">
        <CardHeader>
          <CardTitle as="h2">Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <EmailPreviewFrame preview={preview} pending={previewPending} onRefresh={refresh} />
        </CardContent>
      </Card>
    </form>
  );
}
