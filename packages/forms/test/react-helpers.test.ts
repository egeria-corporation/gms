// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { compileForm, LOI_DRAFT_RESPONSE, LOI_VALID_RESPONSE, validateResponses, YOUTH_ARTS_LOI } from '../src';
import {
  answerText,
  applyMarkdownFormat,
  canRedo,
  canUndo,
  createUndoStack,
  currencyDisplayValue,
  domIdForPointer,
  fieldDomId,
  formatCentsForInput,
  formatEin,
  markdownToPlainText,
  normalizeUei,
  pageProgress,
  parseDollarsToCents,
  parseInline,
  parseMarkdown,
  parseNumberInput,
  recordChange,
  redo,
  resetPresent,
  ruleHolds,
  safeHref,
  setAnswer,
  sumHint,
  undo,
} from '../src/react';

describe('money input', () => {
  it('parses dollars into integer cents', () => {
    expect(parseDollarsToCents('12500')).toBe(1_250_000);
    expect(parseDollarsToCents('$12,500.5')).toBe(1_250_050);
    expect(parseDollarsToCents(' 12,500.05 ')).toBe(1_250_005);
    expect(parseDollarsToCents('.75')).toBe(75);
    expect(parseDollarsToCents('-40')).toBe(-4000);
    expect(parseDollarsToCents('USD 10')).toBe(1000);
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('   ')).toBeNull();
    expect(parseDollarsToCents('12.345')).toBeUndefined();
    expect(parseDollarsToCents('twelve')).toBeUndefined();
    expect(parseDollarsToCents('1e5')).toBeUndefined();
  });

  it('formats cents for the input box', () => {
    expect(formatCentsForInput(1_250_000)).toBe('12,500');
    expect(formatCentsForInput(1_250_050)).toBe('12,500.50');
    expect(formatCentsForInput(5)).toBe('0.05');
    expect(formatCentsForInput(-4000)).toBe('-40');
    expect(formatCentsForInput(null)).toBe('');
    expect(currencyDisplayValue('abc')).toBe('abc');
    expect(currencyDisplayValue(undefined)).toBe('');
  });

  it('round-trips', () => {
    for (const cents of [0, 1, 99, 100, 123_456_789, 2_500_000]) expect(parseDollarsToCents(formatCentsForInput(cents))).toBe(cents);
  });

  it('parses plain numbers and masks EIN / UEI', () => {
    expect(parseNumberInput('1,200')).toBe(1200);
    expect(parseNumberInput('2.5', true)).toBeUndefined();
    expect(parseNumberInput('')).toBeNull();
    expect(formatEin('841234567')).toBe('84-1234567');
    expect(formatEin('84-12')).toBe('84-12');
    expect(formatEin('8')).toBe('8');
    expect(formatEin('84123456799')).toBe('84-1234567');
    expect(normalizeUei('a1b2-c3d4 e5f6 g7')).toBe('A1B2C3D4E5F6');
  });
});

describe('undo stack', () => {
  it('undoes and redoes', () => {
    let s = createUndoStack(1);
    s = recordChange(s, 2);
    s = recordChange(s, 3);
    expect(canUndo(s)).toBe(true);
    s = undo(s);
    expect(s.present).toBe(2);
    expect(canRedo(s)).toBe(true);
    s = redo(s);
    expect(s.present).toBe(3);
    s = undo(undo(s));
    expect(s.present).toBe(1);
    expect(undo(s)).toBe(s);
    s = recordChange(s, 9);
    expect(canRedo(s)).toBe(false);
  });

  it('merges bursts with the same key inside the window', () => {
    let s = createUndoStack('');
    s = recordChange(s, 'P', { key: 'label', now: 0 });
    s = recordChange(s, 'Pr', { key: 'label', now: 400 });
    s = recordChange(s, 'Pro', { key: 'label', now: 800 });
    expect(s.past).toEqual(['']);
    s = recordChange(s, 'Proj', { key: 'label', now: 5000 });
    expect(s.past).toEqual(['', 'Pro']);
    s = recordChange(s, 'Project', { key: 'help', now: 5100 });
    expect(s.past).toEqual(['', 'Pro', 'Proj']);
  });

  it('caps history and adopts external values', () => {
    let s = createUndoStack(0);
    for (let i = 1; i <= 10; i++) s = recordChange(s, i, { limit: 3 });
    expect(s.past).toEqual([7, 8, 9]);
    const r = resetPresent(undo(s), 42);
    expect(r.present).toBe(42);
    expect(r.future).toEqual([]);
  });
});

