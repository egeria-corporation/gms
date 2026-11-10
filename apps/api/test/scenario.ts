// SPDX-License-Identifier: AGPL-3.0-only
// A funder with an open two-stage competition and an applicant linked to Passport, built through
// the same routes a person would use. Shared by the application, inbox and MCP tests.
import { USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, type Harness } from "./helpers.ts";

export const USER_APPLICANT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
export const USER_APPLICANT_EDITOR = "99999999-9999-4999-8999-999999999999";
export const ORG_ALDER = "0193a1c0-0000-7000-8000-0000000000a1";

export const ALDER_ORG = {
  id: ORG_ALDER,
  name: "Alder Creek Family Services",
  orgType: { term: "Nonprofits", class: "Organization types", code: "EA000000" },
  status: { value: "active" },
  identifiers: { "org:us:ein": { id: "001234567" } },
  mission: "Health navigation and family support for rural households in the Alder Creek valley.",
  addresses: { primary: { street1: "418 Mill Road", city: "Alder Creek", stateOrProvince: "OR", country: "US", postalCode: "97000" } },
  emails: { primary: "info@aldercreekfs.example" },
  customFields: {
    verificationLevel: { name: "verificationLevel", fieldType: "string", value: "L3" },
    verifiedAt: { name: "verifiedAt", fieldType: "string", value: "2027-01-12T17:20:00Z" },
    attestation: { name: "attestation", fieldType: "string", value: `https://passport.test/passport/orgs/${ORG_ALDER}/attestation` },
  },
  createdAt: "2026-11-02T18:00:00Z",
  lastModifiedAt: "2027-01-12T17:20:00Z",
};

export const ALDER_PROFILE = {
  orgId: ORG_ALDER,
  handle: "alder-creek",
  level: "L3",
  fields: [
    { path: "/commonApp/irs/subsection", value: "03", source: "irs_bmf", fetchedAt: "2027-01-10T08:00:00Z", confidence: 1, confirmedAt: "2027-01-12T17:20:00Z" },
    { path: "/commonApp/financials/budget", value: 2_400_000, source: "member", fetchedAt: "2027-01-12T17:20:00Z", confidence: 1, confirmedAt: "2027-01-12T17:20:00Z" },
    { path: "/commonApp/financials/totalRevenue", value: 2_310_000, source: "irs_990", fetchedAt: "2027-01-10T08:00:00Z", confidence: 0.95, confirmedAt: "2027-01-12T17:20:00Z" },
  ],
};

export interface Scenario {
  funder: Record<string, string>;
  applicant: Record<string, string>;
  editor: Record<string, string>;
  oppId: string;
  compId: string;
  loiFormId: string;
  fullFormId: string;
  /** Bare UUIDs, as the protocol routes speak them. */
  uuid: { opp: string; comp: string; loi: string; full: string };
  json: <T>(res: Response) => Promise<T>;
  call: <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
}

