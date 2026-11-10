// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the CommonGrants v0.5.0 models that `@common-grants/sdk@0.9.1` does not ship:
 * `CompetitionBase`, `FormBase`, `ApplicationBase`, `AppFormResponse`, `OrganizationBase` and the
 * application filters. Written from the `@common-grants/core@0.5.0` TypeSpec, reusing the SDK
 * schemas wherever they exist. Opportunities and awards use the SDK schemas directly.
 */
import {
  ApplicantTypeSchema,
  CustomFieldSchema,
  DateRangeFilterSchema,
  DefaultFilterSchema,
  EventSchema,
  OppRefSchema,
  OrgIdsSchema,
  StringArrayFilterSchema,
  SystemMetadataSchema,
  UuidSchema,
} from "@common-grants/sdk/schemas";
import { z } from "zod";

const customFields = z.record(z.string(), CustomFieldSchema);

const extensibleEnum = <T extends readonly [string, ...string[]]>(options: T) =>
  z.object({ value: z.enum(options), customValue: z.string().optional(), description: z.string().optional() }).strict();

export const FileSchema = z
  .object({
    downloadUrl: z.url(),
    name: z.string(),
    description: z.string().optional(),
    sizeInBytes: z.number().optional(),
    mimeType: z.string().optional(),
    ...SystemMetadataSchema.shape,
  })
  .strict();

// ---------------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------------

export const MappingConstantFunctionSchema = z.object({ const: z.unknown() }).strict();
export const MappingFieldFunctionSchema = z.object({ field: z.string() }).strict();
export const MappingSwitchFunctionSchema = z
  .object({
    switch: z.object({ field: z.string(), case: z.record(z.string(), z.unknown()), default: z.unknown().optional() }).strict(),
  })
  .strict();

export type MappingNode = { [key: string]: unknown };

/** `MappingSchema`: a tree whose leaves are `field`, `const` or `switch` functions. */
export const MappingSchemaSchema: z.ZodType<MappingNode> = z.lazy(() =>
  z.record(
    z.string(),
    z.union([MappingFieldFunctionSchema, MappingSwitchFunctionSchema, MappingConstantFunctionSchema, MappingSchemaSchema]),
  ),
);

// ---------------------------------------------------------------------------------------------
// Forms and form responses
// ---------------------------------------------------------------------------------------------

export const FormBaseSchema = z
  .object({
    id: UuidSchema,
    title: z.string(),
    description: z.string().optional(),
    version: z.string().optional(),
    instructions: z.union([z.string(), z.array(FileSchema)]).optional(),
    jsonSchema: z.record(z.string(), z.unknown()).optional(),
    uiSchema: z.record(z.string(), z.unknown()).optional(),
    mappingToCommonGrants: MappingSchemaSchema.optional(),
    mappingFromCommonGrants: MappingSchemaSchema.optional(),
    customFields: customFields.optional(),
    ...SystemMetadataSchema.shape,
  })
  .strict();

export const FORM_RESPONSE_STATUS_OPTIONS = ["notStarted", "inProgress", "complete", "custom"] as const;

export const AppFormResponseSchema = z
  .object({
    id: UuidSchema,
    formId: UuidSchema,
    applicationId: UuidSchema,
    response: z.record(z.string(), z.unknown()),
    status: extensibleEnum(FORM_RESPONSE_STATUS_OPTIONS),
    validationErrors: z.array(z.unknown()).optional(),
    customFields: customFields.optional(),
    ...SystemMetadataSchema.shape,
  })
  .strict();

// ---------------------------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------------------------

export const COMPETITION_STATUS_OPTIONS = ["open", "closed", "custom"] as const;

export const CompetitionTimelineSchema = z
  .object({
    openDate: EventSchema.optional(),
    closeDate: EventSchema.optional(),
    otherDates: z.record(z.string(), EventSchema).optional(),
  })
  .strict();

