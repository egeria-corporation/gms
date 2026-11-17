// SPDX-License-Identifier: AGPL-3.0-only
// Imported history over /gms/imports and /gms/history (v1.12.0): a funder's past applications,
// reviews and reports, from Submittable and Bonterra CyberGrants exports. Each is linked to its
// award by the export's own id, then by exact name, never by a guess; a review waits for its
// application by the id; contact details and bank or identity data are never stored; history never
// becomes a live application, review, decision, payment or requirement; only the funder's staff
// read it (never a reviewer, a grantee, a fund advisor outside its funds, or a token without the
// scope); and the report builder's "Imported history" data set carries no reviewer or contact column.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

const USER_REVIEWER = "46464646-4646-4646-8646-464646464601";
const USER_GUEST = "46464646-4646-4646-8646-464646464602";
const USER_ADVISOR = "46464646-4646-4646-8646-464646464603";
const USER_GRANTEE = "46464646-4646-4646-8646-464646464604";
/** Made at run time; no file holds a value of this shape. */
const NINE = ["900", "00", "0001"].join("");
const LONG = ["0000", "0000", "0012"].join("");
const fixture = (name: string) =>
  readFileSync(new URL(`../../../packages/importers/test/fixtures/adapters/${name}`, import.meta.url), "utf8")
    .replace("{NINE}", NINE)
    .replace("{LONG}", LONG);

