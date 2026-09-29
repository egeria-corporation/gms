// SPDX-License-Identifier: AGPL-3.0-or-later
// CommonGrants contract schemas.
//
// `@common-grants/sdk` 0.8 ships zod schemas for the Opportunity model, the shared fields
// (Money, Event, CustomField, SystemMetadata), filters, pagination, sorting and the response
// envelopes. We re-export and build on those. It does NOT ship schemas for Competition, Form,
// FormResponse, Application, Award or Organization, so those are hand-written here from the
// `@common-grants/core` 0.4 TypeSpec (node_modules/@common-grants/core/lib/core/models/*.tsp),
// reusing the SDK field schemas so the shared shapes stay identical.
import {
  CustomFieldSchema,
  DateRangeFilterSchema,
  DefaultFilterSchema,
  EventSchema,
  FilteredSchema,
  MoneyRangeFilterSchema,
  MoneySchema,
  OkSchema,
  OppFiltersSchema,
  OpportunityBaseSchema,
  PaginatedSchema,
  StringArrayFilterSchema,
  SystemMetadataSchema,
  UTCDateTimeSchema,
  UuidSchema,
} from '@common-grants/sdk/schemas';
import { z } from 'zod';

export {
  CustomFieldSchema,
  DateRangeFilterSchema,
  DefaultFilterSchema,
  ErrorSchema,
  EventSchema,
  FilteredSchema,
  MoneyRangeFilterSchema,
  MoneySchema,
  OkSchema,
  OppFiltersSchema,
  OppSortingSchema,
  OpportunityBaseSchema,
  PaginatedResultsInfoSchema,
  PaginatedSchema,
  SortedResultsInfoSchema,
  SortedSchema,
  StringArrayFilterSchema,
  SuccessSchema,
  UnauthorizedSchema,
  NotFoundSchema,
} from '@common-grants/sdk/schemas';

/** `Fields.ExtensibleEnumT<T>` */
export function extensibleEnum<const T extends readonly [string, ...string[]]>(options: T) {
  return z.object({
    value: z.enum(options),
    customValue: z.string().nullish(),
    description: z.string().nullish(),
  });
}

const CustomFieldsSchema = z.record(z.string(), CustomFieldSchema).nullish();

// ---------------------------------------------------------------------------------------
// Identifiers (core 0.4: fields/identifier.tsp, models/organization.tsp)
export const IdentifierSchema = z.object({
  registry: z.object({ code: z.string().nullish(), url: z.url().nullish() }).nullish(),
  id: z.string().nullish(),
  allIds: z.array(z.object({ id: z.string(), status: z.enum(['active', 'archived']) })).nullish(),
});
export const IdentifierCollectionSchema = z.object({
  systemId: IdentifierSchema.extend({ id: UuidSchema.nullish() }).nullish(),
  otherIds: z.record(z.string(), IdentifierSchema).nullish(),
});
export const OrgIdsSchema = IdentifierCollectionSchema.extend({
  'org:us:ein': IdentifierSchema.extend({ id: z.string().regex(/^[0-9]{9}$/).nullish() }).nullish(),
  'org:us:uei': IdentifierSchema.extend({ id: z.string().regex(/^[A-HJ-NP-Z0-9]{12}$/).nullish() }).nullish(),
  'org:xi:duns': IdentifierSchema.extend({ id: z.string().regex(/^[0-9]{9}$/).nullish() }).nullish(),
});
export const OrgRefSchema = z.object({ id: UuidSchema, name: z.string(), identifiers: OrgIdsSchema.nullish() });
export const OrgRefCollectionSchema = z.object({ primary: OrgRefSchema, otherOrgs: z.record(z.string(), OrgRefSchema).nullish() });

