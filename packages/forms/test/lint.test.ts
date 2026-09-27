// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canPublish, defineForm, type ElementInput, FORM_TEMPLATES, type FormModel, lintForm, type LintIssue } from '../src';

function form(...pages: ElementInput[][]): FormModel {
  return defineForm({ version: 1, title: 'Lint me', pages: pages.map((elements, i) => ({ id: `p${i + 1}`, title: `Page ${i + 1}`, elements })) });
}

const codes = (issues: LintIssue[]) => issues.map((i) => `${i.level}:${i.code}${i.fieldId ? `:${i.fieldId}` : ''}`);

describe('lintForm', () => {
  it('finds no problems in the built-in templates', () => {
    for (const t of FORM_TEMPLATES) expect(lintForm(t.model), t.key).toEqual([]);
  });

  it('warns about a required field that fits a well-known CG path but is unmapped', () => {
    const issues = lintForm(form([{ id: 'ein', type: 'ein', label: 'Your EIN', required: true, help: 'x' }]));
    expect(codes(issues)).toEqual(['warning:unmapped_required:ein']);
    expect(issues[0]!.message).toContain('organization.ein');
    // Optional fields and fields with no good match are fine.
    expect(lintForm(form([{ id: 'fav', type: 'text', label: 'Favorite color', required: true }]))).toEqual([]);
  });

  it('flags a mapping conflict when two fields map to the same CG path (FB-02)', () => {
    const issues = lintForm(
      form([
        { id: 'a', type: 'text', label: 'Legal name', cgMapping: 'organization.name', blind: true },
        { id: 'b', type: 'text', label: 'Organization name (again)', cgMapping: 'organization.name', blind: true },
      ]),
    );
    expect(codes(issues)).toEqual(['warning:mapping_conflict:b']);
    expect(issues[0]!.message).toMatch(/both mapped to organization\.name/);
  });

  it('reports missing labels, duplicate ids, empty pages and bad ids', () => {
    const issues = lintForm(
      form(
        [
          { id: 'x', type: 'text', label: '' },
          { id: 'x', type: 'text', label: 'Second X' },
          { id: '9lives', type: 'text', label: 'Bad id' },
        ],
        [],
      ),
    );
    expect(codes(issues)).toEqual(['error:duplicate_id:x', 'warning:empty_page', 'error:missing_label:x', 'error:invalid_id:9lives']);
    expect(canPublish(issues)).toBe(false);
  });

  it('reports selects without options, one-option selects and duplicate option values', () => {
    const issues = lintForm(
      form([
        { id: 's', type: 'select', label: 'Pick', options: [] },
        { id: 'm', type: 'multi_select', label: 'Pick some', options: [{ value: 'a', label: 'A' }] },
        { id: 'c', type: 'checkbox_group', label: 'Check', options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'A again' }] },
      ]),
    );
    expect(codes(issues)).toEqual(['error:select_without_options:s', 'warning:single_option:m', 'error:duplicate_option:c']);
  });

  it('warns about unreasonable word limits and unrestricted file uploads', () => {
    const issues = lintForm(
      form([
        { id: 'essay', type: 'long_text', label: 'Tell us everything', maxWords: 15_000 },
        { id: 'upload', type: 'file_upload', label: 'Upload anything', help: 'Any file' },
      ]),
    );
    expect(codes(issues)).toEqual(['warning:word_limit_high:essay', 'warning:file_without_type_restriction:upload']);
    expect(issues[0]!.message).toContain('Did you mean 1,500?');
  });

  it('checks accessibility of labels and help on complex fields', () => {
    const issues = lintForm(
      form([
        { id: 'a', type: 'text', label: 'Click here' },
        { id: 'b', type: 'text', label: 'x'.repeat(201) },
        { id: 'c', type: 'repeater_table', label: 'Staff', columns: [{ id: 'n', type: 'text', label: 'Name' }] },
      ]),
    );
    expect(codes(issues)).toEqual(['warning:vague_label:a', 'warning:label_too_long:b', 'warning:missing_help:c']);
  });

  it('reports circular rules and rules on unknown fields as errors', () => {
    const issues = lintForm(
      form([
        { id: 'a', type: 'yes_no', label: 'A', visibleWhen: { field: 'b', op: 'truthy' } },
        { id: 'b', type: 'yes_no', label: 'B', visibleWhen: { field: 'a', op: 'truthy' } },
        { id: 'c', type: 'text', label: 'C', requiredWhen: { field: 'nope', op: 'truthy' } },
      ]),
    );
    expect(codes(issues)).toEqual(['error:rule_cycle:a', 'error:rule_unknown_field:c']);
    expect(issues[0]!.message).toContain('“A” → “B” → “A”');
  });

  it('requires x-sumEquals to point at a currency field', () => {
    const issues = lintForm(
      form([
        { id: 'count', type: 'number', label: 'How many?' },
        {
          id: 'lines',
          type: 'repeater_table',
          label: 'Lines',
          help: 'One per row',
          columns: [{ id: 'amt', type: 'currency', label: 'Amount' }],
          sumEquals: { column: 'amt', field: 'count' },
        },
        {
          id: 'lines2',
          type: 'repeater_table',
          label: 'Lines 2',
          help: 'One per row',
          columns: [{ id: 'what', type: 'text', label: 'What' }],
          sumEquals: { column: 'what', field: 'missing' },
        },
      ]),
    );
    expect(codes(issues)).toEqual(['error:sum_equals_column_not_numeric:lines2', 'error:sum_equals_not_currency:lines', 'error:sum_equals_unknown_field:lines2']);
  });

  it('suggests putting the attestation on the last page', () => {
    const issues = lintForm(form([{ id: 'att', type: 'attestation', label: 'Sign', statement: 'True.', required: true }], [{ id: 'more', type: 'text', label: 'More' }]));
    expect(codes(issues)).toEqual(['info:attestation_not_last:att']);
    expect(canPublish(issues)).toBe(true);
  });

  it('checks CG paths, flags and ranges', () => {
    const issues = lintForm(
      form([
        { id: 'a', type: 'number', label: 'Budget', cgMapping: 'organization.annualBudget' },
        { id: 'b', type: 'text', label: 'Custom', cgMapping: 'custom.thing' },
        { id: 'c', type: 'text', label: 'Website', cgMapping: 'organization.website' },
        { id: 'd', type: 'text', label: 'Flagged', visibleWhen: { flag: 'nope' } },
        { id: 'e', type: 'currency', label: 'Range', min: 10, max: 5 },
      ]),
    );
    expect(codes(issues)).toEqual([
      'warning:cg_type_mismatch:a',
      'info:custom_cg_path:b',
      'info:identifying_not_blind:c',
      'warning:unknown_flag:d',
      'error:min_greater_than_max:e',
    ]);
  });

  it('reports a form with no pages', () => {
    expect(codes(lintForm(defineForm({ version: 1, title: 'Empty', pages: [] })))).toEqual(['error:no_pages']);
  });
});
