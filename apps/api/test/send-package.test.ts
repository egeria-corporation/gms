// SPDX-License-Identifier: AGPL-3.0-only
// Send to the funder (C4): the package's content and order, files only from this application, the
// sensitive-answer refusal, the email (preview equals sent, the daily limit, human only) and the
// footer setting.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 as nodeCrc32, inflateSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { clearDiscoveryCache } from "../src/services/applicant.ts";
import { crc32, zipStored } from "../src/services/send-package-zip.ts";
import { PACKAGE_EMAILS_PER_DAY, sensitiveAnswer } from "../src/services/send-package.ts";
import { CLIENT_AGENT, WS_APPLICANT, bearer, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let oaId: string;
let otherOaId: string;
const USER_VIEWER = "77777777-7777-4777-8777-777777777777";

type Data<T> = { data: T };
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<Data<T>>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const headersFor = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const agentHeaders = async (scope: string) => ({ ...bearer(await h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: WS_APPLICANT, jti: `tok-${Math.random()}` })).headers, "Content-Type": "application/json" });
const b64 = (text: string) => Buffer.from(text).toString("base64");
const bytesOf = async (path: string, who: Record<string, string> = s.applicant) => {
  const res = await h.request(path, { headers: who });
  expect(res.status, `${path} ${res.status}`).toBe(200);
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
};

/** The text drawn on a pdf-lib page: inflate each content stream and read its hex strings. */
function pdfText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf);
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = raw.indexOf("stream\n", at);
    if (start < 0) break;
    const end = raw.indexOf("\nendstream", start);
    try {
      const body = inflateSync(raw.subarray(start + 7, end)).toString("latin1");
      for (const m of body.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) out.push(Buffer.from(m[1]!, "hex").toString("latin1"));
    } catch {
      // Not a Flate stream (fonts are not embedded; nothing else to read).
    }
    at = end + 10;
  }
  return out.join("\n");
}

/** The entries of a stored ZIP: name and bytes, each CRC checked against Node's own. */
function unzip(zip: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(zip);
  const out = new Map<string, Buffer>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const crc = buf.readUInt32LE(at + 14);
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString("utf8");
    const body = buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    expect(nodeCrc32(body), name).toBe(crc);
    out.set(name, body);
    at += 30 + nameLen + size;
  }
  return out;
}

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  clearDiscoveryCache();
  // The in-memory mailer passes attachments on, as the Resend mailer does (packages/notify mailer.ts).
  expect(h.mailer.sendsAttachments).toBe(true);
  h.directory.users.set(USER_APPLICANT, { email: "ana.ruiz@aldercreekfs.example", name: "Ana Ruiz" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_VIEWER, role: "viewer" });
  const oa = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", {
    title: "Rural clinics 2027",
    funderName: "Northwind Family Foundation",
    programName: "Rural Health Access",
    loiDue: "2027-04-20",
    fullDue: "2027-05-01",
    internalDue: "2027-04-25",
    askAmount: { amount: "50000.00", currency: "USD" },
  });
  oaId = oa.id;
  await data(s.applicant, "PATCH", `/gms/outside-applications/${oaId}`, {
    askByYear: [
      { year: 2027, amount: { amount: "30000.00", currency: "USD" } },
      { year: 2028, amount: { amount: "20000.00", currency: "USD" } },
    ],
  });
  const qs = await data<{ id: string }[]>(s.applicant, "POST", `/gms/outside-applications/${oaId}/questions`, {
    questions: [
      { prompt: "Summarize the project.", phase: "loi" },
      { prompt: "Describe the need." },
      { prompt: "Who is served?" },
    ],
  });
  await data(s.applicant, "PUT", `/gms/outside-questions/${qs[0]!.id}/answer`, { body: "Mobile health navigation for rural families." });
  await data(s.applicant, "PUT", `/gms/outside-questions/${qs[1]!.id}/answer`, { body: "Families travel 46 miles to reach a clinic.\n\nThree clinics closed in 2025." });
  // Files: one attached to this application, one to another application, the funder's guidelines.
  await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/documents`, { name: "Letter of support.pdf", mime: "application/pdf", contentBase64: b64("%PDF-support") });
  const other = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Another application", funderName: "Elsewhere Fund" });
  otherOaId = other.id;
  await data(s.applicant, "POST", `/gms/outside-applications/${otherOaId}/documents`, { name: "Other application file.pdf", mime: "application/pdf", contentBase64: b64("%PDF-other") });
  await h.repos.table("documents").insert({ workspace_id: WS_APPLICANT, owner_workspace_id: WS_APPLICANT, subject_type: "outside_application", subject_id: oaId, name: "Funder guidelines.pdf", mime: "application/pdf", size: 4, sha256: "f".repeat(64), storage: "supabase", path: "x", doc_type: "funder_guidelines" });
  // Vault: the board list is used for this application's checklist; the audit is not.
  const board = await data<{ id: string }>(s.applicant, "POST", "/gms/vault", { name: "Board list 2027.pdf", mime: "application/pdf", contentBase64: b64("%PDF-board"), docType: "board_list" });
  await data(s.applicant, "POST", "/gms/vault", { name: "Audit 2026.pdf", mime: "application/pdf", contentBase64: b64("%PDF-audit"), docType: "audit" });
  await data(s.applicant, "PUT", `/gms/outside-applications/${oaId}/required-documents`, { items: [{ label: "Board list", docType: "board_list" }, { label: "Audit", docType: "audit" }] });
  await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/required-documents/use-from-vault`, { label: "Board list", documentId: board.id });
});

