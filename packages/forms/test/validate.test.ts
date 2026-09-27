// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  checkEligibility,
  compileForm,
  computeTotals,
  type Condition,
  conditionToSchema,
  createAjv,
  defineForm,
  evaluateCondition,
  LOI_DRAFT_RESPONSE,
  LOI_INVALID_BUDGET_MISMATCH,
  LOI_INVALID_MISSING_SPONSOR_EIN,
  LOI_INVALID_OVER_WORD_LIMIT,
  LOI_VALID_RESPONSE,
  LOI_VALID_SPONSORED_RESPONSE,
  pruneEmpty,
  requiredFields,
  type ResponseData,
  sampleWords,
  validateResponses,
  visibleFields,
  wordCount,
  YOUTH_ARTS_LOI,
} from '../src';
import { ALL_TYPES } from './helpers';

const loi = compileForm(YOUTH_ARTS_LOI);
const submit = (data: ResponseData) => validateResponses(loi, data, { mode: 'submit' });
const save = (data: ResponseData) => validateResponses(loi, data, { mode: 'save' });

describe('LOI fixtures', () => {
  it('the valid response passes submit and save validation', () => {
    expect(submit(LOI_VALID_RESPONSE)).toEqual({ valid: true, errors: [], knockouts: [] });
    expect(save(LOI_VALID_RESPONSE).valid).toBe(true);
    expect(submit(LOI_VALID_SPONSORED_RESPONSE).valid).toBe(true);
  });

  it('budget mismatch → /budget_lines with a friendly message', () => {
    const r = submit(LOI_INVALID_BUDGET_MISMATCH);
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual([
      {
        pointer: '/budget_lines',
        fieldId: 'budget_lines',
        pageId: 'budget',
        keyword: 'x-sumEquals',
        message: 'Your budget lines add up to $24,000, but you asked for $25,000. Make them match.',
      },
    ]);
  });

  it('over the word limit → /project_summary with the count', () => {
    const r = submit(LOI_INVALID_OVER_WORD_LIMIT);
    expect(r.errors).toEqual([
      { pointer: '/project_summary', fieldId: 'project_summary', pageId: 'project', keyword: 'maxWords', message: 'Keep this under 150 words (you have 162).' },
    ]);
    // Limits are enforced on drafts too.
    expect(save(LOI_INVALID_OVER_WORD_LIMIT).errors.map((e) => e.pointer)).toEqual(['/project_summary']);
  });

  it('sponsored without a sponsor EIN → /sponsor_ein', () => {
    const r = submit(LOI_INVALID_MISSING_SPONSOR_EIN);
    expect(r.errors).toEqual([
      { pointer: '/sponsor_ein', fieldId: 'sponsor_ein', pageId: 'about_org', keyword: 'required', message: 'Please enter the EIN, like 12-3456789.' },
    ]);
  });
});

