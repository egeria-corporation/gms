// SPDX-License-Identifier: AGPL-3.0-only
// GMS extensions to the CommonGrants 0.4 models (@common-grants/core).
//
// Best effort: this file documents the custom fields GMS emits so other implementers can type them.
// It is NOT compiled in CI (the TypeSpec compiler and emitters are not project dependencies).
// The runtime source of truth is packages/commongrants/src/plugin.ts (`gmsPlugin`, `GMS_CUSTOM_FIELDS`),
// and the contract tests validate every response against zod schemas built from the same models.
//
// To compile by hand:
//   npm i -D @typespec/compiler @typespec/http @typespec/json-schema @typespec/openapi @typespec/openapi3 @typespec/rest @typespec/versioning
//   npx tsp compile packages/commongrants/typespec/gms.tsp --emit @typespec/openapi3
import "@common-grants/core";

using CommonGrants.Fields;
using CommonGrants.Models;

namespace GMS.CommonGrants;

// ---------------------------------------------------------------------------
// Opportunity

model SummaryField is CustomField {
  name: "summary";
  fieldType: CustomFieldType.string;
  value: string;
}

model EligibilitySummaryField is CustomField {
  name: "eligibilitySummary";
  fieldType: CustomFieldType.string;
  value: string;
}

model CauseAreasField is CustomField {
  name: "causeAreas";
  fieldType: CustomFieldType.array;
  value: string[];
}

model GeographyField is CustomField {
  name: "geography";
  fieldType: CustomFieldType.array;
  value: string[];
}

model ProgramNameField is CustomField {
  name: "programName";
  fieldType: CustomFieldType.string;
  value: string;
}

model ApplyUrlField is CustomField {
  name: "applyUrl";
  fieldType: CustomFieldType.string;
  value: url;
}

model DecisionExpectedOnField is CustomField {
  name: "decisionExpectedOn";
  fieldType: CustomFieldType.string;
  value: CommonGrants.Types.isoDate;
}

model GmsOpportunityCustomFields {
  summary?: SummaryField;
  eligibilitySummary?: EligibilitySummaryField;
  causeAreas?: CauseAreasField;
  geography?: GeographyField;
  programName?: ProgramNameField;
  applyUrl?: ApplyUrlField;
  decisionExpectedOn?: DecisionExpectedOnField;
}

@doc("A CommonGrants opportunity as published by GMS")
model GmsOpportunity extends OpportunityBase {
  customFields?: GmsOpportunityCustomFields;
}

// ---------------------------------------------------------------------------
// Application

model ReferenceNumberField is CustomField {
  name: "referenceNumber";
  fieldType: CustomFieldType.string;
  value: string;
}

model ApplicationTitleField is CustomField {
  name: "applicationTitle";
  fieldType: CustomFieldType.string;
  value: string;
}

model RequestedAmountField is CustomField {
  name: "requestedAmount";
  fieldType: CustomFieldType.object;
  value: Money;
}

model OrganizationIdField is CustomField {
  name: "organizationId";
  fieldType: CustomFieldType.string;
  value: CommonGrants.Types.uuid;
}

model AiDisclosureField is CustomField {
  name: "aiDisclosure";
  fieldType: CustomFieldType.string;
  value: string;
}

model GmsApplicationCustomFields {
  referenceNumber?: ReferenceNumberField;
  applicationTitle?: ApplicationTitleField;
  requestedAmount?: RequestedAmountField;
  organizationId?: OrganizationIdField;
  aiDisclosure?: AiDisclosureField;
}

@doc("A CommonGrants application as returned by GMS")
model GmsApplication extends ApplicationBase {
  customFields?: GmsApplicationCustomFields;
}

// ---------------------------------------------------------------------------
// Award

model FiscalYearField is CustomField {
  name: "fiscalYear";
  fieldType: CustomFieldType.integer;
  value: int32;
}

model RecipientNameField is CustomField {
  name: "recipientName";
  fieldType: CustomFieldType.string;
  value: string;
}

model RecipientLocation {
  city?: string;
  county?: string;
  state?: string;
}

model RecipientLocationField is CustomField {
  name: "recipientLocation";
  fieldType: CustomFieldType.object;
  value: RecipientLocation;
}

model GmsAwardCustomFields {
  referenceNumber?: ReferenceNumberField;
  fiscalYear?: FiscalYearField;
  programName?: ProgramNameField;
  recipientName?: RecipientNameField;
  recipientLocation?: RecipientLocationField;
}

@doc("A CommonGrants award as returned by GMS. Anonymous callers get the public transparency view.")
model GmsAward extends AwardBase {
  customFields?: GmsAwardCustomFields;
}
