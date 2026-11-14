// SPDX-License-Identifier: AGPL-3.0-only
// In-browser implementation of the applicant API port. It follows the Worker's rules closely enough
// for the screens to behave the same in mock mode: starting prefills from the Passport record,
// saves merge by field and never overwrite Passport-owned fields, submit re-validates and answers
// 422 with the fields to fix, signing needs the typed name and the attestation.
import {
  buildPrefillSource,
  computeResponseStatus,
  mergeResponse,
  passportFieldPaths,
  prefill,
  validateResponse,
  type FormDefinition,
  type JsonObject,
  type Provenance,
} from "@gms/forms";
import { ApiError } from "../api/client.ts";
import type {
  Agreement,
  Answer,
  AppDocument,
  AppForm,
  ApplicantApi,
  ApplicantMember,
  ApplicantReadiness,
  Application,
  ApplicationEvent,
  ApplicationStatus,
  Approval,
  Award,
  AwardDetail,
  Comment,
  Consent,
  DiscoverCompetition,
  EligibilityResult,
  MyApplication,
  MyFunder,
  MyOrganization,
  OpenGrantsListing,
  SavedListing,
  Task,
  Thread,
} from "../api/applicant.ts";
import type { Session } from "../auth/types.ts";
import { FIXTURE_WORKSPACES, MOCK_USER } from "./fixtures.ts";
import { LOI_FORM, LOI_PROVENANCE, LOI_RESPONSE } from "./forms.ts";

const clone = <T>(v: T): T => structuredClone(v);
const notFound = (what: string) => new ApiError(404, `${what} not found`);
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export const APPLICANT_IDS = {
  workspace: FIXTURE_WORKSPACES[2]!.id,
  riverbend: FIXTURE_WORKSPACES[0]!.id,
  cascade: FIXTURE_WORKSPACES[1]!.id,
  org: "30000000-0000-4000-8000-000000000011",
  maria: MOCK_USER.userId,
  jamal: "10000000-0000-4000-8000-000000000012",
  lena: "10000000-0000-4000-8000-000000000013",
  appHealth: "90000000-0000-7000-8000-000000000001",
  appClinic: "90000000-0000-7000-8000-000000000002",
  compHealth: "60000000-0000-7000-8000-000000000001",
  compClinic: "60000000-0000-7000-8000-000000000011",
  compHousing: "60000000-0000-7000-8000-000000000002",
  oppHealth: "50000000-0000-7000-8000-000000000001",
  oppClinic: "50000000-0000-7000-8000-000000000011",
  oppHousing: "50000000-0000-7000-8000-000000000002",
  formFull: "70000000-0000-7000-8000-000000000002",
  formLoi: "70000000-0000-7000-8000-000000000001",
  awardHealth: "a0000000-0000-7000-8000-000000000001",
  awardClinic: "a0000000-0000-7000-8000-000000000002",
  agreementHealth: "b0000000-0000-7000-8000-000000000001",
  threadHealth: "c0000000-0000-7000-8000-000000000001",
} as const;
const I = APPLICANT_IDS;

const AGREEMENT_SHA = "7e2b4c1d9a0f5e6b3c8d7a1f2e4b6c9d0a3f5e7b1c2d4f6a8b9c0d1e2f3a40af";

interface AppRecord {
  uuid: string;
  title: string;
  competitionId: string;
  opportunityId: string;
  funderWorkspaceId: string;
  status: ApplicationStatus;
  stage: string;
  submittedAt: string | null;
  updatedAt: string;
  eligibility: Application["eligibility"];
  verificationLevel: string | null;
  forms: AppForm[];
  sections: Record<string, Record<string, string>>;
  events: ApplicationEvent[];
}

interface CompetitionInfo {
  id: string;
  opportunityId: string;
  slug: string;
  title: string;
  description: string;
  funding: Record<string, unknown>;
  funderWorkspaceId: string;
  stages: { key: string; label: string; opens: string | null; closes: string | null; forms: Record<string, number> }[];
  /** Decides eligibility from the organization record; `unknown` is a real answer. */
  eligibility: (org: MyOrganization) => EligibilityResult;
}

export interface ApplicantStore {
  organization: MyOrganization;
  members: ApplicantMember[];
  forms: FormDefinition[];
  competitions: CompetitionInfo[];
  /** Published opportunities with no open competition (apply anywhere, D10). */
  listed?: { opportunityId: string; slug: string; title: string; description: string; funding: Record<string, unknown>; funderWorkspaceId: string }[];
  funders: Record<string, { name: string; handle: string; brand: { accent: string; onAccent: string } }>;
  applications: AppRecord[];
  comments: Record<string, Comment[]>;
  attachments: Record<string, AppDocument[]>;
  threads: Thread[];
  tasks: Task[];
  answers: Answer[];
  saved: SavedListing[];
  openGrants: OpenGrantsListing[] | null;
  awards: AwardDetail[];
  agreements: Agreement[];
  consents: Consent[];
  approvals: Approval[];
}

const rule = (label: string, outcome: "pass" | "fail" | "unknown", explain: string) => ({ rule: {}, label, outcome, explain });

function seedOrganization(): MyOrganization {
  return {
    workspaceId: I.workspace,
    handle: "alder-creek",
    displayName: "Alder Creek Family Services",
    passportOrgId: I.org,
    linked: true,
    source: "passport",
    selfDeclared: null,
    level: "L3",
    verifiedAt: "2027-01-12T00:00:00Z",
    attestationUrl: "https://passport.opengrants.io/attestations/alder-creek",
    organization: {
      id: I.org,
      name: "Alder Creek Family Services",
      identifiers: { "org:us:ein": { id: "930000418" } },
      status: { value: "active" },
      addresses: { primary: { street1: "418 Mill Road", city: "Alder Creek", stateOrProvince: "OR", postalCode: "97000", country: "US" } },
      phones: { primary: { countryCode: "+1", number: "5415550142" } },
      emails: { primary: "maria.santos@aldercreek.example" },
      mission: "Alder Creek Family Services helps rural families reach the health care, housing and food they need to stay well and stay together.",
      yearFounded: "1998",
      socials: { website: "https://aldercreek.example" },
    } as unknown as MyOrganization["organization"],
    profile: {
      commonApp: {
        irs: { subsection: "03", ntee: "P40" },
        financials: { budget: 2400000, totalRevenue: 2510000, totalExpenses: 2380000, netAssets: 890000 },
        fiscalYearEnd: "06-30",
        staffCount: 31,
      },
    },
    profileSources: {
      "/commonApp/irs/subsection": "irs_bmf",
      "/commonApp/financials/budget": "user",
      "/commonApp/financials/totalRevenue": "irs_990",
      "/commonApp/financials/totalExpenses": "irs_990",
      "/commonApp/staffCount": "user",
    },
    syncedAt: "2027-04-20T15:58:00Z",
    editUrl: `https://passport.opengrants.io/orgs/${I.org}`,
  };
}

