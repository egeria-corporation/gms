// SPDX-License-Identifier: AGPL-3.0-only
// Applicant-side tools (build spec §10.9).
import { z } from "zod";
import {
  amendmentType,
  agreementId,
  applicationId,
  applicationStatus,
  awardId,
  awardStatus,
  competitionId,
  formId,
  isoDate,
  jsonObject,
  paging,
  requirementId,
  requirementStatus,
  submissionId,
  tool,
  uuid,
} from "./shared.ts";

const answerId = uuid("Answer library entry id");
const outsideApplicationId = uuid("Outside application id");
const outsideStage = z.enum(["prospect", "deciding", "loi", "invited", "drafting", "submitted", "awarded", "declined", "withdrawn", "not_pursuing"]);
const decimalMoney = z.object({ amount: z.string().regex(/^\d{1,13}(\.\d{1,3})?$/).describe("Decimal amount, e.g. 25000.00"), currency: z.string().regex(/^[A-Z]{3}$/).default("USD") }).describe("The applicant's own record of an amount; no money moves");
const threadId = uuid("Thread id");
const documentRef = z
  .union([z.object({ documentId: uuid("GMS document id") }), z.object({ passportDocumentId: z.string().min(1).describe("Reference into the Passport locker; nothing is copied") })])
  .describe("An uploaded document or a Passport locker reference");
const searchContext = { query: z.string().max(300).optional(), region: z.string().max(60).optional(), focusAreas: z.array(z.string().max(80)).max(20).optional(), ...paging };

