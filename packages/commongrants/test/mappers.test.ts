// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { OpportunityBaseSchema } from '@common-grants/sdk/schemas';
import { APPLICATION_STATUS, type ApplicationStatus } from '@gms/domain';
import { describe, expect, it } from 'vitest';
import {
  GmsOpportunitySchema,
  internalAppStatusesFor,
  toCgApplicantType,
  toCgApplication,
  toCgAppStatus,
  toCgAward,
  toCgAwardStatus,
  toCgCompetition,
  toCgCompetitionStatus,
  toCgForm,
  toCgOpportunity,
  toCgOppStatus,
  toCgOrganization,
  toInternalApplicantType,
  toInternalApplication,
  toInternalAppStatus,
  toInternalAward,
  toInternalAwardStatus,
  toInternalCompetition,
  toInternalForm,
  toInternalOpportunity,
  toInternalOrganization,
  type ApplicationRow,
  type AwardRow,
  type CompetitionRow,
  type FormResponseRow,
  type OpportunityRow,
  type OrgRow,
} from '../src';
import { AppFormResponseSchema, ApplicationBaseSchema, AwardBaseSchema, CompetitionBaseSchema, FormBaseSchema, OrganizationBaseSchema } from '../src/schemas';

const ctx = { origin: 'http://halcyon.localhost:3000', timezone: 'America/Los_Angeles' };

function expectValid(schema: { safeParse(v: unknown): { success: boolean; error?: unknown } }, value: unknown) {
  const r = schema.safeParse(JSON.parse(JSON.stringify(value)));
  if (!r.success) throw new Error(`schema validation failed: ${JSON.stringify(r.error, null, 2)}`);
}

const oppRow: OpportunityRow = {
  id: randomUUID(),
  slug: 'community-arts-2027',
  title: 'Community Arts Grants 2027',
  status: 'open',
  summary: 'Small grants for neighborhood arts.',
  description_md: 'Funding for **community arts** projects.',
  eligibility_md: '501(c)(3) nonprofits in Alameda County.',
  funding_total_cents: 50_000_000,
  award_min_cents: 500_000,
  award_max_cents: 2_500_050,
  expected_award_count: 20,
  currency: 'USD',
  applicant_types: ['nonprofit_501c3', 'fiscally_sponsored', 'tribal'],
  cause_terms: ['arts', 'youth'],
  geography_terms: ['ca-alameda'],
  forecast_at: '2026-09-01T16:00:00.000Z',
  opens_at: '2026-10-01T16:00:00.000Z',
  closes_at: '2026-12-06T01:00:00.000Z',
  decision_expected_on: '2027-02-15',
  created_at: '2026-08-01T12:00:00.000Z',
  last_modified_at: '2026-09-20T12:34:56.000Z',
  program_name: 'Arts',
};

describe('opportunity mapping', () => {
  it('maps to a valid CommonGrants Opportunity (SDK schema + GMS plugin schema)', () => {
    const cg = toCgOpportunity(oppRow, ctx);
    expectValid(OpportunityBaseSchema, cg);
    expectValid(GmsOpportunitySchema, cg);
    expect(cg.status).toEqual({ value: 'open', description: expect.any(String) });
    expect(cg.funding).toEqual({
      totalAmountAvailable: { amount: '500000.00', currency: 'USD' },
      minAwardAmount: { amount: '5000.00', currency: 'USD' },
      maxAwardAmount: { amount: '25000.50', currency: 'USD' },
      estimatedAwardCount: 20,
    });
    expect(cg.source).toBe('http://halcyon.localhost:3000/opportunities/community-arts-2027');
    expect(cg.customFields?.applyUrl?.value).toBe('http://halcyon.localhost:3000/opportunities/community-arts-2027/apply');
    expect(cg.customFields?.causeAreas).toMatchObject({ name: 'causeAreas', fieldType: 'array', value: ['arts', 'youth'] });
    expect(cg.customFields?.decisionExpectedOn?.value).toBe('2027-02-15');
    // 2026-12-06T01:00Z is 5:00 PM on Dec 5 in Los Angeles.
    expect(cg.keyDates?.closeDate).toMatchObject({ eventType: 'singleDate', date: '2026-12-05', time: '17:00:00' });
    expect(cg.keyDates?.closeDate?.description).toContain('America/Los_Angeles');
    expect(cg.acceptedApplicantTypes).toEqual([
      expect.objectContaining({ value: 'non_profit_with_501c3' }),
      expect.objectContaining({ value: 'custom', customValue: 'fiscally_sponsored' }),
      expect.objectContaining({ value: 'government_tribal' }),
    ]);
  });

  it('round-trips internal -> CG -> internal', () => {
    const back = toInternalOpportunity(toCgOpportunity(oppRow, ctx), ctx);
    expect(back).toEqual({ ...oppRow });
  });

  it('never exposes draft or archived', () => {
    expect(() => toCgOpportunity({ ...oppRow, status: 'draft' }, ctx)).toThrow(RangeError);
    expect(() => toCgOppStatus('archived')).toThrow(RangeError);
    for (const s of ['forecasted', 'open', 'closed'] as const) expect(toCgOppStatus(s).value).toBe(s);
  });

  it('omits empty optional blocks', () => {
    const cg = toCgOpportunity(
      { ...oppRow, funding_total_cents: null, award_min_cents: null, award_max_cents: null, expected_award_count: null, forecast_at: null, opens_at: null, closes_at: null, decision_expected_on: null, applicant_types: [] },
      ctx,
    );
    expectValid(OpportunityBaseSchema, cg);
    expect(cg.funding).toBeUndefined();
    expect(cg.keyDates).toBeUndefined();
    expect(cg.acceptedApplicantTypes).toBeUndefined();
  });
});

