// SPDX-License-Identifier: AGPL-3.0-only
// CommonGrants wire (JSON) types. Dates are ISO strings on the wire; the SDK's zod schemas
// parse them into `Date`s, so these are written by hand to describe exactly what we emit.

export interface CgMoney {
  /** Decimal string, e.g. "25000.00". */
  amount: string;
  /** ISO 4217 code. */
  currency: string;
}

export interface CgExtensibleEnum<T extends string> {
  value: T | 'custom';
  customValue?: string;
  description?: string;
}

export type CgCustomFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

export interface CgCustomField {
  name: string;
  fieldType: CgCustomFieldType;
  schema?: string;
  value: unknown;
  description?: string;
}

export type CgCustomFields = Record<string, CgCustomField>;

export interface CgSingleDateEvent {
  name: string;
  eventType: 'singleDate';
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM:SS */
  time?: string;
  description?: string;
}
export interface CgDateRangeEvent {
  name: string;
  eventType: 'dateRange';
  startDate: string;
  startTime?: string;
  endDate: string;
  endTime?: string;
  description?: string;
}
export interface CgOtherEvent {
  name: string;
  eventType: 'other';
  details?: string;
  description?: string;
}
export type CgEvent = CgSingleDateEvent | CgDateRangeEvent | CgOtherEvent;

export interface CgSystemMetadata {
  createdAt: string;
  lastModifiedAt: string;
}

export type CgOppStatusValue = 'forecasted' | 'open' | 'closed';
export type CgApplicantTypeValue =
  | 'individual'
  | 'organization'
  | 'government_state'
  | 'government_county'
  | 'government_municipal'
  | 'government_special_district'
  | 'government_tribal'
  | 'organization_tribal_other'
  | 'school_district_independent'
  | 'higher_education_public'
  | 'higher_education_private'
  | 'non_profit_with_501c3'
  | 'nonprofit_without_501c3'
  | 'for_profit_small_business'
  | 'for_profit_not_small_business'
  | 'unrestricted';

export interface CgOppFunding {
  details?: string;
  totalAmountAvailable?: CgMoney;
  minAwardAmount?: CgMoney;
  maxAwardAmount?: CgMoney;
  minAwardCount?: number;
  maxAwardCount?: number;
  estimatedAwardCount?: number;
}

export interface CgOppTimeline {
  postDate?: CgEvent;
  closeDate?: CgEvent;
  otherDates?: Record<string, CgEvent>;
}

export interface CgOpportunity extends CgSystemMetadata {
  id: string;
  title: string;
  status: CgExtensibleEnum<CgOppStatusValue>;
  description: string;
  funding?: CgOppFunding;
  keyDates?: CgOppTimeline;
  acceptedApplicantTypes?: CgExtensibleEnum<CgApplicantTypeValue>[];
  source?: string;
  customFields?: CgCustomFields;
}

export interface CgOpportunityDetails extends CgOpportunity {
  competitions?: CgCompetition[];
}

export type CgMapping = { [key: string]: unknown };

export interface CgForm extends CgSystemMetadata {
  id: string;
  name: string;
  description?: string;
  version?: string;
  instructions?: string;
  jsonSchema?: Record<string, unknown>;
  uiSchema?: Record<string, unknown>;
  mappingToCommonGrants?: CgMapping;
  mappingFromCommonGrants?: CgMapping;
  customFields?: CgCustomFields;
}

export interface CgCompetition extends CgSystemMetadata {
  id: string;
  opportunityId: string;
  title: string;
  description?: string;
  status: CgExtensibleEnum<'open' | 'closed'>;
  keyDates?: { openDate?: CgEvent; closeDate?: CgEvent; otherDates?: Record<string, CgEvent> };
  forms: { forms: Record<string, CgForm>; validation?: Record<string, unknown> };
  acceptedApplicantTypes?: CgExtensibleEnum<CgApplicantTypeValue>[];
  customFields?: CgCustomFields;
}

export interface CgAppFormResponse extends CgSystemMetadata {
  applicationId: string;
  id: string;
  formId: string;
  response: Record<string, unknown>;
  status: CgExtensibleEnum<'notStarted' | 'inProgress' | 'complete'>;
  validationErrors?: unknown[];
  customFields?: CgCustomFields;
}

export type CgAppStatusValue = 'inProgress' | 'submitted' | 'accepted' | 'rejected';

export interface CgApplication extends CgSystemMetadata {
  id: string;
  title: string;
  competitionId: string;
  opportunityId: string;
  formResponses: Record<string, CgAppFormResponse>;
  status: CgExtensibleEnum<CgAppStatusValue>;
  submittedAt?: string | null;
  validationErrors?: unknown[];
  customFields?: CgCustomFields;
}

export interface CgIdentifier {
  registry?: { code?: string; url?: string };
  id?: string;
  allIds?: { id: string; status: 'active' | 'archived' }[];
}

export interface CgOrgIds {
  systemId?: CgIdentifier;
  otherIds?: Record<string, CgIdentifier>;
  'org:us:ein'?: CgIdentifier;
  'org:us:uei'?: CgIdentifier;
  'org:xi:duns'?: CgIdentifier;
}

export interface CgOrgRef {
  id: string;
  name: string;
  identifiers?: CgOrgIds;
}

export interface CgAddress {
  street1: string;
  street2?: string;
  city: string;
  stateOrProvince: string;
  country: string;
  postalCode: string;
}

export interface CgPhone {
  countryCode: string;
  number: string;
  extension?: string;
  isMobile?: boolean;
}

export interface CgOrganization extends CgOrgRef {
  addresses?: { primary: CgAddress; otherAddresses?: Record<string, CgAddress> };
  phones?: { primary: CgPhone };
  emails?: { primary: string };
  mission?: string;
  socials?: { website?: string };
  customFields?: CgCustomFields;
}

export type CgAwardStatusValue = 'awarded' | 'completed' | 'cancelled';

export interface CgAward extends CgSystemMetadata {
  id: string;
  title: string;
  identifiers?: { systemId?: CgIdentifier; otherIds?: Record<string, CgIdentifier>; 'awd:us:fain'?: CgIdentifier };
  description: string;
  status: CgExtensibleEnum<CgAwardStatusValue>;
  funding?: { details?: string; requestedAmount?: CgMoney; awardedAmount?: CgMoney; disbursedAmount?: CgMoney };
  keyDates?: { awardDate?: CgEvent; periodOfPerformance?: CgEvent; otherDates?: Record<string, CgEvent> };
  opportunity?: { id: string; title: string };
  application?: { id: string; title: string };
  funders?: { primary: CgOrgRef; otherOrgs?: Record<string, CgOrgRef> };
  recipientOrganizations?: { primary: CgOrgRef; otherOrgs?: Record<string, CgOrgRef> };
  source?: string;
  customFields?: CgCustomFields;
}

export interface CgPaginationInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CgSortInfo {
  sortBy: string;
  customSortBy?: string;
  sortOrder: 'asc' | 'desc';
  errors?: string[];
}