let h: Harness;
let admin: Record<string, string>;
const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
async function call<T>(who: Record<string, string>, method: string, path: string, body?: unknown) {
  const res = await h.request(path, { method, headers: who, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as { data: T; errors?: { code: string }[] } };
}
async function data<T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> {
  const r = await call<T>(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}

type Run = { id: string; target: string; reconciliation: { create: number; skip: number; error: number }; dropped: { column: string }[]; adapter: { key: string } | null };

/** Read, check and import a file into a target, as the import screen does. */
async function importFile(target: string, file: string, adapter?: string, mapping?: Record<string, string>) {
  const source = { kind: "csv", text: fixture(file), fileName: file };
  const read = await data<{ mapping: Record<string, string>; adapter: { key: string } | null }>(admin, "POST", "/gms/imports/read", { target, source, ...(adapter ? { adapter } : {}) });
  const preview = await data<{ run: Run; rows: { outcome: string; reason: string | null }[] }>(admin, "POST", "/gms/imports/preview", { target, source, mapping: mapping ?? read.mapping, ...(adapter ? { adapter } : {}) });
  for (let i = 0; i < 100; i++) {
    const c = await data<{ done: boolean; run: Run }>(admin, "POST", `/gms/imports/runs/${preview.run.id}/commit`);
    if (c.done) return { read, preview, run: c.run };
  }
  throw new Error("the import did not finish");
}
const csvImport = async (target: string, text: string, mapping: Record<string, string>) => {
  const source = { kind: "csv", text, fileName: "plain.csv" };
  const preview = await data<{ run: Run }>(admin, "POST", "/gms/imports/preview", { target, source, mapping });
  for (let i = 0; i < 100; i++) if ((await data<{ done: boolean }>(admin, "POST", `/gms/imports/runs/${preview.run.id}/commit`)).done) return preview.run;
  throw new Error("the import did not finish");
};

const t = (name: Parameters<Harness["repos"]["table"]>[0]) => h.repos.table(name);
async function liveCounts() {
  const tables = ["applications", "review_assignments", "reviews", "decisions", "tranches", "payment_schedules", "requirements", "submissions"] as const;
  return Object.fromEntries(await Promise.all(tables.map(async (x) => [x, await t(x).count({})] as const)));
}

beforeEach(async () => {
  h = await harness();
  for (const [user, role, scope] of [[USER_REVIEWER, "reviewer", {}], [USER_GUEST, "external_reviewer", {}], [USER_ADVISOR, "program_officer", { fundIds: [] }]] as const) await t("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: user, role, scope: scope as never });
  await t("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_GRANTEE, role: "admin" });
  admin = await headers(USER_ADMIN, WS_FUNDER);
});

describe("past applications and reviews from Submittable", () => {
  it("link to the award the grant history import made from the same id, and reviews to their application", async () => {
    const before = await liveCounts();
    await importFile("award_history", "submittable.csv", "submittable");
    const awards = await t("awards").find({ workspace_id: WS_FUNDER });
    const van = awards.find((a) => a.title === "Clinic van")!;
    const afterAwards = await liveCounts();

    const apps = await importFile("history_applications", "submittable-applications.csv");
    expect(apps.read.adapter).toEqual({ key: "submittable", system: "Submittable" });
    expect(apps.preview.run.dropped.map((d) => d.column)).toEqual(["Bank acct", "Reference"]);
    expect(apps.run.reconciliation).toMatchObject({ create: 3, skip: 0, error: 0 });
    const past = await t("history_applications").find({ workspace_id: WS_FUNDER });
    const byTitle = new Map(past.map((p) => [p.title, p]));
    expect(byTitle.get("Clinic van")).toMatchObject({ award_id: van.id, outcome: "awarded", outcome_label: "Accepted", requested_amount_minor: 4_500_000, awarded_amount_minor: 4_000_000, source_system: "submittable", call_title: "Health 2024" });
    // A declined or withdrawn application leads to no award.
    expect(byTitle.get("After-school tutors")).toMatchObject({ award_id: null, outcome: "declined" });
    expect(byTitle.get("Mural walk")).toMatchObject({ award_id: null, outcome: "withdrawn" });
    expect(byTitle.get("Clinic van")!.answers).toEqual([
      { question: "Project summary", answer: "A mobile clinic for rural families. Write to [email removed]" },
      { question: "How many people will you serve?", answer: "1200" },
    ]);

    const reviews = await importFile("history_reviews", "submittable-reviews.csv", "submittable");
    expect(reviews.run.reconciliation).toMatchObject({ create: 4, error: 0 });
    const rows = await t("history_reviews").find({ workspace_id: WS_FUNDER });
    expect(rows.filter((r) => r.application_id === byTitle.get("Clinic van")!.id)).toHaveLength(2);
    expect(rows.filter((r) => r.application_id === byTitle.get("After-school tutors")!.id)).toHaveLength(1);
    const waiting = rows.find((r) => r.application_id === null)!;
    expect(waiting.application_key).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.find((r) => r.reviewer_name === "Lee Moss")).toBeTruthy();
    expect(rows[0]!.scores).toEqual([
      { criterion: "Impact score", score: 5, outOf: null },
      { criterion: "Feasibility score", score: 4, outOf: null },
      { criterion: "Budget score", score: 4, outOf: 5 },
    ]);

    // The application a review was waiting for arrives later, and the review finds it by the same id.
    await csvImport("history_applications", ["Submission ID,Title,Organization,Status", "70099999,Late arrival,Cedar Library Friends,Declined"].join("\n"), { sourceId: "Submission ID", title: "Title", organizationName: "Organization", outcome: "Status" });
    const late = (await t("history_applications").find({ workspace_id: WS_FUNDER, title: "Late arrival" }))[0]!;
    expect((await t("history_reviews").one({ id: waiting.id }))!.application_id).toBe(late.id);

    // No contact detail, bank or identity number and no export id is stored anywhere.
    const stored = JSON.stringify([await t("history_applications").find({}), await t("history_reviews").find({}), await t("import_rows").find({ workspace_id: WS_FUNDER })]);
    for (const x of [NINE, "@example.org", "Ruiz", "70012345"]) expect(stored).not.toContain(x);

    // History is not live: the imports wrote no application, review, decision, payment or requirement.
    expect(await liveCounts()).toEqual(afterAwards);
    expect(afterAwards.applications).toBe(before.applications);
    expect(afterAwards.reviews).toBe(before.reviews);
    const live = await call(admin, "GET", `/gms/applications/app_${late.id}`);
    expect(live.status).toBe(404);
  });

  it("links by exact name when the export has no id, and never by a guess", async () => {
    await importFile("award_history", "submittable.csv", "submittable");
    const pantry = (await t("awards").find({ workspace_id: WS_FUNDER, title: "Food pantry shelves" }))[0]!;
    // Two awards of the same title to the same organization: a name that fits both links to neither.
    for (let i = 0; i < 2; i++) await t("awards").insert({ workspace_id: WS_FUNDER, title: "Twin grant", status: "active", recipient_individual: { name: "Twin Org", imported: true } as never });
    await csvImport(
      "history_applications",
      ["Organization,Project,Decision", "Harbor Food Bank,Food pantry shelves,Approved", "Harbor Food Bank,Food pantry shelf,Approved", "Someone Else,Food pantry shelves,Approved", "Twin Org,Twin grant,Approved", "Harbor Food Bank,Food pantry shelves,Declined"].join("\n"),
      { organizationName: "Organization", title: "Project", outcome: "Decision" },
    );
    const past = await t("history_applications").find({ workspace_id: WS_FUNDER });
    const link = (title: string, org: string, outcome: string) => past.find((p) => p.title === title && p.organization_name === org && p.outcome === outcome)!.award_id;
    expect(link("Food pantry shelves", "Harbor Food Bank", "awarded")).toBe(pantry.id);
    expect(link("Food pantry shelf", "Harbor Food Bank", "awarded")).toBeNull();
    expect(link("Food pantry shelves", "Someone Else", "awarded")).toBeNull();
    expect(link("Twin grant", "Twin Org", "awarded")).toBeNull();
    expect(link("Food pantry shelves", "Harbor Food Bank", "declined")).toBeNull();
  });

  it("links an organization through its award, else only among organizations connected to the funder", async () => {
    // Alder Creek holds an award the funder made here, so it is connected; Pine Valley is a stranger.
    await t("awards").insert({ workspace_id: WS_FUNDER, title: "Made here", status: "active", recipient_workspace_id: WS_APPLICANT });
    const stranger = await t("workspaces").insert({ kind: "applicant", handle: "pine-valley", display_name: "Pine Valley Arts" });
    await csvImport("history_applications", ["Organization,Project,Decision", "Alder Creek Family Services,After-school tutors,Declined", "Pine Valley Arts,Mural walk,Withdrawn"].join("\n"), { organizationName: "Organization", title: "Project", outcome: "Decision" });
    const past = await t("history_applications").find({ workspace_id: WS_FUNDER });
    expect(past.find((p) => p.title === "After-school tutors")!.organization_workspace_id).toBe(WS_APPLICANT);
    expect(past.find((p) => p.title === "Mural walk")!.organization_workspace_id).toBeNull();
    expect(stranger.id).toBeTruthy();
    const list = await data<{ applications: { title: string; outcome: string; reviewCount: number }[]; reports: unknown[] }>(admin, "GET", `/gms/history?organization=${WS_APPLICANT}`);
    expect(list.applications.map((a) => [a.title, a.outcome])).toEqual([["After-school tutors", "declined"]]);
  });

  it("is imported again from another file of the same export only once", async () => {
    await importFile("history_applications", "submittable-applications.csv", "submittable");
    // The same export with its id column named differently: a new file to the run log, the same records.
    const renamed = fixture("submittable-applications.csv").replace("Submission ID", "Submission Number");
    const again = await csvImport("history_applications", renamed, { sourceId: "Submission Number", title: "Title", organizationName: "Organization" });
    expect(await t("history_applications").find({ workspace_id: WS_FUNDER, title: "Clinic van" })).toHaveLength(1);
    const log = await t("import_rows").find({ run_id: again.id });
    expect(log.map((r) => [r.outcome, r.reason])).toEqual(Array(3).fill(["skip", "Imported already, from another file of the same export"]));
  });
});

describe("past reports from Bonterra CyberGrants", () => {
  it("drop the payee's bank fields, link to the awards by Request ID, and take their file from the zip", async () => {
    const before = await liveCounts();
    const requests = await importFile("award_history", "cybergrants-requests.csv", "cybergrants");
    expect(requests.preview.run.dropped.map((d) => d.column)).toEqual(["Payee Bank Acct", "Payee Routing", "Payee Reference"]);
    const awards = await t("awards").find({ workspace_id: WS_FUNDER });
    const storage = (await t("awards").find({ workspace_id: WS_FUNDER, title: "Cold storage" }))[0]!;
    const afterAwards = await liveCounts();
    expect(afterAwards.tranches).toBeGreaterThan(before.tranches);

    const reports = await importFile("history_reports", "cybergrants-impact-reports.csv", "cybergrants");
    expect(reports.run.reconciliation).toMatchObject({ create: 3, error: 0 });
    const rows = await t("history_reports").find({ workspace_id: WS_FUNDER });
    expect(rows.map((r) => [r.title, r.report_state, awards.find((a) => a.id === r.award_id)?.title]).sort()).toEqual([
      ["Final Impact Report", "not_submitted", "Coaching clinics"],
      ["Final Impact Report", "submitted", "Cold storage"],
      ["Interim Impact Report", "late", "Coaching clinics"],
    ]);
    // A past report is not a requirement of the award, and gates no payment.
    expect(await liveCounts()).toEqual(afterAwards);

    const stored = JSON.stringify([awards, await t("tranches").find({}), await t("import_rows").find({ workspace_id: WS_FUNDER }), await t("import_runs").find({ workspace_id: WS_FUNDER }), rows]);
    for (const x of [NINE, LONG, "on file"]) expect(stored).not.toContain(x);

    // The report's PDF from the zip, matched by its id, kept as the funder's own document.
    const m = await data<{ matched: { path: string; by: string }[]; unmatched: { path: string }[] }>(admin, "POST", `/gms/imports/runs/${reports.run.id}/files/match`, { paths: ["impact/9001 Final Impact Report.pdf", "impact/unknown.pdf"] });
    expect(m.matched.map((x) => [x.path, x.by])).toEqual([["impact/9001 Final Impact Report.pdf", "id"]]);
    const pdf = btoa("%PDF-1.4 fake");
    const attached = await call<{ created: boolean }>(admin, "POST", `/gms/imports/runs/${reports.run.id}/files`, { path: "impact/9001 Final Impact Report.pdf", contentBase64: pdf });
    expect(attached.status).toBe(201);
    const list = await data<{ reports: { id: string; title: string; state: string; file: { id: string; name: string } | null; award: { id: string } | null }[] }>(admin, "GET", `/gms/history?award=awd_${storage.id}`);
    expect(list.reports).toHaveLength(1);
    const report = list.reports[0]!;
    expect(report).toMatchObject({ title: "Final Impact Report", state: "submitted", file: { name: "9001 Final Impact Report.pdf" } });
    const file = await h.request(`/gms/history/reports/${report.id}/files/${report.file!.id}`, { headers: admin });
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("%PDF-1.4 fake");
    const reviewer = await headers(USER_REVIEWER, WS_FUNDER);
    expect((await h.request(`/gms/history/reports/${report.id}/files/${report.file!.id}`, { headers: reviewer })).status).toBe(403);
  });
});

describe("who reads imported history", () => {
  beforeEach(async () => {
    await importFile("award_history", "submittable.csv", "submittable");
    await importFile("history_applications", "submittable-applications.csv", "submittable");
    await importFile("history_reviews", "submittable-reviews.csv", "submittable");
  });

  it("the funder's staff, with the reviews of each application", async () => {
    const van = (await t("awards").find({ workspace_id: WS_FUNDER, title: "Clinic van" }))[0]!;
    for (const user of [USER_ADMIN, USER_OFFICER, USER_AUDITOR]) {
      const list = await data<{ applications: { id: string; title: string; reviewCount: number; award: { id: string } | null }[] }>(await headers(user, WS_FUNDER), "GET", `/gms/history?award=awd_${van.id}`);
      expect(list.applications.map((a) => [a.title, a.reviewCount, a.award?.id])).toEqual([["Clinic van", 2, `awd_${van.id}`]]);
    }
    const id = (await t("history_applications").find({ workspace_id: WS_FUNDER, title: "Clinic van" }))[0]!.id;
    const detail = await data<{ answers: { question: string }[]; reviews: { reviewerName: string | null; totalScore: number | null; scores: unknown[] }[] }>(admin, "GET", `/gms/history/applications/${id}`);
    expect(detail.answers.map((a) => a.question)).toEqual(["Project summary", "How many people will you serve?"]);
    expect(detail.reviews.map((r) => [r.reviewerName, r.totalScore])).toEqual([["Jo Park", 13], ["Lee Moss", 11]]);
    expect(JSON.stringify(detail)).not.toContain("@example.org");
  });

  it("never a reviewer, an external reviewer, the grantee or a fund advisor outside its funds", async () => {
    const van = (await t("awards").find({ workspace_id: WS_FUNDER, title: "Clinic van" }))[0]!;
    const id = (await t("history_applications").find({ workspace_id: WS_FUNDER, title: "Clinic van" }))[0]!.id;
    for (const user of [USER_REVIEWER, USER_GUEST]) {
      const who = await headers(user, WS_FUNDER);
      expect((await call(who, "GET", `/gms/history?award=awd_${van.id}`)).status).toBe(403);
      expect((await call(who, "GET", `/gms/history/applications/${id}`)).status).toBe(403);
    }
    const grantee = await headers(USER_GRANTEE, WS_APPLICANT);
    expect((await call(grantee, "GET", `/gms/history?organization=${WS_APPLICANT}`)).status).toBe(403);
    expect((await call(grantee, "GET", `/gms/history/applications/${id}`)).status).toBe(403);
    const advisor = await headers(USER_ADVISOR, WS_FUNDER);
    expect((await call(advisor, "GET", `/gms/history?award=awd_${van.id}`)).status).toBe(404);
    expect((await call(advisor, "GET", `/gms/history/applications/${id}`)).status).toBe(404);
  });

  it("an API client with the scope reads it, one without it does not, and none imports it", async () => {
    const van = (await t("awards").find({ workspace_id: WS_FUNDER, title: "Clinic van" }))[0]!;
    const reader = { Authorization: `Bearer ${await clientCredentialsToken(h, "applications:read")}`, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    const list = await data<{ applications: unknown[]; reports: unknown[]; includes: { reviews: boolean; reports: boolean } }>(reader, "GET", `/gms/history?award=awd_${van.id}`);
    expect(list.applications).toHaveLength(1);
    expect(list.includes).toEqual({ reviews: false, reports: false });
    const awardsOnly = { ...reader, Authorization: `Bearer ${await clientCredentialsToken(h, "awards:read")}` };
    expect((await call(awardsOnly, "GET", `/gms/history?award=awd_${van.id}`)).status).toBe(403);
    const admin2 = { ...reader, Authorization: `Bearer ${await clientCredentialsToken(h)}` };
    const preview = await call(admin2, "POST", "/gms/imports/preview", { target: "history_reviews", source: { kind: "csv", text: fixture("submittable-reviews.csv") }, mapping: { applicationRef: "Submission ID", totalScore: "Total Score" } });
    expect(preview.status).toBe(403);
  });

  it("in the report builder: one row per record, with no reviewer or contact column", async () => {
    const out = await data<{ columns: { key: string }[]; rows: unknown[][] }>(admin, "POST", "/gms/reports/preview", { dataSet: "history", columns: ["record", "title", "organization", "outcome", "score", "reviews", "award", "importedFrom", "fund"] });
    const rows = out.rows.map((r) => r.slice(0, 2));
    expect(rows.filter((r) => r[0] === "Past application")).toHaveLength(3);
    expect(rows.filter((r) => r[0] === "Past review")).toHaveLength(4);
    const text = JSON.stringify(out);
    for (const x of ["Jo Park", "Lee Moss", "@example.org", NINE]) expect(text).not.toContain(x);
    expect(out.rows.find((r) => r[1] === "Clinic van" && r[0] === "Past application")).toEqual(["Past application", "Clinic van", "River Clinic", "Accepted", null, 2, "Clinic van", "Submittable", "No fund"]);
    const reviewer = await headers(USER_REVIEWER, WS_FUNDER);
    expect((await call(reviewer, "POST", "/gms/reports/preview", { dataSet: "history", columns: ["record"] })).status).toBe(403);
    const advisor = await headers(USER_ADVISOR, WS_FUNDER);
    expect((await data<{ rows: unknown[] }>(advisor, "POST", "/gms/reports/preview", { dataSet: "history", columns: ["record"] })).rows).toEqual([]);
  });
});