describe('status mapping', () => {
  const expected: Record<ApplicationStatus, { value: string; customValue?: string }> = {
    in_progress: { value: 'inProgress' },
    submitted: { value: 'submitted' },
    awarded: { value: 'accepted' },
    declined: { value: 'rejected' },
    under_review: { value: 'custom', customValue: 'underReview' },
    invited_to_next_stage: { value: 'custom', customValue: 'invitedToNextStage' },
    withdrawn: { value: 'custom', customValue: 'withdrawn' },
    ineligible: { value: 'custom', customValue: 'ineligible' },
  };
  it.each(Object.keys(APPLICATION_STATUS) as ApplicationStatus[])('application %s', (s) => {
    const cg = toCgAppStatus(s);
    expect({ value: cg.value, ...(cg.customValue ? { customValue: cg.customValue } : {}) }).toEqual(expected[s]);
    expect(toInternalAppStatus(cg)).toBe(s);
  });

  it('resolves search filter values to internal statuses', () => {
    expect(internalAppStatusesFor('accepted')).toEqual(['awarded']);
    expect(internalAppStatusesFor('underReview')).toEqual(['under_review']);
    expect(internalAppStatusesFor('custom').sort()).toEqual(['ineligible', 'invited_to_next_stage', 'under_review', 'withdrawn']);
  });

  it('award statuses', () => {
    expect(toCgAwardStatus('active').value).toBe('awarded');
    expect(toCgAwardStatus('completed').value).toBe('completed');
    expect(toCgAwardStatus('cancelled').value).toBe('cancelled');
    expect(() => toCgAwardStatus('draft')).toThrow(RangeError);
    for (const s of ['active', 'completed', 'cancelled']) expect(toInternalAwardStatus(toCgAwardStatus(s))).toBe(s);
  });

  it('competition statuses', () => {
    expect(toCgCompetitionStatus('scheduled')).toMatchObject({ value: 'custom', customValue: 'scheduled' });
    expect(() => toCgCompetitionStatus('draft')).toThrow(RangeError);
  });

  it('applicant types round-trip', () => {
    for (const t of ['nonprofit_501c3', 'fiscally_sponsored', 'nonprofit_other', 'government', 'tribal', 'school', 'for_profit', 'individual', 'government_state']) {
      expect(toInternalApplicantType(toCgApplicantType(t))).toBe(t);
    }
  });
});

const formRow = { id: randomUUID(), name: 'Full application', description: 'The main form.', created_at: '2026-08-01T00:00:00.000Z', last_modified_at: '2026-08-02T00:00:00.000Z' };
const versionRow = {
  id: randomUUID(),
  version: 3,
  json_schema: { type: 'object', properties: { projectTitle: { type: 'string' } }, required: ['projectTitle'] },
  ui_schema: { type: 'VerticalLayout', elements: [{ type: 'Control', scope: '#/properties/projectTitle' }] },
  mapping_to_cg: { title: { field: 'projectTitle' } },
  mapping_from_cg: { projectTitle: { field: 'title' } },
  published_at: '2026-08-03T00:00:00.000Z',
  last_modified_at: '2026-08-03T00:00:00.000Z',
};

