// SPDX-License-Identifier: AGPL-3.0-only
// Open data exports (docs/open-data.md): the 360Giving file validates against 360Giving's own JSON
// schema (bundled in fixtures/360giving, CC BY 4.0), every CommonGrants record against
// `@common-grants/sdk`; confidential awards, awards to individuals and unlinked recipients stay
// out; a recipient that is not verified and shared goes out by name only; without a prefix the
// export is a draft; the public feed is off by default; agents read counts and never publish.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseCsv } from "@gms/importers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CSV_COLUMNS, rangeOf } from "../src/services/open-data.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/360giving/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
const GRANT_SCHEMA = fixture("360-giving-schema.json");
const PACKAGE_SCHEMA = fixture("360-giving-package-schema.json");

/** 360Giving's schemas name `http://json-schema.org/draft/2020-12/schema`; Ajv knows the https spelling. They are otherwise used as published. */
function threeSixtyGivingValidators() {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  const bare = ({ $schema: _s, ...rest }: Record<string, unknown>) => rest;
  ajv.addSchema(bare(GRANT_SCHEMA));
  // The package schema refers to the grant schema by the 1.4.2 `$id` it was written with.
  ajv.addSchema({ ...bare(GRANT_SCHEMA), $id: String(GRANT_SCHEMA.$id).replace("/1.4.3/", "/1.4.2/") });
  return { grant: ajv.getSchema(String(GRANT_SCHEMA.$id)) as ValidateFunction, pkg: ajv.compile(bare(PACKAGE_SCHEMA)) as ValidateFunction };
}

// `@common-grants/sdk` is @gms/protocol's dependency: load the same schemas the projections use.
const sdk = async () => {
  const req = createRequire(new URL("../../../packages/protocol/package.json", import.meta.url));
  return (await import(pathToFileURL(req.resolve("@common-grants/sdk/schemas")).href)) as { AwardBaseSchema: ZodType; OpportunityBaseSchema: ZodType };
};

const WS_SELF = "44444444-4444-4444-8444-444444444444";
const WS_HIDDEN = "55555555-5555-4555-8555-555555555555";
const WS_PERSON = "66666666-6666-4666-8666-666666666666";
const USER_REVIEWER = "77777777-7777-4777-8777-777777777777";
const ORG_ALDER = "0193a1c0-0000-7000-8000-0000000000a1";
const ORG_HIDDEN = "0193a1c0-0000-7000-8000-0000000000b2";
const ORG_RIVERBEND = "0190a000-0000-7000-8000-000000000001";
const PREFIX = "360G-riverbend";

let h: Harness;
let admin: Record<string, string>;
let officer: Record<string, string>;
const awardIds: Record<string, string> = {};