export const APPLICANT_TOOLS = {
  get_my_organization: tool("getMyOrganization", "org:read", "Get the workspace's organization as cached from Passport (CommonGrants OrganizationBase).", z.object({ refresh: z.boolean().default(false) })),
  get_passport_readiness: tool("getPassportReadiness", "org:read", "Get the organization's Passport level and readiness: identity, documents, payee (bank name and last4 only).", z.object({})),

  find_competitions: tool("findCompetitions", "discovery", "Find competitions open on the GMS, each with an eligibility preview for this organization.", z.object({ search: z.string().max(200).optional(), eligibleOnly: z.boolean().default(false), ...paging })),
  check_eligibility: tool("checkEligibility", "discovery", "Dry-run a competition's eligibility rules against this organization, with an explanation per rule.", z.object({ competitionId })),
  search_opengrants: tool("searchOpenGrants", "discovery", "Search the OpenGrants index for grants and funders.", z.object({ kind: z.enum(["grants", "funders"]).default("grants"), ...searchContext })),
  match_opengrants: tool("matchOpenGrants", "discovery", "Match this organization's profile against the OpenGrants index.", z.object({ limit: z.number().int().min(1).max(50).default(20) })),
  create_funding_alert: tool("createFundingAlert", "discovery", "Create an OpenGrants funding alert for a saved search.", z.object({ name: z.string().min(1).max(120), query: z.string().max(300), frequency: z.enum(["daily", "weekly"]).default("weekly") })),

  list_applications: tool("listMyApplications", "applications:read", "List this workspace's applications across funders.", z.object({ status: z.array(applicationStatus).optional(), ...paging })),
  get_application: tool("getMyApplication", "applications:read", "Get one application: forms, responses with provenance, validation errors and status.", z.object({ applicationId })),
  start_application: tool("startApplication", "applications:write", "Start an application to a competition. Fields mapped from Passport arrive prefilled and marked.", z.object({ competitionId })),
  fill_form_response: tool("fillFormResponse", "applications:write", "Merge values into a form response. Validation errors are returned, not fatal until submit. Values are marked as entered by this agent.", z.object({ applicationId, formId, response: jsonObject.describe("Partial response; merged into the stored one") })),
  attach_document: tool("attachDocument", "applications:write", "Attach a document to a file field of a form response.", z.object({ applicationId, formId, field: z.string().min(1).describe("Field path of a fileRef field"), document: documentRef })),
  insert_answer: tool("insertAnswer", "applications:write", "Insert an answer-library entry into a field. Provenance is recorded as library.", z.object({ applicationId, formId, field: z.string().min(1), answerId })),
  validate_application: tool("validateApplication", "applications:read", "Validate every required form of the current stage and dry-run eligibility, without submitting.", z.object({ applicationId })),
  submit_application: tool("submitApplication", "applications:submit", "Submit an application: validates, runs eligibility, stamps the Passport level and attestation, locks responses.", z.object({ applicationId }), { gated: true }),
  withdraw_application: tool("withdrawApplication", "applications:write", "Withdraw an application that has not reached a decision.", z.object({ applicationId, reason: z.string().max(2000).optional() })),

  list_awards: tool("listMyAwards", "awards:read", "List awards made to this workspace.", z.object({ status: z.array(awardStatus).optional(), ...paging })),
  get_award: tool("getMyAward", "awards:read", "Get one award with its payment schedule and requirements.", z.object({ awardId })),
  accept_award: tool("acceptAward", "awards:write", "Accept an award offer. Always requires a person.", z.object({ awardId }), { gated: true }),
  sign_agreement: tool("signAgreement", "agreements:write", "Sign a grant agreement. Always requires a person: the signature records their typed name, time, IP and the document hash.", z.object({ agreementId }), { gated: true }),
  request_amendment: tool("requestAmendment", "awards:write", "Request an amendment to an award.", z.object({ awardId, type: amendmentType, request: jsonObject, reason: z.string().min(1).max(5000) })),

  list_requirements: tool("listMyRequirements", "requirements:read", "List what this workspace owes funders: reports, documents, milestones.", z.object({ awardId: awardId.optional(), status: z.array(requirementStatus).optional(), ...paging })),
  draft_submission: tool("draftSubmission", "requirements:write", "Create or update the draft submission for a requirement. Prefills from the application, the prior report and Passport.", z.object({ requirementId, formId: formId.optional(), response: jsonObject.optional().describe("Partial response; merged into the draft") })),
  submit_requirement: tool("submitRequirement", "requirements:write", "Submit the draft submission for a requirement.", z.object({ requirementId })),
  share_submission_with_funder: tool("shareSubmissionWithFunder", "requirements:write", "Share an accepted submission with another funder workspace. Records a consent.", z.object({ submissionId, funderWorkspaceId: uuid("Target funder workspace id"), fields: z.array(z.string()).optional().describe("Field paths to share; all when omitted"), includeAttachments: z.boolean().default(false) })),

  list_answers: tool("listAnswers", "library:read", "List the answer library.", z.object({ search: z.string().max(200).optional(), ...paging })),
  save_answer: tool("saveAnswer", "library:write", "Save a new answer, or a new version of an existing one.", z.object({ answerId: answerId.optional(), key: z.string().regex(/^[a-z0-9-]{2,60}$/).optional(), title: z.string().min(1).max(200), body: z.string().min(1).max(50000) })),
  adapt_answer: tool("adaptAnswer", "assist", "Draft an adaptation of a library answer to a question and its limits. Returns a draft; saves nothing.", z.object({ answerId, question: z.string().min(1).max(2000), maxWords: z.number().int().positive().max(10000).optional(), maxCharacters: z.number().int().positive().max(100000).optional() })),

  // ---- apply anywhere: outside applications (the applicant's own records of applications to any funder) ----
  list_outside_applications: tool("listOutsideApplications", "applications:read", "List this workspace's outside applications: applications to funders anywhere, tracked here. Private to the workspace.", z.object({ stage: z.array(outsideStage).optional(), search: z.string().max(200).optional(), archived: z.boolean().default(false), ...paging })),
  get_outside_application: tool("getOutsideApplication", "applications:read", "Get one outside application with its questions, latest answers (with word and character counts), documents and tasks.", z.object({ outsideApplicationId })),
  create_outside_application: tool(
    "createOutsideApplication",
    "applications:write",
    "Start tracking an application to any funder. With source opengrants and the listing id, an application already tracking that listing is returned instead of a duplicate.",
    z.object({
      title: z.string().min(1).max(300),
      funderName: z.string().min(1).max(200),
      programName: z.string().max(300).optional(),
      source: z.enum(["manual", "opengrants", "link"]).default("manual"),
      sourceRef: z.string().min(1).max(300).optional().describe("The OpenGrants listing id, with source opengrants"),
      listingUrl: z.string().url().max(2000).optional(),
      portalUrl: z.string().url().max(2000).optional(),
      loiDue: isoDate.optional(),
      fullDue: isoDate.optional(),
      internalDue: isoDate.optional(),
      rolling: z.boolean().optional(),
      askAmount: decimalMoney.optional(),
      stage: z.enum(["prospect", "drafting"]).default("drafting"),
    }),
  ),
  add_outside_questions: tool("addOutsideQuestions", "applications:write", "Add a funder's questions from pasted text: the text is split on numbering and blank lines, and limits such as \"(250 words)\" or \"1,500 characters\" are read. Returns the questions made.", z.object({ outsideApplicationId, text: z.string().min(1).max(100_000), phase: z.enum(["loi", "full", "report"]).default("full") })),
  put_outside_answer: tool("putOutsideAnswer", "applications:write", "Save an answer to an outside question as a new version, marked as written by this agent (or from the library when libraryAnswerId is given). Returns word and character counts and whether it is over the limit.", z.object({ questionId: uuid("Outside question id"), body: z.string().max(100_000), libraryAnswerId: answerId.optional() })),
  set_outside_stage: tool("setOutsideStage", "applications:write", "Move an outside application to another stage: prospect, deciding, letter of inquiry, invited, drafting, withdrawn or not pursuing. Submissions and decisions are recorded with their own tools.", z.object({ outsideApplicationId, to: z.enum(["prospect", "deciding", "loi", "invited", "drafting", "withdrawn", "not_pursuing"]) })),
  record_outside_submission: tool("recordOutsideSubmission", "applications:write", "Record that the application was submitted to the funder (the GMS never submits anything): the date, how, and the confirmation. Keeps an as-submitted PDF of the answers. Always waits for a person's approval.", z.object({ outsideApplicationId, submittedAt: z.string().min(10).max(40).describe("RFC 3339 timestamp or YYYY-MM-DD"), method: z.enum(["portal", "email", "mail", "grants_gov", "other"]), confirmationRef: z.string().max(200).optional() }), { gated: true }),
  record_outside_decision: tool(
    "recordOutsideDecision",
    "applications:write",
    "Record the funder's decision on an outside application: awarded (with the amount), declined or withdrawn. Always waits for a person's approval.",
    z.object({ outsideApplicationId, outcome: z.enum(["awarded", "declined", "withdrawn"]), awardedAmount: decimalMoney.optional(), grantStart: isoDate.optional(), grantEnd: isoDate.optional(), notes: z.string().max(5000).optional(), nextCycleOn: isoDate.optional() }),
    { gated: true },
  ),

  list_messages: tool("listMessages", "messages:read", "List message threads with funders, or the messages of one thread.", z.object({ threadId: threadId.optional(), applicationId: applicationId.optional(), awardId: awardId.optional(), ...paging })),
  reply: tool("replyToThread", "messages:write", "Reply in a thread shared with a funder.", z.object({ threadId, body: z.string().min(1).max(10000), attachments: z.array(documentRef).max(10).default([]) })),
} as const;
