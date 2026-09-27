// SPDX-License-Identifier: AGPL-3.0-only
// E2E flow 4 precondition, run with tsx by flow4-payments.spec.ts (a separate process: generating the agreement
// renders a React PDF). Through the real action layer it creates a fresh grantee organization, submits an LOI for
// it, awards it with one installment, activates the award, and has the agreement signed and countersigned; then it
// delivers the outbox events (the worker's job), so signing invites the grantee to bank onboarding. Prints the
// result as one JSON line.
import { randomUUID } from 'node:crypto';
import { getRuntime } from '@gms/actions';
import { sql } from '@gms/db';
import { LOI_VALID_RESPONSE } from '@gms/forms';
import { drainOutbox } from '@gms/worker/outbox';

const MAYA = 'maya@eastside-youth-music.example';
const JORDAN = 'jordan@halcyonridge.example';
const HELEN = 'helen@halcyonridge.example';
const PRIYA = 'priya@halcyonridge.example';
/** Marks this flow's awards, so leftovers from an interrupted run can be found. */
const PURPOSE = 'E2E flow 4 — payments';

/** A tiny, valid one-page PDF (the LOI's budget attachment). */
const PDF = ['%PDF-1.4', '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj', '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj', '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj', 'trailer<</Root 1 0 R>>', '%%EOF'].join(String.fromCharCode(10));

type Role = 'owner' | 'program_officer' | 'finance';