const headers = async (user: string, ws = WS_FUNDER) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const call = async (who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const res = await h.request(path, { method, headers: who, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json: json as Record<string, unknown> & { data?: Record<string, unknown> } };
};
const summary = async (query = "") => {
  const r = await call(officer, "GET", `/gms/open-data/summary${query}`);
  expect(r.status, r.text.slice(0, 300)).toBe(200);
  return r.json.data as {
    draft: boolean;
    registerUrl: string;
    feedUrl: string | null;
    settings: { threeSixtyGivingPrefix: string | null; publishFeed: boolean };
    counts: { inRange: number; exported: number; leftOut: number; nameOnly: number };
    leftOut: { reason: string; label: string; count: number }[];
    commonGrants: { opportunities: number; awards: number };
    awards: { awardId: string; title: string; recipientName: string; exported: boolean; reason: string | null; reasonLabel: string | null; nameOnly: boolean; confidential: boolean }[];
  };
};
const setPrefix = (prefix: string | null) => call(admin, "PUT", "/gms/open-data/settings", { threeSixtyGivingPrefix: prefix });
type Grant = { id: string; title: string; recipientOrganization: Record<string, string>[]; fundingOrganization: Record<string, string>[]; amountAwarded: number; awardDate: string; plannedDates?: unknown; grantProgramme?: { code: string; title: string }[] };
const pkg = async (query = "") => {
  const r = await call(officer, "GET", `/gms/open-data/360giving.json${query}`);
  expect(r.status, r.text.slice(0, 300)).toBe(200);
  return { ...r, pkg: r.json as unknown as { title: string; description: string; publisher: { name: string; identifier: string }; downloadURL?: string; grants: Grant[] } };
};
const byTitle = (grants: Grant[], title: string) => grants.find((g) => g.title === title);

async function award(key: string, row: { status: string; recipient?: string | null; individual?: Record<string, unknown> | null; amount?: string | null; date?: string; program?: string | null; description?: string | null }) {
  const a = await h.repos.table("awards").insert({
    workspace_id: WS_FUNDER,
    title: key,
    description: row.description === undefined ? `${key}: community health navigation.` : row.description,
    status: row.status,
    recipient_workspace_id: row.recipient === undefined ? WS_APPLICANT : row.recipient,
    recipient_individual: (row.individual ?? null) as never,
    program_id: row.program ?? null,
    funding: (row.amount === null ? {} : { awardedAmount: { amount: row.amount ?? "50000.00", currency: "USD" } }) as never,
    key_dates: { awardDate: { name: "Award date", eventType: "singleDate", date: row.date ?? "2027-03-01" }, periodOfPerformance: { name: "Period of performance", eventType: "dateRange", startDate: "2027-04-01", endDate: "2028-03-31" } } as never,
  });
  awardIds[key] = a.id;
  return a;
}

beforeEach(async () => {
  h = await harness();
  admin = await headers(USER_ADMIN);
  officer = await headers(USER_OFFICER);
  const ws = h.repos.table("workspaces");
  // The funder: linked to Passport, with its EIN on file.
  await ws.update({ id: WS_FUNDER }, { legal_name: "Riverbend Community Foundation", ein: "381234567", passport_org_id: ORG_RIVERBEND, profile_source: "passport", org_projection: { id: ORG_RIVERBEND, name: "Riverbend Community Foundation", socials: { website: "https://riverbendcf.example" } } as never });
  // Verified with Passport and sharing its record with the funder.
  await ws.update(
    { id: WS_APPLICANT },
    {
      passport_org_id: ORG_ALDER,
      profile_source: "passport",
      legal_name: "Alder Creek Family Services, Inc.",
      ein: "941234567",
      verification_level: "L3",
      org_projection: { id: ORG_ALDER, name: "Alder Creek Family Services, Inc.", identifiers: { "org:us:ein": { id: "941234567" } }, addresses: { primary: { street1: "418 Mill Road", city: "Alder Creek", stateOrProvince: "OR", postalCode: "97000", country: "US" } }, socials: { website: "https://aldercreekfs.example" } } as never,
    },
  );
  await h.repos.table("consents").insert({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_FUNDER, basis: "application", granted_at: "2027-01-01T00:00:00Z" });
  // Self-declared: not verified. Its declared EIN and address never go out.
  await ws.insert({ id: WS_SELF, kind: "applicant", handle: "maple-hollow", display_name: "Maple Hollow Food Bank", profile_source: "self_declared", self_declared_profile: { legalName: "Maple Hollow Food Bank", ein: "941111111", orgType: "non_profit_with_501c3", address: { street: "12 Orchard Lane", city: "Maple Hollow", region: "OR", postalCode: "97001", country: "US" } } as never });
  // Verified with Passport but not sharing its record with this funder.
  await ws.insert({ id: WS_HIDDEN, kind: "applicant", handle: "cedar-row", display_name: "Cedar Row Youth", passport_org_id: ORG_HIDDEN, profile_source: "passport", legal_name: "Cedar Row Youth Collective", ein: "941222222", verification_level: "L2", org_projection: { id: ORG_HIDDEN, name: "Cedar Row Youth Collective", addresses: { primary: { street1: "7 Birch St", city: "Cedar Row", stateOrProvince: "WA", postalCode: "98000", country: "US" } } } as never });
  // A workspace that declared itself an individual.
  await ws.insert({ id: WS_PERSON, kind: "applicant", handle: "sam-artist", display_name: "Sam Rivera", profile_source: "self_declared", self_declared_profile: { legalName: "Sam Rivera", orgType: "individual" } as never });
  const program = await h.repos.table("programs").insert({ workspace_id: WS_FUNDER, name: "Community Health" });

  await award("Navigator program", { status: "active", program: program.id });
  await award("Completed clinic", { status: "completed", amount: "125000.50", date: "2026-06-15" });
  await award("Food bank shelves", { status: "accepted", recipient: WS_SELF });
  await award("Youth mentoring", { status: "suspended", recipient: WS_HIDDEN });
  await award("Offer pending", { status: "offered" });
  await award("Cancelled grant", { status: "cancelled" });
  await award("Studio residency", { status: "active", recipient: null, individual: { name: "Jordan Lee" } });
  await award("Imported 2019 grant", { status: "completed", recipient: null, individual: { name: "Old Records Org", imported: true } });
  await award("Artist stipend", { status: "active", recipient: WS_PERSON });
  await award("Missing amount", { status: "active", amount: null });
  await award("Quiet grant", { status: "active" });
  // Another funder's award never appears.
  await h.repos.table("awards").insert({ workspace_id: WS_OTHER, title: "Someone else's", status: "active", recipient_workspace_id: WS_APPLICANT, funding: { awardedAmount: { amount: "1.00", currency: "USD" } } as never });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: USER_REVIEWER, role: "reviewer" });
  // A published opportunity for the CommonGrants export.
  await h.repos.table("opportunities").insert({ workspace_id: WS_FUNDER, slug: "community-health-2027", title: "Community Health Grants 2027", description: "Grants for community health navigation.", status: "open", published_at: "2027-02-01T12:00:00Z", funding: { totalAmountAvailable: { amount: "1200000.00", currency: "USD" } } as never });
  // The funder marks one award confidential, as a person.
  const conf = await call(officer, "PUT", `/gms/open-data/awards/awd_${awardIds["Quiet grant"]}/confidential`, { confidential: true });
  expect(conf.status, conf.text).toBe(200);
});