describe("the package", () => {
  it("holds the cover, the questions in order, the budget and only this application's files", async () => {
    const sum = await data<{
      cover: { organization: string; funder: string; program: string; askPrinted: string; deadlines: { label: string; date: string }[] };
      questions: { number: number; prompt: string; answered: boolean }[];
      budget: { total: string } | null;
      attachments: { name: string; source: string; requiredFor: string | null }[];
      files: { contents: string[] };
      footer: { shown: boolean };
      blocked: unknown[];
      email: { available: boolean; perDay: number; remainingToday: number };
    }>(s.applicant, "GET", `/gms/outside-applications/${oaId}/package`);
    expect(sum.cover.funder).toBe("Northwind Family Foundation");
    expect(sum.cover.askPrinted).toBe("USD 50,000.00");
    // The internal deadline is the team's own: never sent to a funder.
    expect(sum.cover.deadlines).toEqual([
      { label: "Letter of inquiry due", date: "2027-04-20" },
      { label: "Application due", date: "2027-05-01" },
    ]);
    expect(sum.questions.map((q) => [q.number, q.prompt, q.answered])).toEqual([
      [1, "Summarize the project.", true],
      [2, "Describe the need.", true],
      [3, "Who is served?", false],
    ]);
    expect(sum.budget?.total).toBe("USD 50,000.00");
    expect(sum.attachments.map((a) => [a.name, a.source, a.requiredFor])).toEqual([
      ["Letter of support.pdf", "application", null],
      ["Board list 2027.pdf", "vault", "Board list"],
    ]);
    expect(sum.files.contents).toEqual(["Rural-clinics-2027.pdf", "Letter of support.pdf", "Board list 2027.pdf", "answers.txt"]);
    expect(sum.footer.shown).toBe(true);
    expect(sum.blocked).toEqual([]);
    expect(sum.email).toMatchObject({ available: true, perDay: 5, remainingToday: 5 });

    const { bytes: pdf, res } = await bytesOf(`/gms/outside-applications/${oaId}/package.pdf`);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Rural-clinics-2027.pdf"');
    const text = pdfText(pdf);
    const order = ["Rural clinics 2027", "Alder Creek", "Northwind Family Foundation", "Rural Health Access", "USD 50,000.00", "Questions and answers", "1. Summarize the project.", "Mobile health navigation", "2. Describe the need.", "Families travel 46 miles", "Three clinics closed", "3. Who is served?", "No answer given.", "Budget summary", "USD 30,000.00", "USD 20,000.00", "Attachments", "Letter of support.pdf", "Board list 2027.pdf (Board list)"];
    let last = -1;
    for (const piece of order) {
      const at = text.indexOf(piece, last + 1);
      expect(at, `"${piece}" after position ${last}`).toBeGreaterThan(last);
      last = at;
    }
    expect(text).not.toContain("2027-04-25");
    // E4: the footer links funders to "for funders" with this applicant's package link.
    const ref = (await h.repos.table("referral_links").one({ workspace_id: WS_APPLICANT, kind: "package" }))!.token;
    // The PDF's footer is the short form, so it fits the page beside the page number.
    expect(text).toContain(`OpenGrants GMS, free for funders · app.gms.test/for-funders?ref=${ref}`);
    for (const never of ["Audit 2026", "Other application file", "Funder guidelines"]) expect(text).not.toContain(never);

    const { bytes: zip } = await bytesOf(`/gms/outside-applications/${oaId}/package.zip`);
    const entries = unzip(zip);
    expect([...entries.keys()]).toEqual(["Rural-clinics-2027.pdf", "Letter of support.pdf", "Board list 2027.pdf", "answers.txt"]);
    expect(entries.get("Letter of support.pdf")!.toString()).toBe("%PDF-support");
    expect(entries.get("Board list 2027.pdf")!.toString()).toBe("%PDF-board");
    expect(Buffer.compare(entries.get("Rural-clinics-2027.pdf")!, Buffer.from(pdf))).toBe(0);
    const answers = entries.get("answers.txt")!.toString("utf8");
    expect(answers.indexOf("1. Summarize the project.")).toBeLessThan(answers.indexOf("2. Describe the need."));
    expect(answers).toContain("3. Who is served?\n\n(no answer given)");
    expect(answers.trimEnd().endsWith(`/for-funders?ref=${ref}`)).toBe(true);
  });

  it("gives the same bytes for the same content, and reads the same with zip tools", async () => {
    const a = (await bytesOf(`/gms/outside-applications/${oaId}/package.zip`)).bytes;
    h.clock.now = new Date(h.clock.now.getTime() + 3_600_000);
    const b = (await bytesOf(`/gms/outside-applications/${oaId}/package.zip`)).bytes;
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), "c4-zip-"));
    writeFileSync(join(dir, "p.zip"), a);
    const listing = execFileSync("unzip", ["-t", join(dir, "p.zip")], { encoding: "utf8" });
    expect(listing).toContain("No errors detected");
  });

  it("names files uniquely, and a vault document not used for this application never comes in", async () => {
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/documents`, { name: "letter of support.pdf", mime: "application/pdf", contentBase64: b64("%PDF-two") });
    const sum = await data<{ files: { contents: string[] } }>(s.applicant, "GET", `/gms/outside-applications/${oaId}/package`);
    expect(sum.files.contents).toEqual(["Rural-clinics-2027.pdf", "Letter of support.pdf", "letter of support (2).pdf", "Board list 2027.pdf", "answers.txt"]);
    // Taking the board list off the checklist takes it out of the package.
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/required-documents/use-from-vault`, { label: "Board list", documentId: null });
    const after = await data<{ attachments: { source: string }[] }>(s.applicant, "GET", `/gms/outside-applications/${oaId}/package`);
    expect(after.attachments.every((a) => a.source === "application")).toBe(true);
  });

  it("is private: another workspace gets 404, a consultant and a funder are refused", async () => {
    const other = await headersFor("55555555-5555-4555-8555-555555555555", "44444444-4444-4444-8444-444444444444");
    await h.repos.table("workspaces").insert({ id: "44444444-4444-4444-8444-444444444444", kind: "applicant", handle: "other-applicant", display_name: "Other Applicant" });
    await h.repos.table("workspace_members").insert({ workspace_id: "44444444-4444-4444-8444-444444444444", user_id: "55555555-5555-4555-8555-555555555555", role: "admin" });
    for (const path of ["package", "package.pdf", "package.zip"]) expect((await s.call(other, "GET", `/gms/outside-applications/${oaId}/${path}`)).status).toBe(404);
    expect((await s.call(s.funder, "GET", `/gms/outside-applications/${oaId}/package`)).status).toBe(403);
    // A viewer may download, not email.
    const viewer = await headersFor(USER_VIEWER, WS_APPLICANT);
    expect((await s.call(viewer, "GET", `/gms/outside-applications/${oaId}/package.zip`)).status).toBe(200);
    const sum = await data<{ email: { available: boolean; reason: string } }>(viewer, "GET", `/gms/outside-applications/${oaId}/package`);
    expect(sum.email).toMatchObject({ available: false, reason: "Workspace admins and editors email the package" });
    expect((await s.call(viewer, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to: "lee@northwind.example" })).status).toBe(403);
  });
});