describe('save vs submit', () => {
  it('save mode tolerates missing required answers, unchecked attestations and budget mismatches', () => {
    expect(save(LOI_DRAFT_RESPONSE)).toMatchObject({ valid: true, errors: [] });
    expect(save({})).toMatchObject({ valid: true });
    expect(save({ ...LOI_VALID_RESPONSE, attestation: { agreed: false } }).valid).toBe(true);
    expect(save(LOI_INVALID_BUDGET_MISMATCH).valid).toBe(true);
    expect(save({ budget_lines: [{ item: 'Paint' }] }).valid).toBe(true);
  });

  it('submit mode lists every missing required answer, in form order', () => {
    const r = submit(LOI_DRAFT_RESPONSE);
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.fieldId)).toEqual([
      'fiscally_sponsored',
      'annual_budget',
      'counties_served',
      'project_summary',
      'age_groups',
      'youth_served',
      'activities',
      'request_amount',
      'budget_lines',
      'budget_file',
      'ai_disclosure',
      'attestation',
    ]);
    const byId = Object.fromEntries(r.errors.map((e) => [e.fieldId, e.message]));
    expect(byId.fiscally_sponsored).toBe('Please choose an answer.');
    expect(byId.counties_served).toBe('Please choose at least one option.');
    expect(byId.budget_file).toBe('Please upload a file.');
    expect(byId.budget_lines).toBe('Please add at least one row.');
    expect(byId.request_amount).toBe('Please enter an amount in dollars.');
    expect(r.errors.every((e) => e.pageId)).toBe(true);
  });

  it('blank strings, nulls and empty lists count as unanswered', () => {
    const r = submit({ ...LOI_VALID_RESPONSE, project_title: '   ', counties_served: [], annual_budget: null });
    expect(r.errors.map((e) => e.pointer)).toEqual(['/annual_budget', '/counties_served', '/project_title']);
  });

  it('format and limit errors are errors in save mode', () => {
    const r = save({ org_ein: '123456789', project_title: 'x'.repeat(101), request_amount: 100_000, youth_served: 2.5 });
    expect(r.errors).toEqual([
      expect.objectContaining({ pointer: '/org_ein', message: 'Enter the EIN as 9 digits in the format 12-3456789.' }),
      expect.objectContaining({ pointer: '/project_title', message: 'Keep this under 100 characters (you have 101).' }),
      expect.objectContaining({ pointer: '/youth_served', message: 'Enter a whole number, like 25.' }),
      expect.objectContaining({ pointer: '/request_amount', message: 'Enter an amount between $5,000 and $25,000.' }),
    ]);
  });

  it('points into repeater rows', () => {
    const r = submit({
      ...LOI_VALID_RESPONSE,
      budget_lines: [
        { item: 'Teaching artist fees', category: 'personnel', amount: 1_200_000 },
        { item: 'Paint', category: 'food', amount: 1_300_000 },
        { category: 'space', amount: -5 },
      ],
    });
    expect(r.errors.map((e) => [e.pointer, e.message])).toEqual([
      ['/budget_lines/1/category', 'Please pick one of the choices listed.'],
      ['/budget_lines/2/item', 'Please fill in the line item for row 3.'],
      ['/budget_lines/2/amount', 'Enter an amount of at least $0.'],
      ['/budget_lines', 'Your budget lines add up to $24,999.95, but you asked for $25,000. Make them match.'],
    ]);
  });

  it('checks files: type and size', () => {
    const r = save({
      budget_file: { fileId: 'f1', name: 'budget.docx', size: 1000, mimeType: 'application/msword' },
      support_letter: { fileId: 'f2', name: 'letter.pdf', size: 12 * 1024 * 1024, mimeType: 'application/pdf' },
    });
    expect(r.errors).toEqual([
      expect.objectContaining({ pointer: '/budget_file', message: "This file type isn't accepted here. Please upload a PDF or XLSX file." }),
      expect.objectContaining({ pointer: '/support_letter', message: expect.stringContaining('This file is 12 MB, and the limit is 10 MB.') }),
    ]);
  });

  it('requires the attestation to be checked and signed on submit', () => {
    const r = submit({ ...LOI_VALID_RESPONSE, attestation: { agreed: false } });
    expect(r.errors.map((e) => [e.pointer, e.message])).toEqual([
      ['/attestation/name', 'Please type your full name to sign.'],
      ['/attestation/agreed', 'Please check the box to confirm the statement is true.'],
    ]);
  });
});

