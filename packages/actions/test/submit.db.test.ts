// SPDX-License-Identifier: AGPL-3.0-or-later
// Regression: actions that read agent_policies under RLS must never select llm_key_ref (gms_authenticated has no
// column grant on it), or Postgres answers 42501 and every submission / policy update fails as "forbidden".
import { randomUUID } from 'node:crypto';
import { asUser, createTestDatabase, createUser, type TestDatabase, type TestUser } from '@gms/db/testing';
import { compileForm, defineForm } from '@gms/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRuntime, type ActionContext, type Runtime, type WorkspaceRef } from '../src';

let t: TestDatabase;
let runtime: Runtime;
let ws: WorkspaceRef;
let owner: TestUser;
let applicant: TestUser;
let competitionId: string;
let formId: string;

const FORM = defineForm({
  version: 1,
  title: 'Short application',
  pages: [
    {
      id: 'project',
      title: 'Your project',
      elements: [
        { id: 'project_title', type: 'text', label: 'Project title', required: true },
        { id: 'project_summary', type: 'long_text', label: 'Summary', required: true },
      ],
    },
  ],
});

function ctxFor(user: TestUser, roles: ActionContext['roles'] = []): ActionContext {
  return {
    workspace: ws,
    actor: { type: 'human', id: user.id, name: user.name },
    roles,
    scopes: '*',
    claims: { role: 'authenticated', sub: user.id, email: user.email, aal: 'aal1' },
    aal: 'aal1',
    requestId: randomUUID(),
    channel: 'test',
  };
}

beforeAll(async () => {
  // The runtime's adapters use the test auth adapter (never in production builds).
  process.env.GMS_AUTH_MODE ??= 'test';
  t = await createTestDatabase('gms_submit');
  const db = t.db;
  runtime = createRuntime({ db });
  owner = await createUser(db, { name: 'Olive Owner' });
  applicant = await createUser(db, { name: 'Maya Chen' });
  ws = await db
    .insertInto('workspaces')
    .values({ slug: 'submitws', name: 'Test Foundation' })
    .returning(['id', 'slug', 'name', 'timezone'])
    .executeTakeFirstOrThrow();
  await db.insertInto('workspace_members').values({ workspace_id: ws.id, user_id: owner.id, role: 'owner' }).execute();
  // A key reference is set, as it would be once a foundation connects a model provider.
  await db.updateTable('agent_policies').set({ ai_use: 'disclosure', llm_key_ref: 'secret://llm/test' }).where('workspace_id', '=', ws.id).execute();

  const day = 86400_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  const program = await db.insertInto('programs').values({ workspace_id: ws.id, name: 'Arts', slug: 'arts' }).returning('id').executeTakeFirstOrThrow();
  const opp = await db
    .insertInto('opportunities')
    .values({
      workspace_id: ws.id,
      program_id: program.id,
      slug: 'arts-fund',
      title: 'Arts Fund',
      status: 'open',
      opens_at: iso(-day),
      closes_at: iso(30 * day),
      published_at: iso(-day),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  competitionId = (
    await db
      .insertInto('competitions')
      .values({ workspace_id: ws.id, opportunity_id: opp.id, name: 'Full application', status: 'open', opens_at: iso(-day), closes_at: iso(30 * day) })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  const compiled = compileForm(FORM);
  formId = (await db.insertInto('forms').values({ workspace_id: ws.id, name: FORM.title }).returning('id').executeTakeFirstOrThrow()).id;
  const version = await db
    .insertInto('form_versions')
    .values({
      workspace_id: ws.id,
      form_id: formId,
      version: 1,
      status: 'published',
      published_at: iso(-day),
      builder_model: JSON.stringify(FORM),
      json_schema: JSON.stringify(compiled.jsonSchema),
      ui_schema: JSON.stringify(compiled.uiSchema),
      mapping_to_cg: JSON.stringify(compiled.mappingToCg),
      mapping_from_cg: JSON.stringify(compiled.mappingFromCg),
      field_meta: JSON.stringify(compiled.fieldMeta),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db.updateTable('forms').set({ current_version_id: version.id }).where('id', '=', formId).execute();
  await db.insertInto('competition_forms').values({ workspace_id: ws.id, competition_id: competitionId, form_id: formId, form_version_id: version.id }).execute();
});

afterAll(async () => {
  await t?.drop();
});

describe('agent_policies reads under RLS', () => {
  it('gms_authenticated still cannot read llm_key_ref', async () => {
    await expect(
      asUser(t.db, applicant, (trx) => trx.selectFrom('agent_policies').select('llm_key_ref').where('workspace_id', '=', ws.id).execute()),
    ).rejects.toThrow(/permission denied/);
  });

  it('lets a person submit an application', async () => {
    const ex = runtime.executor;
    const started = await ex.run<{ applicationId: string }>('applications.start', { competitionId }, ctxFor(applicant));
    const saved = await ex.run<{ errors: unknown[] }>(
      'applications.save_answers',
      { applicationId: started.applicationId, formId, answers: { project_title: 'Murals on Main', project_summary: 'Teens paint a mural with working artists.' } },
      ctxFor(applicant),
    );
    expect(saved.errors).toEqual([]);
    const submitted = await ex.execute<{ status: string; receiptNumber: string }>(
      'applications.submit',
      { applicationId: started.applicationId, attestation: { typedName: 'Maya Chen', agreed: true }, aiDisclosure: 'No AI tools were used.' },
      ctxFor(applicant),
    );
    expect(submitted.status).toBe('ok');
    if (submitted.status === 'ok') expect(submitted.output.status).toBe('submitted');
    const row = await t.db.selectFrom('applications').select(['submitted_at']).where('id', '=', started.applicationId).executeTakeFirstOrThrow();
    expect(row.submitted_at).not.toBeNull();
  });

  it('lets an owner update the AI-use policy', async () => {
    await runtime.executor.run(
      'agents.update_policy',
      { aiUse: 'allowed', reviewerAssist: true, agentSubmissionsEnabled: true, mcpEnabled: true, a2aEnabled: false },
      ctxFor(owner, ['owner']),
    );
    const p = await t.db.selectFrom('agent_policies').select(['ai_use', 'a2a_enabled', 'llm_key_ref']).where('workspace_id', '=', ws.id).executeTakeFirstOrThrow();
    expect(p).toEqual({ ai_use: 'allowed', a2a_enabled: false, llm_key_ref: 'secret://llm/test' });
  });
});
