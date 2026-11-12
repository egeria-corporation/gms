// SPDX-License-Identifier: AGPL-3.0-only
// Seed data for mock mode: what the API would return for the fixture workspaces. Names, handles,
// programs and the Community Health Grants 2027 cycle mirror supabase/seed.sql and the design canvas.
import type {
  Competition,
  FormRecord,
  Invitation,
  Member,
  Opportunity,
  PassportStatus,
  Program,
  PublicFunder,
  Rubric,
  WorkspaceRecord,
} from "../api/types.ts";
import { rowsToRules } from "../lib/rules.ts";
import { FIXTURE_WORKSPACES } from "./fixtures.ts";
import { LOI_FORM } from "./forms.ts";

const usd = (amount: number) => ({ amount: String(amount), currency: "USD" });
const at = (date: string) => `${date}T00:00:00Z`;
const day = (name: string, date: string) => ({ name, eventType: "singleDate" as const, date });

export const IDS = {
  riverbend: FIXTURE_WORKSPACES[0]!.id,
  cascade: FIXTURE_WORKSPACES[1]!.id,
  programHealth27: "40000000-0000-7000-8000-000000000001",
  programHousing27: "40000000-0000-7000-8000-000000000002",
  programHealth26: "40000000-0000-7000-8000-000000000003",
  programRapid: "40000000-0000-7000-8000-000000000004",
  oppHealth27: "opp_50000000-0000-7000-8000-000000000001",
  oppHousing27: "opp_50000000-0000-7000-8000-000000000002",
  oppRapid: "opp_50000000-0000-7000-8000-000000000003",
  oppYouth28: "opp_50000000-0000-7000-8000-000000000004",
  oppClinic: "opp_50000000-0000-7000-8000-000000000011",
  compHealth27: "cmp_60000000-0000-7000-8000-000000000001",
  formLoi: "frm_70000000-0000-7000-8000-000000000001",
  formFull: "frm_70000000-0000-7000-8000-000000000002",
  formLibraryLoi: "frm_70000000-0000-7000-8000-0000000000a1",
  formLibraryReport: "frm_70000000-0000-7000-8000-0000000000a2",
  rubricLoi: "80000000-0000-7000-8000-000000000001",
  rubricFull: "80000000-0000-7000-8000-000000000002",
} as const;

export interface WorkspaceData {
  record: WorkspaceRecord;
  /** Public profile fields the API reads from the cached Passport record. */
  profile: Pick<PublicFunder, "mission" | "website">;
  members: Member[];
  invitations: Invitation[];
  passport: PassportStatus;
  programs: Program[];
  rubrics: Rubric[];
  opportunities: Opportunity[];
  competitions: Competition[];
  /** Every version of every form the workspace owns. */
  forms: FormRecord[];
}

export interface Store {
  workspaces: WorkspaceData[];
  /** Shared library forms (no owning workspace). */
  library: FormRecord[];
  sharedRubrics: Rubric[];
}

const stamp = { createdAt: at("2027-01-06"), updatedAt: at("2027-04-18") };

function formFrom(id: string, version: number, over: Partial<FormRecord>): FormRecord {
  return {
    id,
    version,
    title: LOI_FORM.title,
    description: LOI_FORM.description ?? null,
    instructions: null,
    purpose: "loi",
    status: "published",
    publishedAt: at("2027-01-12"),
    supersedesFormVersion: version > 1 ? version - 1 : null,
    shared: false,
    jsonSchema: structuredClone(LOI_FORM.jsonSchema),
    uiSchema: structuredClone(LOI_FORM.uiSchema),
    mappingFromCommonGrants: structuredClone(LOI_FORM.mappingFromCommonGrants ?? {}),
    mappingToCommonGrants: structuredClone(LOI_FORM.mappingToCommonGrants ?? {}),
    fieldMeta: {},
    ...stamp,
    ...over,
  };
}

