// SPDX-License-Identifier: AGPL-3.0-or-later
// Form builder backend: drafts, compile + lint on save, immutable published versions,
// migration of in-progress applications to a new version, templates, question bank, CommonGrants import.
import { randomUUID } from 'node:crypto';
import { compileForm, diffVersions, FormModelSchema, importCommonGrantsForm, lintForm, migrationNotice } from '@gms/forms';
import { DomainError } from '@gms/domain';
import { z } from 'zod';
import { defineAction } from '../define';
import { found, IdOut, json, Ok, uid, uuid, ws } from './lib';

const PROGRAM_ROLES = ['owner', 'admin', 'program_officer'] as const;
const Kind = z.enum(['application', 'loi', 'report', 'eligibility', 'other']);

function compileOrThrow(model: unknown) {
  const parsed = FormModelSchema.safeParse(model);
  if (!parsed.success) {
    throw new DomainError(
      'validation_failed',
      'The form definition is not valid.',
      {},
      parsed.error.issues.map((i) => ({ pointer: '/' + i.path.join('/'), message: i.message })),
    );
  }
  return { model: parsed.data, compiled: compileForm(parsed.data) };
}

export const createForm = defineAction({
  id: 'forms.create',
  title: 'Create a form',
  description: 'Creates a form with a first draft version, from scratch, a template, or a builder model.',
  input: z.object({ name: z.string().trim().min(1).max(200), kind: Kind.default('application'), description: z.string().max(2000).optional().nullable(), templateId: uuid.optional(), model: z.unknown().optional() }),
  output: z.object({ formId: z.string().uuid(), versionId: z.string().uuid() }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    let model: unknown = input.model ?? { version: 1, title: input.name, pages: [{ id: 'page_1', title: 'Page 1', elements: [] }] };
    if (input.templateId) {
      const t = found(await ctx.db.selectFrom('form_templates').select(['builder_model']).where('id', '=', input.templateId).executeTakeFirst(), 'template');
      model = { ...(t.builder_model as object), title: input.name };
    }
    const { model: m, compiled } = compileOrThrow(model);
    const formId = randomUUID();
    const versionId = randomUUID();
    await ctx.db.insertInto('forms').values({ id: formId, workspace_id: w.id, name: input.name, kind: input.kind, description: input.description ?? null, created_by: uid(ctx) }).execute();
    await ctx.db
      .insertInto('form_versions')
      .values({
        id: versionId,
        workspace_id: w.id,
        form_id: formId,
        version: 1,
        status: 'draft',
        builder_model: json(m),
        json_schema: json(compiled.jsonSchema),
        ui_schema: json(compiled.uiSchema),
        mapping_to_cg: json(compiled.mappingToCg),
        mapping_from_cg: json(compiled.mappingFromCg),
        field_meta: json(compiled.fieldMeta),
        created_by: uid(ctx),
      })
      .execute();
    ctx.audit({ entityType: 'form', entityId: formId, after: { name: input.name, kind: input.kind, fromTemplate: input.templateId ?? null } });
    return { formId, versionId };
  },
});

export const saveFormDraft = defineAction({
  id: 'forms.save_draft',
  title: 'Save a form draft',
  description: 'Saves the builder model of a draft form version; compiles it to JSON Schema / UI Schema and returns lint results. Published versions cannot change.',
  input: z.object({ versionId: uuid, model: z.unknown(), expectedLastModifiedAt: z.string().optional() }),
  output: z.object({ lastModifiedAt: z.string(), lint: z.array(z.object({ level: z.string(), code: z.string(), message: z.string(), fieldId: z.string().optional() })) }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const v = found(await ctx.db.selectFrom('form_versions').selectAll().where('id', '=', input.versionId).executeTakeFirst(), 'form version');
    if (v.status !== 'draft') throw new DomainError('conflict', 'This version is published and cannot change. Create a new version to edit.');
    if (input.expectedLastModifiedAt && input.expectedLastModifiedAt !== v.last_modified_at) {
      throw new DomainError('precondition_failed', 'Someone else saved this form. Reload to see their changes.');
    }
    const { model, compiled } = compileOrThrow(input.model);
    const r = await ctx.db
      .updateTable('form_versions')
      .set({
        builder_model: json(model),
        json_schema: json(compiled.jsonSchema),
        ui_schema: json(compiled.uiSchema),
        mapping_to_cg: json(compiled.mappingToCg),
        mapping_from_cg: json(compiled.mappingFromCg),
        field_meta: json(compiled.fieldMeta),
      })
      .where('id', '=', v.id)
      .returning('last_modified_at')
      .executeTakeFirstOrThrow();
    const lint = lintForm(model).map((l) => ({ level: l.level, code: l.code, message: l.message, ...(l.fieldId ? { fieldId: l.fieldId } : {}) }));
    ctx.audit({ entityType: 'form_version', entityId: v.id, after: { pages: model.pages.length } });
    return { lastModifiedAt: r.last_modified_at, lint };
  },
});