describe('conditional logic', () => {
  it('hidden fields are never required and their answers are ignored', () => {
    // Not sponsored: sponsor questions are hidden, so an invalid sponsor EIN doesn't matter.
    const r = submit({ ...LOI_VALID_RESPONSE, fiscally_sponsored: false, sponsor_ein: 'not an ein' });
    expect(r.valid).toBe(true);
    expect(visibleFields(loi, LOI_VALID_RESPONSE)).not.toContain('sponsor_ein');
    expect(visibleFields(loi, LOI_VALID_SPONSORED_RESPONSE)).toContain('sponsor_ein');
  });

  it('conditional requirement applies only when the condition is true', () => {
    expect(requiredFields(loi, LOI_VALID_RESPONSE)).not.toContain('sponsor_name');
    expect(requiredFields(loi, { fiscally_sponsored: true })).toEqual(expect.arrayContaining(['sponsor_name', 'sponsor_ein']));
    const r = submit({ ...LOI_VALID_RESPONSE, fiscally_sponsored: true });
    expect(r.errors.map((e) => e.pointer)).toEqual(['/sponsor_name', '/sponsor_ein']);
  });

  it('the AI disclosure is required only when the aiDisclosure flag is on', () => {
    const data = { ...LOI_VALID_RESPONSE, ai_disclosure: '' };
    expect(submit(data).errors.map((e) => e.fieldId)).toEqual(['ai_disclosure']);
    const off = compileForm({ ...YOUTH_ARTS_LOI, flags: { aiDisclosure: false } });
    expect(validateResponses(off, data, { mode: 'submit' }).valid).toBe(true);
  });

  it('hidden chains stay hidden (a field shown by a hidden field is hidden too)', () => {
    const c = compileForm(
      defineForm({
        version: 1,
        title: 'Chain',
        pages: [
          {
            id: 'p',
            title: 'P',
            elements: [
              { id: 'a', type: 'yes_no', label: 'A', required: true },
              { id: 'b', type: 'yes_no', label: 'B', required: true, visibleWhen: { field: 'a', op: 'eq', value: true } },
              { id: 'c', type: 'text', label: 'C', required: true, visibleWhen: { field: 'b', op: 'eq', value: true } },
            ],
          },
        ],
      }),
    );
    // b was answered Yes earlier, then a changed to No: b is hidden, so c must be hidden too.
    expect(visibleFields(c, { a: false, b: true })).toEqual(['a']);
    expect(validateResponses(c, { a: false, b: true }, { mode: 'submit' }).valid).toBe(true);
    expect(validateResponses(c, { a: true, b: true }, { mode: 'submit' }).errors.map((e) => e.pointer)).toEqual(['/c']);
  });

  it('sections hide their questions', () => {
    const c = compileForm(
      defineForm({
        version: 1,
        title: 'Sections',
        pages: [
          {
            id: 'p',
            title: 'P',
            elements: [
              { id: 'has_partner', type: 'yes_no', label: 'Do you have a partner?', required: true },
              {
                type: 'section',
                id: 'partner',
                title: 'Partner',
                visibleWhen: { field: 'has_partner', op: 'truthy' },
                elements: [{ id: 'partner_name', type: 'text', label: 'Partner name', required: true }],
              },
            ],
          },
        ],
      }),
    );
    expect(validateResponses(c, { has_partner: false }, { mode: 'submit' }).valid).toBe(true);
    expect(validateResponses(c, { has_partner: true }, { mode: 'submit' }).errors.map((e) => e.pointer)).toEqual(['/partner_name']);
  });

  it('disabled fields are not required', () => {
    const c = compileForm(
      defineForm({
        version: 1,
        title: 'Enabled',
        pages: [
          {
            id: 'p',
            title: 'P',
            elements: [
              { id: 'n', type: 'number', label: 'How many?' },
              { id: 'detail', type: 'text', label: 'Details', required: true, enabledWhen: { field: 'n', op: 'gt', value: 0 } },
            ],
          },
        ],
      }),
    );
    expect(validateResponses(c, {}, { mode: 'submit' }).valid).toBe(true);
    expect(validateResponses(c, { n: 3 }, { mode: 'submit' }).errors.map((e) => e.pointer)).toEqual(['/detail']);
  });

  it('evaluateCondition agrees with the generated JSON Schema on every case', () => {
    const ajv = createAjv();
    const conds: Condition[] = [
      { field: 'x', op: 'eq', value: true },
      { field: 'x', op: 'eq', value: 'a' },
      { field: 'x', op: 'neq', value: 'a' },
      { field: 'x', op: 'in', value: ['a', 'b'] },
      { field: 'x', op: 'gt', value: 5 },
      { field: 'x', op: 'lt', value: 5 },
      { field: 'x', op: 'truthy' },
      { field: 'x', op: 'falsy' },
      { all: [{ field: 'x', op: 'truthy' }, { field: 'y', op: 'eq', value: 1 }] },
      { any: [{ field: 'x', op: 'eq', value: 'a' }, { field: 'y', op: 'gt', value: 0 }] },
    ];
    const values: unknown[] = [undefined, null, '', 'a', 'b', 'c', 0, 3, 5, 9, true, false, [], ['a'], ['c'], ['b', 'c'], { k: 1 }];
    for (const cond of conds) {
      const check = ajv.compile(conditionToSchema(cond));
      for (const x of values)
        for (const y of [undefined, 0, 1]) {
          const data = pruneEmpty({ x, y });
          expect(check(data), `${JSON.stringify(cond)} on ${JSON.stringify(data)}`).toBe(evaluateCondition(cond, data));
        }
    }
  });

  it('evaluates flag conditions from the flags argument', () => {
    expect(evaluateCondition({ flag: 'aiDisclosure' }, {}, { aiDisclosure: true })).toBe(true);
    expect(evaluateCondition({ flag: 'aiDisclosure' }, {})).toBe(false);
    expect(evaluateCondition({ field: 'counties', op: 'in', value: ['other'] }, { counties: ['alder', 'other'] })).toBe(true);
  });
});