const FULL_PROPOSAL: Pick<FormRecord, "jsonSchema" | "uiSchema" | "mappingFromCommonGrants" | "mappingToCommonGrants"> = {
  jsonSchema: {
    type: "object",
    required: ["legalName", "approach", "outcomes"],
    properties: {
      legalName: { type: "string", title: "Legal name" },
      approach: { type: "string", title: "Approach and activities", "x-wordCount": { max: 400 } },
      outcomes: { type: "string", title: "Outcomes and evaluation", "x-wordCount": { max: 300 } },
      requestedAmount: { type: "object", title: "Requested amount" },
    },
  },
  uiSchema: {
    type: "VerticalLayout",
    elements: [
      { type: "Group", label: "Organization", elements: [{ type: "Control", scope: "#/properties/legalName", options: { widget: "passportField" } }] },
      {
        type: "Group",
        label: "Proposal",
        elements: [
          { type: "Control", scope: "#/properties/approach" },
          { type: "Control", scope: "#/properties/outcomes" },
          { type: "Control", scope: "#/properties/requestedAmount", options: { widget: "money", widgetOptions: { currency: "USD" } } },
        ],
      },
    ],
  },
  mappingFromCommonGrants: { legalName: { field: "name" } },
  mappingToCommonGrants: {},
};

const riverbendRubrics: Rubric[] = [
  {
    id: IDS.rubricLoi,
    version: 1,
    name: "LOI screening rubric",
    shared: false,
    overall: { recommendations: ["Advance", "Decline"], spreadThreshold: 15 },
    criteria: [
      { key: "fit", label: "Fit with program goals", weight: 50, scale: { type: "numeric", min: 1, max: 5 } },
      { key: "need", label: "Clarity of need", weight: 30, scale: { type: "numeric", min: 1, max: 5 } },
      { key: "readiness", label: "Organizational readiness", weight: 20, scale: { type: "numeric", min: 1, max: 5 } },
    ],
  },
  {
    id: IDS.rubricFull,
    version: 2,
    name: "Full proposal rubric",
    shared: false,
    overall: { recommendations: ["Fund", "Fund with conditions", "Do not fund"], spreadThreshold: 15 },
    criteria: [
      { key: "impact", label: "Community impact", weight: 35, scale: { type: "numeric", min: 1, max: 5 } },
      { key: "feasibility", label: "Feasibility", weight: 25, scale: { type: "numeric", min: 1, max: 5 } },
      { key: "budget", label: "Budget reasonableness", weight: 20, scale: { type: "numeric", min: 1, max: 5 } },
      { key: "equity", label: "Reach to underserved families", weight: 20, scale: { type: "numeric", min: 1, max: 5 } },
    ],
  },
];

const healthRules = rowsToRules([
  { id: "r1", fact: "taxStatus", values: ["03"] },
  { id: "r2", fact: "state", values: ["OR"] },
  { id: "r3", fact: "level", level: "L1" },
  { id: "r4", fact: "revenueUnder", amount: 5_000_000 },
]);

function opportunity(over: Partial<Opportunity> & Pick<Opportunity, "id" | "slug" | "title" | "description">): Opportunity {
  return {
    programId: null,
    status: "open",
    funding: {},
    keyDates: {},
    acceptedApplicantTypes: ["non_profit_with_501c3"],
    eligibilityRules: { all: [] },
    publish: { publicPage: true, openGrantsIndex: true, sitemap: true },
    customFields: {},
    published: true,
    publishedAt: at("2027-01-15"),
    ...stamp,
    ...over,
  };
}

