// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Categorization, Category, ControlElement, JsonSchema7, VerticalLayout } from '@jsonforms/core';
import { describe, expect, it } from 'vitest';
import { ALL_TYPES } from './helpers';
import { compileForm, createAjv, defineForm, FORM_TEMPLATES, FormCompileError, type FormModelInput, LOI_FIELD_IDS, YOUTH_ARTS_LOI } from '../src';

/** Rebuilds an object with its keys in reverse order (deeply), to prove output ignores input key order. */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).reverse()) out[k] = reverseKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

describe('compileForm', () => {
  it('is deterministic: same model → byte-identical output, regardless of input key order', () => {
    const a = JSON.stringify(compileForm(YOUTH_ARTS_LOI));
    const b = JSON.stringify(compileForm(structuredClone(YOUTH_ARTS_LOI)));
    const c = JSON.stringify(compileForm(reverseKeys(YOUTH_ARTS_LOI) as FormModelInput));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('compiles the LOI into four pages with the expected field ids', () => {
    const c = compileForm(YOUTH_ARTS_LOI);
    expect(c.pages.map((p) => [p.id, p.title])).toEqual([
      ['about_org', 'About your organization'],
      ['project', 'Your project'],
      ['budget', 'Budget'],
      ['attachments', 'Attachments & attestation'],
    ]);
    expect(c.pages.flatMap((p) => p.fieldIds)).toEqual(Object.values(LOI_FIELD_IDS));
    expect(Object.keys(c.fieldMeta)).toEqual(Object.values(LOI_FIELD_IDS));
    expect(c.jsonSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(c.jsonSchema.type).toBe('object');
  });

  it('emits LOI limits in the JSON Schema', () => {
    const p = compileForm(YOUTH_ARTS_LOI).jsonSchema.properties!;
    expect(p.project_title).toMatchObject({ type: 'string', maxLength: 100 });
    expect(p.project_summary).toMatchObject({ type: 'string', maxWords: 150 });
    expect(p.activities).toMatchObject({ maxWords: 300 });
    expect(p.youth_served).toMatchObject({ type: 'integer', minimum: 1 });
    expect(p.request_amount).toMatchObject({ type: 'integer', minimum: 500_000, maximum: 2_500_000, 'x-currency': 'USD' });
    expect(p.org_ein).toMatchObject({ pattern: '^\\d{2}-\\d{7}$' });
    expect(p.counties_served).toMatchObject({ type: 'array', uniqueItems: true });
    expect(p.counties_served!.items!.oneOf!.map((o) => o.const)).toEqual(['alder', 'bramble', 'cinder', 'other']);
    expect(p.age_groups!.items!.oneOf!.map((o) => o.title)).toEqual(['12–14', '15–17', '18–24']);
    expect(p.budget_lines).toMatchObject({
      type: 'array',
      minItems: 1,
      'x-sumEquals': { column: 'amount', field: 'request_amount' },
      'x-totals': ['amount'],
    });
    expect(p.budget_lines!.items!.properties!.category!.oneOf!.map((o) => o.title)).toEqual(['Personnel', 'Supplies', 'Space', 'Stipends', 'Other']);
    expect(p.budget_file).toMatchObject({ type: 'object', 'x-accept': ['pdf', 'xlsx'], 'x-maxBytes': 10 * 1024 * 1024 });
    expect(p.support_letter).toMatchObject({ 'x-accept': ['pdf'] });
    // Attestation must be checked and signed (merged in because it is always required).
    expect(p.attestation).toMatchObject({ required: ['agreed', 'name'], properties: { agreed: { const: true } } });
  });

  it('turns conditional visibility + requirement into if/then (sponsor questions)', () => {
    const s = compileForm(YOUTH_ARTS_LOI).jsonSchema;
    expect(s.required).not.toContain('sponsor_name');
    expect(s.required).not.toContain('sponsor_ein');
    expect(s.allOf).toEqual([
      { if: { required: ['fiscally_sponsored'], properties: { fiscally_sponsored: { const: true } } }, then: { required: ['sponsor_name'] } },
      { if: { required: ['fiscally_sponsored'], properties: { fiscally_sponsored: { const: true } } }, then: { required: ['sponsor_ein'] } },
    ]);
  });

  it('resolves form-level flags at compile time (aiDisclosure)', () => {
    const on = compileForm(YOUTH_ARTS_LOI);
    expect(on.jsonSchema.required).toContain('ai_disclosure');
    expect(on.fieldMeta.ai_disclosure!.required).toBe(true);
    const off = compileForm({ ...YOUTH_ARTS_LOI, flags: { aiDisclosure: false } });
    expect(off.jsonSchema.required).not.toContain('ai_disclosure');
    expect(off.jsonSchema.properties!.ai_disclosure).toBeDefined();
    expect(off.fieldMeta.ai_disclosure!.required).toBe(false);
  });

  it('omits fields that a flag hides entirely', () => {
    const c = compileForm(
      defineForm({
        version: 1,
        title: 'Flags',
        pages: [{ id: 'p', title: 'P', elements: [{ id: 'a', type: 'text', label: 'A' }, { id: 'b', type: 'text', label: 'B', visibleWhen: { flag: 'showB' } }] }],
      }),
    );
    expect(c.pages[0]!.fieldIds).toEqual(['a']);
    expect(c.jsonSchema.properties!.b).toBeUndefined();
    expect(c.fieldMeta.b).toBeUndefined();
  });

  it('builds a JSON Forms Categorization with one Category per page and SHOW rules', () => {
    const ui: Categorization = compileForm(YOUTH_ARTS_LOI).uiSchema;
    expect(ui.type).toBe('Categorization');
    expect(ui.elements).toHaveLength(4);
    const first = ui.elements[0] as Category;
    expect(first.type).toBe('Category');
    expect(first.label).toBe('About your organization');
    expect(first.options).toMatchObject({ pageId: 'about_org' });
    const sponsor = first.elements.find((e) => (e as ControlElement).scope === '#/properties/sponsor_ein') as ControlElement;
    expect(sponsor.rule).toEqual({
      effect: 'SHOW',
      condition: { scope: '#', schema: { required: ['fiscally_sponsored'], properties: { fiscally_sponsored: { const: true } } } },
    });
    const summary = (ui.elements[1] as Category).elements.find((e) => (e as ControlElement).scope === '#/properties/project_summary') as ControlElement;
    expect(summary.options).toMatchObject({ fieldType: 'long_text', multi: true, maxWords: 150 });
    // The JSON Schema is usable as a JSON Forms schema.
    const asJf: JsonSchema7 = compileForm(YOUTH_ARTS_LOI).jsonSchema;
    expect(asJf.type).toBe('object');
  });

  it('wraps a control in a VerticalLayout when it has both a SHOW and an ENABLE rule', () => {
    const c = compileForm(
      defineForm({
        version: 1,
        title: 'Rules',
        pages: [
          {
            id: 'p',
            title: 'P',
            elements: [
              { id: 'a', type: 'yes_no', label: 'A' },
              { id: 'b', type: 'yes_no', label: 'B' },
              { id: 'c', type: 'text', label: 'C', visibleWhen: { field: 'a', op: 'truthy' }, enabledWhen: { field: 'b', op: 'eq', value: true } },
            ],
          },
        ],
      }),
    );
    const wrapper = (c.uiSchema.elements[0] as Category).elements[2] as VerticalLayout;
    expect(wrapper.type).toBe('VerticalLayout');
    expect(wrapper.rule?.effect).toBe('SHOW');
    expect((wrapper.elements[0] as ControlElement).rule?.effect).toBe('ENABLE');
    // Required-ness of a field also depends on its enabled rule.
    expect(c.fieldMeta.c!.enabledWhen).toEqual({ field: 'b', op: 'eq', value: true });
  });

  it('records field_meta for blind review, reviewer notes and CG mappings', () => {
    const c = compileForm(YOUTH_ARTS_LOI);
    expect(c.fieldMeta.org_legal_name).toMatchObject({ blind: true, pageId: 'about_org', cgMapping: 'organization.name', required: true, order: 0 });
    expect(c.fieldMeta.sponsor_name).toMatchObject({ blind: true, required: false, requiredWhen: { field: 'fiscally_sponsored', op: 'eq', value: true } });
    expect(c.fieldMeta.org_ein!.blind).toBe(false);
    expect(c.fieldMeta.sponsor_ein!.blind).toBe(false);
    expect(c.fieldMeta.annual_budget!.blind).toBe(false);
    expect(c.fieldMeta.request_amount!.blind).toBe(false);
    expect(c.fieldMeta.budget_lines!.blind).toBe(false);
    expect(c.fieldMeta.budget_file!.blind).toBe(false);
    expect(c.fieldMeta.ai_disclosure!.reviewerNotes).toMatch(/Do not score/);
    expect(c.fieldMeta.budget_lines!.columns!.map((x) => x.id)).toEqual(['item', 'category', 'amount']);
    expect(c.mappingToCg).toEqual({
      org_legal_name: { path: 'organization.name', transform: 'identity' },
      org_ein: { path: 'organization.ein', transform: 'identity' },
      sponsor_name: { path: 'organization.fiscalSponsor.name', transform: 'identity' },
      sponsor_ein: { path: 'organization.fiscalSponsor.ein', transform: 'identity' },
      annual_budget: { path: 'organization.annualBudget', transform: 'money' },
      project_title: { path: 'project.title', transform: 'identity' },
      project_summary: { path: 'project.summary', transform: 'identity' },
      youth_served: { path: 'project.beneficiaryCount', transform: 'identity' },
      request_amount: { path: 'funding.requestedAmount', transform: 'money' },
    });
    expect(c.mappingFromCg['organization.ein']).toEqual({ fieldId: 'org_ein', transform: 'identity' });
  });

  it('refuses duplicate field ids', () => {
    const model: FormModelInput = {
      version: 1,
      title: 'Dupes',
      pages: [
        { id: 'p1', title: 'One', elements: [{ id: 'x', type: 'text', label: 'X' }] },
        { id: 'p2', title: 'Two', elements: [{ id: 'x', type: 'number', label: 'Also X' }] },
      ],
    };
    expect(() => compileForm(model)).toThrow(FormCompileError);
  });

  it('produces schemas Ajv 2020 (strict) accepts for every template', () => {
    const ajv = createAjv();
    for (const t of FORM_TEMPLATES) {
      expect(() => ajv.compile(compileForm(t.model).jsonSchema), t.key).not.toThrow();
    }
  });

  it('compiles every field type', () => {
    const c = compileForm(ALL_TYPES);
    const types = Object.values(c.fieldMeta).map((m) => m.type);
    expect(new Set(types).size).toBe(20);
    expect(() => createAjv().compile(c.jsonSchema)).not.toThrow();
    expect(c.uiSchema.elements[0]!.type).toBe('Category');
    const group = (c.uiSchema.elements[1] as Category).elements[0]!;
    expect(group).toMatchObject({ type: 'Group', label: 'Contact', options: { sectionId: 'contact_section' } });
    expect((c.uiSchema.elements[0] as Category).elements.some((e) => e.type === 'Label')).toBe(true);
  });
});
