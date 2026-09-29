// SPDX-License-Identifier: AGPL-3.0-or-later
// Sample (fictional) response data for the Youth Arts Fund LOI, a sample applicant profile, and a
// sample CommonGrants form-library JSON document for import tests.
import type { ResponseData } from './util';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Deterministic filler text with exactly `n` words. */
export function sampleWords(n: number): string {
  const bank = ['young', 'artists', 'paint', 'murals', 'with', 'mentors', 'across', 'town', 'every', 'week', 'and', 'share', 'their', 'work', 'at', 'community', 'events'];
  return Array.from({ length: n }, (_, i) => bank[i % bank.length]).join(' ') + '.';
}

export const LOI_VALID_RESPONSE: ResponseData = {
  org_legal_name: 'Riverbend Youth Arts Collective',
  org_ein: '84-1234567',
  fiscally_sponsored: false,
  annual_budget: 42_000_000,
  counties_served: ['alder', 'cinder'],
  project_title: 'Murals on Main: Youth Public Art Studio',
  project_summary:
    'Murals on Main is a free after-school studio where teens design and paint public murals with local teaching artists. Over one school year, young people learn drawing, color and teamwork, then lead a community vote on the final designs. Each mural ends with a block party where the artists share their work with neighbors.',
  age_groups: ['12-14', '15-17'],
  youth_served: 40,
  activities:
    'Twice a week, students meet at our studio on Main Street for two-hour sessions led by two teaching artists. The first term covers sketching, color theory and scale drawings. In the second term, small teams design a mural for a wall donated by a local business, present their ideas at a community meeting, and paint the final piece together. Older students serve as paid peer mentors.',
  request_amount: 2_500_000,
  budget_lines: [
    { item: 'Teaching artist fees', category: 'personnel', amount: 1_200_000 },
    { item: 'Paint, brushes and primer', category: 'supplies', amount: 450_000 },
    { item: 'Studio rent (share)', category: 'space', amount: 300_000 },
    { item: 'Peer mentor stipends', category: 'stipends', amount: 550_000 },
  ],
  other_funding: 'Alder Community Foundation, $10,000 (secured). Main Street Merchants Association, $2,500 (pending).',
  budget_file: { fileId: 'file_loi_budget_001', name: 'murals-on-main-budget.xlsx', size: 48_213, mimeType: XLSX },
  ai_disclosure: 'None.',
  attestation: { agreed: true, name: 'Jordan Reyes' },
};

/** Budget lines add up to $24,000 but the request is $25,000. */
export const LOI_INVALID_BUDGET_MISMATCH: ResponseData = {
  ...LOI_VALID_RESPONSE,
  budget_lines: [
    { item: 'Teaching artist fees', category: 'personnel', amount: 1_200_000 },
    { item: 'Paint, brushes and primer', category: 'supplies', amount: 450_000 },
    { item: 'Studio rent (share)', category: 'space', amount: 300_000 },
    { item: 'Peer mentor stipends', category: 'stipends', amount: 450_000 },
  ],
};

/** The project summary is 162 words; the limit is 150. */
export const LOI_INVALID_OVER_WORD_LIMIT: ResponseData = {
  ...LOI_VALID_RESPONSE,
  project_summary: sampleWords(162),
};

/** Fiscally sponsored, sponsor name given, sponsor EIN missing. */
export const LOI_INVALID_MISSING_SPONSOR_EIN: ResponseData = {
  ...LOI_VALID_RESPONSE,
  fiscally_sponsored: true,
  sponsor_name: 'Cedar Commons Fiscal Partners',
};

/** A fiscally sponsored applicant with both sponsor answers (valid). */
export const LOI_VALID_SPONSORED_RESPONSE: ResponseData = {
  ...LOI_INVALID_MISSING_SPONSOR_EIN,
  sponsor_ein: '91-7654321',
};

/** An early draft: a few answers, nothing else. Valid in save mode, not in submit mode. */
export const LOI_DRAFT_RESPONSE: ResponseData = {
  org_legal_name: 'Riverbend Youth Arts Collective',
  org_ein: '84-1234567',
  project_title: 'Murals on Main',
};

/** A CommonGrants-shaped applicant profile used for prefill. */
export const SAMPLE_APPLICANT_PROFILE: Record<string, unknown> = {
  organization: {
    name: 'Riverbend Youth Arts Collective',
    ein: '84-1234567',
    uei: 'RYAC12345678',
    mission: 'We help young people in Alder and Cinder counties make public art that tells their stories.',
    annualBudget: { amount: '420000.00', currency: 'USD' },
    website: 'https://riverbend-arts.example',
    address: { street1: '410 Main Street', city: 'Alderton', stateOrProvince: 'CA', postalCode: '95501', country: 'US', county: 'Alder' },
  },
  contact: {
    name: { firstName: 'Jordan', lastName: 'Reyes' },
    email: 'jordan@riverbend-arts.example',
    phone: '(555) 555-0142',
  },
};