export const CompetitionFormsSchema = z
  .object({ forms: z.record(z.string(), FormBaseSchema), validation: z.record(z.string(), z.unknown()).optional() })
  .strict();

export const CompetitionBaseSchema = z
  .object({
    id: UuidSchema,
    opportunity: OppRefSchema,
    title: z.string(),
    description: z.string().optional(),
    instructions: z.union([z.string(), z.array(FileSchema)]).optional(),
    status: extensibleEnum(COMPETITION_STATUS_OPTIONS),
    keyDates: CompetitionTimelineSchema.optional(),
    forms: CompetitionFormsSchema,
    acceptedApplicantTypes: z.array(ApplicantTypeSchema).optional(),
    customFields: customFields.optional(),
    ...SystemMetadataSchema.shape,
  })
  .strict();

// ---------------------------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------------------------

export const APP_STATUS_OPTIONS = ["inProgress", "submitted", "accepted", "rejected", "custom"] as const;

export const ApplicationBaseSchema = z
  .object({
    id: UuidSchema,
    title: z.string(),
    competitionId: UuidSchema,
    opportunityId: UuidSchema,
    formResponses: z.record(z.string(), AppFormResponseSchema),
    status: extensibleEnum(APP_STATUS_OPTIONS),
    submittedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    validationErrors: z.array(z.unknown()).optional(),
    customFields: customFields.optional(),
    ...SystemMetadataSchema.shape,
  })
  .strict();

export const AppFiltersSchema = z
  .object({
    opportunityId: StringArrayFilterSchema.optional(),
    competitionId: StringArrayFilterSchema.optional(),
    submittedAtRange: DateRangeFilterSchema.optional(),
    status: StringArrayFilterSchema.optional(),
    customFilters: z.record(z.string(), DefaultFilterSchema).optional(),
  })
  .strict();

export const APP_SORT_BY = ["lastModifiedAt", "createdAt", "submittedAt", "status.value", "opportunityId", "competitionId", "custom"] as const;

export const AppSortingSchema = z
  .object({ sortBy: z.enum(APP_SORT_BY), customSortBy: z.string().optional(), sortOrder: z.enum(["asc", "desc"]).optional() })
  .strict();

// ---------------------------------------------------------------------------------------------
// Organizations (cached Passport projection)
// ---------------------------------------------------------------------------------------------

/**
 * `OrganizationBase` as the GMS consumes it. Passport is the source and validates the full model
 * before serving it, so the nested collections are checked for shape only; the top level is strict
 * so nothing outside the CommonGrants model is ever cached or re-served.
 */
export const OrganizationBaseSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    identifiers: OrgIdsSchema.optional(),
    orgType: z.looseObject({ term: z.string(), code: z.string() }).optional(),
    status: extensibleEnum(["active", "inactive", "custom"] as const).optional(),
    addresses: z.looseObject({ primary: z.looseObject({}) }).optional(),
    phones: z.looseObject({ primary: z.looseObject({}) }).optional(),
    emails: z.looseObject({ primary: z.string() }).optional(),
    mission: z.string().optional(),
    yearFounded: z.string().regex(/^[0-9]{4}$/).optional(),
    socials: z.record(z.string(), z.unknown()).optional(),
    aliases: z.array(z.string().min(1)).optional(),
    relationships: z.record(z.string(), z.array(z.unknown())).optional(),
    customFields: customFields.optional(),
  })
  .strict();

export type FormBase = z.input<typeof FormBaseSchema>;
export type AppFormResponse = z.input<typeof AppFormResponseSchema>;
export type CompetitionBase = z.input<typeof CompetitionBaseSchema>;
export type ApplicationBase = z.input<typeof ApplicationBaseSchema>;
export type OrganizationBase = z.input<typeof OrganizationBaseSchema>;
export type AppFilters = z.input<typeof AppFiltersSchema>;
export type AppSorting = z.input<typeof AppSortingSchema>;
