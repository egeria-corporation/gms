// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defineForm, diffVersions, type FormModel, migrationNotice, templateModel, YOUTH_ARTS_LOI } from '../src';

/** v2 of the LOI with a realistic set of edits. */
function loiV2(): FormModel {
  const m = templateModel('youth_arts_loi_2027');
  const [about, project, budget, attachments] = m.pages as [FormModel['pages'][number], FormModel['pages'][number], FormModel['pages'][number], FormModel['pages'][number]];
  // Summary: 150 → 100 words, relabeled.
  const summary = project.elements.find((e) => e.id === 'project_summary');
  if (summary?.type === 'long_text') {
    summary.maxWords = 100;
    summary.label = 'Summarize your project in 100 words';
  }
  // Remove "other funding"; add a required partners question.
  budget.elements = budget.elements.filter((e) => e.id !== 'other_funding');
  project.elements.push({ id: 'partners', type: 'long_text', label: 'Who are your partners?', required: true, maxWords: 200, blind: false });
  // Move activities to the budget page.
  const activities = project.elements.find((e) => e.id === 'activities')!;
  project.elements = project.elements.filter((e) => e.id !== 'activities');
  budget.elements.unshift(activities);
  // Remove an option from counties; make the support letter required.
  const counties = about.elements.find((e) => e.id === 'counties_served');
  if (counties?.type === 'multi_select') counties.options = counties.options.filter((o) => o.value !== 'other');
  const letter = attachments.elements.find((e) => e.id === 'support_letter');
  if (letter?.type === 'file_upload') letter.required = true;
  // Rename a page; change a rule.
  attachments.title = 'Files & signature';
  const sponsorName = about.elements.find((e) => e.id === 'sponsor_name');
  if (sponsorName && sponsorName.type === 'text') sponsorName.visibleWhen = { field: 'fiscally_sponsored', op: 'truthy' };
  m.flags = { aiDisclosure: false };
  return m;
}

describe('diffVersions', () => {
  it('reports no changes between identical versions', () => {
    expect(diffVersions(YOUTH_ARTS_LOI, templateModel('youth_arts_loi_2027'))).toEqual([]);
  });

  it('describes added, removed, moved and changed fields in plain language', () => {
    const changes = diffVersions(YOUTH_ARTS_LOI, loiV2());
    const summaries = changes.map((c) => c.summary);
    expect(summaries).toEqual([
      'Turned off the “AI disclosure” setting.',
      'Renamed the page “Attachments & attestation” to “Files & signature”.',
      'Added “Who are your partners?” on “Your project” (required).',
      'Removed “What other funding do you have or expect for this project?” from “Budget”.',
      'Moved “What activities will young people take part in?” from “Your project” to “Budget”.',
      "“Fiscal sponsor’s legal name” now shows when 'Is your organization fiscally sponsored?' is Yes.",
      'Changed the choices for “Which counties do you serve?”: removed “Other”.',
      'Renamed “Summarize your project” to “Summarize your project in 100 words”.',
      'Changed the word limit for “Summarize your project in 100 words” from 150 to 100 words.',
      '“Letter of support (optional)” is now required.',
    ]);
    const limit = changes.find((c) => c.property === 'maxWords')!;
    expect(limit).toMatchObject({ kind: 'limit_changed', fieldId: 'project_summary', before: 150, after: 100, affectsAnswers: true, pageId: 'project' });
    expect(changes.find((c) => c.kind === 'field_removed')).toMatchObject({ fieldId: 'other_funding', affectsAnswers: false });
  });

  it('detects type, mapping, blind, page and reorder changes', () => {
    const a = defineForm({
      version: 1,
      title: 'A',
      pages: [
        { id: 'p1', title: 'One', elements: [{ id: 'x', type: 'text', label: 'X' }, { id: 'y', type: 'text', label: 'Y' }, { id: 'z', type: 'text', label: 'Z' }] },
        { id: 'p2', title: 'Two', elements: [] },
      ],
    });
    const b = defineForm({
      version: 1,
      title: 'B',
      pages: [
        { id: 'p3', title: 'Three', elements: [] },
        { id: 'p1', title: 'One', elements: [{ id: 'z', type: 'text', label: 'Z' }, { id: 'x', type: 'long_text', label: 'X', maxWords: 50 }, { id: 'y', type: 'text', label: 'Y', cgMapping: 'project.title', blind: true }] },
      ],
    });
    expect(diffVersions(a, b).map((c) => c.kind)).toEqual([
      'form_renamed',
      'page_added',
      'page_removed',
      'field_reordered',
      'type_changed',
      'mapping_changed',
      'blind_changed',
    ]);
    expect(diffVersions(a, b)[3]!.summary).toBe('Moved “Z” to a new position on “One”.');
    expect(diffVersions(a, b)[4]!.summary).toBe('Changed “X” from a short text question to a long text question.');
  });
});

describe('migrationNotice', () => {
  it('explains what happens to in-progress applications', () => {
    const n = migrationNotice(YOUTH_ARTS_LOI, loiV2());
    expect(n.removed).toEqual([{ fieldId: 'other_funding', label: 'What other funding do you have or expect for this project?' }]);
    expect(n.newRequired).toEqual([
      { fieldId: 'partners', label: 'Who are your partners?', conditional: false },
      { fieldId: 'support_letter', label: 'Letter of support (optional)', conditional: false },
    ]);
    expect(n.carriedOver).toHaveLength(18);
    expect(n.carriedOver).not.toContain('other_funding');
    expect(n.needsReview.map((r) => r.fieldId)).toEqual(['counties_served', 'project_summary']);
    expect(n.details).toEqual([
      'Answers to 18 questions carry over unchanged.',
      "1 question was removed (“What other funding do you have or expect for this project?”). Answers already given stay in each application's history, but they are hidden from the form.",
      'Applicants must answer 2 new required questions before they can submit: “Who are your partners?” and “Letter of support (optional)”.',
      'Some answers may need another look: Changed the choices for “Which counties do you serve?”: removed “Other”.',
      'Some answers may need another look: Changed the word limit for “Summarize your project in 100 words” from 150 to 100 words.',
      'Turned off the “AI disclosure” setting.',
    ]);
    expect(n.summary).toBe(
      'Applications already in progress will switch to this version. Answers to 18 questions carry over unchanged. Applicants will be asked to answer 2 new required questions before they submit.',
    );
  });

  it('says nothing changes when the versions match', () => {
    const n = migrationNotice(YOUTH_ARTS_LOI, templateModel('youth_arts_loi_2027'));
    expect(n.summary).toBe('Applications already in progress will switch to this version. Answers to 19 questions carry over unchanged. Nothing else changes for applicants.');
    expect(n.removed).toEqual([]);
    expect(n.newRequired).toEqual([]);
  });

  it('marks conditionally required new fields', () => {
    const a = defineForm({ version: 1, title: 'A', pages: [{ id: 'p', title: 'P', elements: [{ id: 'q', type: 'yes_no', label: 'Q' }] }] });
    const b = defineForm({
      version: 1,
      title: 'A',
      pages: [{ id: 'p', title: 'P', elements: [{ id: 'q', type: 'yes_no', label: 'Q' }, { id: 'why', type: 'text', label: 'Why?', requiredWhen: { field: 'q', op: 'eq', value: true } }] }],
    });
    const n = migrationNotice(a, b);
    expect(n.newRequired).toEqual([{ fieldId: 'why', label: 'Why?', conditional: true }]);
    expect(n.details).toContain('Depending on their answers, applicants may also need to answer “Why?” before they can submit.');
  });
});