async function main() {
  const rt = getRuntime();
  const ex = rt.executor;
  const ws = await rt.db.selectFrom('workspaces').select(['id', 'slug', 'name', 'timezone']).where('slug', '=', 'halcyon').executeTakeFirstOrThrow();
  const person = (email: string) => rt.db.selectFrom('profiles').select(['id', 'email', 'full_name']).where('email', '=', email).executeTakeFirstOrThrow();
  const [maya, jordan, helen, priya] = await Promise.all([person(MAYA), person(JORDAN), person(HELEN), person(PRIYA)]);
  const as = (p: { id: string; email: string; full_name: string | null }, roles: Role[]) => ({
    workspace: ws,
    actor: { type: 'human' as const, id: p.id, name: p.full_name ?? p.email },
    roles,
    scopes: '*' as const,
    claims: { role: 'authenticated' as const, sub: p.id, email: p.email, aal: 'aal2' as const },
    aal: 'aal2' as const,
    stepUpAt: new Date().toISOString(),
    requestId: randomUUID(),
    channel: 'test' as const,
  });

  // A due date earlier than every seeded installment, so this run's installment is the only one due by then.
  const dueDate = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const earliest = await sql<{ due: string | null }>`
    select min(i.due_date)::text as due from public.installments i join public.awards a on a.id = i.award_id
     where a.workspace_id = ${ws.id}::uuid and i.status = 'scheduled' and a.purpose is distinct from ${PURPOSE}`.execute(rt.db);
  const due = earliest.rows[0]?.due;
  if (due && due <= dueDate) throw new Error(`A seeded installment is due ${due}; flow 4 needs its own date (${dueDate}) to be the earliest.`);

  // Leftovers from an interrupted run: put them on hold so they can't join this run's batch.
  const leftovers = await sql<{ id: string }>`
    select distinct a.id from public.awards a join public.installments i on i.award_id = a.id
     where a.workspace_id = ${ws.id}::uuid and a.purpose = ${PURPOSE} and not a.on_hold and i.status = 'scheduled'
       and not exists (select 1 from public.payments p where p.installment_id = i.id and p.status not in ('failed', 'cancelled'))`.execute(rt.db);
  for (const l of leftovers.rows) await ex.run('awards.set_hold', { awardId: l.id, onHold: true, reason: 'Left over from an interrupted E2E run.' }, as(priya, ['finance']));

  // The grantee: Maya sets up a new organization and submits the Youth Arts LOI for it.
  const suffix = String(Date.now() % 10_000_000).padStart(7, '0');
  const orgName = `Juniper Row Youth Choir ${suffix.slice(-4)}`;
  const ein = `47-${suffix}`;
  const org = await ex.run<{ id: string }>('orgs.create', { legalName: orgName, ein, orgType: 'nonprofit_501c3', annualBudgetCents: 36_000_000, counties: ['Alder'] }, as(maya, []));
  const comp = await rt.db
    .selectFrom('competitions as c')
    .innerJoin('opportunities as o', 'o.id', 'c.opportunity_id')
    .select('c.id')
    .where('o.slug', '=', 'e2e-youth-arts-loi')
    .executeTakeFirst();
  if (!comp) throw new Error('The E2E opportunity is created by e2e/global-setup.ts');
  const { applicationId } = await ex.run<{ applicationId: string }>('applications.start', { competitionId: comp.id, applicantOrgId: org.id }, as(maya, []));
  const response = () => rt.db.selectFrom('form_responses').select(['form_id', 'etag']).where('application_id', '=', applicationId).executeTakeFirstOrThrow();
  const r0 = await response();
  const { budget_file: _file, attestation: _att, ...answers } = LOI_VALID_RESPONSE as Record<string, unknown>;
  await ex.run('applications.save_answers', { applicationId, formId: r0.form_id, etag: r0.etag, answers: { ...answers, org_legal_name: orgName, org_ein: ein } }, as(maya, []));
  const upload = await ex.run<{ attachmentId: string }>(
    'applications.request_upload',
    { applicationId, formId: r0.form_id, fieldId: 'budget_file', fileName: 'choir-budget.pdf', contentType: 'application/pdf', sizeBytes: PDF.length },
    as(maya, []),
  );
  // The browser's PUT to the signed upload URL, made straight to the storage adapter.
  const att = await rt.db.selectFrom('attachments').select('storage_path').where('id', '=', upload.attachmentId).executeTakeFirstOrThrow();
  await rt.deps.storage.put('applications', att.storage_path, new TextEncoder().encode(PDF), 'application/pdf');
  await ex.run('applications.confirm_upload', { attachmentId: upload.attachmentId }, as(maya, []));
  const r1 = await response();
  await ex.run('applications.save_answers', { applicationId, formId: r1.form_id, etag: r1.etag, answers: { attestation: { agreed: true, name: 'Maya Chen' } } }, as(maya, []));
  await ex.run('applications.submit', { applicationId, attestation: { typedName: 'Maya Chen', agreed: true }, aiDisclosure: 'No AI tools were used.' }, as(maya, []));

  // The award: Jordan approves it with one installment, activates it and sends the agreement; Maya signs; Helen
  // countersigns (which clears "Agreement pending").
  const amountCents = 700_000 + (Number(suffix) % 1000) * 100; // a distinct dollar amount per run
  const { awardId } = await ex.run<{ awardId: string }>('decisions.record_final', { applicationId, outcome: 'approve', amountCents, sendLetter: false }, as(jordan, ['program_officer']));
  await ex.run('awards.draft', { applicationId, amountCents, purpose: PURPOSE, installments: [{ dueDate, amountCents, condition: 'On signed agreement' }] }, as(jordan, ['program_officer']));
  await ex.run('awards.activate', { awardId }, as(jordan, ['program_officer']));
  const agreement = await ex.run<{ agreementId: string; documentHash: string }>('agreements.generate', { awardId }, as(jordan, ['program_officer']));
  await ex.run('agreements.send', { agreementId: agreement.agreementId }, as(jordan, ['program_officer']));
  await ex.run('agreements.sign', { agreementId: agreement.agreementId, typedName: 'Maya Chen', agree: true, documentHash: agreement.documentHash }, as(maya, []));
  await ex.run('agreements.countersign', { agreementId: agreement.agreementId, typedName: 'Helen Ortiz', agree: true }, as(helen, ['owner']));

  // Deliver the events (the worker's job): the signed agreement invites the grantee to bank onboarding.
  for (let i = 0; i < 20 && (await drainOutbox(rt)) > 0; i++) {
    /* keep draining: handlers emit follow-up events */
  }
  const award = await rt.db.selectFrom('awards').select('reference').where('id', '=', awardId).executeTakeFirstOrThrow();
  process.stdout.write(`\n${JSON.stringify({ awardId, reference: award.reference, orgName, amountCents, dueDate, suffix })}\n`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
