// SPDX-License-Identifier: AGPL-3.0-only
// Apply anywhere (v1.5.0), around the outside application: privacy (another workspace, a funder,
// a consultant read nothing), the consulting request (content, limits, human only), the calendar
// feed and its public .ics, CSV import and export, discovery changes, funder records, and tasks
// and documents about an outside application.
import { beforeEach, describe, expect, it } from "vitest";
import { setLogSink } from "../src/lib/log.ts";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { clearDiscoveryCache } from "../src/services/applicant.ts";
import { CLIENT_AGENT, USER_ADMIN, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let oaId: string;
let other: Record<string, string>;
let consultant: Record<string, string>;
const WS_OTHER_APPLICANT = "44444444-4444-4444-8444-444444444444";
const USER_OTHER = "55555555-5555-4555-8555-555555555555";
const USER_CONSULTANT = "66666666-6666-4666-8666-666666666666";
const USER_VIEWER = "77777777-7777-4777-8777-777777777777";

type Data<T> = { data: T };
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<Data<T>>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const headersFor = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const agentHeaders = async (scope: string) => ({ ...bearer(await h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: WS_APPLICANT, jti: `tok-${Math.random()}` })).headers, "Content-Type": "application/json" });

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  clearDiscoveryCache();
  h.directory.users.set(USER_APPLICANT, { email: "ana.ruiz@aldercreekfs.example", name: "Ana Ruiz" });
  await h.repos.table("workspaces").insert({ id: WS_OTHER_APPLICANT, kind: "applicant", handle: "other-applicant", display_name: "Other Applicant" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER_APPLICANT, user_id: USER_OTHER, role: "admin" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_CONSULTANT, role: "consultant", scope: { applicationIds: [] } });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_VIEWER, role: "viewer" });
  other = await headersFor(USER_OTHER, WS_OTHER_APPLICANT);
  consultant = await headersFor(USER_CONSULTANT, WS_APPLICANT);
  const oa = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", loiDue: "2027-04-20", fullDue: "2027-05-01", internalDue: "2027-04-25", askAmount: { amount: "50000.00", currency: "USD" }, listingUrl: "https://northwind.example/grants", portalUrl: "https://portal.northwind.example" });
  oaId = oa.id;
  const qs = await data<{ id: string }[]>(s.applicant, "POST", `/gms/outside-applications/${oaId}/questions`, { questions: [{ prompt: "Describe the need." }, { prompt: "Who is served?" }] });
  await data(s.applicant, "PUT", `/gms/outside-questions/${qs[0]!.id}/answer`, { body: "Families travel 46 miles to reach a clinic." });
});

describe("privacy", () => {
  it("another applicant workspace reads and changes nothing (404 everywhere)", async () => {
    const qid = (await h.repos.table("outside_questions").find({ outside_application_id: oaId }))[0]!.id;
    expect(await data<unknown[]>(other, "GET", "/gms/outside-applications")).toEqual([]);
    expect(await data<unknown[]>(other, "GET", "/gms/pipeline")).toEqual([]);
    for (const [method, path, body] of [
      ["GET", `/gms/outside-applications/${oaId}`],
      ["PATCH", `/gms/outside-applications/${oaId}`, { title: "Mine now" }],
      ["POST", `/gms/outside-applications/${oaId}/stage`, { to: "withdrawn" }],
      ["POST", `/gms/outside-applications/${oaId}/submit`, { submittedAt: "2027-04-15", method: "portal" }],
      ["POST", `/gms/outside-applications/${oaId}/decision`, { outcome: "withdrawn" }],
      ["POST", `/gms/outside-applications/${oaId}/archive`],
      ["GET", `/gms/outside-applications/${oaId}/questions`],
      ["POST", `/gms/outside-applications/${oaId}/questions`, { prompt: "x" }],
      ["POST", `/gms/outside-applications/${oaId}/questions/parse`, { text: "1. x" }],
      ["PATCH", `/gms/outside-questions/${qid}`, { prompt: "x" }],
      ["PUT", `/gms/outside-questions/${qid}/answer`, { body: "x" }],
      ["GET", `/gms/outside-questions/${qid}/answers`],
      ["DELETE", `/gms/outside-questions/${qid}`],
      ["GET", `/gms/outside-applications/${oaId}/export?format=txt`],
      ["GET", `/gms/outside-applications/${oaId}/documents`],
      ["POST", `/gms/outside-applications/${oaId}/consulting-request/preview`, {}],
      ["POST", `/gms/outside-applications/${oaId}/consulting-request`, {}],
    ] as [string, string, unknown?][]) {
      expect((await s.call(other, method, path, method === "GET" ? undefined : (body ?? {}))).status, `${method} ${path}`).toBe(404);
    }
    const csv = await h.request("/gms/outside-applications/export.csv", { headers: other });
    expect(await csv.text()).not.toContain("Rural clinics");
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_OTHER_APPLICANT })).toBe(0);
  });

  it("a funder, a consultant and a client-credentials token are refused", async () => {
    const funder = await s.call<{ errors: { code: string }[] }>(s.funder, "GET", "/gms/outside-applications");
    expect(funder.status).toBe(403);
    expect(funder.body.errors[0]!.code).toBe("wrong_workspace_kind");
    for (const path of [`/gms/outside-applications/${oaId}`, "/gms/pipeline", "/gms/funder-records", "/gms/calendar-feed"]) expect((await s.call(s.funder, "GET", path)).status).toBe(403);
    const c = await s.call<{ errors: { code: string }[] }>(consultant, "GET", "/gms/outside-applications");
    expect(c.status).toBe(403);
    expect(c.body.errors[0]!.code).toBe("insufficient_role");
  });

  it("outside applications never reach the funder's inbox, CommonGrants output or analytics", async () => {
    await s.call(s.applicant, "POST", `/gms/outside-applications/${oaId}/submit`, { submittedAt: "2027-04-15", method: "portal" });
    const funderViews = [
      await s.call(s.funder, "GET", "/gms/applications"),
      await s.call(s.funder, "POST", "/common-grants/applications/search", {}),
      await s.call(s.funder, "GET", "/common-grants/awards"),
      await s.call(s.funder, "GET", "/gms/analytics/portfolio"),
      await s.call(s.funder, "GET", "/gms/grantees"),
      await s.call(await headersFor(USER_ADMIN, WS_FUNDER), "GET", "/gms/ledger"),
    ];
    expect(funderViews.map((v) => v.status)).toEqual([200, 200, 200, 200, 200, 200]);
    for (const v of funderViews) expect(JSON.stringify(v.body)).not.toMatch(/Rural clinics|Northwind|46 miles/);
    // The ledger rows are in the applicant's workspace only.
    expect(h.ledger.events.filter((e) => e.subjectType === "outside_application").every((e) => e.workspaceId === WS_APPLICANT)).toBe(true);
    // No webhook is queued for an outside application.
    expect(JSON.stringify(h.webhooks)).not.toContain("outside_application");
  });
});