describe('form + competition mapping', () => {
  it('maps a form version and round-trips', () => {
    const cg = toCgForm(formRow, versionRow);
    expectValid(FormBaseSchema, cg);
    expect(cg.version).toBe('3');
    expect(cg.lastModifiedAt).toBe('2026-08-03T00:00:00.000Z');
    const back = toInternalForm(cg);
    expect(back.form).toEqual({ id: formRow.id, name: formRow.name, description: formRow.description });
    expect(back.version).toEqual({
      id: versionRow.id,
      version: 3,
      json_schema: versionRow.json_schema,
      ui_schema: versionRow.ui_schema,
      mapping_to_cg: versionRow.mapping_to_cg,
      mapping_from_cg: versionRow.mapping_from_cg,
    });
  });

  it('maps a competition and round-trips', () => {
    const row: CompetitionRow = {
      id: randomUUID(),
      opportunity_id: oppRow.id,
      name: 'Stage 1: Letter of inquiry',
      description: 'Short LOI.',
      stage_order: 1,
      access: 'public',
      status: 'open',
      opens_at: '2026-10-01T16:00:00.000Z',
      closes_at: '2026-11-01T00:59:59.000Z',
      grace_minutes: 15,
      created_at: '2026-08-01T00:00:00.000Z',
      last_modified_at: '2026-08-05T00:00:00.000Z',
    };
    const cg = toCgCompetition(row, [toCgForm(formRow, versionRow)], ctx, ['nonprofit_501c3']);
    expectValid(CompetitionBaseSchema, cg);
    expect(Object.keys(cg.forms.forms)).toEqual([formRow.id]);
    expect(toInternalCompetition(cg, ctx)).toEqual(row);
  });
});

describe('application mapping', () => {
  const app: ApplicationRow = {
    id: randomUUID(),
    competition_id: randomUUID(),
    opportunity_id: oppRow.id,
    applicant_org_id: randomUUID(),
    reference_number: 'HRF-2027-00042',
    title: 'After-school murals',
    status: 'under_review',
    requested_amount_cents: 1_250_000,
    currency: 'USD',
    submitted_at: '2026-11-15T20:00:00.000Z',
    ai_disclosure: 'Drafted the budget narrative with an assistant.',
    created_at: '2026-10-02T00:00:00.000Z',
    last_modified_at: '2026-11-15T20:00:00.000Z',
  };
  const response: FormResponseRow = {
    id: randomUUID(),
    application_id: app.id,
    form_id: formRow.id,
    form_version_id: versionRow.id,
    data: { projectTitle: 'Murals', budget: { total: 12500 } },
    etag: 'abc123',
    created_at: '2026-10-02T00:00:00.000Z',
    last_modified_at: '2026-11-15T19:59:00.000Z',
  };

  it('maps and round-trips an application with form responses', () => {
    const cg = toCgApplication(app, [response]);
    expectValid(ApplicationBaseSchema, cg);
    expectValid(AppFormResponseSchema, cg.formResponses[formRow.id]);
    expect(cg.status).toMatchObject({ value: 'custom', customValue: 'underReview' });
    expect(cg.customFields?.requestedAmount?.value).toEqual({ amount: '12500.00', currency: 'USD' });
    expect(cg.formResponses[formRow.id]?.status.value).toBe('complete');
    const back = toInternalApplication(cg);
    expect(back.application).toEqual(app);
    expect(back.responses).toEqual([response]);
  });

  it('in-progress applications report inProgress / notStarted form responses', () => {
    const cg = toCgApplication({ ...app, status: 'in_progress', submitted_at: null, title: null }, [response, { ...response, id: randomUUID(), form_id: randomUUID(), data: {} }]);
    expectValid(ApplicationBaseSchema, cg);
    expect(cg.title).toBe('HRF-2027-00042');
    expect(cg.submittedAt).toBeNull();
    const statuses = Object.values(cg.formResponses).map((r) => r.status.value);
    expect(statuses).toEqual(['inProgress', 'notStarted']);
  });
});

