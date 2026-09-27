// SPDX-License-Identifier: AGPL-3.0-only
// Pure mappers: internal DB rows <-> CommonGrants models.
// Every `toCg*` has a `toInternal*` partner; tests assert internal -> CG -> internal equality
// on the mapped fields. Mappers never touch the database.
import {
  APPLICATION_STATUS,
  AWARD_STATUS,
  formatEin,
  type ApplicationStatus,
  type AwardStatus,
  type OpportunityStatus,
} from '@gms/domain';
import { dateEvent, dateRangeEvent, eventToDate, eventToInstant, instantEvent } from './events';
import { centsToMoney, decimalToCents, optionalCents, optionalMoney } from './money';
import { GMS_CUSTOM_FIELDS } from './plugin';
import type {
  CgAddress,
  CgAppFormResponse,
  CgApplicantTypeValue,
  CgApplication,
  CgAppStatusValue,
  CgAward,
  CgAwardStatusValue,
  CgCompetition,
  CgCustomField,
  CgCustomFields,
  CgCustomFieldType,
  CgEvent,
  CgExtensibleEnum,
  CgForm,
  CgMapping,
  CgOpportunity,
  CgOppStatusValue,
  CgOrganization,
  CgOrgIds,
  CgOrgRef,
} from './types';

// ---------------------------------------------------------------------------------------
// Shared helpers

