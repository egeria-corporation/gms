// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// CM-02 composer: segment builder + message → "Save draft & count recipients" → type the exact count to
// confirm → send. A changed segment at send time (precondition_failed) re-counts and asks again.
import { APPLICATION_STATUS, AWARD_STATUS } from '@gms/domain';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldSet,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@gms/ui';
import { Eye, Send, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import { draftBulkMessageAction, sendBulkMessageAction, type SegmentInput } from '@/app/console/(app)/comms/actions';
import { EmailPreviewFrame, MergeFieldPicker, UnknownTokens, useMessagePreview, useTokenInsert, useUnsavedGuard, type MergeFieldOption, type PreviewState } from './message-kit';

export interface SegmentValue {
  opportunityId: string;
  competitionId: string;
  applicationStatuses: string[];
  awardStatuses: string[];
  programId: string;
  reportOverdue: boolean;
}

export interface ComposerDraft {
  id: string | null;
  subject: string;
  bodyMd: string;
  segment: SegmentValue;
  templateKey: string | null;
  recipientCount: number;
}

interface Option {
  id: string;
  label: string;
}

const ANY = '__any__';
const NO_TEMPLATE = '__none__';

const EMPTY_SEGMENT: SegmentValue = { opportunityId: '', competitionId: '', applicationStatuses: [], awardStatuses: [], programId: '', reportOverdue: false };

/** Only non-empty filters are sent: an empty list would change how the segment resolves. */
function toSegmentInput(s: SegmentValue): SegmentInput {
  const out: SegmentInput = {};
  if (s.opportunityId) out.opportunityId = s.opportunityId;
  if (s.opportunityId && s.competitionId) out.competitionId = s.competitionId;
  if (s.applicationStatuses.length) out.applicationStatuses = s.applicationStatuses;
  if (s.awardStatuses.length) out.awardStatuses = s.awardStatuses;
  if (s.programId) out.programId = s.programId;
  if (s.reportOverdue) out.reportOverdue = true;
  return out;
}

/** Mirrors resolveSegment: award filters, overdue reports or a program on its own target grantees. */
function isGranteeSegment(s: SegmentValue): boolean {
  return s.awardStatuses.length > 0 || s.reportOverdue || (Boolean(s.programId) && !s.opportunityId && s.applicationStatuses.length === 0);
}

function toggle(list: string[], value: string, on: boolean): string[] {
  return on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
}

function people(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'person' : 'people'}`;
}

export function Composer({
  initialDraft,
  openConfirm,
  previewOnly,
  initialPreview,
  opportunities,
  competitions,
  programs,
  templates,
  mergeFields,
}: {
  initialDraft: ComposerDraft | null;
  openConfirm: boolean;
  previewOnly: boolean;
  initialPreview: PreviewState;
  opportunities: Option[];
  competitions: (Option & { opportunityId: string })[];
  programs: Option[];
  templates: { key: string; name: string; subject: string; bodyMd: string }[];
  mergeFields: MergeFieldOption[];
}) {
  const router = useRouter();
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const [segment, setSegment] = useState<SegmentValue>(initialDraft?.segment ?? EMPTY_SEGMENT);
  const [subject, setSubject] = useState(initialDraft?.subject ?? '');
  const [body, setBody] = useState(initialDraft?.bodyMd ?? '');
  const [templateKey, setTemplateKey] = useState<string | null>(initialDraft?.templateKey ?? null);
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});
  const snapshot = (s: SegmentValue, subj: string, b: string) => JSON.stringify([toSegmentInput(s), subj.trim(), b]);
  // What was last counted (the saved draft). Sending requires the form to still match it.
  const [counted, setCounted] = useState<{ key: string; count: number } | null>(
    initialDraft && (openConfirm || initialDraft.id) ? { key: snapshot(initialDraft.segment, initialDraft.subject, initialDraft.bodyMd), count: initialDraft.recipientCount } : null,
  );
  const [typed, setTyped] = useState('');
  const [changedNotice, setChangedNotice] = useState<string | null>(null);
  const [counting, startCount] = useTransition();
  const [sending, startSend] = useTransition();
  const [previewOpen, setPreviewOpen] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { insert, onFocusSubject, onFocusBody } = useTokenInsert({ subjectRef, bodyRef, subject, body, setSubject, setBody });
  const { preview, pending: previewPending, refresh } = useMessagePreview(initialPreview, subject, body, { delayMs: 1200 });

  const current = snapshot(segment, subject, body);
  const stale = counted !== null && counted.key !== current;
  const confirmOpen = counted !== null && !stale;
  const dirty = !previewOnly && (subject.trim() !== '' || body.trim() !== '') && (counted === null || stale);
  useUnsavedGuard(dirty);

  const stageOptions = useMemo(() => competitions.filter((c) => c.opportunityId === segment.opportunityId), [competitions, segment.opportunityId]);
  const grantees = isGranteeSegment(segment);
  const noFilters = Object.keys(toSegmentInput(segment)).length === 0;

  const setSeg = (patch: Partial<SegmentValue>) => setSegment((s) => ({ ...s, ...patch }));

  const count = (opts: { after?: 'precondition' } = {}) => {
    const e: { subject?: string; body?: string } = {};
    if (!subject.trim()) e.subject = 'Enter a subject line.';
    if (!body.trim()) e.body = 'Write the message.';
    setErrors(e);
    if (Object.keys(e).length) return;
    if (previewOnly) {
      setCounted({ key: current, count: initialDraft?.recipientCount ?? 0 });
      return;
    }
    startCount(async () => {
      const r = await draftBulkMessageAction({ bulkMessageId: draftId ?? undefined, subject: subject.trim(), bodyMd: body, segment: toSegmentInput(segment), templateKey: templateKey ?? undefined });
      if (!r.ok) {
        if (r.problem.code === 'conflict') {
          // The draft was sent elsewhere: start a fresh draft next time.
          setDraftId(null);
        }
        toast.error(r.problem.detail);
        return;
      }
      setDraftId(r.data.id);
      setCounted({ key: snapshot(segment, subject, body), count: r.data.recipientCount });
      setTyped('');
      if (opts.after !== 'precondition') setChangedNotice(null);
      if (!draftId) router.replace(`/console/comms/compose?draft=${r.data.id}`, { scroll: false });
      router.refresh();
    });
  };

  const send = () => {
    if (!counted) return;
    if (previewOnly || !draftId) {
      toast.info('This is a preview of the confirmation step. Nothing was sent.');
      return;
    }
    const n = counted.count;
    startSend(async () => {
      const r = await sendBulkMessageAction({ bulkMessageId: draftId, confirmRecipientCount: n });
      if (r.ok) {
        toast.success(`Sending to ${people(r.data.queued)}. Delivery results appear in the history below.`);
        setDraftId(null);
        setCounted(null);
        setTyped('');
        setSubject('');
        setBody('');
        setTemplateKey(null);
        setSegment(EMPTY_SEGMENT);
        router.replace('/console/comms/compose', { scroll: false });
        router.refresh();
        return;
      }
      if (r.problem.code === 'precondition_failed') {
        const now = typeof r.problem.recipientCount === 'number' ? r.problem.recipientCount : null;
        setChangedNotice(
          now === null
            ? 'The group changed since you counted. We’ve counted again — check the number and confirm.'
            : `The group changed since you counted: it now reaches ${people(now)}, not ${people(n)}. Check the filters and confirm the new number.`,
        );
        setTyped('');
        count({ after: 'precondition' });
        return;
      }
      if (r.problem.code === 'conflict') {
        setDraftId(null);
        setCounted(null);
        router.refresh();
      }
      toast.error(r.problem.detail);
    });
  };

  const expected = counted ? String(counted.count) : '';
  const typedOk = typed.trim().replace(/,/g, '') === expected;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Who gets this</CardTitle>
            <CardDescription>Combine filters to narrow the group. Each person gets the message once, even if they match more than one application.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Opportunity" htmlFor="seg-opp">
                <Select value={segment.opportunityId || ANY} onValueChange={(v) => setSeg({ opportunityId: v === ANY ? '' : v, competitionId: '' })}>
                  <SelectTrigger id="seg-opp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any opportunity</SelectItem>
                    {opportunities.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Stage" htmlFor="seg-stage" description={segment.opportunityId ? undefined : 'Choose an opportunity first.'}>
                <Select value={segment.competitionId || ANY} disabled={!segment.opportunityId || stageOptions.length === 0} onValueChange={(v) => setSeg({ competitionId: v === ANY ? '' : v })}>
                  <SelectTrigger id="seg-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Every stage</SelectItem>
                    {stageOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Program" htmlFor="seg-program">
                <Select value={segment.programId || ANY} onValueChange={(v) => setSeg({ programId: v === ANY ? '' : v })}>
                  <SelectTrigger id="seg-program">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any program</SelectItem>
                    {programs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <FieldSet legend="Application status" description="Applicants whose application is in any of these.">
                <div className="grid gap-1 sm:grid-cols-2">
                  {Object.entries(APPLICATION_STATUS).map(([value, meta]) => (
                    <CheckboxField
                      key={value}
                      id={`seg-app-${value}`}
                      label={meta.label}
                      checked={segment.applicationStatuses.includes(value)}
                      onCheckedChange={(v) => setSeg({ applicationStatuses: toggle(segment.applicationStatuses, value, v === true) })}
                    />
                  ))}
                </div>
              </FieldSet>
              <div className="grid content-start gap-5">
                <FieldSet legend="Award status" description="Grantee organization admins with an award in any of these.">
                  <div className="grid gap-1 sm:grid-cols-2">
                    {Object.entries(AWARD_STATUS).map(([value, meta]) => (
                      <CheckboxField
                        key={value}
                        id={`seg-award-${value}`}
                        label={meta.label}
                        checked={segment.awardStatuses.includes(value)}
                        onCheckedChange={(v) => setSeg({ awardStatuses: toggle(segment.awardStatuses, value, v === true) })}
                      />
                    ))}
                  </div>
                </FieldSet>
                <CheckboxField
                  id="seg-overdue"
                  label="Only grantees with overdue reports"
                  checked={segment.reportOverdue}
                  onCheckedChange={(v) => setSeg({ reportOverdue: v === true })}
                />
              </div>
            </div>
            {grantees ? (
              <Alert variant="info" title="Sending to grantees">
                Award status, overdue reports or a program on its own send to grantee organization admins. Opportunity, stage and application status filters don’t apply.
              </Alert>
            ) : noFilters ? (
              <Alert variant="warning" title="No filters chosen">
                This reaches everyone who has applied to any of your opportunities. Add a filter to narrow it.
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Message</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {templates.length ? (
              <Field label="Start from a template" htmlFor="msg-template" optional>
                <Select
                  value={templateKey ?? NO_TEMPLATE}
                  onValueChange={(v) => {
                    if (v === NO_TEMPLATE) {
                      setTemplateKey(null);
                      return;
                    }
                    const t = templates.find((x) => x.key === v);
                    if (!t) return;
                    setTemplateKey(t.key);
                    setSubject(t.subject);
                    setBody(t.bodyMd);
                    toast.success(`Filled in from “${t.name}”. Edit it as much as you like.`);
                  }}
                >
                  <SelectTrigger id="msg-template">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field label="Subject" htmlFor="msg-subject" required error={errors.subject}>
              <Input id="msg-subject" ref={subjectRef} value={subject} maxLength={300} onFocus={onFocusSubject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Message" htmlFor="msg-body" required error={errors.body} description="Markdown: **bold**, *italic*, [link text](https://…), and lists starting with “- ”.">
              <Textarea id="msg-body" ref={bodyRef} value={body} rows={12} className="min-h-64 font-mono text-[13px] leading-relaxed" onFocus={onFocusBody} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <MergeFieldPicker id="msg-merge" fields={mergeFields} onInsert={insert} />
            <UnknownTokens tokens={preview.tokens} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => count()} pending={counting} pendingLabel="Counting…">
                <Users aria-hidden="true" />
                {draftId ? 'Save draft & recount' : 'Save draft & count recipients'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  refresh();
                  setPreviewOpen(true);
                }}
              >
                <Eye aria-hidden="true" />
                Preview email
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="xl:sticky xl:top-4">
        <CardHeader>
          <CardTitle as="h2">Review and send</CardTitle>
          <CardDescription>Nothing goes out until you type the exact number of recipients.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {changedNotice ? (
            <Alert variant="warning" role="alert" title="The group changed">
              {changedNotice}
            </Alert>
          ) : null}
          {!counted ? (
            <p className="text-sm text-muted-foreground">Choose who gets this and write your message, then select “Save draft &amp; count recipients”.</p>
          ) : stale ? (
            <Alert variant="info" title="Count again before sending">
              You changed the message or the filters since the last count ({people(counted.count)}). Save the draft again to update it.
            </Alert>
          ) : counted.count === 0 ? (
            <Alert variant="warning" title="No one matches these filters">
              Loosen the filters, then count again.
            </Alert>
          ) : null}
          {confirmOpen && counted && counted.count > 0 ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (typedOk) send();
              }}
            >
              <p className="text-base" aria-live="polite">
                This message will be emailed to <strong className="tabular-nums">{people(counted.count)}</strong>
                {grantees ? ' (grantee organization admins)' : ' (applicants)'}. It can’t be unsent.
              </p>
              <Field label={`Type ${counted.count} to confirm`} htmlFor="confirm-count" description="This makes sure the number is what you expect.">
                <Input id="confirm-count" inputMode="numeric" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className="max-w-40 tabular-nums" />
              </Field>
              <div>
                <Button type="submit" variant="destructive" disabled={!typedOk} pending={sending} pendingLabel="Sending…">
                  <Send aria-hidden="true" />
                  Send to {people(counted.count)}
                </Button>
              </div>
              {previewOnly ? <p className="text-xs text-muted-foreground">Preview: this example uses a sample count. Nothing will be sent.</p> : null}
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Email preview</DialogTitle>
            <DialogDescription>How recipients will see it, with example values for merge fields.</DialogDescription>
          </DialogHeader>
          <EmailPreviewFrame preview={preview} pending={previewPending} onRefresh={refresh} height={560} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