describe('organization mapping', () => {
  const org: OrgRow = {
    id: randomUUID(),
    legal_name: 'Eastside Arts Collective',
    dba_name: 'Eastside Arts',
    ein: '94-1234567',
    uei: 'ABCDEFGH1234',
    org_type: 'nonprofit_501c3',
    mission: 'Art for every block.',
    annual_budget_cents: 45_000_000,
    website: 'https://eastside-arts.example',
    phone: '510-555-0100',
    email: 'hello@eastside-arts.example',
    counties: ['Alameda'],
  };
  const address = { line1: '100 Main St', line2: 'Suite 2', city: 'Oakland', state: 'CA', postal_code: '94601', country: 'US' };

  it('uses CG 0.4 registry identifiers and round-trips', () => {
    const cg = toCgOrganization(org, address);
    expectValid(OrganizationBaseSchema, cg);
    expect(cg.identifiers?.['org:us:ein']).toEqual({ registry: { code: 'org:us:ein', url: 'https://commongrants.org/registries/org-us-ein' }, id: '941234567' });
    expect(cg.identifiers?.['org:us:uei']?.id).toBe('ABCDEFGH1234');
    const back = toInternalOrganization(cg);
    expect(back.org).toEqual(org);
    expect(back.address).toEqual(address);
  });

  it('drops identifiers that do not match the registry format', () => {
    const cg = toCgOrganization({ ...org, uei: 'IOIOIOIOIOIO', ein: null });
    expect(cg.identifiers).toBeUndefined();
    expectValid(OrganizationBaseSchema, cg);
  });
});

describe('award mapping', () => {
  const funder = { id: randomUUID(), name: 'Halcyon Foundation' };
  const staffRow: AwardRow = {
    id: randomUUID(),
    reference: 'HRF-AWD-2027-00007',
    title: 'Eastside murals',
    purpose: 'Youth mural program.',
    status: 'active',
    amount_cents: 2_500_000,
    disbursed_cents: 1_000_000,
    currency: 'USD',
    start_date: '2027-01-01',
    end_date: '2027-12-31',
    fiscal_year: 2027,
    opportunity_id: oppRow.id,
    opportunity_title: oppRow.title,
    application_id: randomUUID(),
    application_title: 'After-school murals',
    program_name: 'Arts',
    recipient: { id: randomUUID(), legal_name: 'Eastside Arts Collective', ein: '94-1234567', uei: null },
    recipient_name: null,
    recipient_city: null,
    recipient_state: null,
    recipient_county: null,
    created_at: '2026-12-20T00:00:00.000Z',
    last_modified_at: '2027-03-01T00:00:00.000Z',
  };

  it('maps the staff view with disbursedAmount and round-trips', () => {
    const cg = toCgAward(staffRow, { ...ctx, funder });
    expectValid(AwardBaseSchema, cg);
    expect(cg.status.value).toBe('awarded');
    expect(cg.funding).toEqual({ awardedAmount: { amount: '25000.00', currency: 'USD' }, disbursedAmount: { amount: '10000.00', currency: 'USD' } });
    expect(cg.keyDates?.periodOfPerformance).toMatchObject({ eventType: 'dateRange', startDate: '2027-01-01', endDate: '2027-12-31' });
    expect(cg.recipientOrganizations?.primary.identifiers?.['org:us:ein']?.id).toBe('941234567');
    expect(toInternalAward(cg)).toEqual(staffRow);
  });

  it('maps the public transparency view without holds, notes or disbursements', () => {
    const pub: AwardRow = {
      ...staffRow,
      status: 'completed',
      disbursed_cents: null,
      application_id: null,
      application_title: null,
      recipient: null,
      recipient_name: 'Eastside Arts Collective',
      recipient_city: 'Oakland',
      recipient_state: 'CA',
      recipient_county: 'Alameda',
      purpose: null,
    };
    const cg = toCgAward(pub, { ...ctx, funder });
    expectValid(AwardBaseSchema, cg);
    expect(cg.funding?.disbursedAmount).toBeUndefined();
    expect(cg.recipientOrganizations).toBeUndefined();
    expect(cg.customFields?.recipientName?.value).toBe('Eastside Arts Collective');
    expect(cg.description).toBe(pub.title);
    expect(toInternalAward(cg)).toEqual(pub);
  });
});