describe('safe markdown', () => {
  it('parses blocks and inline marks', () => {
    const blocks = parseMarkdown('# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote']);
    expect(parseInline('a **b** _c_ `d`').map((n) => n.kind)).toEqual(['text', 'strong', 'text', 'em', 'text', 'code']);
    expect(parseInline('snake_case_name').map((n) => n.kind)).toEqual(['text']);
  });

  it('allows only safe link targets', () => {
    expect(parseInline('[site](https://example.org)')[0]).toMatchObject({ kind: 'link', href: 'https://example.org' });
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.kind === 'link')).toBe(false);
    expect(safeHref('data:text/html,hi')).toBeUndefined();
    expect(safeHref('/apply')).toBe('/apply');
    expect(safeHref('//evil.example')).toBeUndefined();
    expect(markdownToPlainText('Hello **there** [friend](https://example.org)')).toBe('Hello there friend');
  });

  it('keeps raw HTML as text', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks[0]).toEqual({ kind: 'paragraph', children: [{ kind: 'text', text: '<script>alert(1)</script>' }] });
  });

  it('applies toolbar formats', () => {
    expect(applyMarkdownFormat('make bold', 5, 9, 'bold')).toEqual({ text: 'make **bold**', selectionStart: 7, selectionEnd: 11 });
    expect(applyMarkdownFormat('make **bold**', 7, 11, 'bold')).toEqual({ text: 'make bold', selectionStart: 5, selectionEnd: 9 });
    expect(applyMarkdownFormat('x', 1, 1, 'italic').text).toBe('x*italic text*');
    expect(applyMarkdownFormat('one\ntwo', 0, 7, 'bullets').text).toBe('- one\n- two');
    expect(applyMarkdownFormat('- one\n- two', 0, 11, 'bullets').text).toBe('one\ntwo');
    expect(applyMarkdownFormat('one\ntwo', 0, 7, 'numbers').text).toBe('1. one\n2. two');
    const link = applyMarkdownFormat('see site', 4, 8, 'link');
    expect(link.text).toBe('see [site](https://)');
    expect(link.text.slice(link.selectionStart, link.selectionEnd)).toBe('https://');
  });
});

describe('form state helpers', () => {
  const loi = compileForm(YOUTH_ARTS_LOI);

  it('builds stable DOM ids from pointers', () => {
    expect(fieldDomId('project_title')).toBe('field-project_title');
    expect(domIdForPointer('/budget_lines/0/amount')).toBe('field-budget_lines-0-amount');
    expect(domIdForPointer('/project_title', 'preview-')).toBe('preview-field-project_title');
  });

  it('computes per-page progress', () => {
    const empty = pageProgress(loi, {});
    expect(empty.every((p) => p.status === 'not_started')).toBe(true);
    const draft = pageProgress(loi, LOI_DRAFT_RESPONSE);
    expect(draft.find((p) => p.id === 'about_org')?.status).toBe('in_progress');
    const done = pageProgress(loi, LOI_VALID_RESPONSE);
    expect(done.every((p) => p.status === 'complete')).toBe(true);
    const { errors } = validateResponses(loi, { ...LOI_VALID_RESPONSE, org_ein: '12' }, { mode: 'save' });
    expect(pageProgress(loi, LOI_VALID_RESPONSE, errors).find((p) => p.id === 'about_org')?.status).toBe('error');
  });

  it('formats answers as plain text', () => {
    expect(answerText(loi.fieldMeta.request_amount!, 2_500_000)).toBe('$25,000.00');
    expect(answerText(loi.fieldMeta.fiscally_sponsored!, false)).toBe('No');
    expect(answerText(loi.fieldMeta.counties_served!, ['alder', 'cinder'])).toBe('Alder County, Cinder County');
    expect(answerText(loi.fieldMeta.attestation!, { agreed: true, name: 'Jordan Reyes' })).toBe('Confirmed — signed by Jordan Reyes');
    expect(answerText(loi.fieldMeta.project_title!, '')).toBeUndefined();
  });

  it('sets and clears answers immutably', () => {
    const d = { a: 1 };
    expect(setAnswer(d, 'b', 2)).toEqual({ a: 1, b: 2 });
    expect(setAnswer(d, 'a', undefined)).toEqual({});
    expect(d).toEqual({ a: 1 });
  });

  it('evaluates compiled UI rules like the server', () => {
    const rule = { effect: 'SHOW', condition: { scope: '#', schema: { required: ['x'], properties: { x: { const: true } } } } } as never;
    expect(ruleHolds(rule, { x: true })).toBe(true);
    expect(ruleHolds(rule, {})).toBe(false);
    expect(ruleHolds(undefined, {})).toBe(true);
  });

  it('writes the live budget hint', () => {
    expect(sumHint({ total: 2_400_000, target: 2_500_000, targetLabel: 'Request', isMoney: true, noun: 'budget lines' })).toEqual({
      tone: 'warn',
      text: 'Your budget lines add up to $24,000. They need to add up to $25,000 (“Request”) — $1,000 to go.',
    });
    expect(sumHint({ total: 5, target: 5, targetLabel: 'Total', isMoney: false }).tone).toBe('ok');
    expect(sumHint({ total: 5, target: undefined, targetLabel: 'Total', isMoney: false }).tone).toBe('info');
  });
});
