// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defineForm, detectRuleCycles, type FormModel, listFields, YOUTH_ARTS_LOI } from '../src';
import {
  addPage,
  allIds,
  applyRule,
  checkRule,
  conditionToDraft,
  containerIds,
  createField,
  draftToCondition,
  duplicateElement,
  getElement,
  idProblem,
  locateElement,
  mappingConflicts,
  mappingSuggestion,
  moveElement,
  moveElementBy,
  moveElementToPage,
  movePage,
  opChoices,
  referencesTo,
  removeElement,
  removePage,
  renameElementId,
  restoreElement,
  slugifyId,
  uniqueId,
  updateElement,
} from '../src/react';
import { bankItemMatches, fieldFromBankItem } from '../src/react';
import { QUESTION_BANK } from '../src';

const model: FormModel = defineForm({
  version: 1,
  title: 'Test form',
  pages: [
    {
      id: 'p1',
      title: 'One',
      elements: [
        { id: 'a', type: 'text', label: 'A' },
        { id: 'b', type: 'yes_no', label: 'B' },
        { type: 'section', id: 's1', title: 'Section', elements: [{ id: 'c', type: 'text', label: 'C', visibleWhen: { field: 'b', op: 'eq', value: true } }] },
      ],
    },
    { id: 'p2', title: 'Two', elements: [{ id: 'd', type: 'currency', label: 'Amount requested', cgMapping: 'funding.requestedAmount' }] },
  ],
});

const ids = (m: FormModel, c: `page:${string}` | `section:${string}`) => containerIds(m, c);

describe('builder model operations', () => {
  it('locates elements on pages and inside sections', () => {
    expect(locateElement(model, 'b')).toEqual({ pageIndex: 0, pageId: 'p1', index: 1 });
    expect(locateElement(model, 'c')).toEqual({ pageIndex: 0, pageId: 'p1', sectionId: 's1', index: 0 });
    expect(locateElement(model, 'nope')).toBeUndefined();
  });

  it('moves up and down, stepping out of a section at its edge', () => {
    const up = moveElementBy(model, 'b', -1);
    expect(ids(up, 'page:p1')).toEqual(['b', 'a', 's1']);
    expect(moveElementBy(model, 'a', -1)).toBe(model);
    const out = moveElementBy(model, 'c', -1);
    expect(ids(out, 'page:p1')).toEqual(['a', 'b', 'c', 's1']);
    expect(ids(out, 'section:s1')).toEqual([]);
    const after = moveElementBy(model, 'c', 1);
    expect(ids(after, 'page:p1')).toEqual(['a', 'b', 's1', 'c']);
  });

  it('moves between pages and into sections, never nesting sections', () => {
    const toP2 = moveElementToPage(model, 'a', 'p2');
    expect(ids(toP2, 'page:p1')).toEqual(['b', 's1']);
    expect(ids(toP2, 'page:p2')).toEqual(['d', 'a']);
    const intoSection = moveElement(model, 'a', 'section:s1', 1);
    expect(ids(intoSection, 'section:s1')).toEqual(['c', 'a']);
    expect(moveElement(model, 's1', 'section:s1', 0)).toBe(model);
    // Same-list moves use "index after removal" (arrayMove semantics).
    expect(ids(moveElement(model, 'a', 'page:p1', 2), 'page:p1')).toEqual(['b', 's1', 'a']);
  });

  it('never mutates its input', () => {
    const before = JSON.stringify(model);
    moveElementBy(model, 'b', -1);
    duplicateElement(model, 's1');
    removeElement(model, 'a');
    updateElement(model, 'a', { label: 'Changed' });
    expect(JSON.stringify(model)).toBe(before);
  });

  it('duplicates with fresh ids, a "(copy)" label and no CommonGrants mapping', () => {
    const r = duplicateElement(model, 'd');
    expect(r.newId).toBe('d_copy');
    const copy = getElement(r.model, 'd_copy');
    expect(copy).toMatchObject({ label: 'Amount requested (copy)', type: 'currency' });
    expect(copy && 'cgMapping' in copy ? copy.cgMapping : undefined).toBeUndefined();
    expect(ids(r.model, 'page:p2')).toEqual(['d', 'd_copy']);
    const s = duplicateElement(model, 's1');
    expect(s.newId).toBe('s1_copy');
    expect(ids(s.model, 'section:s1_copy')).toEqual(['c_copy']);
    expect(allIds(s.model).size).toBe(allIds(model).size + 2);
  });

  it('deletes and restores an element in place', () => {
    const r = removeElement(model, 'c');
    expect(getElement(r.model, 'c')).toBeUndefined();
    expect(r.removed).toMatchObject({ container: 'section:s1', index: 0 });
    const back = restoreElement(r.model, r.removed!);
    expect(back).toEqual(model);
    // If the section is gone too, it lands on the first page.
    const noSection = removeElement(r.model, 's1').model;
    expect(locateElement(restoreElement(noSection, r.removed!), 'c')?.pageId).toBe('p1');
  });

  it('adds, moves and removes pages', () => {
    const r = addPage(model, 'Budget');
    expect(r.pageId).toBe('budget');
    expect(r.model.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'budget']);
    expect(movePage(r.model, 'budget', -1).pages.map((p) => p.id)).toEqual(['p1', 'budget', 'p2']);
    expect(movePage(r.model, 'p1', -1)).toBe(r.model);
    expect(removePage(r.model, 'p1').pages.map((p) => p.id)).toEqual(['p2', 'budget']);
  });

  it('creates unique ids and valid new fields of every kind', () => {
    expect(slugifyId('Project title!')).toBe('project_title');
    expect(slugifyId('2027 budget')).toBe('question_2027_budget');
    expect(uniqueId(model, 'a')).toBe('a_2');
    expect(idProblem(model, 'a', 'b')).toMatch(/already used/);
    expect(idProblem(model, 'a', '9x')).toMatch(/letters/);
    expect(idProblem(model, 'a', 'a')).toBeUndefined();
    const f = createField(model, 'repeater_table');
    expect(f.type).toBe('repeater_table');
    expect(f.id).toBe('repeater_table');
    const t = createField(model, 'text');
    expect(allIds(model).has(t.id)).toBe(false);
  });

  it('renames an id and rewrites the rules that read it', () => {
    const r = renameElementId(model, 'b', 'is_sponsored');
    expect(getElement(r, 'c')).toMatchObject({ visibleWhen: { field: 'is_sponsored', op: 'eq', value: true } });
    expect(renameElementId(model, 'b', 'a')).toBe(model); // taken
    expect(referencesTo(model, 'b')).toEqual([{ elementId: 'c', label: 'C', kind: 'visibleWhen' }]);
  });

  it('reports CommonGrants mapping conflicts and suggestions', () => {
    const two = updateElement(model, 'a', { cgMapping: 'funding.requestedAmount' });
    expect(mappingConflicts(two).get('funding.requestedAmount')).toEqual(['a', 'd']);
    expect(mappingConflicts(model).size).toBe(0);
    const title = createField(model, 'text', { label: 'Project title' });
    expect(mappingSuggestion(model, title)).toBe('project.title');
  });

  it('inserts question bank items with a free id', () => {
    const item = QUESTION_BANK.find((i) => i.key === 'org_ein')!;
    const f = fieldFromBankItem(YOUTH_ARTS_LOI, item);
    expect(f.id).toBe('org_ein_2');
    expect(bankItemMatches(item, 'tax id', null)).toBe(true);
    expect(bankItemMatches(item, 'mural budget', null)).toBe(false);
    expect(bankItemMatches(item, 'employer', 'tax')).toBe(true);
    expect(bankItemMatches(item, '', 'narrative')).toBe(false);
  });
});