/**
 * A CommonGrants form-library-style document: a JSON Schema + UI schema pair with
 * `x-cg-mapping` hints on some properties and a `mappingToCommonGrants` block for others.
 */
export const SAMPLE_CG_FORM_LIBRARY_JSON = {
  id: 'cg-form-org-basics',
  name: 'Organization basics',
  description: 'Common questions about an applicant organization.',
  jsonSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      orgName: { type: 'string', title: 'Legal name', maxLength: 200, 'x-cg-mapping': 'organization.name' },
      ein: { type: 'string', title: 'EIN', pattern: '^\\d{2}-\\d{7}$', 'x-cg-mapping': 'organization.ein' },
      uei: { type: 'string', title: 'UEI', pattern: '^[A-Z0-9]{12}$' },
      mission: { type: 'string', title: 'Mission', maxLength: 2000, description: 'In a few sentences.' },
      annualBudget: {
        type: 'object',
        title: 'Annual budget',
        properties: { amount: { type: 'string' }, currency: { type: 'string' } },
      },
      contactName: { type: 'object', title: 'Contact', properties: { firstName: { type: 'string' }, lastName: { type: 'string' } } },
      contactEmail: { type: 'string', format: 'email', title: 'Contact email' },
      mailingAddress: {
        type: 'object',
        title: 'Mailing address',
        properties: { street1: { type: 'string' }, city: { type: 'string' }, stateOrProvince: { type: 'string' }, postalCode: { type: 'string' } },
      },
      orgType: { type: 'string', title: 'Organization type', enum: ['nonprofit', 'government', 'tribal'] },
      focusAreas: { type: 'array', title: 'Focus areas', items: { type: 'string', enum: ['arts', 'education', 'health'] }, uniqueItems: true },
      hasSponsor: { type: 'boolean', title: 'Do you have a fiscal sponsor?' },
      sponsorName: { type: 'string', title: 'Sponsor name' },
      foundedOn: { type: 'string', format: 'date', title: 'Date founded' },
      staffCount: { type: 'integer', title: 'Paid staff', minimum: 0 },
      boardMembers: {
        type: 'array',
        title: 'Board members',
        items: { type: 'object', properties: { fullName: { type: 'string', title: 'Name' }, role: { type: 'string', title: 'Role' } }, required: ['fullName'] },
      },
      legacyData: { type: 'object', title: 'Legacy data', properties: { blob: { type: 'object' } } },
      signature: { type: 'string', title: 'Signature', contentEncoding: 'base64' },
    },
    required: ['orgName', 'ein', 'contactEmail'],
  },
  uiSchema: {
    type: 'Categorization',
    elements: [
      {
        type: 'Category',
        label: 'Organization',
        elements: [
          { type: 'Control', scope: '#/properties/orgName' },
          { type: 'Control', scope: '#/properties/ein' },
          { type: 'Control', scope: '#/properties/uei' },
          { type: 'Control', scope: '#/properties/mission', options: { multi: true } },
          { type: 'Control', scope: '#/properties/annualBudget' },
          { type: 'Control', scope: '#/properties/orgType' },
          { type: 'Control', scope: '#/properties/focusAreas' },
          { type: 'Control', scope: '#/properties/hasSponsor' },
          {
            type: 'Control',
            scope: '#/properties/sponsorName',
            rule: { effect: 'SHOW', condition: { scope: '#/properties/hasSponsor', schema: { const: true } } },
          },
          { type: 'Control', scope: '#/properties/foundedOn' },
          { type: 'Control', scope: '#/properties/staffCount' },
        ],
      },
      {
        type: 'Category',
        label: 'Contact',
        elements: [
          {
            type: 'Group',
            label: 'Primary contact',
            elements: [
              { type: 'Control', scope: '#/properties/contactName', label: 'Contact name' },
              { type: 'Control', scope: '#/properties/contactEmail' },
            ],
          },
          { type: 'Control', scope: '#/properties/mailingAddress' },
          { type: 'Control', scope: '#/properties/boardMembers' },
        ],
      },
    ],
  },
  mappingToCommonGrants: {
    organization: {
      annualBudget: { field: 'annualBudget' },
      address: { field: 'mailingAddress' },
    },
    contact: {
      name: { field: 'contactName' },
      email: { field: 'contactEmail' },
    },
  },
};