describe("the rule: what goes out and what stays out", () => {
  it("counts exported awards and gives the reason for each one left out", async () => {
    const s = await summary();
    expect(s.counts).toEqual({ inRange: 11, exported: 4, leftOut: 7, nameOnly: 2 });
    expect(Object.fromEntries(s.leftOut.map((r) => [r.reason, r.count]))).toEqual({ not_accepted: 1, cancelled: 1, individual: 2, no_organization: 1, confidential: 1, no_amount: 1 });
    expect(s.leftOut.find((r) => r.reason === "confidential")?.label).toBe("Marked confidential");
    const row = (t: string) => s.awards.find((a) => a.title === t)!;
    expect(row("Quiet grant")).toMatchObject({ exported: false, reason: "confidential", confidential: true });
    expect(row("Food bank shelves")).toMatchObject({ exported: true, nameOnly: true });
    expect(row("Navigator program")).toMatchObject({ exported: true, nameOnly: false, recipientName: "Alder Creek Family Services, Inc." });
    // Never a person's name, in the export or on the panel.
    expect(row("Studio residency").recipientName).toBe("An individual");
    expect(row("Artist stipend").recipientName).toBe("An individual");
    expect(row("Imported 2019 grant").recipientName).toBe("Not linked to an organization");
    expect(JSON.stringify(s)).not.toContain("Jordan Lee");
    expect(JSON.stringify(s)).not.toContain("Sam Rivera");
    expect(s.awards.map((a) => a.title)).not.toContain("Someone else's");
  });

  it("names a verified, sharing recipient by its Passport record and everyone else by name only", async () => {
    await setPrefix(PREFIX);
    const { pkg: p } = await pkg();
    expect(p.grants.map((g) => g.title).sort()).toEqual(["Completed clinic", "Food bank shelves", "Navigator program", "Youth mentoring"]);
    const verified = byTitle(p.grants, "Navigator program")!;
    expect(verified.recipientOrganization[0]).toEqual({ id: "US-EIN-94-1234567", name: "Alder Creek Family Services, Inc.", streetAddress: "418 Mill Road", addressLocality: "Alder Creek", addressRegion: "OR", postalCode: "97000", addressCountry: "US", url: "https://aldercreekfs.example" });
    expect(verified.fundingOrganization[0]).toEqual({ id: "US-EIN-38-1234567", name: "Riverbend Community Foundation" });
    expect(verified.grantProgramme?.[0]?.title).toBe("Community Health");
    // Self-declared: a local identifier and the name; no EIN, no address.
    expect(byTitle(p.grants, "Food bank shelves")!.recipientOrganization[0]).toEqual({ id: `${PREFIX}-${WS_SELF}`, name: "Maple Hollow Food Bank" });
    // Verified but not shared: the workspace's own name, never the Passport legal name, EIN or address.
    expect(byTitle(p.grants, "Youth mentoring")!.recipientOrganization[0]).toEqual({ id: `${PREFIX}-${WS_HIDDEN}`, name: "Cedar Row Youth" });
    const text = JSON.stringify(p);
    for (const hidden of ["941111111", "94-1111111", "12 Orchard Lane", "941222222", "94-1222222", "7 Birch St", "Cedar Row Youth Collective", "Jordan Lee", "Sam Rivera", "Old Records Org", "Quiet grant", "Offer pending", "Cancelled grant"]) expect(text, hidden).not.toContain(hidden);
    expect(byTitle(p.grants, "Navigator program")!.id).toBe(`${PREFIX}-${awardIds["Navigator program"]}`);
    expect(byTitle(p.grants, "Completed clinic")!.amountAwarded).toBe(125000.5);
  });

  it("filters by award year or date range", async () => {
    expect((await summary("?year=2026")).awards.map((a) => a.title)).toEqual(["Completed clinic"]);
    expect((await summary("?from=2027-01-01&to=2027-12-31")).counts.inRange).toBe(10);
    expect((await call(officer, "GET", "/gms/open-data/summary?from=2027-12-31&to=2027-01-01")).status).toBe(400);
    expect((await call(officer, "GET", "/gms/open-data/summary?year=27")).status).toBe(400);
    expect((await call(officer, "GET", "/gms/open-data/summary?from=2027-02-30")).status).toBe(400);
    expect(rangeOf({ year: "2027" })).toEqual({ from: "2027-01-01", to: "2027-12-31" });
    expect(rangeOf({})).toEqual({ from: null, to: null });
  });

  it("lets a person clear the confidential mark, and never lets an agent or API client set it", async () => {
    const unmark = await call(officer, "PUT", `/gms/open-data/awards/awd_${awardIds["Quiet grant"]}/confidential`, { confidential: false });
    expect(unmark.json.data).toEqual({ awardId: `awd_${awardIds["Quiet grant"]}`, confidential: false });
    expect((await summary()).counts.exported).toBe(5);
    expect((await h.ledger.list({ workspaceId: WS_FUNDER, eventType: "open_data.award_unmarked_confidential" })).length).toBe(1);
    const client = await clientCredentialsToken(h, "workspace:admin awards:read");
    const viaClient = await call({ ...bearer(client).headers, "Content-Type": "application/json" }, "PUT", `/gms/open-data/awards/awd_${awardIds["Quiet grant"]}/confidential`, { confidential: true });
    expect(viaClient.status).toBe(403);
    // Another funder's award is not found, not forbidden.
    const other = (await h.repos.table("awards").find({ workspace_id: WS_OTHER }))[0]!;
    expect((await call(officer, "PUT", `/gms/open-data/awards/awd_${other.id}/confidential`, { confidential: true })).status).toBe(404);
  });
});