describe("the sensitive screen", () => {
  it("reads digit runs the way the importer reads cells", () => {
    expect(sensitiveAnswer("Our routing is 021000021 for the grant.", "Payment details")).toBe("bank_routing");
    expect(sensitiveAnswer("Her number is 123-45-6789.", "Staff")).toBe("identity_number");
    expect(sensitiveAnswer("Account 1234 5678 9012 3456", "Banking")).toBe("long_number");
    expect(sensitiveAnswer("Call 555-010-0123 or visit.", "Contact")).toBeNull();
    expect(sensitiveAnswer("We served 1,240 families in 2025 and 2026, $50,000 in all.", "Need")).toBeNull();
    // A question that asks for the EIN may hold one.
    expect(sensitiveAnswer("12-3456789", "Organization EIN")).toBeNull();
    expect(sensitiveAnswer("12-3456789", "Tell us about you")).toBe("identity_number");
  });

  it("refuses the package and the email, naming the question", async () => {
    const qid = (await h.repos.table("outside_questions").find({ outside_application_id: oaId })).find((q) => q.prompt === "Who is served?")!.id;
    await data(s.applicant, "PUT", `/gms/outside-questions/${qid}/answer`, { body: "Families; payments go to account 000123456789 at the credit union." });
    const sum = await data<{ blocked: { number: number; message: string }[]; email: { available: boolean } }>(s.applicant, "GET", `/gms/outside-applications/${oaId}/package`);
    expect(sum.blocked.map((b) => b.number)).toEqual([3]);
    expect(sum.blocked[0]!.message).toBe("The answer to question 3 (“Who is served?”) looks like it holds an account or card number. Take the number out of the answer, then try again.");
    expect(sum.email.available).toBe(false);
    for (const [method, path, body] of [
      ["GET", `/gms/outside-applications/${oaId}/package.pdf`],
      ["GET", `/gms/outside-applications/${oaId}/package.zip`],
      ["POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to: "lee@northwind.example" }],
    ] as [string, string, unknown?][]) {
      const r = await s.call<{ errors: { code: string; field: string }[]; message: string }>(s.applicant, method, path, body);
      expect(r.status, path).toBe(422);
      expect(r.body.errors.map((e) => e.code)).toEqual(["sensitive_answer", "sensitive_answer"]);
      expect(r.body.errors[1]).toMatchObject({ code: "sensitive_answer", field: "questions[2]" });
      // The number itself never comes back.
      expect(JSON.stringify(r.body)).not.toContain("000123456789");
    }
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe("emailing the package", () => {
  const to = "Lee.Park@Northwind.example";

  it("sends exactly the preview, under the person's name with replies to them", async () => {
    const p = await data<{ from: string; to: string; replyTo: string; subject: string; text: string; html: string; attachments: { filename: string; sha256: string; size: number }[]; digest: string; remainingToday: number }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to, message: "Dear Lee,\n\nAs discussed, our application." });
    expect(p.from).toMatch(/^"Ana Ruiz" <[^>]+>$/);
    expect(p.to).toBe("lee.park@northwind.example");
    expect(p.replyTo).toBe("ana.ruiz@aldercreekfs.example");
    expect(p.subject).toBe("Application: Rural clinics 2027 (Alder Creek Family Services)");
    expect(p.attachments.map((a) => a.filename)).toEqual(["Rural-clinics-2027.pdf", "Letter of support.pdf", "Board list 2027.pdf"]);
    expect(p.attachments[1]!.size).toBe("%PDF-support".length);
    expect(h.mailer.sent).toHaveLength(0);

    const out = await data<{ sent: boolean; sendId: string; remainingToday: number }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email`, { to, message: "Dear Lee,\n\nAs discussed, our application.", digest: p.digest });
    expect(out).toMatchObject({ sent: true, remainingToday: 4 });
    const mail = h.mailer.sent.at(-1)! as (typeof h.mailer.sent)[number] & { attachments: { filename: string; content: string; contentType: string }[] };
    expect({ from: mail.from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html }).toEqual({ from: p.from, to: [p.to], replyTo: p.replyTo, subject: p.subject, text: p.text, html: p.html });
    expect(mail.attachments.map((a) => a.filename)).toEqual(p.attachments.map((a) => a.filename));
    expect(Buffer.from(mail.attachments[1]!.content, "base64").toString()).toBe("%PDF-support");
    expect(mail.text).toContain("Prepared with the OpenGrants Grant Management System");

    const [row] = await h.repos.table("package_sends").find({ outside_application_id: oaId });
    expect(row).toMatchObject({ to_masked: "l…@northwind.example", attachment_count: 2, slot: 1, package_sha256: p.attachments[0]!.sha256 });
    expect(row!.sent_at).not.toBeNull();
    const e = h.ledger.events.find((x) => x.eventType === "outside_application.package_sent")!;
    expect(e.workspaceId).toBe(WS_APPLICANT);
    expect(JSON.stringify(e.data)).not.toContain("lee.park");
    expect(JSON.stringify(e.data)).not.toContain("Dear Lee");
  });

  it("refuses a send that is not the preview", async () => {
    const p = await data<{ digest: string }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to });
    const qid = (await h.repos.table("outside_questions").find({ outside_application_id: oaId })).find((q) => q.prompt === "Who is served?")!.id;
    await data(s.applicant, "PUT", `/gms/outside-questions/${qid}/answer`, { body: "Rural households." });
    const r = await s.call<{ errors: { code: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email`, { to, digest: p.digest });
    expect(r.status).toBe(409);
    expect(r.body.errors[0]!.code).toBe("preview_changed");
    const other = await s.call(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email`, { to: "someone@else.example", digest: p.digest });
    expect(other.status).toBe(409);
    expect(h.mailer.sent).toHaveLength(0);
  });

  it(`sends at most ${PACKAGE_EMAILS_PER_DAY} a day per application`, async () => {
    let who = s.applicant;
    const send = async () => {
      const p = await data<{ digest: string }>(who, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to });
      return s.call<{ errors: { code: string }[] }>(who, "POST", `/gms/outside-applications/${oaId}/package/email`, { to, digest: p.digest });
    };
    for (let i = 0; i < PACKAGE_EMAILS_PER_DAY; i++) expect((await send()).status).toBe(200);
    const sixth = await send();
    expect(sixth.status).toBe(429);
    expect(sixth.body.errors[0]!.code).toBe("too_many_package_emails");
    expect(h.mailer.sent).toHaveLength(PACKAGE_EMAILS_PER_DAY);
    const sum = await data<{ email: { available: boolean; remainingToday: number } }>(s.applicant, "GET", `/gms/outside-applications/${oaId}/package`);
    expect(sum.email).toMatchObject({ available: false, remainingToday: 0 });
    // Another application has its own count; the next day starts again.
    expect((await data<{ email: { remainingToday: number } }>(s.applicant, "GET", `/gms/outside-applications/${otherOaId}/package`)).email.remainingToday).toBe(5);
    h.clock.now = new Date(h.clock.now.getTime() + 86_400_000);
    who = await headersFor(USER_APPLICANT, WS_APPLICANT);
    expect((await send()).status).toBe(200);
  });

  it("gives the place back when the email fails", async () => {
    const p = await data<{ digest: string }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to });
    h.mailer.failNext = new Error("Resend is down");
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email`, { to, digest: p.digest })).status).toBe(502);
    expect(await h.repos.table("package_sends").count({ outside_application_id: oaId })).toBe(0);
  });

  it("is a person's: an agent's token is refused, and no MCP tool sends it", async () => {
    const agent = await agentHeaders("applications:read applications:write");
    // Reading and downloading is open to the agent.
    expect((await s.call(agent, "GET", `/gms/outside-applications/${oaId}/package`)).status).toBe(200);
    expect((await h.request(`/gms/outside-applications/${oaId}/package.zip`, { headers: agent })).status).toBe(200);
    const p = await data<{ digest: string }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to });
    for (const [path, body] of [
      ["package/email/preview", { to }],
      ["package/email", { to, digest: p.digest }],
    ] as const) {
      const r = await s.call<{ errors: { code: string }[] }>(agent, "POST", `/gms/outside-applications/${oaId}/${path}`, body);
      expect(r.status, path).toBe(403);
      expect(r.body.errors[0]!.code).toBe("approval_required");
    }
    const sum = await data<{ email: { available: boolean; reason: string } }>(agent, "GET", `/gms/outside-applications/${oaId}/package`);
    expect(sum.email).toMatchObject({ available: false, reason: "Only a person emails the package, in the GMS" });
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("an editor sends; a server whose mailer drops attachments does not", async () => {
    h.directory.users.set(USER_APPLICANT_EDITOR, { email: "jo@aldercreekfs.example", name: null });
    const editor = await headersFor(USER_APPLICANT_EDITOR, WS_APPLICANT);
    const p = await data<{ from: string; replyTo: string }>(editor, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to });
    expect(p.from.startsWith('"Jo" <')).toBe(true);
    expect(p.replyTo).toBe("jo@aldercreekfs.example");
    (h.mailer as unknown as { sendsAttachments: boolean }).sendsAttachments = false;
    const r = await s.call<{ errors: { code: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to });
    expect(r.status).toBe(503);
    expect(r.body.errors[0]!.code).toBe("mail_attachments_unavailable");
    const sum = await data<{ email: { available: boolean; reason: string } }>(s.applicant, "GET", `/gms/outside-applications/${oaId}/package`);
    expect(sum.email.reason).toBe("This server cannot email files. Download the package and send it from your own email");
  });

  it("refuses an archived application and a bad address", async () => {
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to: "not an address" })).status).toBe(400);
    await data(s.applicant, "POST", `/gms/outside-applications/${oaId}/archive`);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to })).status).toBe(409);
  });
});