const HEALTH_RESPONSE: JsonObject = (() => {
  const r = clone(LOI_RESPONSE);
  // The draft the design shows: budget $3,000 over the request, no letter of support, not yet attested.
  (r.budget as JsonObject[])[3] = { category: "Indirect", amount: { amount: "18000.00", currency: "USD" }, notes: "10% cap" };
  delete r.supportLetter;
  delete r.signature;
  return r;
})();

function formState(form: FormDefinition, response: JsonObject, provenance: Record<string, string>): Pick<AppForm, "status" | "validationErrors"> {
  return { status: computeResponseStatus(form, response, provenance as Provenance), validationErrors: validateResponse(form, response).validationErrors };
}

export function seedApplicantStore(): ApplicantStore {
  const fullForm: FormDefinition = { ...clone(LOI_FORM), id: I.formFull, version: 1, title: "Full proposal" };
  const loiForm: FormDefinition = { ...clone(LOI_FORM), id: I.formLoi, version: 2, title: "Letter of intent" };
  const organization = seedOrganization();
  const event = (n: number, type: string, at: string, over: Partial<ApplicationEvent> = {}): ApplicationEvent => ({
    id: `e0000000-0000-7000-8000-00000000000${n}`,
    type,
    fromStatus: null,
    toStatus: null,
    fromStage: null,
    toStage: null,
    at,
    message: null,
    ...over,
  });
  const usd = (min: number, max: number) => ({ minAwardAmount: { amount: String(min), currency: "USD" }, maxAwardAmount: { amount: String(max), currency: "USD" } });

  return {
    organization,
    members: [
      { userId: I.maria, email: "maria.santos@aldercreek.example", name: "Maria Santos", role: "admin", scope: {}, expiresAt: null, mfaEnrolledAt: "2027-01-10T00:00:00Z", requiresMfa: true, invitedBy: null, createdAt: "2027-01-10T00:00:00Z" },
      { userId: I.jamal, email: "jamal.reed@aldercreek.example", name: "Jamal Reed", role: "editor", scope: {}, expiresAt: null, mfaEnrolledAt: null, requiresMfa: false, invitedBy: null, createdAt: "2027-02-01T00:00:00Z" },
      { userId: I.lena, email: "lena@fischergrants.example", name: "Lena Fischer", role: "consultant", scope: { applicationIds: [I.appHealth] }, expiresAt: "2027-05-15T00:00:00Z", mfaEnrolledAt: null, requiresMfa: false, invitedBy: null, createdAt: "2027-02-01T00:00:00Z" },
    ],
    forms: [fullForm, loiForm],
    funders: {
      [I.riverbend]: { name: "Riverbend Community Foundation", handle: "riverbend", brand: { accent: "#1F6F8B", onAccent: "#FFFFFF" } },
      [I.cascade]: { name: "Cascade County Health Department", handle: "cascade-county", brand: { accent: "#7A4F01", onAccent: "#FFFFFF" } },
    },
    competitions: [
      {
        id: I.compHealth,
        opportunityId: I.oppHealth,
        slug: "community-health-2027",
        title: "Community Health Grants 2027",
        description: "Two-year grants for organizations improving access to primary and preventive care in Riverbend County.",
        funding: usd(50000, 150000),
        funderWorkspaceId: I.riverbend,
        stages: [
          { key: "loi", label: "LOI", opens: "2027-01-15T00:00:00Z", closes: "2027-02-28T17:00:00Z", forms: { [I.formLoi]: 2 } },
          { key: "full", label: "Full proposal", opens: "2027-03-15T00:00:00Z", closes: "2027-04-30T17:00:00Z", forms: { [I.formFull]: 1 } },
        ],
        eligibility: (org) => ({
          eligible: org.linked ? true : "unknown",
          results: [
            rule("501(c)(3) in good standing", org.linked ? "pass" : "unknown", org.linked ? "IRS subsection 03, status active" : "Connect Passport to check this"),
            rule("Serves Riverbend County", org.linked ? "pass" : "unknown", org.linked ? "Primary address is in Oregon" : "Connect Passport to check this"),
            rule("Annual budget under $5M", org.linked ? "pass" : "unknown", org.linked ? "Budget is $2,400,000" : "Connect Passport to check this"),
          ],
        }),
      },
      {
        id: I.compClinic,
        opportunityId: I.oppClinic,
        slug: "community-clinic-capacity",
        title: "Community Clinic Capacity",
        description: "Capacity grants for community clinics and their navigation partners across Cascade County.",
        funding: usd(25000, 90000),
        funderWorkspaceId: I.cascade,
        stages: [{ key: "loi", label: "LOI", opens: "2027-03-01T00:00:00Z", closes: "2027-05-31T17:00:00Z", forms: { [I.formLoi]: 2 } }],
        eligibility: () => ({ eligible: true, results: [rule("Operates in Cascade County", "pass", "Service area includes Cascade County")] }),
      },
      {
        id: I.compHousing,
        opportunityId: I.oppHousing,
        slug: "housing-stability-2027",
        title: "Housing Stability 2027",
        description: "Rental assistance and eviction prevention partnerships.",
        funding: usd(40000, 200000),
        funderWorkspaceId: I.riverbend,
        stages: [{ key: "loi", label: "LOI", opens: "2027-04-01T00:00:00Z", closes: "2027-05-31T17:00:00Z", forms: { [I.formLoi]: 2 } }],
        eligibility: () => ({
          eligible: "unknown",
          results: [rule("Provides housing services", "unknown", "Your Passport record does not say; a program officer will review this")],
        }),
      },
    ],
    // Published and listed, with no competition open yet: shown as "Not taking applications yet".
    listed: [
      {
        opportunityId: "50000000-0000-7000-8000-000000000021",
        slug: "youth-mental-health-2028",
        title: "Youth Mental Health Partnerships 2028",
        description: "School-linked counseling and peer support programs in Cascade County.",
        funding: usd(25000, 75000),
        funderWorkspaceId: I.cascade,
      },
    ],
    applications: [
      {
        uuid: I.appHealth,
        title: "Mobile Health Navigation for Rural Families",
        competitionId: I.compHealth,
        opportunityId: I.oppHealth,
        funderWorkspaceId: I.riverbend,
        status: "draft",
        stage: "full",
        submittedAt: null,
        updatedAt: "2027-04-20T16:00:00Z",
        eligibility: {
          eligible: true,
          preview: true,
          results: [rule("501(c)(3) in good standing", "pass", "IRS subsection 03, status active"), rule("Serves Riverbend County", "pass", "Primary address is in Oregon"), rule("Annual budget under $5M", "pass", "Budget is $2,400,000")],
        },
        verificationLevel: null,
        forms: [
          { formId: I.formFull, version: 1, response: clone(HEALTH_RESPONSE), provenance: { ...LOI_PROVENANCE, "/activities": "user" }, lockedAt: null, lastModifiedAt: "2027-04-20T16:00:00Z", ...formState(fullForm, HEALTH_RESPONSE, LOI_PROVENANCE) },
          {
            formId: I.formLoi,
            version: 2,
            response: clone(LOI_RESPONSE),
            provenance: { ...LOI_PROVENANCE },
            lockedAt: "2027-02-21T18:00:00Z",
            lastModifiedAt: "2027-02-21T18:00:00Z",
            status: "complete",
            validationErrors: [],
          },
        ],
        sections: { [I.formFull]: { Organization: I.maria, Project: I.jamal, "Budget and attachments": I.lena } },
        events: [
          event(1, "started", "2027-02-03T17:00:00Z", { toStatus: "draft", toStage: "loi" }),
          event(2, "submit", "2027-02-21T18:00:00Z", { fromStatus: "draft", toStatus: "submitted" }),
          event(3, "advance", "2027-03-12T16:00:00Z", { fromStage: "loi", toStage: "full", fromStatus: "submitted", toStatus: "draft" }),
        ],
      },
      {
        uuid: I.appClinic,
        title: "Community Clinic Capacity",
        competitionId: I.compClinic,
        opportunityId: I.oppClinic,
        funderWorkspaceId: I.cascade,
        status: "submitted",
        stage: "loi",
        submittedAt: "2027-04-02T19:30:00Z",
        updatedAt: "2027-04-02T19:30:00Z",
        eligibility: { eligible: true, results: [rule("Operates in Cascade County", "pass", "Service area includes Cascade County")] },
        verificationLevel: "L3",
        forms: [{ formId: I.formLoi, version: 2, response: clone(LOI_RESPONSE), provenance: { ...LOI_PROVENANCE }, lockedAt: "2027-04-02T19:30:00Z", lastModifiedAt: "2027-04-02T19:30:00Z", status: "complete", validationErrors: [] }],
        sections: {},
        events: [event(4, "started", "2027-03-20T17:00:00Z", { toStatus: "draft", toStage: "loi" }), event(5, "submit", "2027-04-02T19:30:00Z", { fromStatus: "draft", toStatus: "submitted" })],
      },
    ],
    comments: {
      [I.appHealth]: [
        {
          id: "d0000000-0000-7000-8000-000000000001",
          body: "Can we cite the county assessment by name and year? The reviewers’ rubric asks for a source.",
          author: "Jamal Reed",
          authorUserId: I.jamal,
          formId: `frm_${I.formFull}`,
          fieldPath: "/need",
          resolvedAt: null,
          createdAt: "2027-04-20T15:00:00Z",
        },
        {
          id: "d0000000-0000-7000-8000-000000000002",
          body: "Budget narrative is in; indirect is over the 10% cap until we trim supplies.",
          author: "Lena Fischer",
          authorUserId: I.lena,
          formId: `frm_${I.formFull}`,
          fieldPath: "/budget",
          resolvedAt: null,
          createdAt: "2027-04-19T21:10:00Z",
        },
      ],
    },
    attachments: {
      [I.appHealth]: [
        { id: "doc_irs_letter", name: "IRS determination letter.pdf", mime: "application/pdf", size: 421888, sha256: "3f9a".padEnd(60, "0") + "c21e", source: "passport_locker", passportDocumentId: "pdoc_irs", scanStatus: "clean", uploadedAt: "2027-04-12T00:00:00Z" },
        { id: "doc_financials", name: "FY2026 audited financials.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 1153434, sha256: "8b10".padEnd(60, "0") + "77d4", source: "passport_locker", passportDocumentId: "pdoc_fin", scanStatus: "clean", uploadedAt: "2027-04-12T00:00:00Z" },
      ],
    },
    threads: [
      {
        id: I.threadHealth,
        subjectType: "application",
        subjectId: I.appHealth,
        visibility: "shared",
        title: "Mobile Health Navigation for Rural Families",
        funderWorkspaceId: I.riverbend,
        applicantWorkspaceId: I.workspace,
        messages: [
          { id: "f0000000-0000-7000-8000-000000000001", author: "Maria Santos", authorUserId: I.maria, body: "We have revised the budget to bring personnel in line with the county salary survey.", createdAt: "2027-04-18T18:00:00Z" },
          { id: "f0000000-0000-7000-8000-000000000002", author: "Dana Ortiz", authorUserId: null, body: "Thanks for the revised budget. Interview slots for the week of May 3 are open in your status page.", createdAt: "2027-04-20T14:00:00Z" },
        ],
        updatedAt: "2027-04-20T14:00:00Z",
      },
    ],
    tasks: [
      { id: "11000000-0000-7000-8000-000000000001", subjectType: "application", subjectId: I.appHealth, title: "Add letters of support", assigneeUserId: I.maria, dueAt: "2027-04-26T00:00:00Z", doneAt: null, createdAt: "2027-04-15T00:00:00Z" },
      { id: "11000000-0000-7000-8000-000000000002", subjectType: "application", subjectId: I.appHealth, title: "Reply to Jamal’s comment on the need statement", assigneeUserId: I.maria, dueAt: null, doneAt: null, createdAt: "2027-04-20T00:00:00Z" },
      { id: "11000000-0000-7000-8000-000000000003", subjectType: "application", subjectId: I.appHealth, title: "Confirm interview slot with Riverbend", assigneeUserId: I.maria, dueAt: "2027-04-28T00:00:00Z", doneAt: null, createdAt: "2027-04-20T00:00:00Z" },
    ],
    answers: [
      {
        id: "12000000-0000-7000-8000-000000000001",
        key: "need",
        title: "Need",
        body: LOI_RESPONSE.need as string,
        version: 3,
        usedIn: [{ applicationId: `app_${I.appHealth}`, formId: `frm_${I.formFull}`, path: "/need", version: 3, insertedAt: "2027-04-12T00:00:00Z" }] as unknown as Answer["usedIn"],
        words: words(LOI_RESPONSE.need as string),
        updatedAt: "2027-04-10T00:00:00Z",
      },
      {
        id: "12000000-0000-7000-8000-000000000002",
        key: "mission",
        title: "Mission",
        body: "Alder Creek Family Services helps rural families reach the health care, housing and food they need to stay well and stay together.",
        version: 1,
        usedIn: [],
        words: 22,
        updatedAt: "2026-11-02T00:00:00Z",
      },
      {
        id: "12000000-0000-7000-8000-000000000003",
        key: "evaluation",
        title: "Evaluation approach",
        body: "We track appointments kept, referrals completed and well-child visits against a baseline drawn from our 2026 intake records, and report them quarterly.",
        version: 2,
        usedIn: [{ applicationId: `app_${I.appClinic}`, formId: `frm_${I.formLoi}`, path: "/need", version: 1, insertedAt: "2027-03-18T00:00:00Z" }] as unknown as Answer["usedIn"],
        words: 24,
        updatedAt: "2027-03-18T00:00:00Z",
      },
    ],
    saved: [],
    openGrants: [
      { id: "og_rural_health_net", title: "Rural Health Network Development Planning", funder: "Health Resources and Services Administration", summary: "Planning grants for rural health networks.", amount: "Up to $100,000", deadline: "2027-06-12", url: "https://opengrants.io/grants/rural-health-network-planning", gms: null },
      { id: "og_riverbend_health", title: "Community Health Grants 2027", funder: "Riverbend Community Foundation", summary: "Indexed from the GMS.", amount: "$50,000 – $150,000", deadline: "2027-04-30", url: "https://gms.opengrants.io/f/riverbend/o/community-health-2027", gms: { opportunityId: `opp_${I.oppHealth}`, competitionId: I.compHealth } },
    ],
    awards: [
      {
        id: `awd_${I.awardHealth}`,
        title: "Mobile Health Navigation for Rural Families",
        description: null,
        status: "offered",
        currency: "USD",
        requestedAmountMinor: 15000000,
        awardedAmountMinor: 15000000,
        disbursedAmountMinor: 0,
        disbursedAt: null,
        keyDates: { periodOfPerformance: { startDate: "2027-07-01", endDate: "2028-06-30" }, awardDate: { date: "2027-05-18" } },
        conditions: [],
        applicationId: `app_${I.appHealth}`,
        opportunityId: `opp_${I.oppHealth}`,
        programId: null,
        parentAwardId: null,
        funder: { workspaceId: I.riverbend, name: "Riverbend Community Foundation", handle: "riverbend", brand: { accent: "#1F6F8B" } },
        recipient: { workspaceId: I.workspace, name: "Alder Creek Family Services", handle: "alder-creek", level: "L3", verification: { source: "passport", level: "L3" } },
        recipientIndividual: null,
        passport: { awardId: null, syncedAt: null, mirror: "pending" },
        createdAt: "2027-05-18T00:00:00Z",
        updatedAt: "2027-05-19T00:00:00Z",
        agreement: { id: `agr_${I.agreementHealth}`, version: 1, status: "sent", documentSha256: AGREEMENT_SHA, granteeSignedAt: null, funderSignedAt: null, executedAt: null },
        tranches: [
          { id: "trn_1", seq: 1, amountMinor: 7500000, currency: "USD", condition: { type: "onExecution" }, status: "scheduled", dueAt: null, holdReason: null, mode: null, passportStatus: null, releasedAt: null },
          { id: "trn_2", seq: 2, amountMinor: 6000000, currency: "USD", condition: { type: "onReportAccepted" }, status: "scheduled", dueAt: null, holdReason: null, mode: null, passportStatus: null, releasedAt: null },
          { id: "trn_3", seq: 3, amountMinor: 1500000, currency: "USD", condition: { type: "onReportAccepted" }, status: "scheduled", dueAt: null, holdReason: null, mode: null, passportStatus: null, releasedAt: null },
        ],
        requirements: [{ id: "req_d0000000-0000-7000-8000-000000000001", type: "report", title: "Interim report", formId: null, dueAt: "2027-12-15T00:00:00Z", status: "scheduled", releasesTrancheId: "trn_2" }],
        amendments: [],
      },
      {
        id: `awd_${I.awardClinic}`,
        title: "Clinic Navigation Pilot",
        description: null,
        status: "active",
        currency: "USD",
        requestedAmountMinor: 4000000,
        awardedAmountMinor: 4000000,
        disbursedAmountMinor: 4000000,
        disbursedAt: "2026-09-02T00:00:00Z",
        keyDates: { periodOfPerformance: { startDate: "2026-07-01", endDate: "2027-06-30" } },
        conditions: [],
        applicationId: null,
        opportunityId: null,
        programId: null,
        parentAwardId: null,
        funder: { workspaceId: I.cascade, name: "Cascade County Health Department", handle: "cascade-county", brand: { accent: "#7A4F01" } },
        recipient: { workspaceId: I.workspace, name: "Alder Creek Family Services", handle: "alder-creek", level: "L3", verification: { source: "passport", level: "L3" } },
        recipientIndividual: null,
        passport: { awardId: null, syncedAt: null, mirror: "synced" },
        createdAt: "2026-06-20T00:00:00Z",
        updatedAt: "2026-09-02T00:00:00Z",
        agreement: null,
        tranches: [],
        requirements: [{ id: "req_d0000000-0000-7000-8000-000000000002", type: "report", title: "Final report", formId: null, dueAt: "2027-06-30T00:00:00Z", status: "due", releasesTrancheId: null }],
        amendments: [],
      },
    ],
    agreements: [
      {
        id: `agr_${I.agreementHealth}`,
        version: 1,
        status: "sent",
        documentSha256: AGREEMENT_SHA,
        granteeSignedAt: null,
        funderSignedAt: null,
        executedAt: null,
        awardId: `awd_${I.awardHealth}`,
        templateId: null,
        granteeSignature: null,
        funderSignature: null,
        hasStoredPdf: true,
        createdAt: "2027-05-19T00:00:00Z",
      },
    ],
    consents: [
      { id: "13000000-0000-7000-8000-000000000001", funder: { workspaceId: I.riverbend, name: "Riverbend Community Foundation", handle: "riverbend" }, basis: "application", scopes: ["org:read"], grantedAt: "2027-02-03T17:00:00Z", revokedAt: null },
      { id: "13000000-0000-7000-8000-000000000002", funder: { workspaceId: I.cascade, name: "Cascade County Health Department", handle: "cascade-county" }, basis: "application", scopes: ["org:read"], grantedAt: "2025-03-11T17:00:00Z", revokedAt: null },
    ],
    approvals: [],
  };
}

export interface MockApplicantOptions {
  session: () => Promise<Session | null>;
  store?: ApplicantStore;
  now?: () => Date;
  /** Display name of the acting person (comments, messages). */
  actor?: { userId: string; name: string };
}

export function createMockApplicantApi(opts: MockApplicantOptions): ApplicantApi {
  const store = opts.store ?? seedApplicantStore();
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  const actor = opts.actor ?? { userId: I.maria, name: "Maria Santos" };
  const uuid = () => crypto.randomUUID();
  // Short ids from the design canvas still open the seeded records they stand for.
  const ALIASES: Record<string, string> = { "01HZX4": I.appHealth, "01J2Q7": I.awardHealth };
  const bare = (id: string) => {
    const raw = id.replace(/^[a-z]{3}_/, "");
    return ALIASES[raw] ?? raw;
  };

  async function signedIn() {
    if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
  }
  const appOf = (id: string): AppRecord => {
    const a = store.applications.find((x) => x.uuid === bare(id));
    if (!a) throw notFound("Application");
    return a;
  };
  const formOf = (formId: string, version: number): FormDefinition => {
    const f = store.forms.find((x) => x.id === bare(formId) && x.version === version) ?? store.forms.find((x) => x.id === bare(formId));
    if (!f) throw notFound("Form");
    return f;
  };
  const competitionOf = (id: string) => {
    const c = store.competitions.find((x) => x.id === bare(id));
    if (!c) throw notFound("Competition");
    return c;
  };
  const view = (a: AppRecord): Application =>
    clone({ id: `app_${a.uuid}`, uuid: a.uuid, title: a.title, competitionId: a.competitionId, opportunityId: a.opportunityId, status: a.status, stage: a.stage, submittedAt: a.submittedAt, eligibility: a.eligibility, verificationLevel: a.verificationLevel, forms: a.forms });
  const stageForms = (a: AppRecord) => {
    const stage = competitionOf(a.competitionId).stages.find((s) => s.key === a.stage);
    return a.forms.filter((f) => stage && f.formId in stage.forms);
  };
  const summary = (a: AppRecord): MyApplication => {
    const c = competitionOf(a.competitionId);
    const stage = c.stages.find((s) => s.key === a.stage);
    const funder = store.funders[a.funderWorkspaceId];
    const current = stageForms(a);
    return {
      id: `app_${a.uuid}`,
      title: a.title,
      status: a.status,
      stage: { key: a.stage, label: stage?.label ?? a.stage, closes: stage?.closes ?? null },
      funder: { workspaceId: a.funderWorkspaceId, name: funder?.name ?? null, handle: funder?.handle ?? null, brand: funder?.brand ?? {} },
      opportunity: { id: `opp_${a.opportunityId}`, title: c.title },
      forms: { total: current.length, complete: current.filter((f) => f.status === "complete").length },
      submittedAt: a.submittedAt,
      updatedAt: a.updatedAt,
    };
  };
  const pushEvent = (a: AppRecord, type: string, over: Partial<ApplicationEvent>) =>
    a.events.push({ id: uuid(), type, fromStatus: null, toStatus: null, fromStage: null, toStage: null, at: now(), message: null, ...over });
  const readiness = (): ApplicantReadiness => {
    const org = store.organization;
    const rank = org.level ? Number(org.level.slice(1)) : null;
    const need = (min: number, key: string, label: string, pass: string, fail: string) =>
      rank === null
        ? { key, state: "unknown" as const, label, reason: "Connect Passport to see this", fixHref: org.editUrl }
        : rank >= min
          ? { key, state: "pass" as const, label, reason: pass, fixHref: null }
          : { key, state: "fail" as const, label, reason: fail, fixHref: org.editUrl };
    if (!org.linked) {
      // Without Passport: the profile the organization entered, and an optional, non-failing nudge.
      const o = org.organization as unknown as { name?: string; emails?: { primary?: string } } | null;
      const complete = !!(o?.name || org.displayName) && !!o?.emails?.primary;
      const own = [
        complete
          ? { key: "profile_complete", state: "pass" as const, label: "Profile complete", reason: "Legal name and contact email are set", fixHref: null }
          : { key: "profile_complete", state: "fail" as const, label: "Profile complete", reason: "Add your legal name and a contact email in Settings", fixHref: null },
        { key: "passport_optional", state: "unknown" as const, optional: true, label: "Connect Passport for verification", reason: "Optional. Verified organizations are shown to funders as verified", fixHref: null },
      ];
      const failed = own.filter((c) => c.state === "fail").length;
      return { level: null, linked: false, source: "self_declared" as const, syncedAt: null, checks: own, summary: { pass: own.length - failed - 1, fail: failed, unknown: 1, ready: failed === 0 } };
    }
    const checks = [
      org.linked
        ? { key: "passport_linked", state: "pass" as const, label: "Passport connected", reason: `Record last read ${org.syncedAt?.slice(0, 10) ?? "never"}`, fixHref: null }
        : { key: "passport_linked", state: "fail" as const, label: "Passport connected", reason: "Connect this workspace to your Passport record", fixHref: null },
      need(1, "organization_verified", "Organization verified", "Matched to public registry records (L1)", "Claim and confirm your organization in Passport"),
      need(2, "identity_verified", "Identity verified", "Representatives confirmed Jan 12, 2027", "Verify your representatives in Passport"),
      need(3, "payee_verified", "Payee verified", "River City Credit Union •••• 4821", "Verify a payout destination in Passport to receive facilitated payments"),
    ];
    const fail = checks.filter((c) => c.state === "fail").length;
    const unknown = checks.filter((c) => c.state === "unknown").length;
    return { level: org.level, linked: org.linked, source: "passport" as const, syncedAt: org.syncedAt, checks, summary: { pass: checks.length - fail - unknown, fail, unknown, ready: fail === 0 && unknown === 0 } };
  };

  return {
    async organization() {
      await signedIn();
      return clone(store.organization);
    },
    async refreshOrganization() {
      await signedIn();
      if (!store.organization.linked) throw new ApiError(409, "Connect this workspace to Passport first");
      store.organization.syncedAt = now();
      return clone(store.organization);
    },
    async readiness() {
      await signedIn();
      return readiness();
    },
    async startConsent(input = {}) {
      await signedIn();
      // Mock mode has no Passport: the browser comes straight back as the Worker's callback would send it.
      store.organization.linked = true;
      return { authorizeUrl: `${input.returnTo ?? "/onboarding/applicant"}?passport=linked&ws=${store.organization.handle}`, scopes: ["org:read", "org.changes:read", "org.changes:write"], expiresInSeconds: 600 };
    },
    async finishConsent() {
      await signedIn();
      store.organization.linked = true;
      return { workspaceId: store.organization.workspaceId, handle: store.organization.handle, redirect: `/onboarding/applicant?passport=linked&ws=${store.organization.handle}` };
    },
    async consents() {
      await signedIn();
      return clone(store.consents);
    },
    async revokeConsent(id) {
      await signedIn();
      const c = store.consents.find((x) => x.id === id);
      if (!c) throw notFound("Consent");
      c.revokedAt ??= now();
      return { revoked: true };
    },
    async funders() {
      await signedIn();
      const ids = [...new Set(store.applications.map((a) => a.funderWorkspaceId))];
      return ids.map((id): MyFunder => {
        const f = store.funders[id]!;
        const mine = store.applications.filter((a) => a.funderWorkspaceId === id);
        return { workspaceId: id, name: f.name, handle: f.handle, brand: f.brand, since: mine.map((a) => a.events[0]?.at ?? a.updatedAt).sort()[0] ?? null, applications: mine.length, awards: store.awards.filter((w) => w.funder.workspaceId === id).length };
      });
    },
    async members() {
      await signedIn();
      return clone(store.members);
    },
    async invite(input) {
      await signedIn();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new ApiError(422, "Enter an email address", [{ field: "email", detail: "Enter an email address" }]);
      return { id: uuid(), email: input.email, role: input.role, expiresAt: input.expiresAt ?? null };
    },

    async applications() {
      await signedIn();
      return store.applications.map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async applicationStatus(id) {
      await signedIn();
      const a = appOf(id);
      const stages = competitionOf(a.competitionId).stages;
      const at = stages.findIndex((s) => s.key === a.stage);
      return clone({
        id: `app_${a.uuid}`,
        title: a.title,
        status: a.status,
        stage: a.stage,
        submittedAt: a.submittedAt,
        stages: stages.map((s, i) => ({ key: s.key, label: s.label, opens: s.opens, closes: s.closes, state: i < at ? ("done" as const) : i === at ? ("current" as const) : ("upcoming" as const) })),
        timeline: a.events,
      });
    },
    async startApplication(competitionId) {
      await signedIn();
      const c = competitionOf(competitionId);
      const existing = store.applications.find((a) => a.competitionId === c.id && a.status !== "withdrawn" && a.status !== "declined");
      if (existing) return view(existing);
      const org = store.organization;
      const stage = c.stages[0]!;
      const source = buildPrefillSource((org.organization ?? {}) as unknown as JsonObject, org.profile as JsonObject | null);
      const forms = Object.entries(stage.forms).map(([formId, version]): AppForm => {
        const def = formOf(formId, version);
        const filled = prefill(def, source);
        return { formId, version, response: filled.response, provenance: filled.provenance, lockedAt: null, lastModifiedAt: now(), ...formState(def, filled.response, filled.provenance) };
      });
      const record: AppRecord = {
        uuid: uuid(),
        title: c.title,
        competitionId: c.id,
        opportunityId: c.opportunityId,
        funderWorkspaceId: c.funderWorkspaceId,
        status: "draft",
        stage: stage.key,
        submittedAt: null,
        updatedAt: now(),
        eligibility: { ...c.eligibility(org), preview: true },
        verificationLevel: null,
        forms,
        sections: {},
        events: [],
      };
      pushEvent(record, "started", { toStatus: "draft", toStage: stage.key });
      store.applications.push(record);
      return view(record);
    },
    async application(id) {
      await signedIn();
      return view(appOf(id));
    },
    async form(formId, version) {
      return clone(formOf(formId, version));
    },
    async saveForm(id, formId, patch) {
      await signedIn();
      const a = appOf(id);
      if (a.status !== "draft" && a.status !== "revision_requested") throw new ApiError(409, `This application is ${a.status.replace(/_/g, " ")} and can no longer be edited`);
      const f = a.forms.find((x) => x.formId === bare(formId));
      if (!f) throw notFound("Form response");
      if (f.lockedAt) throw new ApiError(409, "This form belongs to an earlier stage and is read-only");
      const def = formOf(f.formId, f.version);
      const merged = mergeResponse(f.response, patch, { provenance: f.provenance as Provenance, actor: "user", lockedPaths: passportFieldPaths(def) });
      Object.assign(f, { response: merged.response, provenance: merged.provenance, lastModifiedAt: now(), ...formState(def, merged.response, merged.provenance) });
      a.updatedAt = f.lastModifiedAt;
      return { ...clone(f), rejected: merged.rejected };
    },
    async submit(id) {
      await signedIn();
      const a = appOf(id);
      if (a.status !== "draft" && a.status !== "revision_requested") throw new ApiError(409, "This application has already been submitted");
      const problems = stageForms(a).flatMap((f) => validateResponse(formOf(f.formId, f.version), f.response).validationErrors.map((e) => ({ code: e.type, field: `${f.formId}${e.field}`, detail: e.message })));
      // Same shape as the Worker: the error code first, then one entry per field.
      if (problems.length) throw new ApiError(422, "This application is not ready to submit", [{ code: "validation_failed" }, ...problems]);
      const at = now();
      for (const f of stageForms(a)) f.lockedAt = at;
      pushEvent(a, "submit", { fromStatus: a.status, toStatus: "submitted" });
      Object.assign(a, { status: "submitted", submittedAt: at, updatedAt: at, verificationLevel: store.organization.level, eligibility: competitionOf(a.competitionId).eligibility(store.organization) });
      if (!store.consents.some((c) => c.funder.workspaceId === a.funderWorkspaceId && c.basis === "application" && !c.revokedAt)) {
        const f = store.funders[a.funderWorkspaceId];
        store.consents.unshift({ id: uuid(), funder: { workspaceId: a.funderWorkspaceId, name: f?.name ?? null, handle: f?.handle ?? null }, basis: "application", scopes: ["org:read"], grantedAt: at, revokedAt: null });
      }
      return view(a);
    },
    async withdraw(id) {
      await signedIn();
      const a = appOf(id);
      pushEvent(a, "withdraw", { fromStatus: a.status, toStatus: "withdrawn" });
      a.status = "withdrawn";
      return { id: `app_${a.uuid}`, status: a.status };
    },
    async comments(id) {
      await signedIn();
      return clone(store.comments[appOf(id).uuid] ?? []);
    },
    async addComment(id, input) {
      await signedIn();
      const a = appOf(id);
      const c: Comment = { id: uuid(), body: input.body, author: actor.name, authorUserId: actor.userId, formId: input.formId ?? null, fieldPath: input.fieldPath ?? null, resolvedAt: null, createdAt: now() };
      (store.comments[a.uuid] ??= []).unshift(c);
      return clone(c);
    },
    async resolveComment(id, commentId) {
      await signedIn();
      const c = (store.comments[appOf(id).uuid] ?? []).find((x) => x.id === commentId);
      if (!c) throw notFound("Comment");
      c.resolvedAt ??= now();
      return clone(c);
    },
    async sections(id, formId) {
      await signedIn();
      return { formId, sections: clone(appOf(id).sections[bare(formId)] ?? {}) };
    },
    async assignSections(id, formId, sections) {
      await signedIn();
      const a = appOf(id);
      const current = (a.sections[bare(formId)] ??= {});
      for (const [section, userId] of Object.entries(sections)) {
        if (userId && !store.members.some((m) => m.userId === userId)) throw new ApiError(422, "That person is not a member of this workspace");
        if (userId) current[section] = userId;
        else delete current[section];
      }
      return { formId, sections: clone(current) };
    },
    async attachments(id) {
      await signedIn();
      return clone(store.attachments[appOf(id).uuid] ?? []);
    },
    async attach(id, input) {
      await signedIn();
      const a = appOf(id);
      const locker = "passportDocumentId" in input;
      const doc: AppDocument = {
        id: `doc_${uuid()}`,
        name: input.name,
        mime: input.mime,
        size: locker ? input.size : Math.floor((input.contentBase64.length * 3) / 4),
        sha256: locker ? input.sha256 : "0".repeat(64),
        source: locker ? "passport_locker" : "upload",
        passportDocumentId: locker ? input.passportDocumentId : null,
        scanStatus: "not_scanned",
        uploadedAt: now(),
      };
      (store.attachments[a.uuid] ??= []).push(doc);
      return clone(doc);
    },
    async threads(id) {
      await signedIn();
      return clone(store.threads.filter((t) => t.subjectId === appOf(id).uuid && t.visibility === "shared"));
    },
    async openThread(id) {
      await signedIn();
      const a = appOf(id);
      let t = store.threads.find((x) => x.subjectId === a.uuid && x.visibility === "shared");
      if (!t) {
        t = { id: uuid(), subjectType: "application", subjectId: a.uuid, visibility: "shared", title: a.title, funderWorkspaceId: a.funderWorkspaceId, applicantWorkspaceId: I.workspace, messages: [], updatedAt: now() };
        store.threads.push(t);
      }
      return clone(t);
    },
    async postMessage(threadId, body) {
      await signedIn();
      const t = store.threads.find((x) => x.id === threadId);
      if (!t) throw notFound("Thread");
      const m = { id: uuid(), author: actor.name, authorUserId: actor.userId, body, createdAt: now() };
      t.messages.push(m);
      t.updatedAt = m.createdAt;
      return clone(m);
    },
    async tasks() {
      await signedIn();
      return clone(store.tasks.filter((t) => !t.doneAt));
    },
    async updateTask(id, patch) {
      await signedIn();
      const t = store.tasks.find((x) => x.id === id);
      if (!t) throw notFound("Task");
      if (patch.done !== undefined) t.doneAt = patch.done ? now() : null;
      return clone(t);
    },

    async answers() {
      await signedIn();
      return clone(store.answers);
    },
    async createAnswer(input) {
      await signedIn();
      if (!input.title.trim()) throw new ApiError(422, "Give this answer a title", [{ field: "title", detail: "Give this answer a title" }]);
      const a: Answer = { id: uuid(), key: input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "answer", title: input.title.trim(), body: input.body, version: 1, usedIn: [], words: words(input.body), updatedAt: now() };
      store.answers.unshift(a);
      return clone(a);
    },
    async updateAnswer(id, patch) {
      await signedIn();
      const a = store.answers.find((x) => x.id === id);
      if (!a) throw notFound("Answer");
      // Editing saves a new version under the same key (with a new id), as the Worker does;
      // applications that used the old text keep what they inserted.
      const next: Answer = { ...a, id: uuid(), title: patch.title?.trim() || a.title, body: patch.body ?? a.body, version: a.version + 1, words: words(patch.body ?? a.body), updatedAt: now() };
      store.answers[store.answers.indexOf(a)] = next;
      return clone(next);
    },

    async discover() {
      await signedIn();
      // Opportunities not taking applications yet come after the open ones, with no eligibility run.
      const notOpen = (store.listed ?? []).map((o): DiscoverCompetition => {
        const funder = store.funders[o.funderWorkspaceId];
        return {
          competitionId: null,
          acceptingApplications: false,
          opportunity: { id: `opp_${o.opportunityId}`, slug: o.slug, title: o.title, description: o.description, funding: o.funding },
          funder: { name: funder?.name ?? null, handle: funder?.handle ?? null, brand: funder?.brand ?? {} },
          stage: null,
          forms: 0,
          eligibility: null,
          application: null,
          url: funder ? `/f/${funder.handle}/o/${o.slug}` : null,
        };
      });
      return [...store.competitions.map((c): DiscoverCompetition => {
        const funder = store.funders[c.funderWorkspaceId];
        const first = c.stages[0];
        const started = store.applications.find((a) => a.competitionId === c.id && a.status !== "withdrawn");
        return {
          competitionId: c.id,
          opportunity: { id: `opp_${c.opportunityId}`, slug: c.slug, title: c.title, description: c.description, funding: c.funding },
          funder: { name: funder?.name ?? null, handle: funder?.handle ?? null, brand: funder?.brand ?? {} },
          stage: first ? { key: first.key, label: first.label, closes: first.closes } : null,
          forms: first ? Object.keys(first.forms).length : 0,
          eligibility: c.eligibility(store.organization),
          application: started ? { id: `app_${started.uuid}`, status: started.status } : null,
          url: funder ? `/f/${funder.handle}/o/${c.slug}` : null,
          acceptingApplications: true,
        } as DiscoverCompetition;
      }), ...notOpen];
    },
    async saved() {
      await signedIn();
      return clone(store.saved);
    },
    async save(input) {
      await signedIn();
      const existing = store.saved.find((s) => s.source === input.source && s.externalId === input.externalId);
      if (existing) return clone(existing);
      const row: SavedListing = { id: uuid(), source: input.source, externalId: input.externalId, title: input.title, url: input.url ?? null, savedAt: now() };
      store.saved.unshift(row);
      return clone(row);
    },
    async openGrants(_tool, args) {
      await signedIn();
      if (!store.openGrants) throw new ApiError(503, "OpenGrants discovery is not configured on this server");
      const q = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      return { results: clone(store.openGrants.filter((l) => !q || `${l.title} ${l.funder ?? ""} ${l.summary ?? ""}`.toLowerCase().includes(q))), cached: false };
    },

    async awards() {
      await signedIn();
      return store.awards.map(({ agreement: _a, tranches: _t, requirements: _r, amendments: _m, ...rest }): Award => clone(rest));
    },
    async award(id) {
      await signedIn();
      const w = store.awards.find((x) => x.id === `awd_${bare(id)}`);
      if (!w) throw notFound("Award");
      return clone(w);
    },
    async acceptAward(id, _name) {
      await signedIn();
      const w = store.awards.find((x) => x.id === `awd_${bare(id)}`);
      if (!w) throw notFound("Award");
      if (w.status !== "offered") throw new ApiError(409, "This award has already been accepted");
      w.status = "accepted";
      w.updatedAt = now();
      return clone(w);
    },
    async agreement(id) {
      await signedIn();
      const g = store.agreements.find((x) => x.id === id);
      if (!g) throw notFound("Agreement");
      return clone(g);
    },
    async signAgreement(id, input) {
      await signedIn();
      const g = store.agreements.find((x) => x.id === id);
      if (!g) throw notFound("Agreement");
      if (g.status !== "sent") throw new ApiError(409, "This agreement is not waiting for your signature");
      if (!input.name.trim() || input.attest !== true) throw new ApiError(422, "Type your full legal name and confirm you are authorized to sign");
      if (input.documentSha256 && input.documentSha256 !== g.documentSha256) throw new ApiError(409, "The agreement changed since you opened it. Reload and review it again");
      const at = now();
      Object.assign(g, { status: "signed_by_grantee", granteeSignedAt: at, granteeSignature: { name: input.name.trim(), at } });
      const w = store.awards.find((x) => x.id === g.awardId);
      if (w?.agreement) Object.assign(w.agreement, { status: g.status, granteeSignedAt: at });
      return clone(g);
    },

    async approvals(status) {
      await signedIn();
      return clone(store.approvals.filter((a) => !status || a.status === status));
    },
    async decideApproval(id, approve, note) {
      await signedIn();
      const a = store.approvals.find((x) => x.id === id);
      if (!a) throw notFound("Approval");
      if (a.status !== "pending") throw new ApiError(409, "This request has already been resolved");
      Object.assign(a, { status: approve ? "executed" : "rejected", decidedBy: actor.userId, decidedAt: now(), ...(note ? { note } : {}) });
      return clone(a);
    },
  };
}

export type { Application, Agreement, Approval, Award, Task };
