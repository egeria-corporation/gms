// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { compileForm, importCommonGrantsForm, lintForm, listFields, SAMPLE_CG_FORM_LIBRARY_JSON, validateResponses } from '../src';

describe('importCommonGrantsForm', () => {
  const result = importCommonGrantsForm(SAMPLE_CG_FORM_LIBRARY_JSON);

  it('builds pages from Categories and sections from Groups', () => {
    expect(result.model.title).toBe('Organization basics');
    expect(result.model.pages.map((p) => p.title)).toEqual(['Organization', 'Contact']);
    const contact = result.model.pages[1]!.elements[0]!;
    expect(contact).toMatchObject({ type: 'section', title: 'Primary contact' });
  });

  it('maps JSON Schema types to builder field types', () => {
    const types = Object.fromEntries(listFields(result.model).map((l) => [l.field.id, l.field.type]));
    expect(types).toEqual({
      orgName: 'text',
      ein: 'ein',
      uei: 'uei',
      mission: 'long_text',
      annualBudget: 'currency',
      orgType: 'select',
      focusAreas: 'multi_select',
      hasSponsor: 'yes_no',
      sponsorName: 'text',
      foundedOn: 'date',
      staffCount: 'number',
      contactName: 'name',
      contactEmail: 'email',
      mailingAddress: 'address',
      boardMembers: 'repeater_table',
    });
  });

  it('keeps required flags, labels, help, rules and CG mappings (hints and mapping blocks)', () => {
    const f = Object.fromEntries(listFields(result.model).map((l) => [l.field.id, l.field]));
    expect(f.orgName).toMatchObject({ required: true, label: 'Legal name', cgMapping: 'organization.name', maxLength: 200 });
    expect(f.ein).toMatchObject({ required: true, cgMapping: 'organization.ein' });
    expect(f.mission).toMatchObject({ help: 'In a few sentences.' });
    expect(f.contactEmail).toMatchObject({ required: true, cgMapping: 'contact.email' });
    expect(f.contactName).toMatchObject({ label: 'Contact name', cgMapping: 'contact.name' });
    expect(f.annualBudget).toMatchObject({ cgMapping: 'organization.annualBudget' });
    expect(f.mailingAddress).toMatchObject({ cgMapping: 'organization.address' });
    expect(f.sponsorName!.visibleWhen).toEqual({ field: 'hasSponsor', op: 'eq', value: true });
    expect(f.staffCount).toMatchObject({ integer: true, min: 0 });
    expect(f.boardMembers).toMatchObject({ columns: [{ id: 'fullName', label: 'Name', required: true }, { id: 'role', label: 'Role', required: false }] });
  });

  it('reports what it could not import', () => {
    expect(result.skipped).toEqual([
      { path: '/properties/legacyData', reason: expect.stringContaining('Nested groups') },
      { path: '/properties/signature', reason: expect.stringContaining('file upload question') },
    ]);
    expect(result.mapped).toHaveLength(15);
  });

  it('produces a model that compiles, lints without errors and validates data', () => {
    const c = compileForm(result.model);
    expect(lintForm(result.model).filter((i) => i.level === 'error')).toEqual([]);
    const r = validateResponses(c, { orgName: 'Cinder Youth Theater', ein: '12-3456789', contactEmail: 'hello@cinder.example' }, { mode: 'submit' });
    expect(r.valid).toBe(true);
  });

  it('handles a bare schema with no UI schema, odd ids and unsupported rules', () => {
    const r = importCommonGrantsForm({
      title: 'Bare',
      schema: {
        type: 'object',
        properties: {
          'org-name': { type: 'string' },
          '2ndPhone': { type: 'string', pattern: '^\\d+$' },
          when: { type: 'string', format: 'date-time' },
          nothing: {},
        },
      },
    });
    expect(r.model.pages).toHaveLength(1);
    expect(listFields(r.model).map((l) => [l.field.id, l.field.label, l.field.type])).toEqual([
      ['org_name', 'Org name', 'text'],
      ['f_2ndPhone', '2nd phone', 'text'],
      ['when', 'When', 'date'],
    ]);
    expect(r.warnings).toHaveLength(4);
    expect(r.skipped).toEqual([{ path: '/properties/nothing', reason: 'The question has no type GMS understands.' }]);

    const hidden = importCommonGrantsForm({
      jsonSchema: { type: 'object', properties: { a: { type: 'string', enum: ['x', 'y'] }, b: { type: 'string' } } },
      uiSchema: {
        type: 'VerticalLayout',
        elements: [
          { type: 'Control', scope: '#/properties/a' },
          { type: 'Control', scope: '#/properties/b', rule: { effect: 'HIDE', condition: { scope: '#/properties/a', schema: { enum: ['x', 'y'] } } } },
        ],
      },
    });
    expect(hidden.skipped[0]!.reason).toMatch(/rule/);
    expect(listFields(hidden.model).find((l) => l.field.id === 'b')!.field.visibleWhen).toBeUndefined();
  });
});