export interface MapContext {
  /** Public origin of the workspace, e.g. "http://halcyon.localhost:3000". */
  origin: string;
  /** IANA timezone of the workspace. */
  timezone: string;
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function nonEmpty<T>(arr: readonly T[] | null | undefined): arr is readonly T[] {
  return Array.isArray(arr) && arr.length > 0;
}

function iso(v: string | Date): string {
  return typeof v === 'string' ? new Date(v).toISOString() : v.toISOString();
}

export function customField(name: string, fieldType: CgCustomFieldType, value: unknown, description: string): CgCustomField {
  return { name, fieldType, value, description };
}

function cfValue<T>(fields: CgCustomFields | undefined, key: string): T | undefined {
  const f = fields?.[key];
  return f ? (f.value as T) : undefined;
}

function compact<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function stripOrigin(url: string | undefined, origin: string, prefix: string): string | null {
  if (!url) return null;
  const base = `${origin.replace(/\/$/, '')}${prefix}`;
  if (!url.startsWith(base)) return null;
  const rest = url.slice(base.length).split(/[/?#]/)[0];
  return rest ? decodeURIComponent(rest) : null;
}

export function opportunityUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, '')}/opportunities/${encodeURIComponent(slug)}`;
}

// ---------------------------------------------------------------------------------------
// Status mappings

export type PublicOpportunityStatus = Extract<OpportunityStatus, 'forecasted' | 'open' | 'closed'>;
export const PUBLIC_OPPORTUNITY_STATUSES: readonly PublicOpportunityStatus[] = ['forecasted', 'open', 'closed'];

const OPP_STATUS_DESCRIPTIONS: Record<PublicOpportunityStatus, string> = {
  forecasted: 'Announced; not yet accepting applications.',
  open: 'Accepting applications.',
  closed: 'No longer accepting applications.',
};

export function isPublicOpportunityStatus(s: string): s is PublicOpportunityStatus {
  return (PUBLIC_OPPORTUNITY_STATUSES as readonly string[]).includes(s);
}

/** Internal draft/archived are never exposed: they throw. */
export function toCgOppStatus(status: string): CgExtensibleEnum<CgOppStatusValue> {
  if (!isPublicOpportunityStatus(status)) throw new RangeError(`opportunity status "${status}" is not public`);
  return { value: status, description: OPP_STATUS_DESCRIPTIONS[status] };
}

export function toInternalOppStatus(s: CgExtensibleEnum<CgOppStatusValue>): PublicOpportunityStatus {
  if (s.value !== 'custom') return s.value;
  if (s.customValue && isPublicOpportunityStatus(s.customValue)) return s.customValue;
  throw new RangeError(`unsupported custom opportunity status "${s.customValue ?? ''}"`);
}

const APP_STATUS_TO_CG: Record<ApplicationStatus, { value: CgAppStatusValue | 'custom'; customValue?: string }> = {
  in_progress: { value: 'inProgress' },
  submitted: { value: 'submitted' },
  awarded: { value: 'accepted' },
  declined: { value: 'rejected' },
  under_review: { value: 'custom', customValue: 'underReview' },
  invited_to_next_stage: { value: 'custom', customValue: 'invitedToNextStage' },
  withdrawn: { value: 'custom', customValue: 'withdrawn' },
  ineligible: { value: 'custom', customValue: 'ineligible' },
};

export function toCgAppStatus(status: string): CgExtensibleEnum<CgAppStatusValue> {
  const m = APP_STATUS_TO_CG[status as ApplicationStatus];
  if (!m) throw new RangeError(`unknown application status "${status}"`);
  const meta = APPLICATION_STATUS[status as ApplicationStatus];
  return { ...m, description: meta.description ?? meta.label };
}

export function toInternalAppStatus(s: { value: string; customValue?: string | null }): ApplicationStatus {
  for (const [internal, cg] of Object.entries(APP_STATUS_TO_CG) as [ApplicationStatus, (typeof APP_STATUS_TO_CG)[ApplicationStatus]][]) {
    if (cg.value === s.value && (cg.value !== 'custom' || cg.customValue === s.customValue)) return internal;
  }
  throw new RangeError(`unsupported application status ${JSON.stringify(s)}`);
}

/** Every CG status string (value or customValue) that selects an internal status, for search filters. */
export function internalAppStatusesFor(cgValue: string): ApplicationStatus[] {
  return (Object.entries(APP_STATUS_TO_CG) as [ApplicationStatus, { value: string; customValue?: string }][])
    .filter(([, cg]) => (cg.value === 'custom' ? cg.customValue === cgValue || cgValue === 'custom' : cg.value === cgValue))
    .map(([s]) => s);
}

const AWARD_STATUS_TO_CG: Partial<Record<AwardStatus, CgAwardStatusValue>> = {
  active: 'awarded',
  completed: 'completed',
  cancelled: 'cancelled',
};

export function toCgAwardStatus(status: string): CgExtensibleEnum<CgAwardStatusValue> {
  const v = AWARD_STATUS_TO_CG[status as AwardStatus];
  if (!v) throw new RangeError(`award status "${status}" is not exposed`);
  return { value: v, description: AWARD_STATUS[status as AwardStatus].label };
}

export function toInternalAwardStatus(s: { value: string; customValue?: string | null }): AwardStatus {
  const hit = (Object.entries(AWARD_STATUS_TO_CG) as [AwardStatus, CgAwardStatusValue][]).find(([, v]) => v === s.value);
  if (!hit) throw new RangeError(`unsupported award status ${JSON.stringify(s)}`);
  return hit[0];
}

/** Maps a CG award status filter value to internal statuses. */
export function internalAwardStatusesFor(cgValue: string): AwardStatus[] {
  return (Object.entries(AWARD_STATUS_TO_CG) as [AwardStatus, CgAwardStatusValue][]).filter(([, v]) => v === cgValue).map(([s]) => s);
}

export function toCgCompetitionStatus(status: string): CgExtensibleEnum<'open' | 'closed'> {
  switch (status) {
    case 'open':
      return { value: 'open', description: 'Accepting applications.' };
    case 'closed':
      return { value: 'closed', description: 'No longer accepting applications.' };
    case 'scheduled':
      return { value: 'custom', customValue: 'scheduled', description: 'Scheduled to open.' };
    default:
      throw new RangeError(`competition status "${status}" is not public`);
  }
}

export function toInternalCompetitionStatus(s: { value: string; customValue?: string | null }): 'open' | 'closed' | 'scheduled' {
  if (s.value === 'open' || s.value === 'closed') return s.value;
  if (s.value === 'custom' && s.customValue === 'scheduled') return 'scheduled';
  throw new RangeError(`unsupported competition status ${JSON.stringify(s)}`);
}

// ---------------------------------------------------------------------------------------
// Applicant types (internal org_type vocabulary <-> CG ApplicantType)

const APPLICANT_TYPE_TO_CG: Record<string, CgApplicantTypeValue> = {
  nonprofit_501c3: 'non_profit_with_501c3',
  nonprofit_other: 'nonprofit_without_501c3',
  tribal: 'government_tribal',
  school: 'school_district_independent',
  individual: 'individual',
};
const CG_APPLICANT_TYPES: readonly CgApplicantTypeValue[] = [
  'individual',
  'organization',
  'government_state',
  'government_county',
  'government_municipal',
  'government_special_district',
  'government_tribal',
  'organization_tribal_other',
  'school_district_independent',
  'higher_education_public',
  'higher_education_private',
  'non_profit_with_501c3',
  'nonprofit_without_501c3',
  'for_profit_small_business',
  'for_profit_not_small_business',
  'unrestricted',
];
const APPLICANT_TYPE_LABELS: Record<string, string> = {
  nonprofit_501c3: 'Nonprofit with 501(c)(3) status',
  fiscally_sponsored: 'Fiscally sponsored project',
  nonprofit_other: 'Nonprofit without 501(c)(3) status',
  government: 'Government entity',
  tribal: 'Tribal government',
  school: 'School or school district',
  for_profit: 'For-profit business',
  individual: 'Individual',
};

export function toCgApplicantType(t: string): CgExtensibleEnum<CgApplicantTypeValue> {
  const mapped = APPLICANT_TYPE_TO_CG[t];
  const description = APPLICANT_TYPE_LABELS[t];
  if (mapped) return { value: mapped, ...(description ? { description } : {}) };
  if ((CG_APPLICANT_TYPES as readonly string[]).includes(t)) return { value: t as CgApplicantTypeValue };
  return { value: 'custom', customValue: t, ...(description ? { description } : {}) };
}

export function toInternalApplicantType(a: { value: string; customValue?: string | null }): string {
  if (a.value === 'custom') return a.customValue ?? 'custom';
  const hit = Object.entries(APPLICANT_TYPE_TO_CG).find(([, v]) => v === a.value);
  return hit ? hit[0] : a.value;
}

// ---------------------------------------------------------------------------------------
// Opportunity

export interface OpportunityRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  summary: string | null;
  description_md: string | null;
  eligibility_md: string | null;
  funding_total_cents: number | null;
  award_min_cents: number | null;
  award_max_cents: number | null;
  expected_award_count: number | null;
  currency: string;
  applicant_types: string[];
  cause_terms: string[];
  geography_terms: string[];
  forecast_at: string | null;
  opens_at: string | null;
  closes_at: string | null;
  decision_expected_on: string | null;
  created_at: string;
  last_modified_at: string;
  /** Joined program name (null when the caller may not read programs). */
  program_name?: string | null;
}

/** The GMS extras carried in Opportunity.customFields (declared by the plugin). */
export const OPPORTUNITY_CUSTOM_FIELDS = GMS_CUSTOM_FIELDS.Opportunity;

type OppCfKey = keyof typeof OPPORTUNITY_CUSTOM_FIELDS;
function oppCf(key: OppCfKey, value: unknown): CgCustomField {
  const spec = OPPORTUNITY_CUSTOM_FIELDS[key];
  return customField(key, spec.fieldType, value, spec.description);
}

export function toCgOpportunity(row: OpportunityRow, ctx: MapContext): CgOpportunity {
  const currency = row.currency || 'USD';
  const funding = compact({
    totalAmountAvailable: optionalMoney(row.funding_total_cents, currency),
    minAwardAmount: optionalMoney(row.award_min_cents, currency),
    maxAwardAmount: optionalMoney(row.award_max_cents, currency),
    estimatedAwardCount: row.expected_award_count ?? undefined,
  });
  const otherDates: Record<string, CgEvent> = {};
  if (row.forecast_at) otherDates.forecastDate = instantEvent('Forecast date', row.forecast_at, ctx.timezone, 'Announced');
  if (row.decision_expected_on) otherDates.decisionDate = dateEvent('Decisions expected', row.decision_expected_on, 'When applicants can expect a decision.');
  const keyDates = compact({
    postDate: row.opens_at ? instantEvent('Applications open', row.opens_at, ctx.timezone, 'Opens') : undefined,
    closeDate: row.closes_at ? instantEvent('Application deadline', row.closes_at, ctx.timezone, 'Deadline') : undefined,
    otherDates: Object.keys(otherDates).length ? otherDates : undefined,
  });
  const source = opportunityUrl(ctx.origin, row.slug);
  const cf: CgCustomFields = {};
  if (row.summary) cf.summary = oppCf('summary', row.summary);
  if (row.eligibility_md) cf.eligibilitySummary = oppCf('eligibilitySummary', row.eligibility_md);
  if (nonEmpty(row.cause_terms)) cf.causeAreas = oppCf('causeAreas', [...row.cause_terms]);
  if (nonEmpty(row.geography_terms)) cf.geography = oppCf('geography', [...row.geography_terms]);
  if (row.program_name) cf.programName = oppCf('programName', row.program_name);
  cf.applyUrl = oppCf('applyUrl', `${source}/apply`);
  if (row.decision_expected_on) cf.decisionExpectedOn = oppCf('decisionExpectedOn', row.decision_expected_on.slice(0, 10));

  return compact({
    id: row.id,
    title: row.title,
    status: toCgOppStatus(row.status),
    description: row.description_md ?? row.summary ?? '',
    funding: Object.keys(funding).length ? funding : undefined,
    keyDates: Object.keys(keyDates).length ? keyDates : undefined,
    acceptedApplicantTypes: nonEmpty(row.applicant_types) ? row.applicant_types.map(toCgApplicantType) : undefined,
    source,
    customFields: cf,
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.last_modified_at),
  });
}

export type InternalOpportunity = Omit<OpportunityRow, 'program_name'> & { program_name: string | null };

export function toInternalOpportunity(cg: CgOpportunity, ctx: MapContext): InternalOpportunity {
  const f = cg.funding ?? {};
  const currency = f.totalAmountAvailable?.currency ?? f.maxAwardAmount?.currency ?? f.minAwardAmount?.currency ?? 'USD';
  const cf = cg.customFields;
  const slug = stripOrigin(cg.source, ctx.origin, '/opportunities/') ?? stripOrigin(cfValue<string>(cf, 'applyUrl'), ctx.origin, '/opportunities/');
  const decision = cfValue<string>(cf, 'decisionExpectedOn') ?? eventToDate(cg.keyDates?.otherDates?.decisionDate);
  return {
    id: cg.id,
    slug: slug ?? cg.id,
    title: cg.title,
    status: toInternalOppStatus(cg.status),
    summary: cfValue<string>(cf, 'summary') ?? null,
    description_md: cg.description === '' ? null : cg.description,
    eligibility_md: cfValue<string>(cf, 'eligibilitySummary') ?? null,
    funding_total_cents: optionalCents(f.totalAmountAvailable),
    award_min_cents: optionalCents(f.minAwardAmount),
    award_max_cents: optionalCents(f.maxAwardAmount),
    expected_award_count: f.estimatedAwardCount ?? null,
    currency: currency.toUpperCase(),
    applicant_types: (cg.acceptedApplicantTypes ?? []).map(toInternalApplicantType),
    cause_terms: cfValue<string[]>(cf, 'causeAreas') ?? [],
    geography_terms: cfValue<string[]>(cf, 'geography') ?? [],
    forecast_at: eventToInstant(cg.keyDates?.otherDates?.forecastDate, ctx.timezone),
    opens_at: eventToInstant(cg.keyDates?.postDate, ctx.timezone),
    closes_at: eventToInstant(cg.keyDates?.closeDate, ctx.timezone, '23:59:59'),
    decision_expected_on: decision ?? null,
    program_name: cfValue<string>(cf, 'programName') ?? null,
    created_at: iso(cg.createdAt),
    last_modified_at: iso(cg.lastModifiedAt),
  };
}

// ---------------------------------------------------------------------------------------
// Form

export interface FormRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  last_modified_at: string;
}

export interface FormVersionRow {
  id: string;
  version: number;
  json_schema: unknown;
  ui_schema: unknown;
  mapping_to_cg: unknown;
  mapping_from_cg: unknown;
  published_at: string | null;
  last_modified_at: string;
}

export function toCgForm(form: FormRow, version: FormVersionRow): CgForm {
  const modified = [form.last_modified_at, version.last_modified_at, version.published_at]
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime());
  return compact({
    id: form.id,
    name: form.name,
    description: form.description ?? undefined,
    version: String(version.version),
    jsonSchema: asRecord(version.json_schema),
    uiSchema: asRecord(version.ui_schema),
    mappingToCommonGrants: asRecord(version.mapping_to_cg) as CgMapping,
    mappingFromCommonGrants: asRecord(version.mapping_from_cg) as CgMapping,
    customFields: {
      formVersionId: customField('formVersionId', 'string', version.id, 'The immutable published form version this document describes.'),
    },
    createdAt: iso(form.created_at),
    lastModifiedAt: new Date(Math.max(...modified)).toISOString(),
  });
}

export function toInternalForm(cg: CgForm): {
  form: Pick<FormRow, 'id' | 'name' | 'description'>;
  version: Pick<FormVersionRow, 'id' | 'version' | 'json_schema' | 'ui_schema' | 'mapping_to_cg' | 'mapping_from_cg'>;
} {
  return {
    form: { id: cg.id, name: cg.name, description: cg.description ?? null },
    version: {
      id: cfValue<string>(cg.customFields, 'formVersionId') ?? '',
      version: Number(cg.version ?? 1),
      json_schema: cg.jsonSchema ?? {},
      ui_schema: cg.uiSchema ?? {},
      mapping_to_cg: cg.mappingToCommonGrants ?? {},
      mapping_from_cg: cg.mappingFromCommonGrants ?? {},
    },
  };
}

// ---------------------------------------------------------------------------------------
// Competition

export interface CompetitionRow {
  id: string;
  opportunity_id: string;
  name: string;
  description: string | null;
  stage_order: number;
  access: string;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
  grace_minutes: number;
  created_at: string;
  last_modified_at: string;
}

export function toCgCompetition(row: CompetitionRow, forms: readonly CgForm[], ctx: MapContext, applicantTypes: readonly string[] = []): CgCompetition {
  const keyDates = compact({
    openDate: row.opens_at ? instantEvent('Opens', row.opens_at, ctx.timezone, 'Opens') : undefined,
    closeDate: row.closes_at ? instantEvent('Closes', row.closes_at, ctx.timezone, 'Deadline') : undefined,
  });
  return compact({
    id: row.id,
    opportunityId: row.opportunity_id,
    title: row.name,
    description: row.description ?? undefined,
    status: toCgCompetitionStatus(row.status),
    keyDates: Object.keys(keyDates).length ? keyDates : undefined,
    forms: {
      forms: Object.fromEntries(forms.map((f) => [f.id, f])),
      validation: { required: forms.map((f) => f.id) },
    },
    acceptedApplicantTypes: nonEmpty(applicantTypes) ? applicantTypes.map(toCgApplicantType) : undefined,
    customFields: {
      stageOrder: customField('stageOrder', 'integer', row.stage_order, 'Stage number within the opportunity (1 = first stage).'),
      access: customField('access', 'string', row.access, '"public" (anyone may apply) or "invite" (invited applicants only).'),
      graceMinutes: customField('graceMinutes', 'integer', row.grace_minutes, 'Minutes after the deadline during which submissions are still accepted.'),
    },
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.last_modified_at),
  });
}

export function toInternalCompetition(cg: CgCompetition, ctx: MapContext): CompetitionRow {
  return {
    id: cg.id,
    opportunity_id: cg.opportunityId,
    name: cg.title,
    description: cg.description ?? null,
    stage_order: cfValue<number>(cg.customFields, 'stageOrder') ?? 1,
    access: cfValue<string>(cg.customFields, 'access') ?? 'public',
    status: toInternalCompetitionStatus(cg.status),
    opens_at: eventToInstant(cg.keyDates?.openDate, ctx.timezone),
    closes_at: eventToInstant(cg.keyDates?.closeDate, ctx.timezone, '23:59:59'),
    grace_minutes: cfValue<number>(cg.customFields, 'graceMinutes') ?? 0,
    created_at: iso(cg.createdAt),
    last_modified_at: iso(cg.lastModifiedAt),
  };
}

// ---------------------------------------------------------------------------------------
// Application + form responses

export interface FormResponseRow {
  id: string;
  application_id: string;
  form_id: string;
  form_version_id: string;
  data: unknown;
  etag: string;
  created_at: string;
  last_modified_at: string;
}

export function formResponseStatus(data: Record<string, unknown>, appStatus: string, errors: readonly unknown[] = []): CgAppFormResponse['status'] {
  if (Object.keys(data).length === 0) return { value: 'notStarted', description: 'No answers saved yet.' };
  if (appStatus !== 'in_progress') return { value: 'complete', description: 'Submitted.' };
  if (errors.length) return { value: 'inProgress', description: 'Some answers need attention.' };
  return { value: 'inProgress', description: 'Answers saved; not submitted yet.' };
}

export function toCgFormResponse(row: FormResponseRow, appStatus: string, validationErrors?: readonly unknown[]): CgAppFormResponse {
  const response = asRecord(row.data);
  return compact({
    applicationId: row.application_id,
    id: row.id,
    formId: row.form_id,
    response,
    status: formResponseStatus(response, appStatus, validationErrors),
    validationErrors: validationErrors ? [...validationErrors] : undefined,
    customFields: {
      formVersionId: customField('formVersionId', 'string', row.form_version_id, 'The form version these answers were saved against.'),
      etag: customField('etag', 'string', row.etag, 'Send as If-Match when saving to avoid overwriting newer answers.'),
    },
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.last_modified_at),
  });
}

export function toInternalFormResponse(cg: CgAppFormResponse): FormResponseRow {
  return {
    id: cg.id,
    application_id: cg.applicationId,
    form_id: cg.formId,
    form_version_id: cfValue<string>(cg.customFields, 'formVersionId') ?? '',
    data: cg.response,
    etag: cfValue<string>(cg.customFields, 'etag') ?? '',
    created_at: iso(cg.createdAt),
    last_modified_at: iso(cg.lastModifiedAt),
  };
}

export interface ApplicationRow {
  id: string;
  competition_id: string;
  opportunity_id: string;
  applicant_org_id: string | null;
  reference_number: string;
  title: string | null;
  status: string;
  requested_amount_cents: number | null;
  currency: string;
  submitted_at: string | null;
  ai_disclosure: string | null;
  created_at: string;
  last_modified_at: string;
}

export function toCgApplication(row: ApplicationRow, responses: readonly FormResponseRow[] = []): CgApplication {
  const cf: CgCustomFields = {
    referenceNumber: customField('referenceNumber', 'string', row.reference_number, 'Human-readable reference number.'),
  };
  if (row.title) cf.applicationTitle = customField('applicationTitle', 'string', row.title, 'Title the applicant gave the application.');
  if (row.requested_amount_cents !== null)
    cf.requestedAmount = customField('requestedAmount', 'object', centsToMoney(row.requested_amount_cents, row.currency), 'Amount requested (CG Money).');
  if (row.applicant_org_id) cf.organizationId = customField('organizationId', 'string', row.applicant_org_id, 'Applicant organization id.');
  if (row.ai_disclosure) cf.aiDisclosure = customField('aiDisclosure', 'string', row.ai_disclosure, 'Applicant-supplied disclosure of AI assistance.');
  return compact({
    id: row.id,
    title: row.title ?? row.reference_number,
    competitionId: row.competition_id,
    opportunityId: row.opportunity_id,
    formResponses: Object.fromEntries(responses.map((r) => [r.form_id, toCgFormResponse(r, row.status)])),
    status: toCgAppStatus(row.status),
    submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
    customFields: cf,
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.last_modified_at),
  });
}

export function toInternalApplication(cg: CgApplication): { application: ApplicationRow; responses: FormResponseRow[] } {
  const cf = cg.customFields;
  const requested = cfValue<{ amount: string; currency: string }>(cf, 'requestedAmount');
  return {
    application: {
      id: cg.id,
      competition_id: cg.competitionId,
      opportunity_id: cg.opportunityId,
      applicant_org_id: cfValue<string>(cf, 'organizationId') ?? null,
      reference_number: cfValue<string>(cf, 'referenceNumber') ?? '',
      title: cfValue<string>(cf, 'applicationTitle') ?? null,
      status: toInternalAppStatus(cg.status),
      requested_amount_cents: requested ? decimalToCents(requested.amount) : null,
      currency: (requested?.currency ?? 'USD').toUpperCase(),
      submitted_at: cg.submittedAt ? iso(cg.submittedAt) : null,
      ai_disclosure: cfValue<string>(cf, 'aiDisclosure') ?? null,
      created_at: iso(cg.createdAt),
      last_modified_at: iso(cg.lastModifiedAt),
    },
    responses: Object.values(cg.formResponses).map(toInternalFormResponse),
  };
}

// ---------------------------------------------------------------------------------------
// Organization

export interface OrgRow {
  id: string;
  legal_name: string;
  dba_name: string | null;
  ein: string | null;
  uei: string | null;
  org_type: string;
  mission: string | null;
  annual_budget_cents: number | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  counties: string[];
}

export interface AddressRow {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

const EIN_REGISTRY = { code: 'org:us:ein', url: 'https://commongrants.org/registries/org-us-ein' };
const UEI_REGISTRY = { code: 'org:us:uei', url: 'https://commongrants.org/registries/org-us-uei' };

export function toCgOrgIds(org: Pick<OrgRow, 'ein' | 'uei'>): CgOrgIds | undefined {
  const ids: CgOrgIds = {};
  const einDigits = org.ein?.replace(/\D/g, '');
  if (einDigits && /^[0-9]{9}$/.test(einDigits)) ids['org:us:ein'] = { registry: EIN_REGISTRY, id: einDigits };
  if (org.uei && /^[A-HJ-NP-Z0-9]{12}$/.test(org.uei)) ids['org:us:uei'] = { registry: UEI_REGISTRY, id: org.uei };
  return Object.keys(ids).length ? ids : undefined;
}

export function toCgOrgRef(org: Pick<OrgRow, 'id' | 'legal_name' | 'ein' | 'uei'>): CgOrgRef {
  return compact({ id: org.id, name: org.legal_name, identifiers: toCgOrgIds(org) });
}

function isUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function splitPhone(phone: string): { countryCode: string; number: string } {
  const m = /^\+([1-9][0-9]{0,3})[\s.-]+(.+)$/.exec(phone.trim());
  return m ? { countryCode: `+${m[1]}`, number: m[2]! } : { countryCode: '+1', number: phone.trim() };
}

export function toCgOrganization(org: OrgRow, address?: AddressRow | null): CgOrganization {
  const cf: CgCustomFields = {
    orgType: customField('orgType', 'string', org.org_type, 'GMS organization type (e.g. nonprofit_501c3, fiscally_sponsored).'),
  };
  if (org.dba_name) cf.dbaName = customField('dbaName', 'string', org.dba_name, '"Doing business as" name.');
  if (org.annual_budget_cents !== null)
    cf.annualBudget = customField('annualBudget', 'object', centsToMoney(org.annual_budget_cents), 'Annual operating budget (CG Money).');
  if (nonEmpty(org.counties)) cf.counties = customField('counties', 'array', [...org.counties], 'Counties served.');
  const primary: CgAddress | undefined = address
    ? compact({
        street1: address.line1,
        street2: address.line2 ?? undefined,
        city: address.city,
        stateOrProvince: address.state,
        country: address.country,
        postalCode: address.postal_code,
      })
    : undefined;
  return compact({
    ...toCgOrgRef(org),
    addresses: primary ? { primary } : undefined,
    phones: org.phone ? { primary: splitPhone(org.phone) } : undefined,
    emails: org.email ? { primary: org.email } : undefined,
    mission: org.mission ?? undefined,
    socials: org.website && isUrl(org.website) ? { website: org.website } : undefined,
    customFields: cf,
  });
}

export function toInternalOrganization(cg: CgOrganization): { org: OrgRow; address: AddressRow | null } {
  const cf = cg.customFields;
  const budget = cfValue<{ amount: string }>(cf, 'annualBudget');
  const ein = cg.identifiers?.['org:us:ein']?.id;
  const phone = cg.phones?.primary;
  const a = cg.addresses?.primary;
  return {
    org: {
      id: cg.id,
      legal_name: cg.name,
      dba_name: cfValue<string>(cf, 'dbaName') ?? null,
      ein: ein ? formatEin(ein) : null,
      uei: cg.identifiers?.['org:us:uei']?.id ?? null,
      org_type: cfValue<string>(cf, 'orgType') ?? 'nonprofit_501c3',
      mission: cg.mission ?? null,
      annual_budget_cents: budget ? decimalToCents(budget.amount) : null,
      website: cg.socials?.website ?? null,
      phone: phone ? (phone.countryCode === '+1' ? phone.number : `${phone.countryCode} ${phone.number}`) : null,
      email: cg.emails?.primary ?? null,
      counties: cfValue<string[]>(cf, 'counties') ?? [],
    },
    address: a
      ? { line1: a.street1, line2: a.street2 ?? null, city: a.city, state: a.stateOrProvince, postal_code: a.postalCode, country: a.country }
      : null,
  };
}

// ---------------------------------------------------------------------------------------
// Award

export interface AwardRow {
  id: string;
  reference: string;
  title: string;
  purpose: string | null;
  status: string;
  /** Awarded amount in cents (original plus approved amendments). */
  amount_cents: number;
  /** Paid so far; only present for staff readers. */
  disbursed_cents?: number | null;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  fiscal_year: number | null;
  opportunity_id: string | null;
  opportunity_title?: string | null;
  application_id?: string | null;
  application_title?: string | null;
  program_name?: string | null;
  /** Staff view: the recipient organization. */
  recipient?: Pick<OrgRow, 'id' | 'legal_name' | 'ein' | 'uei'> | null;
  /** Public view: the transparency columns of `public_awards`. */
  recipient_name?: string | null;
  recipient_city?: string | null;
  recipient_state?: string | null;
  recipient_county?: string | null;
  created_at: string;
  last_modified_at: string;
}

export interface AwardMapContext extends MapContext {
  funder: { id: string; name: string };
}

export function toCgAward(row: AwardRow, ctx: AwardMapContext): CgAward {
  const currency = row.currency || 'USD';
  const otherDates: Record<string, CgEvent> = {};
  let periodOfPerformance: CgEvent | undefined;
  if (row.start_date && row.end_date) periodOfPerformance = dateRangeEvent('Period of performance', row.start_date, row.end_date, 'The period during which the funded work is performed.');
  else if (row.start_date) otherDates.startDate = dateEvent('Start date', row.start_date);
  else if (row.end_date) otherDates.endDate = dateEvent('End date', row.end_date);

  const cf: CgCustomFields = {
    referenceNumber: customField('referenceNumber', 'string', row.reference, 'Grantmaker reference number.'),
  };
  if (row.fiscal_year !== null) cf.fiscalYear = customField('fiscalYear', 'integer', row.fiscal_year, 'Fiscal year the award is booked in.');
  if (row.program_name) cf.programName = customField('programName', 'string', row.program_name, 'Program that made the award.');
  if (!row.recipient) {
    if (row.recipient_name) cf.recipientName = customField('recipientName', 'string', row.recipient_name, 'Recipient organization (public transparency data).');
    const place = [row.recipient_city, row.recipient_county, row.recipient_state].some(Boolean);
    if (place)
      cf.recipientLocation = customField(
        'recipientLocation',
        'object',
        compact({ city: row.recipient_city ?? undefined, county: row.recipient_county ?? undefined, state: row.recipient_state ?? undefined }),
        'Recipient location (public transparency data).',
      );
  }

  return compact({
    id: row.id,
    title: row.title,
    identifiers: {
      systemId: { registry: { code: 'awd:gms:system' }, id: row.id },
      otherIds: { 'awd:gms:reference': { registry: { code: 'awd:gms:reference' }, id: row.reference } },
    },
    description: row.purpose ?? row.title,
    status: toCgAwardStatus(row.status),
    funding: compact({
      awardedAmount: centsToMoney(row.amount_cents, currency),
      disbursedAmount: optionalMoney(row.disbursed_cents, currency),
    }),
    keyDates: compact({
      awardDate: dateEvent('Award date', new Date(row.created_at).toISOString().slice(0, 10), 'The date the award was recorded.'),
      periodOfPerformance,
      otherDates: Object.keys(otherDates).length ? otherDates : undefined,
    }),
    opportunity: row.opportunity_id && row.opportunity_title ? { id: row.opportunity_id, title: row.opportunity_title } : undefined,
    application: row.application_id && row.application_title ? { id: row.application_id, title: row.application_title } : undefined,
    funders: { primary: { id: ctx.funder.id, name: ctx.funder.name } },
    recipientOrganizations: row.recipient ? { primary: toCgOrgRef(row.recipient) } : undefined,
    customFields: cf,
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.last_modified_at),
  });
}

export function toInternalAward(cg: CgAward): AwardRow {
  const cf = cg.customFields;
  const pop = cg.keyDates?.periodOfPerformance;
  const other = cg.keyDates?.otherDates;
  const awarded = cg.funding?.awardedAmount;
  const recipient = cg.recipientOrganizations?.primary;
  const loc = cfValue<{ city?: string; county?: string; state?: string }>(cf, 'recipientLocation');
  const ein = recipient?.identifiers?.['org:us:ein']?.id;
  return {
    id: cg.id,
    reference: cfValue<string>(cf, 'referenceNumber') ?? cg.identifiers?.otherIds?.['awd:gms:reference']?.id ?? '',
    title: cg.title,
    purpose: cg.description === cg.title ? null : cg.description,
    status: toInternalAwardStatus(cg.status),
    amount_cents: awarded ? decimalToCents(awarded.amount) : 0,
    disbursed_cents: optionalCents(cg.funding?.disbursedAmount),
    currency: (awarded?.currency ?? 'USD').toUpperCase(),
    start_date: pop?.eventType === 'dateRange' ? pop.startDate : eventToDate(other?.startDate),
    end_date: pop?.eventType === 'dateRange' ? pop.endDate : eventToDate(other?.endDate),
    fiscal_year: cfValue<number>(cf, 'fiscalYear') ?? null,
    opportunity_id: cg.opportunity?.id ?? null,
    opportunity_title: cg.opportunity?.title ?? null,
    application_id: cg.application?.id ?? null,
    application_title: cg.application?.title ?? null,
    program_name: cfValue<string>(cf, 'programName') ?? null,
    recipient: recipient
      ? { id: recipient.id, legal_name: recipient.name, ein: ein ? formatEin(ein) : null, uei: recipient.identifiers?.['org:us:uei']?.id ?? null }
      : null,
    recipient_name: cfValue<string>(cf, 'recipientName') ?? null,
    recipient_city: loc?.city ?? null,
    recipient_state: loc?.state ?? null,
    recipient_county: loc?.county ?? null,
    created_at: iso(cg.createdAt),
    last_modified_at: iso(cg.lastModifiedAt),
  };
}