// ---------------------------------------------------------------------------------------
// Organization (core 0.4: models/organization.tsp, fields/address|phone|email.tsp)
export const AddressSchema = z.object({
  street1: z.string(),
  street2: z.string().nullish(),
  city: z.string(),
  stateOrProvince: z.string(),
  country: z.string(),
  postalCode: z.string(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  geography: z.record(z.string(), z.unknown()).nullish(),
});
export const PhoneSchema = z.object({
  countryCode: z.string().regex(/^\+[1-9][0-9]{0,3}$/),
  number: z.string(),
  extension: z.string().nullish(),
  isMobile: z.boolean().nullish(),
});
export const OrganizationBaseSchema = OrgRefSchema.extend({
  orgType: z.unknown().optional(),
  addresses: z.object({ primary: AddressSchema, otherAddresses: z.record(z.string(), AddressSchema).nullish() }).nullish(),
  phones: z.object({ primary: PhoneSchema, fax: PhoneSchema.nullish(), otherPhones: z.record(z.string(), PhoneSchema).nullish() }).nullish(),
  emails: z.object({ primary: z.email(), otherEmails: z.record(z.string(), z.email()).nullish() }).nullish(),
  mission: z.string().nullish(),
  yearFounded: z.string().regex(/^[0-9]{4}$/).nullish(),
  socials: z.record(z.string(), z.unknown()).nullish(),
  customFields: CustomFieldsSchema,
});

// ---------------------------------------------------------------------------------------
// Mapping + Form (core 0.4: models/mapping.tsp, models/form.tsp)
export type MappingSchemaType = { [key: string]: MappingFunctionType | MappingSchemaType };
type MappingFunctionType = { const: unknown } | { field: string } | { switch: { field: string; case: Record<string, unknown>; default?: unknown } };
const MappingFunctionSchema = z.union([
  z.object({ const: z.unknown() }).strict(),
  z.object({ field: z.string() }).strict(),
  z.object({ switch: z.object({ field: z.string(), case: z.record(z.string(), z.unknown()), default: z.unknown().optional() }) }).strict(),
]);
export const MappingSchema: z.ZodType<MappingSchemaType> = z.lazy(() =>
  z.record(z.string(), z.union([MappingFunctionSchema, MappingSchema])),
) as z.ZodType<MappingSchemaType>;

export const FileSchema = z.object({ downloadUrl: z.url(), name: z.string(), description: z.string().nullish(), sizeInBytes: z.number().int().nullish(), mimeType: z.string().nullish() }).passthrough();

export const FormBaseSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    description: z.string().nullish(),
    version: z.string().nullish(),
    instructions: z.union([z.string(), z.array(FileSchema)]).nullish(),
    jsonSchema: z.record(z.string(), z.unknown()).nullish(),
    uiSchema: z.record(z.string(), z.unknown()).nullish(),
    mappingToCommonGrants: MappingSchema.nullish(),
    mappingFromCommonGrants: MappingSchema.nullish(),
    customFields: CustomFieldsSchema,
  })
  .extend(SystemMetadataSchema.shape);

// ---------------------------------------------------------------------------------------
// Competition (core 0.4: models/competition.tsp)
export const CompetitionStatusSchema = extensibleEnum(['open', 'closed', 'custom'] as const);
export const CompetitionBaseSchema = z
  .object({
    id: UuidSchema,
    opportunityId: UuidSchema,
    title: z.string(),
    description: z.string().nullish(),
    instructions: z.union([z.string(), z.array(FileSchema)]).nullish(),
    status: CompetitionStatusSchema,
    keyDates: z
      .object({ openDate: EventSchema.nullish(), closeDate: EventSchema.nullish(), otherDates: z.record(z.string(), EventSchema).nullish() })
      .nullish(),
    forms: z.object({ forms: z.record(z.string(), FormBaseSchema), validation: z.record(z.string(), z.unknown()).nullish() }),
    acceptedApplicantTypes: OpportunityBaseSchema.shape.acceptedApplicantTypes,
    customFields: CustomFieldsSchema,
  })
  .extend(SystemMetadataSchema.shape);

/** `Models.OpportunityDetails`: the `GET /opportunities/{oppId}` payload. */
export const OpportunityDetailsSchema = OpportunityBaseSchema.extend({ competitions: z.array(CompetitionBaseSchema).nullish() });

// ---------------------------------------------------------------------------------------
// Form responses + Application (core 0.4: models/form-response.tsp, models/application.tsp)
export const FormResponseStatusSchema = extensibleEnum(['notStarted', 'inProgress', 'complete', 'custom'] as const);
export const AppFormResponseSchema = z
  .object({
    applicationId: UuidSchema,
    id: UuidSchema,
    formId: UuidSchema,
    response: z.record(z.string(), z.unknown()),
    status: FormResponseStatusSchema,
    validationErrors: z.array(z.unknown()).nullish(),
    customFields: CustomFieldsSchema,
  })
  .extend(SystemMetadataSchema.shape);

export const AppStatusSchema = extensibleEnum(['inProgress', 'submitted', 'accepted', 'rejected', 'custom'] as const);
export const AppRefSchema = z.object({ id: UuidSchema, title: z.string() });
export const ApplicationBaseSchema = AppRefSchema.extend({
  competitionId: UuidSchema,
  opportunityId: UuidSchema,
  formResponses: z.record(z.string(), AppFormResponseSchema),
  status: AppStatusSchema,
  submittedAt: UTCDateTimeSchema.nullish(),
  validationErrors: z.array(z.unknown()).nullish(),
  customFields: CustomFieldsSchema,
}).extend(SystemMetadataSchema.shape);

