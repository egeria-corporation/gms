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
  maskEmail,
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
  list_funds: tool("listFunds", "programs:read", "List the funds you can see, the default fund first, each with its budget per fiscal year beside its programs' budgets. A fund advisor sees their own funds only. Creating funds and inviting advisors is done by a workspace admin in the GMS.", z.object({})),

  list_opportunities: tool("listOpportunities", "opportunities:read", "List opportunities, optionally by status or program.", z.object({ status: z.enum(["forecasted", "open", "closed"]).optional(), programId: programId.optional(), search: z.string().max(200).optional(), ...paging })),
  get_opportunity: tool("getOpportunity", "opportunities:read", "Get one opportunity with its CommonGrants projection and eligibility rules.", z.object({ opportunityId })),
  create_opportunity: tool("createOpportunity", "opportunities:write", "Create a draft opportunity in a program.", z.object({ programId, title: z.string().min(1).max(200), description: z.string().max(20000), slug: z.string().regex(/^[a-z0-9-]{3,80}$/).optional(), funding: fundingSchema.optional(), keyDates: keyDatesSchema.optional(), acceptedApplicantTypes: z.array(applicantType).min(1).default(["organization"]), eligibilityRules: eligibilityRules.optional() })),
  update_opportunity: tool("updateOpportunity", "opportunities:write", "Update fields of an opportunity. Published opportunities re-validate their CommonGrants projection.", z.object({ opportunityId, title: z.string().min(1).max(200).optional(), description: z.string().max(20000).optional(), funding: fundingSchema.optional(), keyDates: keyDatesSchema.optional(), acceptedApplicantTypes: z.array(applicantType).min(1).optional(), eligibilityRules: eligibilityRules.optional() })),
  publish_opportunity: tool("publishOpportunity", "opportunities:write", "Publish an opportunity: validates the projection, renders the public page and adds the sitemap entry.", z.object({ opportunityId, publicPage: z.boolean().default(true), openGrantsIndex: z.boolean().default(true) })),
  // Syndication (E2): read only. Sending a call to Philanthropy News Digest is a person's, in the GMS.
  get_opportunity_syndication: tool("getOpportunitySyndication", "opportunities:read", "Where a published call goes besides its page: whether it is in the open-call feeds (and their addresses), in the feed OpenGrants can pull, its Philanthropy News Digest submission (the last day PND takes it, whether it was sent, why it cannot go now), and the applications started from feed and PND links. No tool sends a call to PND; only a person does, in the GMS (docs/syndication.md).", z.object({ opportunityId })),

  list_competitions: tool("listCompetitions", "competitions:read", "List competitions, optionally for one opportunity.", z.object({ opportunityId: opportunityId.optional(), status: z.enum(["draft", "open", "closed"]).optional(), ...paging })),
  get_competition: tool("getCompetition", "competitions:read", "Get one competition with its stages, pinned forms and launch-check result.", z.object({ competitionId })),
  create_competition: tool("createCompetition", "competitions:write", "Create a draft competition under an opportunity. One stage is the common case.", z.object({ opportunityId, title: z.string().min(1).max(200), description: z.string().max(20000).optional(), instructions: z.string().max(20000).optional(), stages: z.array(stageSchema).min(1) })),
  set_stage_forms: tool("setStageForms", "competitions:write", "Pin form versions to a stage. On an open competition, pass migrate to re-validate in-progress responses.", z.object({ competitionId, stage, forms: z.record(formId, z.number().int().positive()), migrate: z.boolean().default(false) })),
  set_rubric: tool("setRubric", "competitions:write", "Set the rubric used to score a stage.", z.object({ competitionId, stage, rubricId, rubricVersion: z.number().int().positive().optional() })),
  quick_setup_competition: tool(
    "quickSetupCompetition",
    "competitions:write",
    "Quick setup for an opportunity: makes, as editable drafts, a one-stage competition dated from the opportunity's open and close dates, a starter application form (published and pinned to the stage) and a starter rubric. Keeps whatever the funder already set and reuses what an earlier run made. Returns the competition and its launch checklist; opening is a separate step. Also needs forms:write and reviews:write.",
    z.object({ opportunityId }),
  ),

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
  // Review parity (v1.8.0). Reads only: a reviewer signs the policy in person, and changing a stage's anonymized setting changes what reviewers see, so neither has a tool.
  get_coi_policy: tool("getCoiPolicy", "reviews:read", "Get the conflict-of-interest policy reviewers sign for a competition, and whether the person this token acts for has signed it. No tool signs it.", z.object({ competitionId })),
  get_conflicts_register: tool("getConflictsRegister", "reviews:read", "Get a competition's conflicts register: who signed the conflict-of-interest policy and when, the conflicts each declared, and every recusal with its reason. Program staff only.", z.object({ competitionId })),

  propose_decision: tool("proposeDecision", "decisions:write", "Propose (not commit) decisions for applications. Proposals appear in the panel view.", z.object({ competitionId, decisions: z.array(z.object({ applicationId, outcome: z.enum(["approve", "decline", "waitlist", "defer"]), amountMinor: amountMinor.optional(), conditions: z.array(z.string().max(500)).default([]), rationale: z.string().max(5000).optional() })).min(1).max(200) })),
  commit_decisions: tool("commitDecisions", "decisions:write", "Commit proposed decisions: creates awards in offered, queues letters. Refused when the program would be over-allocated.", z.object({ competitionId, decisionIds: z.array(uuid("Decision id")).min(1).max(200) }), { gated: true }),

  list_awards: tool("listAwards", "awards:read", "List awards by status, program or recipient.", z.object({ status: z.array(awardStatus).optional(), programId: programId.optional(), recipientWorkspaceId: applicantWorkspaceId.optional(), ...paging })),
  get_award: tool("getAward", "awards:read", "Get one award: lifecycle status, funding (disbursed amount is read from Passport), dates and conditions.", z.object({ awardId })),
  get_award_share_kit: tool("getAwardShareKit", "awards:read", "Get the share kit for an award on the public grants-awarded page: three ready-to-edit posts (LinkedIn, short, newsletter), the award page link, the card image, the 1080 × 1350 portrait card and its public address, the carousel PDF (6 to 10 slides, each with its alt text), a press release to edit, the federal share statement when the funder entered both numbers, and the “Funded by” badge snippet, from public fields only. Null when the award is not public (confidential, unlisted, not accepted, or the funder does not list awards). Nothing is posted by this tool; marking an award confidential or unlisted, and listing awards, are a person's, in the GMS.", z.object({ awardId })),
  create_direct_award: tool(
    "createDirectAward",
    "awards:write",
    "Give an award directly to an organization that has not applied: the award is created as offered and its contact is emailed a link to accept. Nothing is matched by name; the award is attached only when the invited person accepts it. Always waits for a person's approval (a funder admin or program officer).",
    z.object({
      organizationName: z.string().min(1).max(200).describe("The organization's name, as it should appear in the email"),
      contactEmail: z.string().email().max(320).describe("The person who will accept for the organization"),
      title: z.string().min(1).max(300),
      amount: z.object({ value: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).describe("Decimal amount, e.g. 25000.00"), currency: z.literal("USD") }),
      startDate: isoDate.optional(),
      endDate: isoDate.optional(),
      programId: programId.optional(),
      message: z.string().max(2000).optional().describe("Plain text for the email. No web or email addresses"),
    }),
    // The ledger records the address masked; the approval keeps it to send the invitation.
    { gated: true, ledgerInput: (i) => ({ ...i, contactEmail: maskEmail(i.contactEmail) }) },
  ),
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
  send_reminders: tool("sendReminders", "requirements:write", "Send the reminder for requirements now, to grantees that share their record with this funder. At most one by hand per requirement per 24 hours.", z.object({ requirementIds: z.array(requirementId).min(1).max(100) })),

  list_grantees: tool("listGrantees", "grantees:read", "List the funder's grantee directory.", z.object({ search: z.string().max(200).optional(), tag: z.string().max(60).optional(), hasPendingChange: z.boolean().optional(), ...paging })),
  get_grantee: tool("getGrantee", "grantees:read", "Get one grantee: cached Passport projection, level, relationship notes, awards.", z.object({ applicantWorkspaceId })),
  get_passport_status: tool("getPassportStatus", "grantees:read", "Get a grantee's Passport status: level, payee status (bank name and last4 only), pending destination change, freeze. Shown only while the grantee shares its record with this funder.", z.object({ applicantWorkspaceId })),
  list_pending_org_changes: tool("listPendingOrgChanges", "grantees:read", "List organization changes received from Passport that await a decision.", z.object({ applicantWorkspaceId: applicantWorkspaceId.optional(), ...paging })),
  accept_org_change: tool("acceptOrgChange", "grantees:write", "Accept a pending organization change into the grantee record. Eligibility re-runs on open applications.", z.object({ changeId: uuid("Org change id") })),

  portfolio_summary: tool("portfolioSummary", "analytics:read", "Portfolio totals: awarded, disbursed, active awards, by program.", z.object({ fiscalYear: z.number().int().optional(), programId: programId.optional() })),
  cycle_metrics: tool("cycleMetrics", "analytics:read", "Cycle metrics for a competition: counts by stage, time in stage, approval rate.", z.object({ competitionId })),
  export_990pf_grant_list: tool("export990pfGrantList", "analytics:read", "Export the 990-PF Part XV grant list for a tax year.", z.object({ taxYear: z.number().int().min(2000).max(2100), format: z.enum(["csv", "json"]).default("csv") })),
  // Open data (360Giving and CommonGrants): counts only. Turning on the public feed and marking awards confidential are done by a person in the GMS.
  open_data_summary: tool("openDataSummary", "analytics:read", "Count the awards an open data export (360Giving, CommonGrants) would publish for a year or date range, and those left out with the reason for each. Reads only; nothing is published.", z.object({ year: z.number().int().min(1900).max(2100).optional(), from: isoDate.optional(), to: isoDate.optional() })),

  get_import_preview: tool("getImportPreview", "workspace:admin", "Read an import check (dry run) a person made on the import screen: how many rows would be created, skipped or need a fix, the amounts by year, and the names of the columns left out as bank or identity data. Only a person imports the rows, in the GMS; no tool does it.", z.object({ importRunId: uuid("Import run id") })),
  // The report builder: read only. Saving and scheduling a view are done by a person in the GMS.
  list_report_views: tool("listReportViews", "analytics:read", "List report views: the six starter views and the saved views this person may see (shared ones and their own), with data set, owner and schedule.", z.object({})),
  run_report_view: tool("runReportView", "analytics:read", "Run a report view and return its first 200 rows (or groups) with the column labels. Also needs the read scope of the view's data set.", z.object({ viewId: z.string().min(1).max(80).describe("A view id from list_report_views: a UUID or starter-<key>") })),
  // Social posting (v1.9.0): read only. No tool posts, schedules or connects an account; a person does, in the GMS.
  list_social_posts: tool("listSocialPosts", "analytics:read", "List the social posts this workspace sent through Zernio, with each account's status and link and Zernio's counts (impressions, clicks, engagements), for one opportunity or award or all; for an opportunity, also the applications started from a shared link. Reading only: no tool posts, schedules or connects an account.", z.object({ opportunityId: opportunityId.optional(), awardId: awardId.optional() })),
  get_digest_preview: tool("getDigestPreview", "applications:read", "Read next Monday's opt-in digest email for the signed-in person, as it would be written now: new_matches or deadlines in an applicant workspace, funder_activity in a funder one. Nothing is sent or recorded. Turning a digest on or off is a person's own choice; no tool does it.", z.object({ digest: z.enum(["funder_activity"]) })),
  // Connected apps (v1.12.0): read only. Connecting Slack, choosing the channel and turning alerts on or off are a person's, in the GMS.
  get_slack_alerts: tool("getSlackAlerts", "workspace:admin", "Read the workspace's Slack alert settings (the channel, the events alerted, on or off) and the latest alerts sent (event and status only; no message text is kept). Reading only: no tool connects Slack, changes the alerts or posts a message.", z.object({})),

  draft_letter: tool("draftLetter", "assist", "Draft a letter from a template. The draft is never sent by this tool.", z.object({ kind: letterContext, applicationId: applicationId.optional(), awardId: awardId.optional(), templateId: uuid("Template id").optional(), instructions: z.string().max(2000).optional() })),
  summarize_application: tool("summarizeApplication", "assist", "Summarize an application. Applicant text is quoted and labeled applicant-supplied.", z.object({ applicationId })),
  compare_to_rubric: tool("compareToRubric", "assist", "Compare an application to a rubric, criterion by criterion. A draft for a human reviewer, never a score.", z.object({ applicationId, rubricId: rubricId.optional() })),

  send_communication: tool("sendCommunication", "communications:write", "Send a templated email to applicants or grantees through Resend.", z.object({ templateId: uuid("Template id"), recipients: z.array(z.object({ applicationId: applicationId.optional(), awardId: awardId.optional(), applicantWorkspaceId: applicantWorkspaceId.optional() })).min(1).max(500), subjectOverride: z.string().max(200).optional() }), { gated: true }),

  // ---- the template gallery: reads only (sharing, withdrawing and moderating are human only, no tool) ----
  search_gallery: tool("searchGallery", "forms:read", "Search the public template gallery (approved application forms, rubrics, report forms, email templates and program kits, CC BY 4.0). Copying one into the workspace is done in the GMS.", z.object({ kind: z.enum(["application_form", "report_form", "rubric", "email_template", "program_kit"]).optional(), tag: z.string().min(1).max(60).optional().describe("A field of work, grant size or audience tag"), q: z.string().max(200).optional().describe("Words to look for in the title, summary and tags"), ...paging })),
  get_gallery_item: tool("getGalleryItem", "forms:read", "Get one approved gallery item with its full content: form questions, rubric criteria and email text.", z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/).describe("The item's slug, as in /templates/{slug}") })),
} as const;