describe("the footer setting", () => {
  it("is on by default and off when an admin turns Powered by off", async () => {
    expect((await s.call(await headersFor(USER_APPLICANT_EDITOR, WS_APPLICANT), "PUT", "/gms/send-package/settings", { poweredBy: false })).status).toBe(403);
    const agent = await agentHeaders("workspace:admin applications:read");
    expect((await s.call(agent, "PUT", "/gms/send-package/settings", { poweredBy: false })).status).toBe(403);
    expect(await data(s.applicant, "PUT", "/gms/send-package/settings", { poweredBy: false })).toEqual({ poweredBy: false });
    expect((await h.repos.table("workspaces").one({ id: WS_APPLICANT }))!.settings).toMatchObject({ poweredBy: false });
    const sum = await data<{ footer: { shown: boolean } }>(s.applicant, "GET", `/gms/outside-applications/${oaId}/package`);
    expect(sum.footer.shown).toBe(false);
    const pdf = (await bytesOf(`/gms/outside-applications/${oaId}/package.pdf`)).bytes;
    expect(pdfText(pdf)).not.toContain("for-funders");
    expect(pdfText(pdf)).toContain("Page 1 of");
    const answers = unzip((await bytesOf(`/gms/outside-applications/${oaId}/package.zip`)).bytes).get("answers.txt")!.toString();
    expect(answers).not.toContain("Prepared with");
    const p = await data<{ text: string; html: string }>(s.applicant, "POST", `/gms/outside-applications/${oaId}/package/email/preview`, { to: "lee@northwind.example" });
    expect(p.text + p.html).not.toContain("Prepared with");
    await data(s.applicant, "PUT", "/gms/send-package/settings", { poweredBy: true });
    expect(pdfText((await bytesOf(`/gms/outside-applications/${oaId}/package.pdf`)).bytes)).toContain("OpenGrants GMS, free for funders");
  });
});