describe("360Giving files", () => {
  let validators: ReturnType<typeof threeSixtyGivingValidators>;
  beforeAll(() => {
    validators = threeSixtyGivingValidators();
  });

  it("the JSON package and every grant validate against the 360Giving schema", async () => {
    await setPrefix(PREFIX);
    const r = await pkg();
    expect(r.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="360giving-riverbend-all.json"');
    expect(r.headers.get("X-Open-Data-Draft")).toBeNull();
    // The validators do reject what 360Giving would: a grant without its recipient, a package without grants.
    expect(validators.grant({ ...r.pkg.grants[0], recipientOrganization: undefined })).toBe(false);
    expect(validators.pkg({ ...r.pkg, grants: [] })).toBe(false);
    validators.pkg(r.pkg);
    expect(validators.pkg.errors ?? []).toEqual([]);
    for (const g of r.pkg.grants) {
      validators.grant(g);
      expect(validators.grant.errors ?? [], g.title).toEqual([]);
    }
    expect(r.pkg.publisher).toEqual({ name: "Riverbend Community Foundation", identifier: "US-EIN-38-1234567", website: "https://riverbendcf.example" });
    // The ten required fields, by their spreadsheet titles.
    const required = (GRANT_SCHEMA.oneOf as { required: string[] }[])[0]!.required;
    for (const g of r.pkg.grants) for (const k of required) expect(g, k).toHaveProperty(k);
  });

  it("the CSV uses the 360Giving column titles and holds the same grants", async () => {
    await setPrefix(PREFIX);
    const csv = await call(officer, "GET", "/gms/open-data/360giving.csv?year=2027");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const [header, ...rows] = parseCsv(csv.text);
    expect(header).toEqual(CSV_COLUMNS.map(([t]) => t));
    // Every column title is the schema's own: "<property title>" or "<array title>:<field title>".
    const props = GRANT_SCHEMA.properties as Record<string, { title?: string; items?: { $ref: string }; $ref?: string }>;
    const defs = GRANT_SCHEMA.$defs as Record<string, { properties: Record<string, { title?: string }> }>;
    const titles = new Set<string>();
    for (const p of Object.values(props)) {
      if (p.title) titles.add(p.title);
      const ref = p.items?.$ref;
      if (p.title && ref) for (const f of Object.values(defs[ref.split("/").pop()!]!.properties)) if (f.title) titles.add(`${p.title}:${f.title}`);
    }
    titles.add("Currency");
    for (const t of header!) expect(titles.has(t), t).toBe(true);
    // Read back into JSON by those titles, the rows are valid grants too.
    const json = await pkg("?year=2027");
    expect(rows).toHaveLength(json.pkg.grants.length);
    const col = (row: string[], t: string) => row[header!.indexOf(t)] ?? "";
    for (const row of rows) {
      const grant = { id: col(row, "Identifier"), title: col(row, "Title"), description: col(row, "Description"), currency: col(row, "Currency"), amountAwarded: Number(col(row, "Amount Awarded")), awardDate: col(row, "Award Date"), recipientOrganization: [{ id: col(row, "Recipient Org:Identifier"), name: col(row, "Recipient Org:Name") }], fundingOrganization: [{ id: col(row, "Funding Org:Identifier"), name: col(row, "Funding Org:Name") }] };
      validators.grant(grant);
      expect(validators.grant.errors ?? []).toEqual([]);
      expect(json.pkg.grants.map((g) => g.id)).toContain(grant.id);
    }
    expect(csv.text).not.toContain("12 Orchard Lane");
  });

  it("without a registered prefix the export is a draft that 360Giving's checker would refuse", async () => {
    const s = await summary();
    expect(s.draft).toBe(true);
    expect(s.registerUrl).toBe("https://www.360giving.org/publish/guidance/plan/register/");
    const r = await pkg();
    expect(r.headers.get("X-Open-Data-Draft")).toBe("true");
    expect(r.headers.get("Content-Disposition")).toContain("-DRAFT.json");
    expect(r.pkg.title.startsWith("DRAFT: ")).toBe(true);
    expect(r.pkg.description).toContain("Not for publication");
    for (const g of r.pkg.grants) expect(g.id.startsWith("DRAFT-riverbend-")).toBe(true);
    // Still valid against the schema: the draft is a preview of the real file.
    validators.pkg(r.pkg);
    expect(validators.pkg.errors ?? []).toEqual([]);
    expect((await setPrefix("riverbend")).status).toBe(400);
    expect((await setPrefix(PREFIX)).status).toBe(200);
    expect((await summary()).draft).toBe(false);
  });

  it("answers 409 when nothing in the period can be exported", async () => {
    const r = await call(officer, "GET", "/gms/open-data/360giving.json?year=2020");
    expect(r.status).toBe(409);
    expect(r.json.errors ?? r.json).toBeTruthy();
  });
});

describe("CommonGrants export", () => {
  it("every opportunity and award validates with @common-grants/sdk and adds no fields outside customFields", async () => {
    const r = await call(officer, "GET", "/gms/open-data/commongrants.json");
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    const out = r.json as unknown as { commonGrants: string; opportunities: Record<string, unknown>[]; awards: Record<string, unknown>[] };
    expect(out.commonGrants).toBe("0.5.0");
    const { AwardBaseSchema, OpportunityBaseSchema } = await sdk();
    expect(out.opportunities).toHaveLength(1);
    for (const o of out.opportunities) expect(OpportunityBaseSchema.safeParse(o).success, JSON.stringify(o).slice(0, 200)).toBe(true);
    expect(out.awards.map((a) => a.title).sort()).toEqual(["Completed clinic", "Food bank shelves", "Navigator program", "Youth mentoring"]);
    for (const a of out.awards) {
      const parsed = AwardBaseSchema.safeParse(a);
      expect(parsed.success, JSON.stringify(a).slice(0, 200)).toBe(true);
      // AwardBase has no customFields and the GMS never adds one.
      expect(a).not.toHaveProperty("customFields");
      expect(a).not.toHaveProperty("recipientIndividual");
    }
    const recipientOf = (t: string) => out.awards.find((a) => a.title === t)!.recipientOrganizations as { primary: { id: string; name: string } } | undefined;
    expect(recipientOf("Navigator program")?.primary).toMatchObject({ id: ORG_ALDER, name: "Alder Creek Family Services, Inc." });
    // Not verified and shared: no organization reference at all.
    expect(recipientOf("Food bank shelves")).toBeUndefined();
    expect(recipientOf("Youth mentoring")).toBeUndefined();
    expect(r.text).not.toContain(ORG_HIDDEN);
    expect((await summary()).commonGrants).toEqual({ opportunities: 1, awards: 4 });
  });
});

describe("the public feed", () => {
  const feed = (init?: RequestInit) => h.request("/gms/open-data/riverbend/360giving.json", init);

  it("is off by default, needs a prefix to switch on, and then serves only what the export would", async () => {
    expect((await summary()).settings).toEqual({ threeSixtyGivingPrefix: null, publishFeed: false });
    expect((await feed()).status).toBe(404);
    const noPrefix = await call(admin, "PUT", "/gms/open-data/settings", { publishFeed: true });
    expect(noPrefix.status).toBe(409);
    expect((await feed()).status).toBe(404);
    // A prefix alone does not publish anything.
    await setPrefix(PREFIX);
    expect((await feed()).status).toBe(404);
    const on = await call(admin, "PUT", "/gms/open-data/settings", { publishFeed: true });
    expect(on.json.data).toEqual({ threeSixtyGivingPrefix: PREFIX, publishFeed: true, feedUrl: "https://gms.test/gms/open-data/riverbend/360giving.json" });
    expect((await summary()).feedUrl).toBe("https://gms.test/gms/open-data/riverbend/360giving.json");

    const res = await feed();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=900");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const etag = res.headers.get("ETag");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const body = (await res.json()) as { grants: Grant[]; downloadURL: string };
    const exported = (await pkg()).pkg;
    expect(body.grants.map((g) => g.id)).toEqual(exported.grants.map((g) => g.id));
    expect(body.downloadURL).toBe("https://gms.test/gms/open-data/riverbend/360giving.json");
    expect(JSON.stringify(body)).not.toContain("Quiet grant");
    const v = threeSixtyGivingValidators();
    v.pkg(body);
    expect(v.pkg.errors ?? []).toEqual([]);
    // Cached: the same body answers 304 to its ETag.
    expect((await feed({ headers: { "If-None-Match": etag! } })).status).toBe(304);
    // Read-only.
    expect((await feed({ method: "POST" })).status).not.toBe(200);
    // Removing the prefix while the feed is on is refused; turning it off stops the feed.
    expect((await setPrefix(null)).status).toBe(409);
    await call(admin, "PUT", "/gms/open-data/settings", { publishFeed: false });
    expect((await feed()).status).toBe(404);
    expect((await h.ledger.list({ workspaceId: WS_FUNDER, eventType: "open_data.settings_updated" })).length).toBe(3);
  });

  it("is switched on only by a workspace admin in person", async () => {
    await setPrefix(PREFIX);
    expect((await call(officer, "PUT", "/gms/open-data/settings", { publishFeed: true })).status).toBe(403);
    const client = await clientCredentialsToken(h, "workspace:admin awards:read");
    const viaClient = await call({ ...bearer(client).headers, "Content-Type": "application/json" }, "PUT", "/gms/open-data/settings", { publishFeed: true });
    expect(viaClient.status).toBe(403);
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "workspace:admin analytics:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-open-data" });
    const viaAgent = await call({ ...bearer(agent).headers, "Content-Type": "application/json" }, "PUT", "/gms/open-data/settings", { publishFeed: true });
    expect(viaAgent.status).toBe(403);
    expect((await feed()).status).toBe(404);
    expect((await call(admin, "PUT", "/gms/open-data/settings", { publishFeed: true, extra: 1 })).status).toBe(400);
  });

  it("answers 404 for an unknown handle and for an applicant workspace", async () => {
    expect((await h.request("/gms/open-data/nobody/360giving.json")).status).toBe(404);
    expect((await h.request("/gms/open-data/alder-creek/360giving.json")).status).toBe(404);
  });
});

