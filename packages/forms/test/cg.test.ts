// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  CG_PATHS,
  cgTransformFor,
  compileForm,
  FULL_PROPOSAL_TEMPLATE,
  fromCommonGrants,
  LOI_VALID_RESPONSE,
  prefillFromProfile,
  SAMPLE_APPLICANT_PROFILE,
  suggestCgPath,
  toCommonGrants,
  YOUTH_ARTS_LOI,
} from '../src';

const loi = compileForm(YOUTH_ARTS_LOI);

describe('CommonGrants mapping', () => {
  it('lists well-known paths with unique ids', () => {
    const paths = CG_PATHS.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of ['organization.name', 'organization.ein', 'organization.uei', 'organization.mission', 'organization.annualBudget', 'organization.address', 'organization.website', 'organization.phone', 'organization.email', 'organization.type', 'contact.name', 'contact.email', 'contact.phone', 'project.title', 'project.summary', 'project.startDate', 'project.endDate', 'funding.requestedAmount']) {
      expect(paths).toContain(p);
    }
  });

  it('suggests paths from labels', () => {
    expect(suggestCgPath({ label: 'Employer Identification Number (EIN)', type: 'ein' })?.path).toBe('organization.ein');
    expect(suggestCgPath({ label: 'How much are you requesting?', type: 'currency' })?.path).toBe('funding.requestedAmount');
    expect(suggestCgPath({ label: 'Project title', type: 'text' })?.path).toBe('project.title');
    expect(suggestCgPath({ label: 'Favorite color', type: 'text' })).toBeUndefined();
    expect(suggestCgPath({ label: 'Mission', type: 'number' })).toBeUndefined();
    expect(cgTransformFor('currency', 'funding.requestedAmount')).toBe('money');
    expect(cgTransformFor('text', 'organization.name')).toBe('identity');
  });

  it('prefills empty mapped fields from the applicant profile (never overwriting answers)', () => {
    expect(prefillFromProfile(loi, SAMPLE_APPLICANT_PROFILE)).toEqual({
      org_legal_name: 'Riverbend Youth Arts Collective',
      org_ein: '84-1234567',
      annual_budget: 42_000_000,
    });
    expect(prefillFromProfile(loi, SAMPLE_APPLICANT_PROFILE, { org_legal_name: 'Riverbend YAC', org_ein: '' })).toEqual({
      org_ein: '84-1234567',
      annual_budget: 42_000_000,
    });
  });

  it('prefills composite fields (name, address) in the full proposal', () => {
    const c = compileForm(FULL_PROPOSAL_TEMPLATE);
    const p = prefillFromProfile(c, SAMPLE_APPLICANT_PROFILE);
    expect(p).toMatchObject({
      org_uei: 'RYAC12345678',
      org_address: { line1: '410 Main Street', city: 'Alderton', state: 'CA', postal: '95501', county: 'Alder' },
      org_website: 'https://riverbend-arts.example',
      contact_name: { first: 'Jordan', last: 'Reyes' },
      contact_email: 'jordan@riverbend-arts.example',
      contact_phone: '(555) 555-0142',
    });
  });

  it('exports form data as a CG-shaped object', () => {
    expect(toCommonGrants(loi, LOI_VALID_RESPONSE)).toEqual({
      organization: { name: 'Riverbend Youth Arts Collective', ein: '84-1234567', annualBudget: { amount: '420000.00', currency: 'USD' } },
      project: {
        title: 'Murals on Main: Youth Public Art Studio',
        summary: LOI_VALID_RESPONSE.project_summary,
        beneficiaryCount: 40,
      },
      funding: { requestedAmount: { amount: '25000.00', currency: 'USD' } },
    });
  });

  it('round-trips mapped fields: data → CG → data', () => {
    const cg = toCommonGrants(loi, LOI_VALID_RESPONSE);
    const back = fromCommonGrants(loi, cg);
    for (const id of Object.keys(loi.mappingToCg)) expect(back[id]).toEqual(LOI_VALID_RESPONSE[id]);
    const full = compileForm(FULL_PROPOSAL_TEMPLATE);
    const data = {
      org_address: { line1: '1 Elm St', line2: 'Suite 2', city: 'Brambleton', state: 'CA', postal: '95502' },
      contact_name: { first: 'Sam', last: 'Lee' },
      request_amount: 1_234_567,
      project_start: '2027-01-15',
    };
    expect(fromCommonGrants(full, toCommonGrants(full, data))).toEqual(data);
  });

  it('accepts plain numbers and strings for money when importing', () => {
    expect(fromCommonGrants(loi, { funding: { requestedAmount: '12,500.50' }, organization: { annualBudget: 1000 } })).toEqual({ request_amount: 1_250_050, annual_budget: 100_000 });
  });
});