describe('totals, words, eligibility', () => {
  it('computes repeater totals per numeric column', () => {
    expect(computeTotals(loi, LOI_VALID_RESPONSE)).toEqual({ budget_lines: { amount: 2_500_000 } });
    expect(computeTotals(loi, LOI_INVALID_BUDGET_MISMATCH)).toEqual({ budget_lines: { amount: 2_400_000 } });
    expect(computeTotals(loi, {})).toEqual({ budget_lines: { amount: 0 } });
    const c = compileForm(ALL_TYPES);
    expect(computeTotals(c, { rows: [{ what: 'a', qty: 2, cost: 150 }, { what: 'b', qty: 3, cost: 50 }, { what: 'c', qty: 'x' }] })).toEqual({ rows: { qty: 5, cost: 200 } });
  });

  it('counts words like a person would', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount(undefined)).toBe(0);
    expect(wordCount('  Hello,   world! ')).toBe(2);
    expect(wordCount('Arts — for everyone.')).toBe(3);
    expect(wordCount('<p>Hello <strong>bold</strong>&nbsp;world</p>')).toBe(3);
    expect(wordCount("It's 2027: year-round programs.")).toBe(4);
    expect(wordCount(sampleWords(162))).toBe(162);
  });

  it('reports eligibility knock-outs separately from errors', () => {
    const c = compileForm(
      defineForm({
        version: 1,
        title: 'Elig',
        pages: [
          {
            id: 'p',
            title: 'P',
            elements: [
              {
                id: 'budget',
                type: 'currency',
                label: 'Annual budget',
                eligibility: { op: 'gt', value: 100_000_000, message: 'This fund is for organizations with budgets under $1 million.' },
              },
            ],
          },
        ],
      }),
    );
    expect(checkEligibility(c, { budget: 50_000_000 })).toEqual([]);
    const r = validateResponses(c, { budget: 200_000_000 }, { mode: 'submit' });
    expect(r.valid).toBe(true);
    expect(r.knockouts).toEqual([{ fieldId: 'budget', pageId: 'p', message: 'This fund is for organizations with budgets under $1 million.' }]);
  });
});

