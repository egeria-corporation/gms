// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Grantee CRM editors: relationship profile (tags, owner, summary → grantees.update_profile) and recording a
// site visit (grantees.record_site_visit).
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@gms/ui';
import { CalendarPlus, Save, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { problemMessage } from '../run-action';
import { recordSiteVisitAction, updateGranteeProfileAction } from './actions';

const NONE = 'none';

export function GranteeProfileEditor({
  orgId,
  tags: initialTags,
  ownerId,
  summary: initialSummary,
  team,
  canEdit,
}: {
  orgId: string;
  tags: string[];
  ownerId: string | null;
  summary: string | null;
  team: { id: string; name: string; role: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState('');
  const [owner, setOwner] = useState<string>(ownerId ?? NONE);
  const [summary, setSummary] = useState(initialSummary ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const addDraft = () => {
    const next = draft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (next.some((t) => t.length > 40)) {
      setError('Keep each tag to 40 characters or fewer.');
      return;
    }
    setTags((t) => [...new Set([...t, ...next])].slice(0, 30));
    setDraft('');
    setError(null);
  };
  const dirty = tags.join('|') !== initialTags.join('|') || (owner === NONE ? null : owner) !== ownerId || summary !== (initialSummary ?? '');
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateGranteeProfileAction({ applicantOrgId: orgId, tags, relationshipOwnerId: owner === NONE ? null : owner, summary: summary.trim() || null });
          if (r.ok) {
            toast.success('Relationship profile saved.');
            router.refresh();
          } else setError(problemMessage(r.problem));
        });
      }}
    >
      <div className="grid gap-1.5">
        <span className="text-sm font-medium" id="gp-tags-label">
          Tags
        </span>
        {tags.length ? (
          <ul className="flex flex-wrap gap-1" aria-labelledby="gp-tags-label">
            {tags.map((t) => (
              <li key={t}>
                <Badge variant="outline" className="gap-0.5 pr-0.5">
                  {t}
                  {canEdit ? (
                    <button type="button" className="grid size-5 place-items-center rounded-sm hover:bg-muted" aria-label={`Remove tag ${t}`} onClick={() => setTags((x) => x.filter((y) => y !== t))}>
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No tags.</p>
        )}
      </div>
      {canEdit ? (
        <Field label="Add tags" htmlFor="gp-tag" description="Comma-separated. Staff-only; applicants never see tags.">
          <div className="flex gap-2">
            <Input
              id="gp-tag"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDraft();
                }
              }}
            />
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={addDraft}>
              Add
            </Button>
          </div>
        </Field>
      ) : null}
      <Field label="Relationship owner" htmlFor="gp-owner">
        <Select value={owner} onValueChange={setOwner} disabled={!canEdit}>
          <SelectTrigger id="gp-owner">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Unassigned</SelectItem>
            {team.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name} ({m.role.replace(/_/g, ' ')})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Relationship summary" htmlFor="gp-summary" optional error={error ?? undefined}>
        <Textarea id="gp-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={5000} readOnly={!canEdit} />
      </Field>
      {canEdit ? (
        <div>
          <Button type="submit" size="sm" disabled={!dirty} pending={pending} pendingLabel="Saving…">
            <Save aria-hidden="true" /> Save profile
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function SiteVisitDialog({ orgId, awards, today }: { orgId: string; awards: { id: string; label: string }[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [visitedOn, setVisitedOn] = useState(today);
  const [awardId, setAwardId] = useState(NONE);
  const [summary, setSummary] = useState('');
  const [followUps, setFollowUps] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarPlus aria-hidden="true" /> Record a site visit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a site visit</DialogTitle>
          <DialogDescription>Site visits are staff-only and appear on this grantee’s timeline.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(visitedOn) || !summary.trim()) {
              setError('Give the visit date and a summary.');
              return;
            }
            setError(null);
            start(async () => {
              const r = await recordSiteVisitAction({ applicantOrgId: orgId, awardId: awardId === NONE ? null : awardId, visitedOn, summary: summary.trim(), followUps });
              if (r.ok) {
                toast.success('Site visit recorded.');
                setOpen(false);
                setSummary('');
                setFollowUps('');
                router.refresh();
              } else setError(problemMessage(r.problem));
            });
          }}
        >
          <Field label="Visit date" htmlFor="sv-date" required>
            <Input id="sv-date" type="date" value={visitedOn} max={today} onChange={(e) => setVisitedOn(e.target.value)} />
          </Field>
          {awards.length ? (
            <Field label="Related award" htmlFor="sv-award" optional>
              <Select value={awardId} onValueChange={setAwardId}>
                <SelectTrigger id="sv-award">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not about a specific award</SelectItem>
                  {awards.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="Summary" htmlFor="sv-summary" required>
            <Textarea id="sv-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={10000} />
          </Field>
          <Field label="Follow-ups" htmlFor="sv-follow" optional error={error ?? undefined}>
            <Textarea id="sv-follow" rows={3} value={followUps} onChange={(e) => setFollowUps(e.target.value)} maxLength={5000} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              Record visit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