/** A fresh copy of the seed; every mock API instance gets its own. */
export function seedStore(): Store {
  const [riverbendFixture, cascadeFixture] = FIXTURE_WORKSPACES;
  const riverbend: WorkspaceData = {
    record: {
      id: IDS.riverbend,
      kind: "funder",
      handle: "riverbend",
      displayName: "Riverbend Community Foundation",
      legalName: "Riverbend Community Foundation, Inc.",
      passportOrgId: "90000000-0000-7000-8000-000000000001",
      verificationLevel: "L3",
      profileSource: "passport",
      verification: { source: "passport", level: "L3" },
      profile: null,
      brand: { ...riverbendFixture!.brand, logoUrl: null },
      settings: { transparency: true },
      status: "active",
    },
    profile: { mission: "Funding health, housing and opportunity across the Riverbend valley since 1984.", website: "https://riverbendcf.example" },
    members: [
      { userId: "10000000-0000-4000-8000-000000000001", role: "admin", email: "dana.ortiz@riverbendcf.example" },
      { userId: "10000000-0000-4000-8000-000000000002", role: "finance", email: "marcus.lee@riverbendcf.example" },
      { userId: "10000000-0000-4000-8000-000000000003", role: "reviewer", email: "priya.natarajan@riverbendcf.example" },
    ],
    invitations: [],
    passport: {
      linked: true,
      passportOrgId: "90000000-0000-7000-8000-000000000001",
      clientId: "pc_riverbend_gms",
      scopes: ["org:read", "payee:read", "award:write", "disbursement:read", "disbursement:write"],
      linkedAt: at("2027-01-08"),
      lastOkAt: at("2027-04-20"),
      check: { state: "pass", reason: "Passport accepted the client and a funding source can be debited" },
      canDebit: true,
    },
    programs: [
      { id: IDS.programHealth27, name: "Community Health 2027", description: "Access to primary and preventive care for families in the valley.", fiscalYear: 2027, budgetAmountMinor: 120_000_000, currency: "USD", defaults: { rubricId: IDS.rubricFull, reminderPlan: [-30, -14, -7, 0, 3, 14] }, ...stamp },
      { id: IDS.programHousing27, name: "Housing Stability 2027", description: "Eviction prevention, rapid rehousing and tenant services.", fiscalYear: 2027, budgetAmountMinor: 80_000_000, currency: "USD", defaults: {}, ...stamp },
      { id: IDS.programHealth26, name: "Community Health 2026", description: "The 2026 cycle; awards are in reporting.", fiscalYear: 2026, budgetAmountMinor: 60_000_000, currency: "USD", defaults: {}, ...stamp },
      { id: IDS.programRapid, name: "Rapid Response Fund", description: "Small, fast grants for urgent community needs.", fiscalYear: 2027, budgetAmountMinor: 12_000_000, currency: "USD", defaults: {}, ...stamp },
    ],
    rubrics: riverbendRubrics,
    opportunities: [
      opportunity({
        id: IDS.oppHealth27,
        programId: IDS.programHealth27,
        slug: "community-health-2027",
        title: "Community Health Grants 2027",
        description: "Direct-service projects that improve access to primary and preventive care for families in the valley.",
        funding: { totalAmountAvailable: usd(1_200_000), minAwardAmount: usd(50_000), maxAwardAmount: usd(150_000), minAwardCount: 8, maxAwardCount: 12 },
        keyDates: {
          postDate: day("Opens", "2027-01-15"),
          closeDate: day("Full proposal closes", "2027-04-30"),
          otherDates: { loiClose: day("LOI closes", "2027-02-28"), decision: day("Decisions announced", "2027-05-18"), periodStart: day("Grant period starts", "2027-07-01") },
        },
        acceptedApplicantTypes: ["non_profit_with_501c3", "government_tribal", "government_municipal"],
        eligibilityRules: healthRules,
      }),
      opportunity({
        id: IDS.oppHousing27,
        programId: IDS.programHousing27,
        slug: "housing-stability-2027",
        title: "Housing Stability Grants 2027",
        description: "Eviction prevention, rapid rehousing and tenant services for households at risk of losing housing.",
        funding: { totalAmountAvailable: usd(800_000), minAwardAmount: usd(25_000), maxAwardAmount: usd(100_000), minAwardCount: 6, maxAwardCount: 10 },
        keyDates: { postDate: day("Opens", "2027-03-01"), closeDate: day("Closes", "2027-05-27") },
        acceptedApplicantTypes: ["non_profit_with_501c3", "government_special_district"],
      }),
      opportunity({
        id: IDS.oppRapid,
        programId: IDS.programRapid,
        slug: "rapid-response-fund",
        title: "Rapid Response Fund",
        description: "Small, fast grants for urgent community needs that cannot wait for a scheduled cycle.",
        funding: { maxAwardAmount: usd(10_000), details: "Reviewed monthly. Decision in 30 days." },
        keyDates: {},
        acceptedApplicantTypes: ["non_profit_with_501c3", "nonprofit_without_501c3"],
      }),
      opportunity({
        id: IDS.oppYouth28,
        slug: "youth-opportunity-2028",
        title: "Youth Opportunity 2028",
        description: "Out-of-school programs for ages 12–18. Details are published when the opportunity opens.",
        status: "forecasted",
        funding: { minAwardAmount: usd(20_000), maxAwardAmount: usd(60_000) },
        keyDates: { postDate: day("Opens", "2027-09-01") },
      }),
    ],
    competitions: [
      {
        id: IDS.compHealth27,
        opportunityId: IDS.oppHealth27,
        title: "Community Health Grants 2027",
        description: "Two stages: a short letter of intent, then a full proposal by invitation.",
        instructions: "Start with the letter of intent. Organizations invited to the full proposal have until April 30.",
        status: "open",
        keyDates: {},
        stages: [
          { key: "loi", label: "Letter of intent", forms: { [IDS.formLoi]: 2 }, opens: at("2027-01-15"), closes: at("2027-02-28"), rubricId: IDS.rubricLoi, reviewers: "pool:loi", entryFrom: [], requiresSubmission: true, decisionRequired: true },
          { key: "full", label: "Full proposal", forms: { [IDS.formFull]: 1 }, opens: at("2027-03-08"), closes: at("2027-04-30"), rubricId: IDS.rubricFull, reviewers: "pool:full", entryFrom: ["loi"], requiresSubmission: true, decisionRequired: true },
        ],
        forms: { [IDS.formLoi]: 2, [IDS.formFull]: 1 },
        acceptedApplicantTypes: ["non_profit_with_501c3", "government_tribal", "government_municipal"],
        ...stamp,
      },
    ],
    forms: [
      formFrom(IDS.formLoi, 1, { title: "Letter of intent", publishedAt: at("2026-11-02") }),
      formFrom(IDS.formLoi, 2, { title: "Letter of intent" }),
      formFrom(IDS.formFull, 1, { title: "Full proposal", purpose: "application", description: "Approach, outcomes and the requested amount.", ...structuredClone(FULL_PROPOSAL) }),
    ],
  };

  const cascade: WorkspaceData = {
    record: {
      id: IDS.cascade,
      kind: "funder",
      handle: "cascade-county",
      displayName: "Cascade County Health Department",
      legalName: "Cascade County",
      passportOrgId: "90000000-0000-7000-8000-000000000002",
      verificationLevel: "L2",
      profileSource: "passport",
      verification: { source: "passport", level: "L2" },
      profile: null,
      brand: { ...cascadeFixture!.brand, logoUrl: null },
      settings: { transparency: false },
      status: "active",
    },
    profile: { mission: "Public health grants for community clinics and prevention programs in Cascade County.", website: "https://cascadecounty.example" },
    members: [{ userId: "10000000-0000-4000-8000-000000000001", role: "reviewer", email: "dana.ortiz@riverbendcf.example" }],
    invitations: [],
    passport: { linked: false, passportOrgId: "90000000-0000-7000-8000-000000000002", check: { state: "fail", reason: "Connect Passport to pay. Awards still work without it" }, canDebit: null },
    programs: [],
    rubrics: [],
    opportunities: [
      opportunity({
        id: IDS.oppClinic,
        slug: "community-clinic-capacity",
        title: "Community Clinic Capacity",
        description: "Capacity grants for federally qualified health centers and free clinics serving Cascade County residents.",
        funding: { totalAmountAvailable: usd(600_000), minAwardAmount: usd(40_000), maxAwardAmount: usd(120_000), estimatedAwardCount: 6 },
        keyDates: { postDate: day("Opens", "2027-02-01"), closeDate: day("LOI closes", "2027-06-30") },
        acceptedApplicantTypes: ["non_profit_with_501c3", "government_special_district"],
      }),
    ],
    competitions: [],
    forms: [],
  };

  return {
    workspaces: [riverbend, cascade],
    library: [
      formFrom(IDS.formLibraryLoi, 2, { shared: true, title: "Letter of intent", description: LOI_FORM.description ?? null }),
      formFrom(IDS.formLibraryReport, 1, { shared: true, title: "Progress report", purpose: "report", description: "Outcomes to date, spending against budget and changes to the plan.", ...structuredClone(FULL_PROPOSAL) }),
    ],
    sharedRubrics: [],
  };
}
