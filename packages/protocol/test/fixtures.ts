// SPDX-License-Identifier: AGPL-3.0-only
// Fictitious rows shaped like the §8 tables. Organizations and people are invented.
import type { ApplicationRow, AwardRow, CompetitionRow, FormResponseRow, FormRow, FunderRow, OpportunityRow } from "../src/index.ts";

export const ids = {
  workspace: "0192f0c1-0000-7000-8000-000000000001",
  funderOrg: "0192f0c1-0000-7000-8000-000000000002",
  recipientOrg: "0192f0c1-0000-7000-8000-000000000003",
  opportunity: "0192f0c1-0000-7000-8000-000000000010",
  competition: "0192f0c1-0000-7000-8000-000000000020",
  loiForm: "0192f0c1-0000-7000-8000-000000000030",
  fullForm: "0192f0c1-0000-7000-8000-000000000031",
  application: "0192f0c1-0000-7000-8000-000000000040",
  loiResponse: "0192f0c1-0000-7000-8000-000000000050",
  award: "0192f0c1-0000-7000-8000-000000000060",
  parentAward: "0192f0c1-0000-7000-8000-000000000061",
};

const stamps = { created_at: "2027-01-05T17:00:00+00:00", updated_at: "2027-02-01T09:30:00+00:00" };

export const funder: FunderRow = {
  passport_org_id: ids.funderOrg,
  handle: "riverbend",
  display_name: "Riverbend Community Foundation",
  legal_name: "Riverbend Community Foundation Inc.",
  ein: "12-3456789",
};

export const opportunity: OpportunityRow = {
  id: ids.opportunity,
  workspace_id: ids.workspace,
  program_id: null,
  slug: "rural-health-access-2027",
  title: "Rural Health Access Grants 2027",
  description: "Operating and project support for organizations improving access to care in rural counties.",
  status: "open",
  funding: {
    totalAmountAvailable: { amount: "1200000.00", currency: "USD" },
    minAwardAmount: { amount: "25000.00", currency: "USD" },
    maxAwardAmount: { amount: "150000.00", currency: "USD" },
    estimatedAwardCount: 12,
  },
  key_dates: {
    postDate: { name: "Posted", eventType: "singleDate", date: "2027-01-15" },
    closeDate: { name: "Full proposals due", eventType: "singleDate", date: "2027-04-30" },
  },
  accepted_applicant_types: ["non_profit_with_501c3"],
  custom_fields: null,
  published_at: "2027-01-15T16:00:00+00:00",
  ...stamps,
};

export const loiForm: FormRow = {
  id: ids.loiForm,
  version: 3,
  title: "Letter of intent",
  description: "Two pages on the need and the proposed work.",
  instructions: null,
  json_schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["legalName", "summary"],
    properties: { legalName: { type: "string" }, ein: { type: "string" }, summary: { type: "string", maxLength: 2000 } },
  },
  ui_schema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/legalName" }, { type: "Control", scope: "#/properties/summary" }] },
  mapping_from_cg: { legalName: { field: "name" }, ein: { field: "identifiers.org:us:ein.id" } },
  mapping_to_cg: { title: { field: "summary" }, applicantType: { const: "non_profit_with_501c3" } },
  field_meta: { ein: { pii: false, reviewerVisible: true } },
  purpose: "loi",
  published_at: "2027-01-10T12:00:00+00:00",
  ...stamps,
};

export const fullForm: FormRow = {
  ...loiForm,
  id: ids.fullForm,
  version: 1,
  title: "Full proposal",
  purpose: "application",
  mapping_to_cg: {
    requestedAmount: { field: "budget.total" },
    status: { switch: { field: "kind", case: { renewal: "renewal" }, default: "new" } },
  },
};