describe('rule drafts (logic editor)', () => {
  it('round-trips simple and grouped conditions', () => {
    const single = { field: 'b', op: 'eq', value: true } as const;
    expect(draftToCondition(conditionToDraft(single)!)).toEqual(single);
    const any = { any: [single, { flag: 'aiDisclosure' }] };
    expect(conditionToDraft(any)).toEqual({ match: 'any', clauses: [{ kind: 'field', field: 'b', op: 'eq', value: true }, { kind: 'flag', flag: 'aiDisclosure' }] });
    expect(draftToCondition(conditionToDraft(any)!)).toEqual(any);
    expect(conditionToDraft({ all: [{ any: [single] }] })).toBeNull();
    expect(draftToCondition({ match: 'all', clauses: [] })).toBeUndefined();
    // Operators without a value drop any stale value.
    expect(draftToCondition({ match: 'all', clauses: [{ kind: 'field', field: 'a', op: 'truthy', value: 'x' }] })).toEqual({ field: 'a', op: 'truthy' });
  });

  it('offers operators that fit the question type', () => {
    expect(opChoices('yes_no').map((c) => c.label)).toEqual(['is Yes', 'is No', 'is No or not answered']);
    expect(opChoices('currency').map((c) => c.op)).toContain('gt');
    expect(opChoices('file_upload').map((c) => c.op)).toEqual(['truthy', 'falsy']);
  });

  it('flags incomplete clauses and blocks circular rules', () => {
    const incomplete = checkRule(model, 'a', 'visibleWhen', { match: 'all', clauses: [{ kind: 'field', field: '', op: 'eq' }] });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.clauseProblems.get(0)).toBe('Choose a question.');
    // c shows when b is Yes; making b show only when c is answered is a loop.
    const loop = checkRule(model, 'b', 'visibleWhen', { match: 'all', clauses: [{ kind: 'field', field: 'c', op: 'truthy' }] });
    expect(loop.ok).toBe(false);
    expect(loop.cycles[0]).toEqual(expect.arrayContaining(['b', 'c']));
    const fine = checkRule(model, 'a', 'visibleWhen', { match: 'all', clauses: [{ kind: 'field', field: 'b', op: 'eq', value: true }] });
    expect(fine.ok).toBe(true);
    expect(detectRuleCycles(fine.next).cycles).toEqual([]);
  });

  it('requiredWhen replaces "always required"', () => {
    const req = updateElement(model, 'a', { required: true });
    const next = applyRule(req, 'a', 'requiredWhen', { field: 'b', op: 'eq', value: true });
    expect(getElement(next, 'a')).toMatchObject({ required: false, requiredWhen: { field: 'b', op: 'eq', value: true } });
    expect(listFields(next)).toHaveLength(4);
  });
});