describe("zip writer", () => {
  it("writes CRCs Node agrees with", () => {
    const bytes = new TextEncoder().encode("hello, world");
    expect(crc32(bytes)).toBe(nodeCrc32(bytes));
    const zip = zipStored([{ name: "ä.txt", bytes }], "2027-04-20T10:00:00.000Z");
    expect([...unzip(zip).keys()]).toEqual(["ä.txt"]);
  });
});

describe("MCP", () => {
  let seq = 0;
  const rpc = async (token: string, method: string, params?: unknown) => {
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }) });
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  };
  const token = () => h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope: "applications:read applications:write", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: `tok-pkg-${++seq}` });

  it("an agent reads what the package holds; no tool sends it", async () => {
    const out = (await rpc(await token(), "tools/call", { name: "get_send_package", arguments: { outsideApplicationId: oaId } })).structuredContent as { files: { contents: string[] }; downloads: { zip: string }; email: { available: boolean; reason: string } };
    expect(out.files.contents).toEqual(["Rural-clinics-2027.pdf", "Letter of support.pdf", "Board list 2027.pdf", "answers.txt"]);
    expect(out.downloads.zip).toBe(`/gms/outside-applications/${oaId}/package.zip`);
    expect(out.email).toMatchObject({ available: false, reason: "Only a person emails the package, in the GMS" });
    const tools = (await rpc(await token(), "tools/list")).tools as { name: string; _meta: Record<string, unknown> }[];
    expect(tools.filter((t) => /package|funder_email|send_to/.test(t.name)).map((t) => t.name)).toEqual(["get_send_package"]);
    expect(tools.find((t) => t.name === "get_send_package")!._meta["gms/gated"]).toBe(false);
    expect(h.mailer.sent).toHaveLength(0);
  });
});
