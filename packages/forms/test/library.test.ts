// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  compileForm,
  FieldSchema,
  FORM_TEMPLATES,
  FULL_PROPOSAL_TEMPLATE,
  instantiateQuestion,
  INTERIM_REPORT_TEMPLATE,
  listFields,
  QUESTION_BANK,
  templateModel,
  validateResponses,
  YOUTH_ARTS_LOI,
} from '../src';

describe('question bank', () => {
  it('has at least 25 valid, uniquely keyed items', () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(25);
    expect(new Set(QUESTION_BANK.map((q) => q.key)).size).toBe(QUESTION_BANK.length);
    for (const item of QUESTION_BANK) {
      expect(() => FieldSchema.parse(item.field), item.key).not.toThrow();
      if (item.cgPath) expect((item.field as { cgMapping?: string }).cgMapping, item.key).toBe(item.cgPath);
    }
    for (const key of ['org_legal_name', 'org_ein', 'org_uei', 'org_mission', 'org_annual_budget', 'sponsor_name', 'sponsor_ein', 'counties_served', 'project_title', 'project_summary', 'youth_served', 'age_groups', 'activities', 'budget_lines', 'other_funding', 'support_letter', 'ai_disclosure', 'attestation', 'outcomes', 'demographics_note']) {
      expect(QUESTION_BANK.map((q) => q.key)).toContain(key);
    }
  });

  it('instantiates copies that can be renamed without touching the bank', () => {
    const f = instantiateQuestion('project_title', { id: 'program_title' });
    expect(f).toMatchObject({ id: 'program_title', type: 'text', maxLength: 100, required: true });
    expect(instantiateQuestion('project_title').id).toBe('project_title');
    expect(() => instantiateQuestion('nope')).toThrow();
  });
});

describe('templates', () => {
  it('ships five templates that compile and accept an empty draft', () => {
    expect(FORM_TEMPLATES.map((t) => t.key)).toEqual(['youth_arts_loi_2027', 'full_proposal', 'interim_report', 'final_report', 'general_operating']);
    for (const t of FORM_TEMPLATES) {
      const c = compileForm(t.model);
      expect(validateResponses(c, {}, { mode: 'save' }).valid, t.key).toBe(true);
      expect(validateResponses(c, {}, { mode: 'submit' }).valid, t.key).toBe(false);
    }
  });

  it('builds the Youth Arts Fund LOI exactly as specified', () => {
    expect(YOUTH_ARTS_LOI.title).toBe('Youth Arts Fund 2027 — Letter of Inquiry');
    expect(YOUTH_ARTS_LOI.flags).toEqual({ aiDisclosure: true });
    const fields = Object.fromEntries(listFields(YOUTH_ARTS_LOI).map((l) => [l.field.id, { ...l.field, page: l.page.id }]));
    expect(fields.org_legal_name).toMatchObject({ page: 'about_org', type: 'text', required: true, cgMapping: 'organization.name', blind: true });
    expect(fields.org_ein).toMatchObject({ page: 'about_org', type: 'ein', required: true, cgMapping: 'organization.ein', blind: false });
    expect(fields.fiscally_sponsored).toMatchObject({ type: 'yes_no', label: 'Is your organization fiscally sponsored?', required: true });
    for (const id of ['sponsor_name', 'sponsor_ein']) {
      expect(fields[id]).toMatchObject({
        required: false,
        visibleWhen: { field: 'fiscally_sponsored', op: 'eq', value: true },
        requiredWhen: { field: 'fiscally_sponsored', op: 'eq', value: true },
      });
    }
    expect(fields.sponsor_ein).toMatchObject({ type: 'ein', blind: false });
    expect(fields.annual_budget).toMatchObject({ type: 'currency', blind: false });
    expect(fields.counties_served).toMatchObject({ type: 'multi_select', options: [{ label: 'Alder County' }, { label: 'Bramble County' }, { label: 'Cinder County' }, { label: 'Other' }] });
    expect(fields.project_title).toMatchObject({ page: 'project', type: 'text', maxLength: 100 });
    expect(fields.project_summary).toMatchObject({ type: 'long_text', maxWords: 150 });
    expect(fields.age_groups).toMatchObject({ type: 'checkbox_group', options: [{ value: '12-14' }, { value: '15-17' }, { value: '18-24' }] });
    expect(fields.youth_served).toMatchObject({ type: 'number', integer: true, min: 1 });
    expect(fields.activities).toMatchObject({ type: 'long_text', maxWords: 300 });
    expect(fields.request_amount).toMatchObject({ page: 'budget', type: 'currency', min: 500_000, max: 2_500_000, blind: false });
    expect(fields.budget_lines).toMatchObject({
      type: 'repeater_table',
      blind: false,
      columns: [{ id: 'item', type: 'text' }, { id: 'category', type: 'select', options: [{ label: 'Personnel' }, { label: 'Supplies' }, { label: 'Space' }, { label: 'Stipends' }, { label: 'Other' }] }, { id: 'amount', type: 'currency' }],
      sumEquals: { column: 'amount', field: 'request_amount' },
    });
    expect(fields.other_funding).toMatchObject({ type: 'long_text', required: false });
    expect(fields.budget_file).toMatchObject({ page: 'attachments', type: 'file_upload', required: true, accept: ['pdf', 'xlsx'], maxBytes: 10 * 1024 * 1024 });
    expect(fields.support_letter).toMatchObject({ type: 'file_upload', required: false, accept: ['pdf'], maxBytes: 10 * 1024 * 1024 });
    expect(fields.ai_disclosure).toMatchObject({ type: 'long_text', required: false, requiredWhen: { flag: 'aiDisclosure' } });
    expect(fields.attestation).toMatchObject({ type: 'attestation', required: true, requireName: true });
  });

  it('includes an interim report with a youth-served indicator and a budget-to-actual table', () => {
    const f = Object.fromEntries(listFields(INTERIM_REPORT_TEMPLATE).map((l) => [l.field.id, l.field]));
    expect(f.youth_served_to_date).toMatchObject({ type: 'number', indicator: 'youth_served' });
    expect(f.budget_to_actual).toMatchObject({ type: 'repeater_table' });
    expect(f.attestation).toBeDefined();
    expect(compileForm(INTERIM_REPORT_TEMPLATE).fieldMeta.youth_served_to_date!.indicator).toBe('youth_served');
  });

  it('checks the full proposal budget against the total project cost', () => {
    const c = compileForm(FULL_PROPOSAL_TEMPLATE);
    expect(c.jsonSchema.properties!.budget_lines!['x-sumEquals']).toMatchObject({ field: 'total_project_cost' });
    const r = validateResponses(c, { total_project_cost: 1_000_000, budget_lines: [{ item: 'Staff', category: 'personnel', amount: 900_000 }] }, { mode: 'submit' });
    expect(r.errors.find((e) => e.keyword === 'x-sumEquals')?.message).toBe('Your budget lines add up to $9,000, but “What is the total cost of the project?” is $10,000. Make them match.');
  });

  it('returns editable copies of templates', () => {
    const m = templateModel('youth_arts_loi_2027');
    m.title = 'Changed';
    expect(YOUTH_ARTS_LOI.title).not.toBe('Changed');
    expect(() => templateModel('nope')).toThrow();
  });
});
