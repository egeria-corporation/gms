// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  compileForm,
  defineForm,
  describeCondition,
  describeFieldRules,
  describeRule,
  detectRuleCycles,
  type ElementInput,
  type FormModel,
  humanizeFlag,
  YOUTH_ARTS_LOI,
} from '../src';

function form(...pages: ElementInput[][]): FormModel {
  return defineForm({ version: 1, title: 'T', pages: pages.map((elements, i) => ({ id: `p${i + 1}`, title: `Page ${i + 1}`, elements })) });
}

describe('rule descriptions', () => {
  it('describes the LOI sponsor rule in plain language', () => {
    const cond = YOUTH_ARTS_LOI.pages[0]!.elements.find((e) => e.id === 'sponsor_ein')!;
    expect('visibleWhen' in cond && cond.visibleWhen).toBeTruthy();
    expect(describeRule('visibleWhen', { field: 'fiscally_sponsored', op: 'eq', value: true }, YOUTH_ARTS_LOI)).toBe(
      "Show when 'Is your organization fiscally sponsored?' is Yes",
    );
    expect(describeRule('requiredWhen', { field: 'fiscally_sponsored', op: 'eq', value: false }, YOUTH_ARTS_LOI)).toBe(
      "Required when 'Is your organization fiscally sponsored?' is No",
    );
    // Works from a compiled form too.
    expect(describeCondition({ field: 'fiscally_sponsored', op: 'truthy' }, compileForm(YOUTH_ARTS_LOI))).toBe("'Is your organization fiscally sponsored?' is Yes");
  });

  it('uses option labels, money and plain words for each operator', () => {
    const m = YOUTH_ARTS_LOI;
    expect(describeCondition({ field: 'counties_served', op: 'in', value: ['alder', 'other'] }, m)).toBe("'Which counties do you serve?' includes any of 'Alder County' or 'Other'");
    expect(describeCondition({ field: 'counties_served', op: 'in', value: ['other'] }, m)).toBe("'Which counties do you serve?' includes 'Other'");
    expect(describeCondition({ field: 'request_amount', op: 'gt', value: 1_000_000 }, m)).toBe("'How much are you requesting?' is more than $10,000");
    expect(describeCondition({ field: 'youth_served', op: 'lt', value: 10 }, m)).toBe("'How many young people will take part?' is less than 10");
    expect(describeCondition({ field: 'project_title', op: 'truthy' }, m)).toBe("'Project title' is answered");
    expect(describeCondition({ field: 'project_title', op: 'falsy' }, m)).toBe("'Project title' is blank");
    expect(describeCondition({ field: 'project_title', op: 'neq', value: 'Draft' }, m)).toBe("'Project title' is not 'Draft'");
    expect(
      describeCondition(
        { all: [{ field: 'fiscally_sponsored', op: 'eq', value: true }, { any: [{ field: 'youth_served', op: 'gt', value: 100 }, { flag: 'aiDisclosure' }] }] },
        m,
      ),
    ).toBe("'Is your organization fiscally sponsored?' is Yes and ('How many young people will take part?' is more than 100 or the 'AI disclosure' setting is on)");
    expect(describeCondition({ field: 'gone', op: 'truthy' }, m)).toBe("'gone' (a question that no longer exists) is answered");
    expect(humanizeFlag('aiDisclosure')).toBe('AI disclosure');
  });

  it('summarizes every rule on a field', () => {
    expect(describeFieldRules(YOUTH_ARTS_LOI, 'sponsor_ein')).toEqual([
      "Show when 'Is your organization fiscally sponsored?' is Yes",
      "Required when 'Is your organization fiscally sponsored?' is Yes",
    ]);
    expect(describeFieldRules(YOUTH_ARTS_LOI, 'org_ein')).toEqual(['Always required']);
    expect(describeFieldRules(YOUTH_ARTS_LOI, 'ai_disclosure')).toEqual(["Required when the 'AI disclosure' setting is on"]);
  });
});

describe('detectRuleCycles', () => {
  it('finds nothing wrong in the LOI', () => {
    expect(detectRuleCycles(YOUTH_ARTS_LOI)).toEqual({ cycles: [], unknownReferences: [], nonQuestionReferences: [], laterPageReferences: [] });
  });

  it('finds a direct cycle', () => {
    const m = form([
      { id: 'a', type: 'yes_no', label: 'A', visibleWhen: { field: 'b', op: 'truthy' } },
      { id: 'b', type: 'yes_no', label: 'B', visibleWhen: { field: 'a', op: 'truthy' } },
    ]);
    expect(detectRuleCycles(m).cycles).toEqual([['a', 'b', 'a']]);
  });

  it('finds a transitive cycle, including through enabledWhen and sections', () => {
    const m = form(
      [
        { id: 'a', type: 'yes_no', label: 'A', visibleWhen: { field: 'c', op: 'truthy' } },
        { id: 'b', type: 'yes_no', label: 'B', enabledWhen: { all: [{ field: 'a', op: 'truthy' }, { flag: 'x' }] } },
        { id: 'free', type: 'yes_no', label: 'Free' },
      ],
      [
        {
          type: 'section',
          id: 'sec',
          title: 'Section',
          visibleWhen: { field: 'b', op: 'truthy' },
          elements: [{ id: 'c', type: 'yes_no', label: 'C' }],
        },
      ],
    );
    expect(detectRuleCycles(m).cycles).toEqual([['a', 'c', 'b', 'a']]);
  });

  it('treats a field that depends on itself as a cycle', () => {
    const m = form([{ id: 'a', type: 'text', label: 'A', visibleWhen: { field: 'a', op: 'truthy' } }]);
    expect(detectRuleCycles(m).cycles).toEqual([['a', 'a']]);
  });

  it('does not count requiredWhen loops as cycles (they cannot deadlock)', () => {
    const m = form([
      { id: 'a', type: 'text', label: 'A', requiredWhen: { field: 'b', op: 'falsy' } },
      { id: 'b', type: 'text', label: 'B', requiredWhen: { field: 'a', op: 'falsy' } },
    ]);
    expect(detectRuleCycles(m).cycles).toEqual([]);
  });

  it('reports unknown fields, non-question references and later-page references', () => {
    const m = form(
      [
        { type: 'info_block', id: 'intro', markdown: 'Hi' },
        { id: 'a', type: 'text', label: 'A', visibleWhen: { field: 'ghost', op: 'truthy' } },
        { id: 'b', type: 'text', label: 'B', requiredWhen: { field: 'intro', op: 'truthy' } },
        { id: 'c', type: 'text', label: 'C', visibleWhen: { field: 'later', op: 'truthy' } },
      ],
      [{ id: 'later', type: 'yes_no', label: 'Later' }],
    );
    const r = detectRuleCycles(m);
    expect(r.unknownReferences).toEqual([{ fieldId: 'a', rule: 'visibleWhen', ref: 'ghost' }]);
    expect(r.nonQuestionReferences).toEqual([{ fieldId: 'b', rule: 'requiredWhen', ref: 'intro' }]);
    expect(r.laterPageReferences).toEqual([{ fieldId: 'c', rule: 'visibleWhen', ref: 'later' }]);
    expect(r.cycles).toEqual([]);
  });
});
