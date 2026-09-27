// SPDX-License-Identifier: AGPL-3.0-only
// Server-renders the React components to static HTML to prove they mount without a DOM.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileForm, LOI_INVALID_BUDGET_MISMATCH, LOI_VALID_RESPONSE, validateResponses, YOUTH_ARTS_LOI } from '../src';
import { ConflictNotice, FormProgressRail, GmsForm, GmsFormPager } from '../src/react';
import { ALL_TYPES } from './helpers';

const loi = compileForm(YOUTH_ARTS_LOI);

describe('GmsForm (server render)', () => {
  it('renders every LOI page in edit mode with stable field ids', () => {
    for (const page of loi.pages) {
      const html = renderToString(createElement(GmsForm, { compiled: loi, data: LOI_VALID_RESPONSE, currentPageId: page.id, onChange: () => {} }));
      expect(html).toContain(page.title.replace('&', '&amp;'));
      for (const id of page.fieldIds) {
        if (id === 'sponsor_name' || id === 'sponsor_ein') continue; // hidden unless fiscally sponsored
        expect(html, `${page.id}/${id}`).toContain(`id="field-${id}"`);
      }
    }
  });

  it('hides conditional questions until they apply', () => {
    const hidden = renderToString(createElement(GmsForm, { compiled: loi, data: {}, currentPageId: 'about_org', onChange: () => {} }));
    expect(hidden).not.toContain('id="field-sponsor_name"');
    const shown = renderToString(createElement(GmsForm, { compiled: loi, data: { fiscally_sponsored: true }, currentPageId: 'about_org', onChange: () => {} }));
    expect(shown).toContain('id="field-sponsor_name"');
  });

  it('shows the error summary and inline errors', () => {
    const { errors } = validateResponses(loi, LOI_INVALID_BUDGET_MISMATCH, { mode: 'submit' });
    expect(errors.length).toBeGreaterThan(0);
    const html = renderToString(createElement(GmsForm, { compiled: loi, data: LOI_INVALID_BUDGET_MISMATCH, errors, currentPageId: 'budget', onChange: () => {} }));
    expect(html).toContain('data-slot="validation-summary"');
    expect(html).toContain('href="#field-budget_lines"');
  });

  it('renders review and blind modes', () => {
    const review = renderToString(createElement(GmsForm, { compiled: loi, data: LOI_VALID_RESPONSE, mode: 'review', fileHref: (f) => `/files/${f.fileId}` }));
    expect(review).toContain('Riverbend Youth Arts Collective');
    expect(review).toContain('/files/file_loi_budget_001');
    expect(review).toContain('$25,000.00');
    const blind = renderToString(createElement(GmsForm, { compiled: loi, data: LOI_VALID_RESPONSE, mode: 'blind' }));
    expect(blind).toContain('Hidden for blind review');
    expect(blind).not.toContain('Riverbend Youth Arts Collective');
  });

  it('renders every field type', () => {
    const compiled = compileForm(ALL_TYPES);
    for (const page of compiled.pages) {
      const html = renderToString(createElement(GmsForm, { compiled, data: {}, currentPageId: page.id, onChange: () => {}, density: 'staff' }));
      expect(html).toContain(page.title);
    }
  });

  it('renders the pager, progress rail and conflict notice', () => {
    const pager = renderToString(createElement(GmsFormPager, { pages: loi.pages, currentPageId: 'project', onPageChange: () => {} }));
    expect(pager).toContain('Back');
    expect(pager).toContain('Next');
    const rail = renderToString(createElement(FormProgressRail, { compiled: loi, data: LOI_VALID_RESPONSE, currentPageId: 'project' }));
    expect(rail).toContain('sections complete');
    const notice = renderToString(
      createElement(ConflictNotice, {
        compiled: loi,
        conflicts: [{ fieldId: 'project_title', theirValue: 'Murals on Main Street', yourValue: 'Murals on Main', by: 'Maya' }],
        onKeepMine: () => {},
        onUseTheirs: () => {},
      }),
    );
    expect(notice).toContain('Maya changed ‘Project title’ while you were editing');
    expect(notice).toContain('Keep yours');
  });
});