describe("consulting request (D7)", () => {
  it("previews exactly what will be sent, without answers unless asked", async () => {
    const p = await data<{ to: string; replyTo: string; subject: string; text: string; fieldsSent: string[] }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request/preview`, { message: "Help with the evaluation plan." });
    expect(p).toMatchObject({ to: "hello@agents.opengrants.io", replyTo: "ana.ruiz@aldercreekfs.example", subject: "Consulting request: Rural clinics 2027 (Alder Creek Family Services)" });
    for (const line of ["Organization: Alder Creek Family Services", "Requested by: Ana Ruiz <ana.ruiz@aldercreekfs.example>", "Application: Rural clinics 2027", "Funder: Northwind Family Foundation", "Stage: Drafting", "Letter of inquiry due: 2027-04-20", "Application due: 2027-05-01", "Internal deadline: 2027-04-25", "Ask: USD 50,000.00", "Funder's listing: https://northwind.example/grants", "Funder's portal: https://portal.northwind.example", "Questions: 2", "Help with the evaluation plan.", "starting right away"]) expect(p.text).toContain(line);
    expect(p.text).not.toContain("46 miles");
    expect(p.fieldsSent).not.toContain("answers");
    const withAnswers = await data<{ text: string; fieldsSent: string[] }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request/preview`, { includeAnswers: true, contactName: "Dana", contactEmail: "dana@aldercreekfs.example" });
    expect(withAnswers.text).toContain("1. Describe the need.\nFamilies travel 46 miles to reach a clinic.");
    expect(withAnswers.text).toContain("Requested by: Dana <dana@aldercreekfs.example>");
    expect(withAnswers.fieldsSent).toContain("answers");
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("sends to OpenGrants with the person's reply address, records it masked, and ledgers it", async () => {
    const out = await data<{ sent: boolean; message: string }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request`, { message: "Please start soon." });
    expect(out.message).toBe("OpenGrants consulting can start right away. The team will reply to ana.ruiz@aldercreekfs.example.");
    const mail = h.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: ["hello@agents.opengrants.io"], replyTo: "ana.ruiz@aldercreekfs.example", subject: "Consulting request: Rural clinics 2027 (Alder Creek Family Services)" });
    expect(mail.text).toContain("wants consulting support from OpenGrants for this application, starting right away");
    expect(mail.text).not.toContain("46 miles");
    const [row] = await h.repos.table("consulting_requests").find({ outside_application_id: oaId });
    expect(row).toMatchObject({ contact_name: "Ana Ruiz", contact_email_masked: "a…@aldercreekfs.example", fields_sent: ["organization", "requester", "title", "funder", "deadlines", "ask", "links", "stage", "questionCount", "message"] });
    expect(row!.sent_at).not.toBeNull();
    const e = h.ledger.events.find((x) => x.eventType === "outside_application.consulting_requested")!;
    expect(e.data).toMatchObject({ contactEmail: "a…@aldercreekfs.example" });
    expect(JSON.stringify(h.ledger.events)).not.toContain("ana.ruiz@");
  });

  it("goes where CONSULTING_REQUEST_TO says on this install", async () => {
    h.env.CONSULTING_REQUEST_TO = "consulting@example.org";
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request`, {});
    expect(h.mailer.sent.at(-1)!.to).toEqual(["consulting@example.org"]);
  });

  it("allows 3 per application and 10 per workspace in 24 hours", async () => {
    for (let i = 0; i < 3; i++) expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request`, {})).status).toBe(200);
    const fourth = await s.call<{ errors: { code: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request`, {});
    expect(fourth.status).toBe(429);
    expect(fourth.body.errors[0]!.code).toBe("too_many_requests_for_application");
    for (let i = 0; i < 4; i++) {
      const more = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: `More ${i}`, funderName: "Cascade" });
      for (let j = 0; j < 2; j++) await s.call(s.applicant, "POST", `/gms/outside-applications/${more.id}/consulting-request`, {});
    }
    expect(await h.repos.table("consulting_requests").count({ workspace_id: WS_APPLICANT })).toBe(10);
    const last = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Last", funderName: "Cascade" });
    const eleventh = await s.call<{ errors: { code: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${last.id}/consulting-request`, {});
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.errors[0]!.code).toBe("too_many_requests");
    expect(h.mailer.sent.filter((m) => m.subject.startsWith("Consulting request"))).toHaveLength(10);
    // A day later the window has moved on.
    h.clock.now = new Date(h.clock.now.getTime() + 25 * 3_600_000);
    expect((await s.call(await headersFor(USER_APPLICANT, WS_APPLICANT), "POST", `/gms/outside-applications/${oaId}/consulting-request`, {})).status).toBe(200);
  });

  it("is human only, needs a writer, gives back the count when the mail fails, and needs mail", async () => {
    const agent = await agentHeaders("applications:read applications:write approvals:bypass");
    expect((await s.call(agent, "POST", `/gms/outside-applications/${oaId}/consulting-request`, {})).status).toBe(403);
    expect((await s.call(agent, "POST", `/gms/outside-applications/${oaId}/consulting-request/preview`, {})).status).toBe(403);
    expect((await s.call(await headersFor(USER_VIEWER, WS_APPLICANT), "POST", `/gms/outside-applications/${oaId}/consulting-request`, {})).status).toBe(403);
    h.mailer.failNext = new Error("down");
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request`, {})).status).toBe(502);
    expect(await h.repos.table("consulting_requests").count({ workspace_id: WS_APPLICANT })).toBe(0);
    h.withoutPorts.add("mailer");
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request`, {})).status).toBe(503);
  });
});

describe("calendar feed", () => {
  it("shows the link once, serves titles, funders and dates only, and rotates and deletes", async () => {
    const lines: string[] = [];
    setLogSink((l) => void lines.push(l));
    try {
      await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
      const archived = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Archived one", funderName: "Gone", fullDue: "2027-06-01" });
      await data(s.applicant, "POST", `/gms/outside-applications/${archived.id}/archive`);
      expect(await data(s.applicant, "GET", "/gms/calendar-feed")).toEqual({ exists: false, createdAt: null, rotatedAt: null });
      const { url } = await data<{ url: string }>(s.applicant, "POST", "/gms/calendar-feed");
      expect(url).toMatch(/^https:\/\/gms\.test\/gms\/cal\/gms_cal_[A-Za-z0-9_-]{43}\.ics$/);
      const status = await data<Record<string, unknown>>(s.applicant, "GET", "/gms/calendar-feed");
      expect(status.exists).toBe(true);
      expect(JSON.stringify(status)).not.toContain("gms_cal_");
      const path = new URL(url).pathname;
      const res = await h.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
      const raw = await res.text();
      expect(raw.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
      const ics = raw.replace(/\r\n /g, "");
      expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
      expect(ics).toContain("DTSTART;VALUE=DATE:20270420\r\n");
      expect(ics).toContain("SUMMARY:Letter of inquiry due: Rural clinics 2027 (Northwind Family Foundation)");
      expect(ics).toContain("SUMMARY:Application due: Rural clinics 2027 (Northwind Family Foundation)");
      expect(ics).toContain("SUMMARY:Internal deadline: Rural clinics 2027 (Northwind Family Foundation)");
      expect(ics).toContain("SUMMARY:Application stage closes: Community Health Grants 2027 (Riverbend Community Foundation)");
      expect(ics).not.toContain("Archived one");
      expect(ics).not.toMatch(/DESCRIPTION|URL:|46 miles|50,000/);
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
      // Rotating stops the old link; deleting stops the new one.
      const rotated = await data<{ url: string; rotated: boolean }>(s.applicant, "POST", "/gms/calendar-feed");
      expect(rotated.rotated).toBe(true);
      expect((await h.request(path)).status).toBe(404);
      expect((await h.request(new URL(rotated.url).pathname)).status).toBe(200);
      await data(s.applicant, "DELETE", "/gms/calendar-feed");
      expect((await h.request(new URL(rotated.url).pathname)).status).toBe(404);
      expect((await h.request("/gms/cal/not-a-token.ics")).status).toBe(404);
      // The link never reaches the logs.
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).not.toMatch(/gms_cal_[A-Za-z0-9_-]{8}/);
    } finally {
      setLogSink(null);
    }
  });

  it("is rate limited per link, and only admins and editors make links", async () => {
    const { url } = await data<{ url: string }>(s.applicant, "POST", "/gms/calendar-feed");
    const path = new URL(url).pathname;
    for (let i = 0; i < 60; i++) expect((await h.request(path)).status).toBe(200);
    expect((await h.request(path)).status).toBe(429);
    expect((await s.call(await headersFor(USER_VIEWER, WS_APPLICANT), "POST", "/gms/calendar-feed")).status).toBe(403);
    expect((await s.call(await agentHeaders("applications:read applications:write"), "POST", "/gms/calendar-feed")).status).toBe(403);
  });

  it("escapes and folds long text", async () => {
    await data(s.applicant, "PATCH", `/gms/outside-applications/${oaId}`, { title: "Rural, clinics; and \\ more – a very long title that goes on and on past seventy-five octets" });
    const { url } = await data<{ url: string }>(s.applicant, "POST", "/gms/calendar-feed");
    const ics = await (await h.request(new URL(url).pathname)).text();
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("Rural\\, clinics\\; and \\\\ more – a very long title");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

describe("CSV import and export", () => {
  const csv = ["Grant,Funder,Stage,Deadline,Ask,Submitted,How,Awarded", "Capacity 2026,Cascade Trust,Awarded,2026-03-01,\"$20,000\",2026-02-20,portal,\"$15,000\"", "Bad row,,Paid,03/32/2026,lots,,,", "Summer camp,Pine Fund,prospect,6/1/2027,5000,,,"].join("\n");
  const mapping = { title: "Grant", funderName: "Funder", stage: "Stage", fullDue: "Deadline", askAmount: "Ask", submittedAt: "Submitted", submissionMethod: "How", awardedAmount: "Awarded" };

  type Row = { row: number; ok: boolean; problems: { field?: string; message: string }[]; values: Record<string, string>; normalized: Record<string, unknown> };
  it("previews rows with their problems and writes nothing on a dry run", async () => {
    const out = await data<{ dryRun: boolean; rows: Row[]; created: unknown[]; summary: { rows: number; valid: number; failed: number; created: number } }>(s.applicant, "POST", "/gms/outside-applications/import", { csv, mapping });
    expect(out).toMatchObject({ dryRun: true, created: [], summary: { rows: 3, valid: 2, failed: 1, created: 0 } });
    expect(out.rows[0]).toMatchObject({ row: 2, ok: true, values: { title: "Capacity 2026", stage: "Awarded", askAmount: "$20,000" }, normalized: { title: "Capacity 2026", stage: "awarded", askAmount: { amount: "20000.00" }, awardedAmount: { amount: "15000.00" }, submittedAt: "2026-02-20", submissionMethod: "portal" } });
    expect(out.rows[1]!.problems).toEqual(expect.arrayContaining([{ field: "funderName", message: "No funder" }, { field: "stage", message: '"Paid" is not a stage' }, { field: "fullDue", message: "fullDue is not a date (use YYYY-MM-DD)" }, { field: "askAmount", message: "The ask is not an amount" }]));
    expect(out.rows[2]).toMatchObject({ ok: true, normalized: { stage: "prospect", fullDue: "2027-06-01" } });
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT, source: "import" })).toBe(0);
  });

  it("imports the valid rows, returns them as list items and reports the rest", async () => {
    const out = await data<{ created: { id: string; title: string; source: string }[]; summary: { created: number; failed: number } }>(s.applicant, "POST", "/gms/outside-applications/import", { csv, mapping, dryRun: false });
    expect(out.summary).toMatchObject({ created: 2, failed: 1 });
    expect(out.created.map((c) => [c.title, c.source]).sort()).toEqual([["Capacity 2026", "import"], ["Summer camp", "import"]]);
    const rows = await h.repos.table("outside_applications").find({ workspace_id: WS_APPLICANT, source: "import" });
    expect(rows.map((r) => [r.title, r.stage, r.awarded_amount_minor, r.submission_method]).sort()).toEqual([["Capacity 2026", "awarded", 1_500_000, "portal"], ["Summer camp", "prospect", null, null]]);
  });

  it("refuses an incomplete mapping, more than 500 rows and never reads a bank or identity column", async () => {
    expect((await s.call(s.applicant, "POST", "/gms/outside-applications/import", { csv, mapping: { title: "Grant" } })).status).toBe(422);
    const big = ["t,f", ...Array.from({ length: 501 }, (_, i) => `T${i},F`)].join("\n");
    const tooMany = await s.call<{ errors: { code: string }[] }>(s.applicant, "POST", "/gms/outside-applications/import", { csv: big, mapping: { title: "t", funderName: "f" } });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.errors[0]!.code).toBe("too_many_rows");
    const header = ["Bank", "Rout" + "ing", "Number"].join(" ");
    const sensitive = await data<{ refusedColumns: string[]; unknownColumns: string[] }>(s.applicant, "POST", "/gms/outside-applications/import", { csv: `Grant,Funder,${header}\nA,B,123\n`, mapping: { title: "Grant", funderName: "Funder", notes: header } });
    expect(sensitive.refusedColumns).toEqual([header]);
    expect(sensitive.unknownColumns).toEqual(["notes"]);
  });

  it("exports every outside application as CSV and JSON, defusing formulas", async () => {
    await data(s.applicant, "PATCH", `/gms/outside-applications/${oaId}`, { programName: "=HYPERLINK(\"x\")" });
    const res = await h.request("/gms/outside-applications/export.csv", { headers: s.applicant });
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const text = await res.text();
    expect(text.split("\r\n")[0]).toBe("id,title,funderName,programName,stage,loiDue,fullDue,internalDue,rolling,askAmount,currency,listingUrl,portalUrl,submittedAt,submissionMethod,confirmationRef,awardedAmount,grantStart,grantEnd,decidedAt,nextCycleOn,archived,source,updatedAt");
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    const json = JSON.parse(await (await h.request("/gms/outside-applications/export.json", { headers: s.applicant })).text()) as { items: { id: string; askAmount: string }[] };
    expect(json.items).toEqual([expect.objectContaining({ id: oaId, askAmount: "50000.00" })]);
  });
});

describe("discovery", () => {
  it("lists published opportunities with no open competition, labelled and without eligibility", async () => {
    const opp = await data<{ id: string }>(s.funder, "POST", "/gms/opportunities", { title: "Fall cycle 2027", description: "Opens in September." });
    await data(s.funder, "POST", `/gms/opportunities/${opp.id}/publish`);
    const found = await data<{ competitionId: string | null; acceptingApplications: boolean; eligibility: unknown; opportunity: { id: string } }[]>(s.applicant, "GET", "/gms/discover/competitions");
    expect(found.find((c) => c.opportunity.id === s.oppId)).toMatchObject({ acceptingApplications: true, competitionId: s.uuid.comp });
    expect(found.find((c) => c.opportunity.id === opp.id)).toEqual(expect.objectContaining({ acceptingApplications: false, competitionId: null, eligibility: null }));
  });

  it("reads one OpenGrants listing for the details dialog", async () => {
    h.env.OPENGRANTS_API_KEY = "test-key-not-real";
    const listing = await data<{ id: string; title: string; gms: unknown }>(s.applicant, "GET", "/gms/discover/opengrants/og-1");
    expect(listing).toMatchObject({ id: "og-1", title: "Rural Health Access Fund", gms: null });
    const missing = await s.call<{ errors: { code: string }[] }>(s.applicant, "GET", "/gms/discover/opengrants/og-404");
    expect(missing.status).toBe(404);
    expect(missing.body.errors[0]!.code).toBe("not_found");
    h.withoutPorts.add("openGrants");
    const off = await s.call<{ errors: { code: string }[] }>(s.applicant, "GET", "/gms/discover/opengrants/og-1");
    expect(off.status).toBe(404);
    expect(off.body.errors[0]!.code).toBe("not_available");
  });

  it("makes a saved OpenGrants listing a prospect, once, and keeps alerts out of the saved list", async () => {
    const saved = await data<{ outsideApplicationId: string }>(s.applicant, "POST", "/gms/discover/saved", { source: "opengrants", externalId: "og-1", title: "Rural Health Access Fund", url: "https://opengrants.example/grants/og-1", listing: { funder: "Northwind Family Foundation", amount: "$25,000", deadline: "2027-06-01" } });
    expect(saved.outsideApplicationId).toBeTruthy();
    const again = await data<{ outsideApplicationId: string }>(s.applicant, "POST", "/gms/discover/saved", { source: "opengrants", externalId: "og-1", title: "Rural Health Access Fund" });
    expect(again.outsideApplicationId).toBe(saved.outsideApplicationId);
    const prospect = await data<{ stage: string; source: string; funderName: string; deadlines: { fullDue: string } }>(s.applicant, "GET", `/gms/outside-applications/${saved.outsideApplicationId}`);
    expect(prospect).toMatchObject({ stage: "prospect", source: "opengrants", funderName: "Northwind Family Foundation", deadlines: { fullDue: "2027-06-01" } });
    // An older client's alert kept as a saved OpenGrants row is not a listing: no prospect.
    expect((await data<{ outsideApplicationId: string | null }>(s.applicant, "POST", "/gms/discover/saved", { source: "opengrants", externalId: "alert:rural clinics", title: "rural clinics" })).outsideApplicationId).toBeNull();
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT, source_ref: "alert:rural clinics" })).toBe(0);
    await data(s.applicant, "POST", "/gms/discover/alerts", { name: "Rural health", query: "rural health", frequency: "weekly" });
    const list = await data<{ source: string }[]>(s.applicant, "GET", "/gms/discover/saved");
    expect(list.map((x) => x.source)).toEqual(["opengrants", "opengrants"]);
  });

  it("refuses OpenGrants alerts and eligibility as the REST client does", async () => {
    h.env.OPENGRANTS_API_KEY = "test-key-not-real";
    for (const tool of ["alerts", "eligibility"]) {
      const r = await s.call<{ errors: { code: string }[] }>(s.applicant, "POST", `/gms/discover/opengrants/${tool}`, {});
      expect(r.status).toBe(501);
      expect(r.body.errors[0]!.code).toBe("opengrants_not_supported");
    }
  });
});

describe("funder records (D6)", () => {
  it("keeps contacts, notes and the portal login holder, unique by name", async () => {
    const r = await data<{ id: string; contacts: unknown[]; applications: { kind: string; id: string; match: string }[] }>(s.applicant, "POST", "/gms/funder-records", { name: "Northwind Family Foundation", website: "https://northwind.example", notes: "Prefers short LOIs.", contacts: [{ name: "Ana Ruiz", role: "Program officer", email: "ana@northwind.example", phone: "+1 (503) 555-0100" }], portalUrl: "https://portal.northwind.example", portalLoginHolder: "Dana Ortiz" });
    // The existing application naming this funder is linked to the new record.
    expect(r.applications).toEqual([expect.objectContaining({ kind: "outside_application", id: oaId, match: "linked" })]);
    expect((await s.call(s.applicant, "POST", "/gms/funder-records", { name: "  NORTHWIND family foundation " })).status).toBe(409);
    expect((await s.call(s.applicant, "POST", "/gms/funder-records", { name: "X", portalLoginHolder: "password: hunter2" })).status).toBe(400);
    expect((await s.call(s.applicant, "POST", "/gms/funder-records", { name: "Y", contacts: Array.from({ length: 21 }, (_, i) => ({ name: `P${i}` })) })).status).toBe(400);
    expect(await data<unknown[]>(s.applicant, "GET", "/gms/funder-records")).toEqual([expect.objectContaining({ id: r.id, applicationCount: 1 })]);
    expect(await data(s.applicant, "PATCH", `/gms/funder-records/${r.id}`, { notes: "Calls back fast." })).toMatchObject({ notes: "Calls back fast." });
    await data(s.applicant, "DELETE", `/gms/funder-records/${r.id}`);
    expect((await h.repos.table("outside_applications").one({ id: oaId }))!.funder_record_id).toBeNull();
    expect((await s.call(s.applicant, "GET", `/gms/funder-records/${r.id}`)).status).toBe(404);
  });

  it("shows built-in applications to a funder of exactly that name, labelled a name match", async () => {
    const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    const r = await data<{ applications: { kind: string; id: string; match: string }[] }>(s.applicant, "POST", "/gms/funder-records", { name: "Riverbend Community Foundation" });
    expect(r.applications).toEqual([expect.objectContaining({ kind: "gms_application", id: `app_${started.body.data.id}`, match: "name" })]);
    const near = await data<{ applications: unknown[] }>(s.applicant, "POST", "/gms/funder-records", { name: "Riverbend Community Fund" });
    expect(near.applications).toEqual([]);
  });
});

describe("tasks and documents about an outside application", () => {
  it("adds a task to its own outside application only", async () => {
    expect((await s.call(s.applicant, "POST", "/gms/tasks", { title: "Collect the audit", subjectType: "outside_application", subjectId: oaId })).status).toBe(201);
    expect((await s.call(other, "POST", "/gms/tasks", { title: "Not mine", subjectType: "outside_application", subjectId: oaId })).status).toBe(404);
    const detail = await data<{ tasks: { title: string }[] }>(s.applicant, "GET", `/gms/outside-applications/${oaId}`);
    expect(detail.tasks.map((t) => t.title)).toEqual(["Collect the audit"]);
  });

  it("uploads, lists and downloads a checklist file, and uses it as the receipt", async () => {
    const doc = await data<{ id: string; sha256: string }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/documents`, { name: "receipt.txt", mime: "text/plain", contentBase64: btoa("Confirmation NW-0412") });
    expect(await data<{ id: string }[]>(s.applicant, "GET", `/gms/outside-applications/${oaId}/documents`)).toEqual([expect.objectContaining({ id: doc.id })]);
    const file = await h.request(`/gms/outside-applications/${oaId}/documents/${doc.id}/file`, { headers: s.applicant });
    expect(await file.text()).toBe("Confirmation NW-0412");
    const sub = await data<{ submission: { receiptDocumentId: string } }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/submit`, { submittedAt: "2027-04-15", method: "email", receiptDocumentId: doc.id });
    expect(sub.submission.receiptDocumentId).toBe(doc.id);
    const stored = await h.repos.table("documents").find({ subject_type: "outside_application", subject_id: oaId });
    expect(stored.every((d) => d.workspace_id === WS_APPLICANT && d.owner_workspace_id === WS_APPLICANT)).toBe(true);
    expect((await s.call(other, "GET", `/gms/outside-applications/${oaId}/documents/${doc.id}/file`)).status).toBe(404);
  });
});

describe("what the web client reads (R3b)", () => {
  it("documents: upload (25 MB at most), pin a locker file, list and open files, the as-submitted PDF too; members only", async () => {
    const up = await data<{ id: string; passportDocumentId: string | null; scanStatus: string; source: string }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/documents`, { name: "letter.txt", mime: "text/plain", contentBase64: btoa("Support letter") });
    expect(up).toMatchObject({ source: "upload", passportDocumentId: null, scanStatus: "not_scanned" });
    const pinned = await data<{ source: string; passportDocumentId: string }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/documents`, { name: "audit.pdf", mime: "application/pdf", passportDocumentId: "doc-123", size: 2048, sha256: "a".repeat(64) });
    expect(pinned).toMatchObject({ source: "passport_locker", passportDocumentId: "doc-123" });
    const big = btoa("x".repeat(25 * 1024 * 1024 + 3));
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oaId}/documents`, { name: "big.bin", mime: "application/octet-stream", contentBase64: big })).status).toBe(413);
    const sub = await data<{ snapshotDocumentId: string; snapshotSha256: string }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/submit`, { submittedAt: "2027-04-15", method: "portal" });
    const listed = await data<{ id: string }[]>(s.applicant, "GET", `/gms/outside-applications/${oaId}/documents`);
    expect(listed.map((d) => d.id)).toEqual(expect.arrayContaining([up.id, sub.snapshotDocumentId]));
    const pdf = await h.request(`/gms/outside-applications/${oaId}/documents/${sub.snapshotDocumentId}/file`, { headers: s.applicant });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect((await h.request(`/gms/outside-applications/${oaId}/documents/${up.id}/file`, { headers: s.applicant })).status).toBe(200);
    expect((await s.call(other, "GET", `/gms/outside-applications/${oaId}/documents`)).status).toBe(404);
    expect((await s.call(other, "POST", `/gms/outside-applications/${oaId}/documents`, { name: "x.txt", mime: "text/plain", contentBase64: btoa("x") })).status).toBe(404);
    expect((await s.call(consultant, "GET", `/gms/outside-applications/${oaId}/documents/${up.id}/file`)).status).toBe(403);
    expect((await s.call(s.funder, "GET", `/gms/outside-applications/${oaId}/documents`)).status).toBe(403);
    // Decoding the 25 MB body takes about four seconds alone; more under a full parallel run.
  }, 30_000);

  it("list items carry source and sourceRef; deadlines are loiDue, fullDue and internalDue", async () => {
    await data(s.applicant, "POST", "/gms/outside-applications", { source: "opengrants", sourceRef: "og-1", title: "Rural Health Access Fund", funderName: "Northwind", stage: "prospect" });
    const items = await data<{ source: string; sourceRef: string | null; deadlines: Record<string, unknown> }[]>(s.applicant, "GET", "/gms/outside-applications");
    expect(items.map((i) => [i.source, i.sourceRef]).sort()).toEqual([["manual", null], ["opengrants", "og-1"]]);
    expect(items.find((i) => i.source === "manual")!.deadlines).toEqual({ loiDue: "2027-04-20", fullDue: "2027-05-01", internalDue: "2027-04-25", rolling: false });
  });

  it("the detail carries its activity, newest first, with ids, stages and dates only", async () => {
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/submit`, { submittedAt: "2027-04-15", method: "portal", confirmationRef: "SECRET-REF-1" });
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request`, { message: "Private message to OpenGrants" });
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/decision`, { outcome: "awarded", awardedAmount: { amount: "40000.00", currency: "USD" }, notes: "Private notes" });
    const detail = await data<{ activity: { id: string; type: string; at: string; actor: string; data: Record<string, unknown> }[]; submittedAt: string; awardedAmount: { amount: string }; decisionNotes: string; snapshotSha256: string }>(s.applicant, "GET", `/gms/outside-applications/${oaId}`);
    expect(detail.activity.map((a) => a.type)).toEqual(["outside_application.decided", "outside_application.consulting_requested", "outside_application.submitted", "outside_application.created"]);
    expect(detail.activity[0]).toMatchObject({ actor: `user:${USER_APPLICANT}`, data: { from: "submitted", to: "awarded", decidedAt: expect.any(String) } });
    expect(Object.keys(detail.activity[1]!.data).sort()).toEqual(["requestId", "sentAt"]);
    expect(JSON.stringify(detail.activity)).not.toMatch(/46 miles|SECRET-REF|Private|40000|ana\.ruiz|a…@/);
    // The submission and the decision are also flat on the detail, as the web reads them.
    expect(detail).toMatchObject({ submittedAt: "2027-04-15T12:00:00.000Z", awardedAmount: { amount: "40000.00" }, decisionNotes: "Private notes" });
    expect(detail.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers and questions carry ids and flat limits; amounts by year accept minor units", async () => {
    const [q] = await data<{ id: string; limitKind: string | null; limitValue: number | null }[]>(s.applicant, "POST", `/gms/outside-applications/${oaId}/questions`, { questions: [{ prompt: "Plan?", limitKind: "chars_no_spaces", limitValue: 900 }] });
    expect(q).toMatchObject({ limitKind: "chars_no_spaces", limitValue: 900 });
    const saved = await data<{ id: string; questionId: string; createdAt: string; createdBy: string }>(s.applicant, "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "A plan." });
    expect(saved).toMatchObject({ id: expect.any(String), questionId: q!.id, createdBy: USER_APPLICANT });
    const edited = await data<{ askByYear: { year: number; amountMinor: number; amount: { amount: string } }[] }>(s.applicant, "PATCH", `/gms/outside-applications/${oaId}`, { askByYear: [{ year: 2027, amountMinor: 2_500_000 }, { year: 2028, amount: { amount: "25000.00", currency: "USD" } }] });
    expect(edited.askByYear).toEqual([{ year: 2027, amountMinor: 2_500_000, amount: { amount: "25000.00", currency: "USD" } }, { year: 2028, amountMinor: 2_500_000, amount: { amount: "25000.00", currency: "USD" } }]);
  });

  it("tasks: subjectType outside_application in the caller's own workspace only", async () => {
    const t = await data<{ subjectType: string; subjectId: string }>(s.applicant, "POST", "/gms/tasks", { title: "Get the board letter", subjectType: "outside_application", subjectId: oaId });
    expect(t).toMatchObject({ subjectType: "outside_application", subjectId: oaId });
    expect((await s.call(other, "POST", "/gms/tasks", { title: "x", subjectType: "outside_application", subjectId: oaId })).status).toBe(404);
    expect((await s.call(s.funder, "POST", "/gms/tasks", { title: "x", subjectType: "outside_application", subjectId: oaId })).status).toBe(403);
    expect((await s.call(s.applicant, "POST", "/gms/tasks", { title: "x", subjectType: "outside_application" })).status).toBe(400);
    expect((await data<{ tasks: { subjectType: string; title: string }[] }>(s.applicant, "GET", `/gms/outside-applications/${oaId}`)).tasks).toEqual([expect.objectContaining({ title: "Get the board letter", subjectType: "outside_application" })]);
  });

  it("notification preferences take the outside_deadline key", async () => {
    const r = await s.call<{ data: { channels: Record<string, { email: boolean }> } }>(s.applicant, "PUT", "/gms/me/notification-preferences", { digest: "weekly", channels: { outside_deadline: { inApp: true, email: false } } });
    expect(r.status).toBe(200);
    expect(r.body.data.channels.outside_deadline).toEqual({ inApp: true, email: false });
    expect(r.body.data.channels.application).toEqual({ inApp: true, email: true });
  });

  it("the consulting preview lists each fact, and sending says where it went", async () => {
    const p = await data<Record<string, unknown>>(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request/preview`, { contactName: "Ana Ruiz", contactEmail: "ana.ruiz@aldercreekfs.example", includeAnswers: true });
    expect(p).toMatchObject({ organization: "Alder Creek Family Services", contactName: "Ana Ruiz", contactEmail: "ana.ruiz@aldercreekfs.example", title: "Rural clinics 2027", funder: "Northwind Family Foundation", stage: "drafting", questionCount: 2, deadlines: { loiDue: "2027-04-20", fullDue: "2027-05-01" }, ask: { amount: "50000.00", currency: "USD" }, listingUrl: "https://northwind.example/grants", portalUrl: "https://portal.northwind.example", answersTruncated: false });
    expect(p.answers).toEqual([{ prompt: "Describe the need.", body: "Families travel 46 miles to reach a clinic." }, { prompt: "Who is served?", body: "" }]);
    expect(await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/consulting-request`, { contactName: "Ana Ruiz", contactEmail: "ana.ruiz@aldercreekfs.example" })).toMatchObject({ to: "hello@agents.opengrants.io", replyTo: "ana.ruiz@aldercreekfs.example", sentAt: expect.any(String) });
  });
});
