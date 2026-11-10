// SPDX-License-Identifier: AGPL-3.0-only
// GMS rows → CommonGrants v0.5.0 models. Every function validates its result before returning it and
// throws `ProjectionError` otherwise; nothing unvalidated is persisted or served.
import { AwardBaseSchema, OpportunityBaseSchema, OpportunityDetailsSchema } from "@common-grants/sdk/schemas";
import type { z } from "zod";
import { ProjectionError, validated } from "./errors.ts";
import { prefixedId } from "./ids.ts";
import { toMoney } from "./money.ts";
import { passportCustomFields, VERIFICATION_LEVELS, type VerificationLevel } from "./passport-fields.ts";
import type {
  ApplicationRow,
  AwardRow,
  CompetitionRow,
  FormResponseRow,
  FormRow,
  FunderRow,
  OpportunityRow,
  OrgRefInput,
  StageJson,
} from "./rows.ts";
import {
  AppFormResponseSchema,
  ApplicationBaseSchema,
  CompetitionBaseSchema,
  FormBaseSchema,
  OrganizationBaseSchema,
  type AppFormResponse,
  type ApplicationBase,
  type CompetitionBase,
  type FormBase,
  type OrganizationBase,
} from "./schemas.ts";
import { applicationStatusToCg, awardStatusToCg, competitionStatusToCg } from "./status.ts";

export type OpportunityBase = z.input<typeof OpportunityBaseSchema>;
export type OpportunityDetails = OpportunityBase & { competitions?: CompetitionBase[]; awards?: { id: string; title: string }[] };
export type AwardBase = z.input<typeof AwardBaseSchema>;

/** Registry code that marks an identifier as issued by this GMS. */
export const GMS_REGISTRY = "org:opengrants:gms";

export interface ProjectionOptions {
  /** `GMS_BASE_URL`, e.g. `https://gms.opengrants.io` */
  baseUrl: string;
  /** `WEB_BASE_URL` for public page links; defaults to `baseUrl` */
  webBaseUrl?: string;
}

type CustomField = { name: string; fieldType: "string" | "number" | "integer" | "boolean" | "object" | "array"; value: unknown; description?: string };

const iso = (value: string): string => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
};

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** Drop null/undefined members so optional CommonGrants fields are absent rather than null. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out as T;
}

const gmsField = (value: Record<string, unknown>, description: string): CustomField => ({
  name: "gms",
  fieldType: "object",
  value: compact(value),
  description,
});

const applicantTypes = (values: readonly string[] | null | undefined) =>
  values && values.length ? values.map((value) => ({ value })) : undefined;

/** An `OrgRef`; the EIN is normalized to the nine digits CommonGrants expects. */
export function orgRef(org: OrgRefInput) {
  const ein = org.ein ? org.ein.replace(/\D/g, "") : "";
  return compact({
    id: org.id,
    name: org.name,
    identifiers: ein.length === 9 ? { "org:us:ein": { id: ein } } : undefined,
  });
}

function funderRef(funder: FunderRow | null | undefined) {
  if (!funder?.passport_org_id) return undefined;
  return { primary: orgRef({ id: funder.passport_org_id, name: funder.legal_name ?? funder.display_name, ein: funder.ein }) };
}

// ---------------------------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------------------------

export function projectForm(row: FormRow): FormBase {
  const form = compact({
    id: row.id,
    title: row.title,
    description: row.description,
    version: String(row.version),
    instructions: row.instructions,
    jsonSchema: row.json_schema,
    uiSchema: row.ui_schema,
    mappingToCommonGrants: row.mapping_to_cg,
    mappingFromCommonGrants: row.mapping_from_cg,
    customFields: {
      gms: gmsField(
        { id: prefixedId("form", row.id), purpose: row.purpose, fieldMeta: row.field_meta, publishedAt: row.published_at ? iso(row.published_at) : undefined },
        "OpenGrants GMS form settings",
      ),
    },
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.updated_at),
  });
  return validated("FormBase", FormBaseSchema, form as FormBase);
}