describe("who may read the export", () => {
  it("funder staff who read reports; not reviewers, not applicants", async () => {
    expect((await call(await headers(USER_AUDITOR), "GET", "/gms/open-data/summary")).status).toBe(200);
    expect((await call(await headers(USER_REVIEWER), "GET", "/gms/open-data/summary")).status).toBe(403);
    expect((await call(await headers(USER_OFFICER, WS_APPLICANT), "GET", "/gms/open-data/summary")).status).toBe(403);
    expect((await h.request("/gms/open-data/summary")).status).toBe(401);
  });

  it("an agent reads the counts over MCP, with no award list and no tool that publishes", async () => {
    const agent = await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "analytics:read awards:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-open-data-mcp" });
    const rpc = async (method: string, params: Record<string, unknown>) => {
      const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${agent}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return ((await res.json()) as { result: { isError?: boolean; structuredContent?: Record<string, unknown>; tools?: { name: string }[] } }).result;
    };
    const out = await rpc("tools/call", { name: "open_data_summary", arguments: { year: 2027 } });
    expect(out.isError).toBe(false);
    expect(out.structuredContent).toMatchObject({ counts: { inRange: 10, exported: 3, leftOut: 7 }, draft: true });
    expect(out.structuredContent).not.toHaveProperty("awards");
    const tools = (await rpc("tools/list", {})).tools!.map((t) => t.name);
    expect(tools).toContain("open_data_summary");
    expect(tools.filter((t) => t.includes("open_data"))).toEqual(["open_data_summary"]);
  });
});