export const AppFiltersSchema = z.object({
  opportunityId: StringArrayFilterSchema.nullish(),
  competitionId: StringArrayFilterSchema.nullish(),
  submittedAtRange: DateRangeFilterSchema.nullish(),
  status: StringArrayFilterSchema.nullish(),
  customFilters: z.record(z.string(), DefaultFilterSchema).nullish(),
});
export const AppSortByEnum = z.enum(['lastModifiedAt', 'createdAt', 'submittedAt', 'status.value', 'opportunityId', 'competitionId', 'custom']);
export const AppSortingSchema = z.object({ sortBy: AppSortByEnum, customSortBy: z.string().nullish(), sortOrder: z.enum(['asc', 'desc']).nullish() });

// ---------------------------------------------------------------------------------------
// Award (core 0.4: models/award.tsp)
export const AwdStatusSchema = extensibleEnum(['awarded', 'completed', 'cancelled', 'custom'] as const);
export const AwdIdsSchema = IdentifierCollectionSchema.extend({ 'awd:us:fain': IdentifierSchema.nullish() });
export const AwdRefSchema = z.object({ id: UuidSchema, title: z.string(), identifiers: AwdIdsSchema.nullish() });
export const AwardBaseSchema = AwdRefSchema.extend({
  description: z.string(),
  status: AwdStatusSchema,
  funding: z
    .object({
      details: z.string().nullish(),
      requestedAmount: MoneySchema.nullish(),
      awardedAmount: MoneySchema.nullish(),
      disbursedAmount: MoneySchema.nullish(),
    })
    .nullish(),
  keyDates: z
    .object({ awardDate: EventSchema.nullish(), periodOfPerformance: EventSchema.nullish(), otherDates: z.record(z.string(), EventSchema).nullish() })
    .nullish(),
  opportunity: z.object({ id: UuidSchema, title: z.string() }).nullish(),
  application: AppRefSchema.nullish(),
  funders: OrgRefCollectionSchema.nullish(),
  recipientOrganizations: OrgRefCollectionSchema.nullish(),
  recipientIndividual: z.record(z.string(), z.unknown()).nullish(),
  parent: AwdRefSchema.nullish(),
  source: z.url().nullish(),
  customFields: CustomFieldsSchema,
}).extend(SystemMetadataSchema.shape);

export const AwdFiltersSchema = z.object({
  status: StringArrayFilterSchema.nullish(),
  opportunityId: StringArrayFilterSchema.nullish(),
  awardDateRange: DateRangeFilterSchema.nullish(),
  awardedAmountRange: MoneyRangeFilterSchema.nullish(),
  customFilters: z.record(z.string(), DefaultFilterSchema).nullish(),
});
export const AwdSortByEnum = z.enum(['lastModifiedAt', 'createdAt', 'title', 'status.value', 'keyDates.awardDate', 'funding.awardedAmount', 'custom']);
export const AwdSortingSchema = z.object({ sortBy: AwdSortByEnum, customSortBy: z.string().nullish(), sortOrder: z.enum(['asc', 'desc']).nullish() });

// ---------------------------------------------------------------------------------------
// Response envelopes for each route (used by contract tests and the OpenAPI document).
export const ResponseSchemas = {
  opportunityList: PaginatedSchema(OpportunityBaseSchema),
  opportunityRead: OkSchema(OpportunityDetailsSchema),
  opportunitySearch: FilteredSchema(OpportunityBaseSchema, OppFiltersSchema),
  formList: PaginatedSchema(FormBaseSchema),
  formRead: OkSchema(FormBaseSchema),
  competitionList: PaginatedSchema(CompetitionBaseSchema),
  competitionRead: OkSchema(CompetitionBaseSchema),
  awardList: PaginatedSchema(AwardBaseSchema),
  awardRead: OkSchema(AwardBaseSchema),
  awardSearch: FilteredSchema(AwardBaseSchema, AwdFiltersSchema),
  applicationRead: OkSchema(ApplicationBaseSchema),
  applicationCreated: OkSchema(ApplicationBaseSchema),
  applicationSearch: FilteredSchema(ApplicationBaseSchema, AppFiltersSchema),
  formResponseRead: OkSchema(AppFormResponseSchema),
  submitted: OkSchema(z.unknown()),
  accepted: OkSchema(z.unknown()),
} as const;