// ---------------------------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------------------------

/** The union of the stage forms (form id → version). A form pinned at two versions is a data error. */
export function unionStageForms(stages: readonly StageJson[] | null | undefined, fallback?: Record<string, number> | null): Record<string, number> {
  const out: Record<string, number> = { ...(stages?.length ? {} : (fallback ?? {})) };
  for (const stage of stages ?? []) {
    for (const [formId, version] of Object.entries(stage.forms ?? {})) {
      if (out[formId] !== undefined && out[formId] !== version) {
        throw new ProjectionError("CompetitionBase", [
          { path: `customFields.gms.value.stages.${stage.key}.forms.${formId}`, message: `form is pinned at versions ${out[formId]} and ${version}` },
        ]);
      }
      out[formId] = version;
    }
  }
  return out;
}

export interface CompetitionInput {
  competition: CompetitionRow;
  opportunity: Pick<OpportunityRow, "id" | "title">;
  /** The pinned version of every form any stage uses. */
  forms: FormRow[];
}

/**
 * CommonGrants sees one competition: `forms.forms` is the union of the stage forms keyed by form id,
 * `forms.validation` carries the per-stage required sets, and the stages themselves are in
 * `customFields.gms.value.stages`.
 */
export function projectCompetition(input: CompetitionInput): CompetitionBase {
  const { competition: row } = input;
  const stages = row.stages ?? [];
  const pinned = unionStageForms(stages, row.forms);
  const byKey = new Map(input.forms.map((f) => [`${f.id}@${f.version}`, f]));
  const forms: Record<string, FormBase> = {};
  const missing: { path: string; message: string }[] = [];
  for (const [formId, version] of Object.entries(pinned)) {
    const form = byKey.get(`${formId}@${version}`);
    if (!form) missing.push({ path: `forms.forms.${formId}`, message: `pinned form version ${version} was not supplied` });
    else forms[formId] = projectForm(form);
  }
  if (missing.length) throw new ProjectionError("CompetitionBase", missing);

  const requiredByStage = Object.fromEntries(
    stages.filter((s) => s.requiresSubmission).map((s) => [s.key, { required: Object.keys(s.forms ?? {}) }]),
  );
  const validation = compact({
    ...(row.validation ?? {}),
    ...(row.validation?.required === undefined && !stages.length ? { required: Object.keys(pinned) } : {}),
    ...(stages.length ? { stages: requiredByStage } : {}),
  });

  const competition = compact({
    id: row.id,
    opportunity: { id: input.opportunity.id, title: input.opportunity.title },
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    status: competitionStatusToCg(row.status),
    keyDates: row.key_dates && Object.keys(row.key_dates).length ? row.key_dates : undefined,
    forms: compact({ forms, validation: Object.keys(validation).length ? validation : undefined }),
    acceptedApplicantTypes: applicantTypes(row.accepted_applicant_types),
    customFields: {
      gms: gmsField({ id: prefixedId("competition", row.id), stages }, "OpenGrants GMS stages; CommonGrants clients see one competition"),
    },
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.updated_at),
  });
  return validated("CompetitionBase", CompetitionBaseSchema, competition as CompetitionBase);
}

// ---------------------------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------------------------

export interface OpportunityInput {
  opportunity: OpportunityRow;
  funder?: FunderRow | null;
}