export const publishFormVersion = defineAction({
  id: 'forms.publish',
  title: 'Publish a form version',
  description:
    'Publishes a draft form version (immutable from then on). Stages using this form switch to the new version; in-progress applications move to it (answers with the same field ids carry over). Blocked when the linter reports errors.',
  input: z.object({ versionId: uuid, changeNote: z.string().max(1000).optional() }),
  output: z.object({ version: z.number(), migratedApplications: z.number(), notice: z.string() }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R2',
  idempotent: true,
  async run(input, ctx) {
    const v = found(await ctx.db.selectFrom('form_versions').selectAll().where('id', '=', input.versionId).executeTakeFirst(), 'form version');
    if (v.status !== 'draft') throw new DomainError('conflict', 'This version is already published.');
    const { model } = compileOrThrow(v.builder_model);
    const errors = lintForm(model).filter((l) => l.level === 'error');
    if (errors.length) throw new DomainError('validation_failed', 'Fix the form checker errors before publishing.', {}, errors.map((e) => ({ pointer: `/fields/${e.fieldId ?? ''}`, message: e.message })));
    const form = await ctx.db.selectFrom('forms').selectAll().where('id', '=', v.form_id).executeTakeFirstOrThrow();
    const prev = form.current_version_id ? await ctx.db.selectFrom('form_versions').select(['id', 'builder_model']).where('id', '=', form.current_version_id).executeTakeFirst() : undefined;
    const now = ctx.now().toISOString();
    await ctx.db.updateTable('form_versions').set({ status: 'published', published_at: now, published_by: uid(ctx), change_note: input.changeNote ?? null }).where('id', '=', v.id).execute();
    if (prev) await ctx.db.updateTable('form_versions').set({ status: 'retired' }).where('id', '=', prev.id).where('status', '=', 'published').execute();
    await ctx.db.updateTable('forms').set({ current_version_id: v.id }).where('id', '=', form.id).execute();
    await ctx.db.updateTable('competition_forms').set({ form_version_id: v.id }).where('form_id', '=', form.id).execute();
    const migrated = await ctx.db
      .updateTable('form_responses')
      .set({ form_version_id: v.id })
      .where('form_id', '=', form.id)
      .where('form_version_id', '!=', v.id)
      .where('application_id', 'in', (eb) => eb.selectFrom('applications').select('id').where('status', '=', 'in_progress'))
      .executeTakeFirst();
    const notice = prev ? migrationNotice(FormModelSchema.parse(prev.builder_model), model).summary : 'First published version.';
    ctx.audit({ entityType: 'form_version', entityId: v.id, before: { status: 'draft' }, after: { status: 'published', version: v.version, migrated: Number(migrated.numUpdatedRows ?? 0) } });
    ctx.emit('form.published', { type: 'form', id: form.id }, { versionId: v.id, version: v.version, notice });
    return { version: v.version, migratedApplications: Number(migrated.numUpdatedRows ?? 0), notice };
  },
});

export const newFormVersion = defineAction({
  id: 'forms.new_version',
  title: 'Start a new form version',
  description: 'Creates a new draft version copied from the latest version so a published form can be edited safely.',
  input: z.object({ formId: uuid }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const latest = found(await ctx.db.selectFrom('form_versions').selectAll().where('form_id', '=', input.formId).orderBy('version', 'desc').executeTakeFirst(), 'form');
    if (latest.status === 'draft') return { id: latest.id };
    const id = randomUUID();
    await ctx.db
      .insertInto('form_versions')
      .values({
        id,
        workspace_id: w.id,
        form_id: input.formId,
        version: latest.version + 1,
        status: 'draft',
        builder_model: json(latest.builder_model),
        json_schema: json(latest.json_schema),
        ui_schema: json(latest.ui_schema),
        mapping_to_cg: json(latest.mapping_to_cg),
        mapping_from_cg: json(latest.mapping_from_cg),
        field_meta: json(latest.field_meta),
        created_by: uid(ctx),
      })
      .execute();
    ctx.audit({ entityType: 'form_version', entityId: id, after: { version: latest.version + 1, from: latest.id } });
    return { id };
  },
});

export const diffFormVersions = defineAction({
  id: 'forms.diff',
  title: 'Compare form versions',
  description: 'Lists what changed between two versions of a form, in plain language.',
  input: z.object({ fromVersionId: uuid, toVersionId: uuid }),
  output: z.object({ changes: z.array(z.object({ summary: z.string() }).loose()), notice: z.string(), details: z.array(z.string()) }),
  scopes: [],
  roles: ['owner', 'admin', 'program_officer', 'auditor'],
  riskTier: 'R0',
  idempotent: true,
  async run(input, ctx) {
    const a = found(await ctx.db.selectFrom('form_versions').select('builder_model').where('id', '=', input.fromVersionId).executeTakeFirst(), 'version');
    const b = found(await ctx.db.selectFrom('form_versions').select('builder_model').where('id', '=', input.toVersionId).executeTakeFirst(), 'version');
    const ma = FormModelSchema.parse(a.builder_model);
    const mb = FormModelSchema.parse(b.builder_model);
    const n = migrationNotice(ma, mb);
    return { changes: diffVersions(ma, mb) as unknown as { summary: string }[], notice: n.summary, details: n.details };
  },
});

export const deleteFormDraft = defineAction({
  id: 'forms.delete_draft',
  title: 'Discard a draft version',
  description: 'Discards an unpublished draft version of a form; published versions are permanent and cannot be deleted.',
  input: z.object({ versionId: uuid }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const v = found(await ctx.db.selectFrom('form_versions').select(['id', 'status', 'version', 'form_id']).where('id', '=', input.versionId).executeTakeFirst(), 'version');
    if (v.status !== 'draft') throw new DomainError('conflict', 'Published versions are kept permanently.');
    if (v.version === 1) {
      await ctx.db.deleteFrom('forms').where('id', '=', v.form_id).where('current_version_id', 'is', null).execute();
    } else {
      await ctx.db.deleteFrom('form_versions').where('id', '=', v.id).execute();
    }
    return { ok: true as const };
  },
});

export const importCgForm = defineAction({
  id: 'forms.import_commongrants',
  title: 'Import a CommonGrants form',
  description: 'Imports a CommonGrants form-library style JSON (JSON Schema + UI Schema) into a new draft form; reports fields that could not be mapped.',
  input: z.object({ name: z.string().trim().min(1).max(200), kind: Kind.default('application'), source: z.record(z.string(), z.unknown()) }),
  output: z.object({ formId: z.string().uuid(), versionId: z.string().uuid(), unmapped: z.array(z.string()) }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const imported = importCommonGrantsForm(input.source) as { model: unknown; unmapped?: string[]; warnings?: string[] };
    const { model, compiled } = compileOrThrow({ ...(imported.model as object), title: input.name });
    const formId = randomUUID();
    const versionId = randomUUID();
    await ctx.db.insertInto('forms').values({ id: formId, workspace_id: w.id, name: input.name, kind: input.kind, created_by: uid(ctx) }).execute();
    await ctx.db
      .insertInto('form_versions')
      .values({
        id: versionId,
        workspace_id: w.id,
        form_id: formId,
        version: 1,
        status: 'draft',
        builder_model: json(model),
        json_schema: json(compiled.jsonSchema),
        ui_schema: json(compiled.uiSchema),
        mapping_to_cg: json(compiled.mappingToCg),
        mapping_from_cg: json(compiled.mappingFromCg),
        field_meta: json(compiled.fieldMeta),
        created_by: uid(ctx),
      })
      .execute();
    ctx.audit({ entityType: 'form', entityId: formId, after: { imported: true, name: input.name } });
    return { formId, versionId, unmapped: imported.unmapped ?? imported.warnings ?? [] };
  },
});

export const saveTemplate = defineAction({
  id: 'forms.save_template',
  title: 'Save a form as a template',
  description: 'Saves a form version’s structure as a reusable workspace template.',
  input: z.object({ versionId: uuid, name: z.string().trim().min(1).max(200), description: z.string().max(1000).optional() }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const v = found(await ctx.db.selectFrom('form_versions as v').innerJoin('forms as f', 'f.id', 'v.form_id').select(['v.builder_model', 'f.kind']).where('v.id', '=', input.versionId).executeTakeFirst(), 'version');
    const r = await ctx.db
      .insertInto('form_templates')
      .values({ workspace_id: w.id, name: input.name, description: input.description ?? null, kind: v.kind, builder_model: json(v.builder_model), source: 'workspace' })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: r.id };
  },
});

export const addQuestionBankItem = defineAction({
  id: 'forms.add_question',
  title: 'Add a question to the bank',
  description: 'Adds a reusable question (a builder field definition) to the workspace question bank.',
  input: z.object({ label: z.string().trim().min(1).max(300), field: z.record(z.string(), z.unknown()), tags: z.array(z.string().max(40)).max(10).default([]), cgPath: z.string().max(120).optional().nullable() }),
  output: IdOut,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const r = await ctx.db
      .insertInto('question_bank_items')
      .values({ workspace_id: w.id, label: input.label, field: json(input.field), tags: input.tags, cg_path: input.cgPath ?? null, created_by: uid(ctx) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: r.id };
  },
});
