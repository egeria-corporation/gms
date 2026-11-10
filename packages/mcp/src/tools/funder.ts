// SPDX-License-Identifier: AGPL-3.0-only
// Funder-side tools (build spec §10.9). Each entry: service method, scope, description, input.
import { z } from "zod";
import {
  amendmentType,
  amountMinor,
  applicantType,
  applicationId,
  applicationStatus,
  agreementId,
  awardId,
  awardStatus,
  competitionId,
  currency,
  eligibilityRules,
  formId,
  fundingSchema,
  isoDate,
  isoDateTime,
  jsonObject,
  keyDatesSchema,
  opportunityId,
  paging,
  requirementId,
  requirementStatus,
  submissionId,
  tool,
  trancheId,
  trancheStatus,
  uuid,
  verificationLevel,
} from "./shared.ts";

const programId = uuid("Program id");
const rubricId = uuid("Rubric id");
const applicantWorkspaceId = uuid("Applicant workspace id (the grantee)");
const stage = z.string().min(1).max(40).describe("Stage key within the competition, e.g. loi or full");
const letterContext = z.enum(["acknowledgment", "revision_request", "decline", "award", "report_reminder", "payment_sent"]);

const stageSchema = z.object({
  key: stage,
  label: z.string().min(1).max(80),
  forms: z.record(formId, z.number().int().positive()).describe("formId → pinned version"),
  opens: isoDateTime.optional(),
  closes: isoDateTime.optional(),
  rubricId: rubricId.optional(),
  reviewers: z.string().optional().describe("Reviewer pool reference, e.g. pool:loi"),
  entryFrom: z.array(stage).default([]),
  requiresSubmission: z.boolean().default(true),
  decisionRequired: z.boolean().default(true),
});

const mappingFunction = z
  .union([
    z.object({ field: z.string().describe("JSON pointer into OrganizationBase or the response") }),
    z.object({ const: z.unknown() }),
    z.object({ switch: z.object({ field: z.string(), case: z.record(z.string(), z.unknown()), default: z.unknown().optional() }) }),
  ])
  .describe("CommonGrants MappingSchema function: field, const or switch");