function opportunityRecord(input: OpportunityInput, opts: ProjectionOptions) {
  const { opportunity: row, funder } = input;
  const web = trimSlash(opts.webBaseUrl ?? opts.baseUrl);
  return compact({
    id: row.id,
    title: row.title,
    status: { value: row.status },
    description: row.description,
    funding: row.funding && Object.keys(row.funding).length ? row.funding : undefined,
    funders: funderRef(funder),
    keyDates: row.key_dates && Object.keys(row.key_dates).length ? row.key_dates : undefined,
    acceptedApplicantTypes: applicantTypes(row.accepted_applicant_types),
    source: funder ? `${web}/f/${funder.handle}/o/${row.slug}` : `${trimSlash(opts.baseUrl)}/common-grants/opportunities/${row.id}`,
    customFields: {
      ...(row.custom_fields ?? {}),
      gms: gmsField(
        { id: prefixedId("opportunity", row.id), slug: row.slug, funderHandle: funder?.handle, programId: row.program_id, publishedAt: row.published_at ? iso(row.published_at) : undefined },
        "OpenGrants GMS listing details",
      ),
    },
    identifiers: { systemId: { registry: { code: GMS_REGISTRY }, id: row.id } },
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.updated_at),
  });
}

export function projectOpportunity(input: OpportunityInput, opts: ProjectionOptions): OpportunityBase {
  return validated("OpportunityBase", OpportunityBaseSchema, opportunityRecord(input, opts) as OpportunityBase);
}

export interface OpportunityDetailsInput extends OpportunityInput {
  /** Competitions the caller may see. */
  competitions?: Omit<CompetitionInput, "opportunity">[];
  /** Awards the caller may see. */
  awards?: Pick<AwardRow, "id" | "title">[];
}

export function projectOpportunityDetails(input: OpportunityDetailsInput, opts: ProjectionOptions): OpportunityDetails {
  const opportunity = { id: input.opportunity.id, title: input.opportunity.title };
  const details = {
    ...opportunityRecord(input, opts),
    competitions: (input.competitions ?? []).map((c) => projectCompetition({ ...c, opportunity })),
    awards: (input.awards ?? []).map((a) => ({ id: a.id, title: a.title })),
  };
  return validated("OpportunityDetails", OpportunityDetailsSchema, details as OpportunityDetails);
}

// ---------------------------------------------------------------------------------------------
// Applications and form responses
// ---------------------------------------------------------------------------------------------

export function projectFormResponse(row: FormResponseRow): AppFormResponse {
  const response = compact({
    id: row.id,
    formId: row.form_id,
    applicationId: row.application_id,
    response: row.response ?? {},
    status: { value: row.status },
    validationErrors: row.validation_errors ?? [],
    customFields: {
      gms: gmsField(
        { formVersion: row.form_version, provenance: row.provenance ?? {}, lockedAt: row.locked_at ? iso(row.locked_at) : undefined },
        "Pinned form version and per-field provenance",
      ),
    },
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.updated_at),
  });
  return validated("AppFormResponse", AppFormResponseSchema, response as AppFormResponse);
}

export interface ApplicationInput {
  application: ApplicationRow;
  formResponses: FormResponseRow[];
}

const isLevel = (value: unknown): value is VerificationLevel => (VERIFICATION_LEVELS as readonly unknown[]).includes(value);