export const competition: CompetitionRow = {
  id: ids.competition,
  opportunity_id: ids.opportunity,
  title: "2027 cycle",
  description: "Two stages: letter of intent, then full proposal by invitation.",
  instructions: "Start with the letter of intent.",
  status: "open",
  key_dates: {
    openDate: { name: "Opens", eventType: "singleDate", date: "2027-01-15" },
    closeDate: { name: "Closes", eventType: "singleDate", date: "2027-04-30" },
  },
  stages: [
    { key: "loi", label: "Letter of intent", forms: { [ids.loiForm]: 3 }, opens: "2027-01-15T00:00:00Z", closes: "2027-02-28T23:59:59Z", rubricId: "rub_1", reviewers: "pool:loi", entryFrom: [], requiresSubmission: true, decisionRequired: true },
    { key: "full", label: "Full proposal", forms: { [ids.fullForm]: 1 }, opens: "2027-03-15T00:00:00Z", closes: "2027-04-30T23:59:59Z", rubricId: "rub_2", entryFrom: ["loi"], requiresSubmission: true, decisionRequired: true },
    { key: "interview", label: "Interview", forms: {}, entryFrom: ["full"], requiresSubmission: false, decisionRequired: false },
  ],
  forms: null,
  validation: null,
  accepted_applicant_types: ["non_profit_with_501c3"],
  ...stamps,
};

export const loiResponse: FormResponseRow = {
  id: ids.loiResponse,
  application_id: ids.application,
  form_id: ids.loiForm,
  form_version: 3,
  response: { legalName: "Alder Creek Family Services", ein: "98-7654321", summary: "Mobile health navigation for rural families." },
  status: "complete",
  validation_errors: [],
  provenance: { legalName: "passport", ein: "passport", summary: "user" },
  locked_at: "2027-02-21T18:04:00+00:00",
  ...stamps,
};

export const application: ApplicationRow = {
  id: ids.application,
  competition_id: ids.competition,
  opportunity_id: ids.opportunity,
  applicant_workspace_id: "0192f0c1-0000-7000-8000-000000000004",
  title: "Mobile Health Navigation for Rural Families",
  stage: "loi",
  status: "submitted",
  submitted_at: "2027-02-21T18:04:00+00:00",
  verification_level_at_submit: "L3",
  attestation_url: "https://passport.opengrants.io/attestations/pp_7Hk2m9.jws",
  eligibility: { eligible: true, results: [] },
  requested_amount_minor: 15000000,
  currency: "USD",
  ...stamps,
};

export const award: AwardRow = {
  id: ids.award,
  title: "Mobile Health Navigation for Rural Families",
  description: "Two-year project grant.",
  status: "active",
  funding: {
    requestedAmount: { amount: "150000.00", currency: "USD" },
    awardedAmount: { amount: "150000.00", currency: "USD" },
    disbursedAmount: { amount: "75000.00", currency: "USD" },
  },
  key_dates: {
    awardDate: { name: "Award date", eventType: "singleDate", date: "2027-05-18" },
    periodOfPerformance: { name: "Grant period", eventType: "dateRange", startDate: "2027-06-01", endDate: "2029-05-31" },
  },
  recipient_individual: null,
  parent_award_id: null,
  ...stamps,
};

export const recipient = { id: ids.recipientOrg, name: "Alder Creek Family Services", ein: "987654321" };

export const organization = {
  id: ids.recipientOrg,
  name: "Alder Creek Family Services",
  identifiers: { "org:us:ein": { id: "987654321" } },
  orgType: { term: "Nonprofits", class: "Organization types", code: "EO000000" },
  status: { value: "active" },
  addresses: { primary: { street1: "410 Alder Creek Rd", city: "Riverbend", stateOrProvince: "CA", country: "US", postalCode: "95999" } },
  emails: { primary: "hello@aldercreek.example" },
  mission: "Health navigation for rural families.",
  yearFounded: "2009",
  customFields: {
    verificationLevel: { name: "verificationLevel", fieldType: "string", value: "L3" },
    verifiedAt: { name: "verifiedAt", fieldType: "string", value: "2027-01-12T19:00:00Z" },
    attestation: { name: "attestation", fieldType: "string", value: "https://passport.opengrants.io/attestations/pp_7Hk2m9.jws" },
  },
};