export const FUNDER_TOOLS = {
  list_programs: tool("listPrograms", "programs:read", "List the workspace's programs with budget and fiscal year.", z.object({ fiscalYear: z.number().int().optional(), ...paging })),
  get_program: tool("getProgram", "programs:read", "Get one program, including its defaults (rubric, templates, requirement and reminder plans).", z.object({ programId })),

  list_opportunities: tool("listOpportunities", "opportunities:read", "List opportunities, optionally by status or program.", z.object({ status: z.enum(["forecasted", "open", "closed"]).optional(), programId: programId.optional(), search: z.string().max(200).optional(), ...paging })),
  get_opportunity: tool("getOpportunity", "opportunities:read", "Get one opportunity with its CommonGrants projection and eligibility rules.", z.object({ opportunityId })),
  create_opportunity: tool("createOpportunity", "opportunities:write", "Create a draft opportunity in a program.", z.object({ programId, title: z.string().min(1).max(200), description: z.string().max(20000), slug: z.string().regex(/^[a-z0-9-]{3,80}$/).optional(), funding: fundingSchema.optional(), keyDates: keyDatesSchema.optional(), acceptedApplicantTypes: z.array(applicantType).min(1).default(["organization"]), eligibilityRules: eligibilityRules.optional() })),
  update_opportunity: tool("updateOpportunity", "opportunities:write", "Update fields of an opportunity. Published opportunities re-validate their CommonGrants projection.", z.object({ opportunityId, title: z.string().min(1).max(200).optional(), description: z.string().max(20000).optional(), funding: fundingSchema.optional(), keyDates: keyDatesSchema.optional(), acceptedApplicantTypes: z.array(applicantType).min(1).optional(), eligibilityRules: eligibilityRules.optional() })),
  publish_opportunity: tool("publishOpportunity", "opportunities:write", "Publish an opportunity: validates the projection, renders the public page and adds the sitemap entry.", z.object({ opportunityId, publicPage: z.boolean().default(true), openGrantsIndex: z.boolean().default(true) })),

  list_competitions: tool("listCompetitions", "competitions:read", "List competitions, optionally for one opportunity.", z.object({ opportunityId: opportunityId.optional(), status: z.enum(["draft", "open", "closed"]).optional(), ...paging })),
  get_competition: tool("getCompetition", "competitions:read", "Get one competition with its stages, pinned forms and launch-check result.", z.object({ competitionId })),
  create_competition: tool("createCompetition", "competitions:write", "Create a draft competition under an opportunity. One stage is the common case.", z.object({ opportunityId, title: z.string().min(1).max(200), description: z.string().max(20000).optional(), instructions: z.string().max(20000).optional(), stages: z.array(stageSchema).min(1) })),
  set_stage_forms: tool("setStageForms", "competitions:write", "Pin form versions to a stage. On an open competition, pass migrate to re-validate in-progress responses.", z.object({ competitionId, stage, forms: z.record(formId, z.number().int().positive()), migrate: z.boolean().default(false) })),
  set_rubric: tool("setRubric", "competitions:write", "Set the rubric used to score a stage.", z.object({ competitionId, stage, rubricId, rubricVersion: z.number().int().positive().optional() })),

  list_forms: tool("listForms", "forms:read", "List forms in the workspace, or the shared library.", z.object({ purpose: z.enum(["application", "report", "loi", "amendment", "site_visit", "other"]).optional(), library: z.boolean().default(false), ...paging })),
  get_form: tool("getForm", "forms:read", "Get a form version: JSON Schema, UI schema and CommonGrants mappings.", z.object({ formId, version: z.number().int().positive().optional() })),
  create_form: tool("createForm", "forms:write", "Create a draft form from a JSON Schema (2020-12 subset) and a UI schema.", z.object({ title: z.string().min(1).max(200), description: z.string().max(5000).optional(), instructions: z.string().max(20000).optional(), purpose: z.enum(["application", "report", "loi", "amendment", "site_visit", "other"]), jsonSchema: jsonObject, uiSchema: jsonObject })),
  update_form: tool("updateForm", "forms:write", "Update the draft version of a form. Published versions are immutable; this creates the next draft.", z.object({ formId, title: z.string().min(1).max(200).optional(), description: z.string().max(5000).optional(), instructions: z.string().max(20000).optional(), jsonSchema: jsonObject.optional(), uiSchema: jsonObject.optional() })),
  set_prefill_mapping: tool("setPrefillMapping", "forms:write", "Set how fields prefill from the applicant's Passport record (mappingFromCommonGrants) and project back (mappingToCommonGrants).", z.object({ formId, mappingFromCommonGrants: z.record(z.string(), mappingFunction).optional(), mappingToCommonGrants: z.record(z.string(), mappingFunction).optional() })),

  list_applications: tool("listApplications", "applications:read", "List applications in the funder's inbox with filters for stage, status, eligibility and Passport level.", z.object({ competitionId: competitionId.optional(), stage: stage.optional(), status: z.array(applicationStatus).optional(), eligibility: z.enum(["eligible", "ineligible", "unknown"]).optional(), minVerificationLevel: verificationLevel.optional(), tag: z.string().max(60).optional(), assignedToUserId: uuid("User id").optional(), search: z.string().max(200).optional(), ...paging })),
  get_application: tool("getApplication", "applications:read", "Get one application: form responses with provenance, eligibility results, Passport level and attestation.", z.object({ applicationId })),
  run_eligibility: tool("runEligibility", "applications:read", "Evaluate the opportunity's eligibility rules against an application. Unknown never declines.", z.object({ applicationId })),
  advance_application: tool("advanceApplication", "applications:write", "Advance an application to a stage whose entryFrom includes its current stage.", z.object({ applicationId, toStage: stage, note: z.string().max(2000).optional() })),
  request_revision: tool("requestRevision", "applications:write", "Return an application to the applicant with a revision request.", z.object({ applicationId, message: z.string().min(1).max(5000), fields: z.array(z.string()).optional().describe("Field paths to unlock"), dueAt: isoDateTime.optional() })),
  decline_application: tool("declineApplication", "applications:write", "Decline an application and queue the decline letter.", z.object({ applicationId, rationale: z.string().min(1).max(5000), letterTemplateId: uuid("Template id").optional() }), { gated: true }),
  tag_application: tool("tagApplication", "applications:write", "Add or remove tags on an application.", z.object({ applicationId, add: z.array(z.string().min(1).max(60)).default([]), remove: z.array(z.string().min(1).max(60)).default([]) })),

  list_review_assignments: tool("listReviewAssignments", "reviews:read", "List review assignments by competition, stage, reviewer or status.", z.object({ competitionId: competitionId.optional(), stage: stage.optional(), applicationId: applicationId.optional(), reviewerUserId: uuid("Reviewer user id").optional(), status: z.enum(["assigned", "coi_declared", "in_progress", "submitted", "recused"]).optional(), ...paging })),
  assign_reviewer: tool("assignReviewer", "reviews:write", "Assign a reviewer to an application for a stage. Refused when a conflict of interest is on record.", z.object({ applicationId, stage, reviewerUserId: uuid("Reviewer user id"), dueAt: isoDateTime.optional() })),
  get_scores: tool("getScores", "reviews:read", "Get submitted reviews and scores for an application.", z.object({ applicationId, stage: stage.optional() })),
  rank_applications: tool("rankApplications", "reviews:read", "Rank a competition stage: mean, median, spread and reviewer count per application.", z.object({ competitionId, stage: stage.optional() })),

  propose_decision: tool("proposeDecision", "decisions:write", "Propose (not commit) decisions for applications. Proposals appear in the panel view.", z.object({ competitionId, decisions: z.array(z.object({ applicationId, outcome: z.enum(["approve", "decline", "waitlist", "defer"]), amountMinor: amountMinor.optional(), conditions: z.array(z.string().max(500)).default([]), rationale: z.string().max(5000).optional() })).min(1).max(200) })),
  commit_decisions: tool("commitDecisions", "decisions:write", "Commit proposed decisions: creates awards in offered, queues letters. Refused when the program would be over-allocated.", z.object({ competitionId, decisionIds: z.array(uuid("Decision id")).min(1).max(200) }), { gated: true }),

  list_awards: tool("listAwards", "awards:read", "List awards by status, program or recipient.", z.object({ status: z.array(awardStatus).optional(), programId: programId.optional(), recipientWorkspaceId: applicantWorkspaceId.optional(), ...paging })),
  get_award: tool("getAward", "awards:read", "Get one award: lifecycle status, funding (disbursed amount is read from Passport), dates and conditions.", z.object({ awardId })),
  create_award_from_application: tool("createAwardFromApplication", "awards:write", "Create an award in offered from an accepted application.", z.object({ applicationId, amountMinor, currency, startDate: isoDate, endDate: isoDate, conditions: z.array(z.string().max(500)).default([]) })),
  amend_award: tool("amendAward", "awards:write", "Record an amendment (extension, reallocation, scope or supplemental). Amount and period changes are mirrored to Passport.", z.object({ awardId, type: amendmentType, request: jsonObject, reason: z.string().min(1).max(5000) })),
  close_award: tool("closeAward", "awards:write", "Complete or cancel an award.", z.object({ awardId, outcome: z.enum(["completed", "cancelled"]), reason: z.string().max(5000).optional() })),

  generate_agreement: tool("generateAgreement", "agreements:write", "Render a draft grant agreement for an award from a template.", z.object({ awardId, templateId: uuid("Template id").optional() })),
  send_agreement: tool("sendAgreement", "agreements:write", "Send a draft agreement to the grantee for signature.", z.object({ agreementId, message: z.string().max(5000).optional() })),
  get_agreement_status: tool("getAgreementStatus", "awards:read", "Get an agreement's status, signatures and document hash.", z.object({ agreementId })),

  list_tranches: tool("listTranches", "payments:read", "List scheduled payments (tranches) by award or status.", z.object({ awardId: awardId.optional(), status: z.array(trancheStatus).optional(), ...paging })),
  check_payment_readiness: tool("checkPaymentReadiness", "payments:read", "Run the live readiness checks for a tranche; each line has a pass, fail or unknown state and a reason.", z.object({ trancheId })),
  release_tranche: tool("releaseTranche", "payments:release", "Release a ready tranche through Passport (facilitated). Always requires a person.", z.object({ trancheId, confirmDuplicate: z.boolean().default(false) }), { gated: true }),
  record_external_payment: tool("recordExternalPayment", "payments:release", "Record a tranche the funder paid outside the GMS (resolve mode). Posts the reference to Passport.", z.object({ trancheId, reference: z.string().min(1).max(120), paidAt: isoDateTime, destinationLast4: z.string().regex(/^\d{4}$/).describe("Last four digits shown on the payee credential; never a full number") })),

  list_requirements: tool("listRequirements", "requirements:read", "List what grantees owe: reports, documents, milestones.", z.object({ awardId: awardId.optional(), status: z.array(requirementStatus).optional(), dueBefore: isoDate.optional(), ...paging })),
  review_submission: tool("reviewSubmission", "requirements:read", "Get a submission for review, with its form responses and provenance.", z.object({ submissionId })),
  accept_submission: tool("acceptSubmission", "requirements:write", "Accept a submission. A linked onReportAccepted tranche becomes due.", z.object({ submissionId, note: z.string().max(5000).optional() })),
  return_submission: tool("returnSubmission", "requirements:write", "Return a submission to the grantee with a note.", z.object({ submissionId, note: z.string().min(1).max(5000) })),
  send_reminders: tool("sendReminders", "requirements:write", "Send the reminder for requirements now. Idempotent per requirement and offset.", z.object({ requirementIds: z.array(requirementId).min(1).max(100) })),

  list_grantees: tool("listGrantees", "grantees:read", "List the funder's grantee directory.", z.object({ search: z.string().max(200).optional(), tag: z.string().max(60).optional(), hasPendingChange: z.boolean().optional(), ...paging })),
  get_grantee: tool("getGrantee", "grantees:read", "Get one grantee: cached Passport projection, level, relationship notes, awards.", z.object({ applicantWorkspaceId })),
  get_passport_status: tool("getPassportStatus", "grantees:read", "Get a grantee's Passport status: level, payee status (bank name and last4 only), pending destination change, freeze.", z.object({ applicantWorkspaceId })),
  list_pending_org_changes: tool("listPendingOrgChanges", "grantees:read", "List organization changes received from Passport that await a decision.", z.object({ applicantWorkspaceId: applicantWorkspaceId.optional(), ...paging })),
  accept_org_change: tool("acceptOrgChange", "grantees:write", "Accept a pending organization change into the grantee record. Eligibility re-runs on open applications.", z.object({ changeId: uuid("Org change id") })),

  portfolio_summary: tool("portfolioSummary", "analytics:read", "Portfolio totals: awarded, disbursed, active awards, by program.", z.object({ fiscalYear: z.number().int().optional(), programId: programId.optional() })),
  cycle_metrics: tool("cycleMetrics", "analytics:read", "Cycle metrics for a competition: counts by stage, time in stage, approval rate.", z.object({ competitionId })),
  export_990pf_grant_list: tool("export990pfGrantList", "analytics:read", "Export the 990-PF Part XV grant list for a tax year.", z.object({ taxYear: z.number().int().min(2000).max(2100), format: z.enum(["csv", "json"]).default("csv") })),

  draft_letter: tool("draftLetter", "assist", "Draft a letter from a template. The draft is never sent by this tool.", z.object({ kind: letterContext, applicationId: applicationId.optional(), awardId: awardId.optional(), templateId: uuid("Template id").optional(), instructions: z.string().max(2000).optional() })),
  summarize_application: tool("summarizeApplication", "assist", "Summarize an application. Applicant text is quoted and labeled applicant-supplied.", z.object({ applicationId })),
  compare_to_rubric: tool("compareToRubric", "assist", "Compare an application to a rubric, criterion by criterion. A draft for a human reviewer, never a score.", z.object({ applicationId, rubricId: rubricId.optional() })),

  send_communication: tool("sendCommunication", "communications:write", "Send a templated email to applicants or grantees through Resend.", z.object({ templateId: uuid("Template id"), recipients: z.array(z.object({ applicationId: applicationId.optional(), awardId: awardId.optional(), applicantWorkspaceId: applicantWorkspaceId.optional() })).min(1).max(500), subjectOverride: z.string().max(200).optional() }), { gated: true }),
} as const;