export function projectApplication(input: ApplicationInput): ApplicationBase {
  const { application: row } = input;
  const foreign = input.formResponses.filter((r) => r.application_id !== row.id);
  if (foreign.length) {
    throw new ProjectionError("ApplicationBase", foreign.map((r) => ({ path: `formResponses.${r.form_id}`, message: "form response belongs to another application" })));
  }
  if (row.verification_level_at_submit != null && !isLevel(row.verification_level_at_submit)) {
    throw new ProjectionError("ApplicationBase", [{ path: "customFields.verificationLevel.value", message: `not a Passport level: ${row.verification_level_at_submit}` }]);
  }
  const formResponses = Object.fromEntries(input.formResponses.map((r) => [r.form_id, projectFormResponse(r)]));
  const validationErrors = input.formResponses.flatMap((r) =>
    (r.validation_errors ?? []).map((e) => (e && typeof e === "object" ? { formId: r.form_id, ...(e as object) } : { formId: r.form_id, message: String(e) })),
  );
  const requested =
    row.requested_amount_minor != null && row.currency ? toMoney(row.requested_amount_minor, row.currency) : undefined;
  const application = compact({
    id: row.id,
    title: row.title,
    competitionId: row.competition_id,
    opportunityId: row.opportunity_id,
    formResponses,
    status: applicationStatusToCg(row.status),
    submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
    validationErrors,
    customFields: {
      ...passportCustomFields({ verificationLevel: row.verification_level_at_submit as VerificationLevel | null, attestationUrl: row.attestation_url }),
      gms: gmsField(
        { id: prefixedId("application", row.id), status: row.status, stage: row.stage, requestedAmount: requested, eligibility: row.eligibility, applicantWorkspaceId: row.applicant_workspace_id },
        "OpenGrants GMS workflow state",
      ),
    },
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.updated_at),
  });
  // `submittedAt` is explicitly nullable in the protocol, so it survives `compact` as null.
  if (!row.submitted_at) (application as Record<string, unknown>).submittedAt = null;
  return validated("ApplicationBase", ApplicationBaseSchema, application as ApplicationBase);
}

// ---------------------------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------------------------

export interface AwardInput {
  award: AwardRow;
  funder?: FunderRow | null;
  /** The recipient's Passport organization; omit for an individual recipient. */
  recipient?: OrgRefInput | null;
  opportunity?: Pick<OpportunityRow, "id" | "title"> | null;
  application?: Pick<ApplicationRow, "id" | "title"> | null;
  parent?: Pick<AwardRow, "id" | "title"> | null;
}

/**
 * `AwardBase` has no `customFields`, and the GMS never adds one. The lifecycle status travels in
 * `status.customValue`; the GMS id travels in `identifiers` (`systemId` is the UUID, `otherIds.gms`
 * the prefixed form). `funding.disbursedAmount` is whatever was last read from Passport.
 */
export function projectAward(input: AwardInput, opts: ProjectionOptions): AwardBase {
  const { award: row } = input;
  if (input.recipient && row.recipient_individual) {
    throw new ProjectionError("AwardBase", [{ path: "recipientIndividual", message: "an award has a recipient organization or an individual, not both" }]);
  }
  const funding = row.funding ? compact({ ...row.funding }) : undefined;
  const award = compact({
    id: row.id,
    title: row.title,
    identifiers: {
      systemId: { registry: { code: GMS_REGISTRY }, id: row.id },
      otherIds: { gms: { registry: { code: GMS_REGISTRY }, id: prefixedId("award", row.id) } },
    },
    description: row.description ?? "",
    status: awardStatusToCg(row.status),
    funding: funding && Object.keys(funding).length ? funding : undefined,
    keyDates: row.key_dates && Object.keys(row.key_dates).length ? row.key_dates : undefined,
    opportunity: input.opportunity ? { id: input.opportunity.id, title: input.opportunity.title } : undefined,
    application: input.application ? { id: input.application.id, title: input.application.title } : undefined,
    funders: funderRef(input.funder),
    recipientOrganizations: input.recipient ? { primary: orgRef(input.recipient) } : undefined,
    recipientIndividual: row.recipient_individual ?? undefined,
    parent: input.parent ? { id: input.parent.id, title: input.parent.title } : undefined,
    source: `${trimSlash(opts.baseUrl)}/common-grants/awards/${row.id}`,
    createdAt: iso(row.created_at),
    lastModifiedAt: iso(row.updated_at),
  });
  return validated("AwardBase", AwardBaseSchema, award as AwardBase);
}

// ---------------------------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------------------------

/**
 * The cached Passport projection, passed through untouched once it validates. The GMS never edits
 * profile fields; a cache entry that is not a CommonGrants organization is refused, not repaired.
 */
export function projectOrganization(cached: unknown): OrganizationBase {
  return validated("OrganizationBase", OrganizationBaseSchema, cached as OrganizationBase);
}