describe('every field type', () => {
  const c = compileForm(ALL_TYPES);
  const valid: ResponseData = {
    t: 'short',
    lt: 'one two three',
    rt: '<p>one <em>two</em></p>',
    n: 4,
    cur: 50_000,
    d: '2027-06-01',
    s: 'a',
    ms: ['b'],
    cg: ['a', 'b'],
    yn: true,
    nm: { first: 'Ana', last: 'Diaz' },
    addr: { line1: '1 Main St', city: 'Alderton', state: 'CA', postal: '95501' },
    em: 'ana@example.org',
    ph: '(555) 555-0123',
    ein: '12-3456789',
    uei: 'ABC123DEF456',
    files: [{ fileId: 'f', name: 'a.pdf', size: 100 }],
    rows: [{ what: 'x', cost: 10 }],
    lik: { r1: '1', r2: '2' },
    att: { agreed: true, name: 'Ana Diaz' },
  };

  it('accepts a complete, valid response', () => {
    expect(validateResponses(c, valid, { mode: 'submit' })).toMatchObject({ valid: true, errors: [] });
  });

  it('gives a friendly message for each kind of problem', () => {
    const bad: ResponseData = {
      ...valid,
      lt: 'one two three four five six',
      rt: '<p>one two three four five six</p>',
      n: 11,
      cur: 50,
      d: '2026-12-31',
      ms: ['a', 'b'],
      yn: 'maybe',
      nm: { first: 'Ana' },
      addr: { line1: '1 Main St', city: 'Alderton', state: 'CA', postal: 'ABCDE' },
      em: 'not-an-email',
      ph: 'call me',
      uei: 'abc',
      files: [{ fileId: 'a', name: 'a.pdf', size: 1 }, { fileId: 'b', name: 'b.pdf', size: 1 }, { fileId: 'c', name: 'c.pdf', size: 1 }],
      rows: [{ what: 'a', cost: 1 }, { what: 'b', cost: 1 }, { what: 'c', cost: 1 }],
      lik: { r1: '1' },
      att: { agreed: true },
    };
    const r = validateResponses(c, bad, { mode: 'submit' });
    const msg = Object.fromEntries(r.errors.map((e) => [e.pointer, e.message]));
    expect(msg).toEqual({
      '/lt': 'Keep this under 5 words (you have 6).',
      '/rt': 'Keep this under 5 words (you have 6).',
      '/n': 'Enter a number between 0 and 10.',
      '/cur': 'Enter an amount between $1 and $1,000.',
      '/d': 'Pick a date on or after January 1, 2027.',
      '/ms': 'Please pick no more than 1 choice.',
      '/yn': 'Please choose Yes or No.',
      '/nm/last': 'Please add a last name.',
      '/addr/postal': 'Enter a 5-digit ZIP code, like 94110.',
      '/em': 'Enter an email address, like name@example.org.',
      '/ph': 'Enter a phone number with area code, like (555) 555-0123.',
      '/uei': 'Enter the 12-character UEI using capital letters and numbers, like A1B2C3D4E5F6.',
      '/files': 'You can upload up to 2 files. Please remove 1 to continue.',
      '/rows': 'You can add up to 2 rows. Please remove 1 row to continue.',
      '/lik/r2': 'Please choose an answer for “Row two.”',
      '/att/name': 'Please type your full name to sign.',
    });
    expect(r.errors[0]!.pointer).toBe('/lt');
  });

  it('every message tells the applicant what to do', () => {
    const r = validateResponses(c, { ms: ['a', 'a'], d: 'someday', n: 'ten' }, { mode: 'save' });
    for (const e of r.errors) expect(e.message).toMatch(/^(Please|Enter|Pick|Keep|You|This|Your)/);
    expect(r.errors.find((e) => e.pointer === '/ms')?.message).toMatch(/same choice twice|no more than/);
    expect(r.errors.find((e) => e.pointer === '/d')?.message).toBe('Enter a real date, like 2027-03-15.');
    expect(r.errors.find((e) => e.pointer === '/n')?.message).toBe('Enter a number, like 25.');
  });
});
