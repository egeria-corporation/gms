// SPDX-License-Identifier: AGPL-3.0-or-later
// D-03 Review an application: the application (read only through gms.reviewer_submission — blind fields
// masked on blind stages) on the left, the rubric in the side panel from 1024px (score, comments, private
// note, recommendation, live weighted score, save draft / submit) and panel notes.
// ?state= blind (blind banner + blind rendering) | submitted (read-only scores) | tablet (stacked single
// column: rubric below the application) | recused (recusal notice) | error
import { sql } from '@gms/db';
import { formatInZone, formatMoney, parseMoneyToCents } from '@gms/domain';
import { GmsForm } from '@gms/forms/react';
import { Alert, Button, DeadlineChip, DescriptionList, ErrorState, NotFoundState, PageHeader, StatusChip } from '@gms/ui';
import { EyeOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { compiledFromModel, isUuid, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { ReviewerFrame } from '../frame';
import { requireReviewer, type QueueRow } from '../guard';
import { ReviewerPanelNoteForm } from './panel-note-form';
import { ScoringPanel, type ScoringCriterion, type ScoringInitial } from './scoring-panel';

export const metadata: Metadata = { title: 'Review' };

interface SubmissionRow {
  application_id: string;
  submitted_at: string | null;
  responses: Record<string, unknown> | null;
  org_profile: Record<string, unknown> | null;
  blind: boolean;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

export default async function ReviewApplicationPage({ params, searchParams }: { params: Promise<{ assignmentId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireReviewer()]);
  const { assignmentId } = await params;
  const forced = forcedState(await searchParams);
  if (!isUuid(assignmentId)) notFound();
  const exit = { href: '/review', label: 'All assignments' };

  const row = await rls(async (trx) => (await sql<QueueRow>`select * from gms.reviewer_queue(${tenant.id}::uuid) where assignment_id = ${assignmentId}::uuid`.execute(trx)).rows[0] ?? null).catch(
    (err: unknown) => {
      console.error('[review] D-03 queue load failed', err);
      return undefined;
    },
  );
  if (row === undefined || forced === 'error') {
    return (
      <ReviewerFrame tenant={tenant} viewer={viewer} exit={exit}>
        <h1 className="sr-only">Review</h1>
        <ErrorState variant="page" description="We couldn’t load this assignment. Your saved scores are safe. Refresh to try again." />
      </ReviewerFrame>
    );
  }
  if (!row) {
    return (
      <ReviewerFrame tenant={tenant} viewer={viewer} exit={exit}>
        <h1 className="sr-only">Assignment not found</h1>
        <NotFoundState variant="page" title="We couldn’t find that assignment" description="It may have been reassigned. Go back to your assignments to see what’s left." />
      </ReviewerFrame>
    );
  }
  const title = row.application_title ?? row.reference_number;
  const context = `${row.stage_name} · ${row.opportunity_title}`;

  // Recused: never show application content.
  if (forced === 'recused' || row.status === 'recused' || row.has_conflict) {
    return (
      <ReviewerFrame tenant={tenant} viewer={viewer} exit={exit} context={context}>
        <PageHeader density="spacious" title={title} meta={<StatusChip kind="review" value="recused" />} />
        <Alert variant="info" title="You’re recused from this application">
          You declared a conflict of interest, so the application stays hidden and you can’t score it. The program officer will assign another reviewer.
        </Alert>
        <div className="mt-6">
          <Button asChild size="lg">
            <Link href="/review">Back to my assignments</Link>
          </Button>
        </div>
      </ReviewerFrame>
    );
  }
  if (!row.coi_declared && !forced) redirect(`/review/${row.assignment_id}/coi`);

  const data = await rls(async (trx) => {
    const [criteria, review, submission, notes, panels] = await Promise.all([
      row.rubric_id
        ? trx
            .selectFrom('rubric_criteria')
            .select(['id', 'label', 'guidance', 'weight_pct', 'scale_min', 'scale_max', 'scale_labels'])
            .where('rubric_id', '=', row.rubric_id)
            .where('workspace_id', '=', tenant.id)
            .orderBy('position')
            .execute()
        : Promise.resolve([]),
      trx.selectFrom('reviews').select(['id', 'status', 'overall_comment', 'private_note', 'recommendation', 'submitted_at']).where('assignment_id', '=', row.assignment_id).where('workspace_id', '=', tenant.id).executeTakeFirst(),
      sql<SubmissionRow>`select * from gms.reviewer_submission(${row.application_id}::uuid)`.execute(trx),
      trx
        .selectFrom('panel_notes as n')
        .leftJoin('profiles as p', 'p.id', 'n.author_id')
        .select(['n.id', 'n.body', 'n.created_at', 'n.author_id', 'p.full_name'])
        .where('n.application_id', '=', row.application_id)
        .where('n.workspace_id', '=', tenant.id)
        .orderBy('n.created_at')
        .execute(),
      trx.selectFrom('panels').select(['id', 'name', 'status']).where('stage_id', '=', row.stage_id).where('workspace_id', '=', tenant.id).where('status', '=', 'live').execute(),
    ]);
    const scores = review ? await trx.selectFrom('review_scores').select(['criterion_id', 'score', 'comment']).where('review_id', '=', review.id).execute() : [];
    const sub = submission.rows[0] ?? null;
    const formIds = sub && isObj(sub.responses) ? Object.keys(sub.responses).filter(isUuid) : [];
    // The exact form version each answer set was written against (gms.reviewer_form_versions); fall back
    // to the published (else latest) version of each form in the snapshot.
    const pinned = formIds.length ? (await sql<{ form_id: string; form_version_id: string }>`select * from gms.reviewer_form_versions(${row.application_id}::uuid)`.execute(trx)).rows : [];
    const versions = formIds.length
      ? await trx
          .selectFrom('form_versions')
          .select(['id', 'form_id', 'version', 'status', 'builder_model'])
          .where('workspace_id', '=', tenant.id)
          .where('form_id', 'in', formIds)
          .orderBy('version', 'desc')
          .execute()
      : [];
    return { criteria, review, sub, notes, panels, scores, versions, formIds, pinned };
  }).catch((err: unknown) => {
    console.error('[review] D-03 load failed', err);
    return null;
  });

  if (!data) {
    return (
      <ReviewerFrame tenant={tenant} viewer={viewer} exit={exit} context={context}>
        <h1 className="sr-only">{title}</h1>
        <ErrorState variant="page" description="We couldn’t load this application. Your saved scores are safe. Refresh to try again." />
      </ReviewerFrame>
    );
  }

  const blind = forced === 'blind' || row.blind || Boolean(data.sub?.blind);
  const submitted = forced === 'submitted' || row.status === 'submitted' || data.review?.status === 'submitted';
  const closed = row.stage_status === 'closed';
  const tablet = forced === 'tablet';

  const forms = data.formIds
    .map((formId) => {
      const candidates = data.versions.filter((v) => v.form_id === formId);
      const pinnedId = data.pinned.find((p) => p.form_id === formId)?.form_version_id;
      const v = candidates.find((x) => x.id === pinnedId) ?? candidates.find((x) => x.status === 'published') ?? candidates[0];
      const compiled = v ? compiledFromModel(v.id, v.builder_model) : null;
      const answers = data.sub && isObj(data.sub.responses) && isObj(data.sub.responses[formId]) ? (data.sub.responses[formId] as Record<string, unknown>) : {};
      return compiled ? { formId, compiled, answers } : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  const criteria: ScoringCriterion[] = data.criteria.map((c) => ({
    id: c.id,
    label: c.label,
    guidance: c.guidance,
    weightPct: Number(c.weight_pct),
    scaleMin: c.scale_min,
    scaleMax: c.scale_max,
    scaleLabels: Object.fromEntries(Object.entries(isObj(c.scale_labels) ? c.scale_labels : {}).map(([k, v]) => [k, String(v)])),
  }));
  const initial: ScoringInitial = {
    scores: Object.fromEntries(data.scores.map((s) => [s.criterion_id, { score: Number(s.score), comment: s.comment }])),
    overallComment: data.review?.overall_comment ?? '',
    privateNote: data.review?.private_note ?? '',
    recommendation: (data.review?.recommendation as ScoringInitial['recommendation']) ?? null,
  };

  // Organization summary (never on blind stages).
  const org = !blind && data.sub && isObj(data.sub.org_profile) && isObj(data.sub.org_profile.organization) ? data.sub.org_profile.organization : null;
  const budget = org && isObj(org.annualBudget) ? org.annualBudget : null;
  const budgetText = (() => {
    if (!budget) return null;
    try {
      return formatMoney(parseMoneyToCents(String(budget.amount ?? '')), str(budget.currency) ?? 'USD');
    } catch {
      return null;
    }
  })();

  const panelId = data.panels[0]?.id ?? null;
  const rubric = (
    <div className="grid gap-8">
      <ScoringPanel
        key={`${data.review?.id ?? 'new'}-${data.review?.status ?? ''}-${submitted}`}
        assignmentId={row.assignment_id}
        criteria={criteria}
        initial={initial}
        readOnly={submitted || closed}
        readOnlyReason={
          submitted
            ? `Submitted${data.review?.submitted_at ? ` ${formatInZone(data.review.submitted_at, tenant.timezone)}` : ''}. Ask the program officer if you need to change it.`
            : closed
              ? 'This review stage is closed, so scores can’t change.'
              : undefined
        }
      />
      <section aria-labelledby="panel-notes" className="grid gap-3 border-t pt-6">
        <h2 id="panel-notes" className="font-heading text-lg font-semibold">
          Panel notes
        </h2>
        {data.notes.length ? (
          <ul className="grid gap-2">
            {data.notes.map((n) => (
              <li key={n.id} className="rounded-md bg-muted/50 p-3 text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {n.author_id === viewer.userId ? 'You' : (n.full_name ?? 'Panel member')} · {formatInZone(n.created_at, tenant.timezone)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No panel notes yet.</p>
        )}
        {!closed ? <ReviewerPanelNoteForm assignmentId={row.assignment_id} applicationId={row.application_id} panelId={panelId} /> : null}
      </section>
    </div>
  );

  return (
    <ReviewerFrame
      tenant={tenant}
      viewer={viewer}
      exit={exit}
      context={context}
      progress={<StatusChip kind="review" value={submitted ? 'submitted' : row.status} />}
      aside={tablet ? undefined : rubric}
      asideLabel="Rubric and scoring"
    >
      <PageHeader
        density="spacious"
        title={title}
        description={blind ? `${row.reference_number} · Identity hidden (blind review)` : `${row.organization_name ?? 'Applicant'} · ${row.reference_number}`}
        meta={row.due_at && !submitted ? <DeadlineChip at={row.due_at} timeZone={tenant.timezone} pastLabel="Was due" /> : null}
      />
      <div className="grid gap-8">
        {blind ? (
          <Alert variant="info" icon={<EyeOff />} title="Blind review">
            Names, contact details, tax IDs, signatures and attachment file names are hidden. The applicant’s own answers may still mention who they are: score only what you can see, and don’t try to identify the applicant.
          </Alert>
        ) : null}
        {submitted ? (
          <Alert variant="success" title="You submitted this review">
            Your scores are below{tablet ? '' : ' and in the side panel'}. A program officer can reopen it if something needs to change.
          </Alert>
        ) : null}

        {org ? (
          <section aria-labelledby="org-heading" className="grid gap-3">
            <h2 id="org-heading" className="font-heading text-xl font-semibold">
              Organization
            </h2>
            <DescriptionList
              items={[
                { term: 'Name', detail: str(org.name) },
                { term: 'Mission', detail: str(org.mission) },
                { term: 'Website', detail: str(org.website) },
                { term: 'Annual budget', detail: budgetText, numeric: true },
                { term: 'Counties served', detail: Array.isArray(org.counties) ? org.counties.map(String).join(', ') : null },
              ]}
            />
          </section>
        ) : null}

        {!data.sub ? (
          <Alert variant="warning" title="The application isn’t available">
            We couldn’t find a submitted version of this application. Ask the program officer to check it.
          </Alert>
        ) : forms.length ? (
          forms.map((f) => (
            <section key={f.formId} aria-label={f.compiled.title} className="grid gap-4">
              <GmsForm compiled={f.compiled} data={f.answers} mode={blind ? 'blind' : 'review'} idPrefix={`f-${f.formId.slice(0, 8)}-`} headingLevel={2} />
            </section>
          ))
        ) : (
          <Alert variant="warning" title="We couldn’t display the answers">
            The form for this application couldn’t be loaded. Ask the program officer for a PDF copy.
          </Alert>
        )}

        {tablet ? <div className="border-t pt-8">{rubric}</div> : null}
      </div>
    </ReviewerFrame>
  );
}