export async function scenario(h: Harness): Promise<Scenario> {
  const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
  const funder = await headers(USER_OFFICER, WS_FUNDER);
  const admin = await headers(USER_ADMIN, WS_FUNDER);
  const call: Scenario["call"] = async (who, method, path, body) => {
    const res = await h.request(path, { method, headers: who, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json().catch(() => null)) as never };
  };
  const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
    const r = await call<{ data: T }>(who, method, path, body ?? {});
    if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data;
  };

  // The applicant workspace is already linked to Passport: its record is cached.
  await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { passport_org_id: ORG_ALDER, org_projection: ALDER_ORG, org_projection_at: "2027-04-16T16:00:00Z", profile_projection: { level: "L3", fields: ALDER_PROFILE.fields }, profile_projection_at: "2027-04-16T16:00:00Z", verification_level: "L3", legal_name: ALDER_ORG.name });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT, role: "admin" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT_EDITOR, role: "editor" });

  const opp = await data<{ id: string }>(funder, "POST", "/gms/opportunities", {
    title: "Community Health Grants 2027",
    description: "Grants for community health navigation in Riverbend County.",
    funding: { totalAmountAvailable: { amount: "1200000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" } },
    keyDates: { closeDate: { name: "Full proposal deadline", eventType: "singleDate", date: "2027-04-30" } },
    acceptedApplicantTypes: ["non_profit_with_501c3"],
    eligibilityRules: {
      all: [
        { path: "profile.commonApp.irs.subsection", op: "in", value: ["03"], missing: "unknown", label: "Nonprofit organization" },
        { path: "org.addresses.primary.stateOrProvince", op: "in", value: ["OR", "WA"], label: "Serves the region" },
        { path: "profile.commonApp.financials.budget", op: "lt", value: 5_000_000, missing: "unknown", label: "Annual budget under $5M" },
      ],
    },
  });
  const loi = await data<{ id: string }>(funder, "POST", "/gms/forms", {
    title: "Letter of intent",
    purpose: "loi",
    jsonSchema: {
      type: "object",
      properties: {
        legalName: { type: "string" },
        annualBudget: { type: "number" },
        projectTitle: { type: "string", minLength: 3 },
        requestedAmount: { type: "object", properties: { amount: { type: "string" }, currency: { type: "string" } }, required: ["amount", "currency"] },
        need: { type: "string" },
      },
      required: ["legalName", "projectTitle", "requestedAmount"],
    },
    uiSchema: {
      type: "VerticalLayout",
      elements: [
        { type: "Control", scope: "#/properties/legalName", options: { widget: "passportField" } },
        { type: "Control", scope: "#/properties/annualBudget" },
        { type: "Control", scope: "#/properties/projectTitle" },
        { type: "Control", scope: "#/properties/requestedAmount" },
        { type: "Control", scope: "#/properties/need", options: { pii: true } },
      ],
    },
    mappingFromCommonGrants: { legalName: { field: "name" }, annualBudget: { field: "profile.commonApp.financials.budget" } },
    mappingToCommonGrants: { title: { field: "projectTitle" }, requestedAmount: { field: "requestedAmount" } },
  });
  await data(funder, "POST", `/gms/forms/${loi.id}/publish`);
  const full = await data<{ id: string }>(funder, "POST", "/gms/forms", {
    title: "Full proposal",
    purpose: "application",
    jsonSchema: { type: "object", properties: { legalName: { type: "string" }, approach: { type: "string", minLength: 10 } }, required: ["approach"] },
    uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/legalName" }, { type: "Control", scope: "#/properties/approach" }] },
    mappingFromCommonGrants: { legalName: { field: "name" } },
  });
  await data(funder, "POST", `/gms/forms/${full.id}/publish`);
  const rubric = await data<{ id: string }>(funder, "POST", "/gms/rubrics", { name: "LOI screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] });
  const comp = await data<{ id: string }>(funder, "POST", "/gms/competitions", { opportunityId: opp.id, title: "Community Health Grants 2027", description: "Two stages." });
  await data(funder, "PUT", `/gms/competitions/${comp.id}/stages`, {
    stages: [
      { key: "loi", label: "Letter of intent", forms: { [loi.id]: 1 }, opens: "2027-02-01T08:00:00Z", closes: "2027-04-30T00:00:00Z", rubricId: rubric.id },
      { key: "full", label: "Full proposal", forms: { [full.id]: 1 }, opens: "2027-03-01T08:00:00Z", closes: "2027-05-30T00:00:00Z", rubricId: rubric.id, entryFrom: ["loi"] },
    ],
  });
  await data(funder, "POST", `/gms/opportunities/${opp.id}/publish`);
  await data(funder, "POST", `/gms/competitions/${comp.id}/open`);
  void admin;
  return {
    funder,
    applicant: await headers(USER_APPLICANT, WS_APPLICANT),
    editor: await headers(USER_APPLICANT_EDITOR, WS_APPLICANT),
    oppId: opp.id,
    compId: comp.id,
    loiFormId: loi.id,
    fullFormId: full.id,
    uuid: { opp: opp.id.slice(4), comp: comp.id.slice(4), loi: loi.id.slice(4), full: full.id.slice(4) },
    json: async (res) => (await res.json()) as never,
    call,
  };
}
