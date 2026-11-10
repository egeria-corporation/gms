// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  assertPaymentFieldsSafe,
  BankDataError,
  DEFAULT_REMINDER_PLAN,
  DEFAULT_TEMPLATES,
  dueReminders,
  matchInbound,
  MemoryMailer,
  MemoryReminderLog,
  MissingFieldError,
  normalizePlan,
  ReminderPlanError,
  renderEmail,
  renderTemplate,
  ResendMailer,
  runReminders,
  scheduleReminders,
  stripQuotedReply,
  TEMPLATE_KINDS,
  templateFields,
  threadIdFromAddress,
  threadReplyAddress,
  validateTemplate,
  type EmailTemplate,
  type MergeFields,
} from "../src/index.ts";

const req = { id: "req_0001", dueAt: "2027-12-15T17:00:00Z", status: "due" };
const at = (iso: string) => new Date(iso);

describe("reminder plans", () => {
  it("defaults to -30, -14, -7, 0, +3, +14 days", () => {
    expect(DEFAULT_REMINDER_PLAN).toEqual([-30, -14, -7, 0, 3, 14]);
    const plan = scheduleReminders(req);
    expect(plan.map((r) => r.offsetDays)).toEqual([-30, -14, -7, 0, 3, 14]);
    expect(plan[2]).toMatchObject({ idempotencyKey: "reminder:req_0001:-7" });
    expect(plan[2]!.sendAt.toISOString()).toBe("2027-12-08T17:00:00.000Z");
  });

  it("is editable per requirement, then per program", () => {
    expect(scheduleReminders({ ...req, reminderPlan: [0, -7, -7] }).map((r) => r.offsetDays)).toEqual([-7, 0]);
    expect(scheduleReminders(req, [-1]).map((r) => r.offsetDays)).toEqual([-1]);
    expect(scheduleReminders({ ...req, reminderPlan: [-2] }, [-1]).map((r) => r.offsetDays)).toEqual([-2]);
    expect(normalizePlan([])).toEqual([]);
    expect(() => normalizePlan([1.5])).toThrow(ReminderPlanError);
    expect(() => normalizePlan([900])).toThrow(ReminderPlanError);
  });

  it("finds what is due, sending only the latest and skipping older misses", () => {
    expect(dueReminders(req, at("2027-11-01T00:00:00Z"), new Set())).toEqual({ send: null, skip: [] });
    const first = dueReminders(req, at("2027-11-15T18:00:00Z"), new Set());
    expect(first.send?.offsetDays).toBe(-30);
    const late = dueReminders(req, at("2027-12-09T00:00:00Z"), new Set(["reminder:req_0001:-30"]));
    expect(late.send?.offsetDays).toBe(-7);
    expect(late.skip.map((r) => r.offsetDays)).toEqual([-14]);
    expect(dueReminders(req, at("2027-12-09T00:00:00Z"), new Set(["reminder:req_0001:-30", "reminder:req_0001:-14", "reminder:req_0001:-7"]))).toEqual({ send: null, skip: [] });
  });

  it("stops once submitted, accepted or waived, and holds overdue notices through the grace period", () => {
    for (const status of ["submitted", "under_review", "accepted", "waived"]) expect(dueReminders({ ...req, status }, at("2027-12-20T00:00:00Z"), new Set()).send).toBeNull();
    const sent = new Set(["reminder:req_0001:-30", "reminder:req_0001:-14", "reminder:req_0001:-7", "reminder:req_0001:0"]);
    expect(dueReminders({ ...req, status: "overdue", graceDays: 5 }, at("2027-12-19T00:00:00Z"), sent).send).toBeNull();
    expect(dueReminders({ ...req, status: "overdue", graceDays: 5 }, at("2027-12-24T00:00:00Z"), sent).send?.offsetDays).toBe(3);
  });

  it("is idempotent across job retries", async () => {
    const log = new MemoryReminderLog();
    const mailer = new MemoryMailer();
    const send = async (r: { idempotencyKey: string }) => (await mailer.send({ from: "a@funder.example", to: ["b@grantee.example"], subject: "s", html: "h", text: "t", idempotencyKey: r.idempotencyKey })).id;
    const now = at("2027-12-09T00:00:00Z");
    const runs = await Promise.all([runReminders(req, { log, now, send }), runReminders(req, { log, now, send })]);
    await runReminders(req, { log, now, send });
    expect(mailer.sent).toHaveLength(1);
    expect(runs.filter((r) => r.sent).length).toBe(1);
    expect([...log.rows.entries()].map(([k, v]) => [k, v.outcome]).sort()).toEqual([
      ["reminder:req_0001:-14", "skipped"],
      ["reminder:req_0001:-30", "skipped"],
      ["reminder:req_0001:-7", "sent"],
    ]);
  });

  it("retries a failed send on the next run without duplicating", async () => {
    const log = new MemoryReminderLog();
    const mailer = new MemoryMailer();
    const send = async (r: { idempotencyKey: string }) => (await mailer.send({ from: "a@funder.example", to: ["b@grantee.example"], subject: "s", html: "h", text: "t", idempotencyKey: r.idempotencyKey })).id;
    const now = at("2027-12-15T18:00:00Z");
    mailer.failNext = new Error("Resend 503");
    await expect(runReminders(req, { log, now, send })).rejects.toThrow("503");
    expect(mailer.sent).toHaveLength(0);
    const retry = await runReminders(req, { log, now, send });
    expect(retry.sent).toMatchObject({ offsetDays: 0 });
    expect(mailer.sent).toHaveLength(1);
  });
});

describe("template rendering", () => {
  const fields: MergeFields = {
    recipient: { name: "Maria Santos" },
    funder: { name: "Riverbend Community Foundation" },
    application: { title: "Mobile Health Navigation", submittedAt: "Apr 16, 2027" },
    opportunity: { title: "Rural Health Access Fund" },
    links: { status: "https://gms.example/w/alder-creek/applications/app_1?tab=status" },
  };

  it("merges fields into subject, text and HTML", () => {
    const out = renderEmail(DEFAULT_TEMPLATES.acknowledgment, fields);
    expect(out.subject).toBe("We received your application: Mobile Health Navigation");
    expect(out.text).toContain("Riverbend Community Foundation received Mobile Health Navigation for Rural Health Access Fund on Apr 16, 2027.");
    expect(out.text).toContain("View application status (https://gms.example/w/alder-creek/applications/app_1?tab=status)");
    expect(out.html).toContain("<strong>Mobile Health Navigation</strong>");
    expect(out.html).toMatch(/<a href="https:\/\/gms\.example[^"]*">View application status<\/a>/);
    expect(out.html.startsWith("<p>Hello Maria Santos,</p>")).toBe(true);
  });

  it("names every missing field and sends nothing", () => {
    expect(() => renderEmail(DEFAULT_TEMPLATES.acknowledgment, { recipient: { name: "Maria" }, funder: { name: "" } })).toThrow(MissingFieldError);
    try {
      renderEmail(DEFAULT_TEMPLATES.acknowledgment, { recipient: { name: "Maria" } });
    } catch (e) {
      expect((e as MissingFieldError).fields).toEqual(["application.title", "funder.name", "opportunity.title", "application.submittedAt", "links.status"]);
    }
  });

  it("escapes values so they add neither markup nor formatting nor headers", () => {
    const out = renderTemplate(
      { subject: "Re: {{t}}", body: "Title: {{t}}\n\n[Open]({{url}})" },
      { t: "<script>alert(1)</script> **bold** [x](https://evil.example) O'Brien & Co\r\nBcc: x@evil.example", url: "javascript:alert(1)" },
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("<strong>");
    expect(out.html).not.toContain('href="https://evil.example"');
    expect(out.html).not.toContain("javascript:");
    expect(out.html).toContain("O&#39;Brien &#38; Co");
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it("renders headings and lists, and does not look up prototype properties", () => {
    const out = renderTemplate({ subject: "s", body: "# Title\n\n- one\n- *two*" }, {});
    expect(out.html).toBe("<h1>Title</h1>\n<ul><li>one</li><li><em>two</em></li></ul>");
    expect(() => renderTemplate({ subject: "{{constructor}}", body: "{{a.toString}}" }, { a: {} })).toThrow(MissingFieldError);
    expect(templateFields("{{ a.b }} {{a.b}} {{c}}")).toEqual(["a.b", "c"]);
  });

  it("ships a default for every kind, each renderable from its own field list", () => {
    for (const kind of TEMPLATE_KINDS) {
      const t = DEFAULT_TEMPLATES[kind];
      expect(validateTemplate(t)).toEqual({ ok: true });
      const filled: Record<string, Record<string, string>> = {};
      for (const f of [...templateFields(t.subject), ...templateFields(t.body)]) {
        const [group, key] = f.split(".") as [string, string];
        (filled[group] ??= {})[key] = group === "links" ? "https://gms.example/x" : key === "last4" ? "4821" : `v-${key}`;
      }
      expect(() => renderEmail(t, filled)).not.toThrow();
    }
  });

  it("rejects an edited template that uses fields its kind does not supply", () => {
    const edited: EmailTemplate = { ...DEFAULT_TEMPLATES.decline, body: "Hello {{recipient.name}}, score {{review.score}}" };
    expect(validateTemplate(edited)).toEqual({ ok: false, unknownFields: ["review.score"] });
  });

  it("payment email carries bank name and last4 only", () => {
    const payment = { amount: "$75,000.00", sequence: "1 of 3", bankName: "River City Credit Union", last4: "4821", sentAt: "May 25, 2027" };
    const base: MergeFields = { recipient: { name: "Maria" }, funder: { name: "Riverbend" }, award: { title: "Mobile Health" }, links: { award: "https://gms.example/a" }, payment };
    const out = renderEmail(DEFAULT_TEMPLATES.payment_sent, base);
    expect(out.text).toContain("Destination: River City Credit Union ending in 4821");
    expect(() => assertPaymentFieldsSafe({ payment: { ...payment, last4: "000123456789" } })).toThrow(BankDataError);
    expect(() => assertPaymentFieldsSafe({ payment: { ...payment, bankName: "Acct 000123456789" } })).toThrow(BankDataError);
    expect(() => assertPaymentFieldsSafe({ payment: { ...payment, memo: "x" } })).toThrow(BankDataError);
  });
});

describe("mailer", () => {
  it("posts to Resend with the idempotency key and hides the response body on failure", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ok: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    };
    const mailer = new ResendMailer("test-key", ok);
    expect(await mailer.send({ from: "GMS <no-reply@gms.example>", to: ["maria@aldercreek.example"], subject: "s", html: "<p>h</p>", text: "h", replyTo: "thread+thr_000001@reply.gms.example", idempotencyKey: "reminder:req_0001:-7" })).toEqual({ id: "re_123" });
    expect(seen[0]!.url).toBe("https://api.resend.com/emails");
    expect((seen[0]!.init.headers as Record<string, string>)["idempotency-key"]).toBe("reminder:req_0001:-7");
    expect(JSON.parse(String(seen[0]!.init.body))).toMatchObject({ reply_to: "thread+thr_000001@reply.gms.example", to: ["maria@aldercreek.example"] });
    const bad = new ResendMailer("test-key", async () => new Response("maria@aldercreek.example is invalid", { status: 422 }));
    await expect(bad.send({ from: "a@b.example", to: ["x"], subject: "s", html: "h", text: "t" })).rejects.toMatchObject({ status: 422, retryable: false, message: "Resend refused the send (HTTP 422)." });
  });
});

describe("inbound replies", () => {
  const options = { inboundDomain: "reply.gms.example", findThreadByMessageId: async (id: string) => (id === "<abc@resend.example>" ? "thr_fromid" : null) };

  it("builds and parses plus-addresses", () => {
    expect(threadReplyAddress("thr_000001", "Reply.GMS.example")).toBe("thread+thr_000001@reply.gms.example");
    expect(threadIdFromAddress("GMS <thread+thr_000001@reply.gms.example>", "reply.gms.example")).toBe("thr_000001");
    expect(threadIdFromAddress("thread+thr_000001@evil.example", "reply.gms.example")).toBeNull();
    expect(threadIdFromAddress("grants@reply.gms.example", "reply.gms.example")).toBeNull();
    expect(() => threadReplyAddress("a b", "x.example")).toThrow();
  });

  it("matches by address first, then In-Reply-To, then References", async () => {
    expect(await matchInbound({ from: "Maria <Maria@AlderCreek.example>", to: ["thread+thr_000001@reply.gms.example"], inReplyTo: "<abc@resend.example>" }, options)).toEqual({ threadId: "thr_000001", via: "address", from: "maria@aldercreek.example" });
    expect(await matchInbound({ from: "maria@aldercreek.example", to: ["grants@riverbendcf.example"], inReplyTo: "<ABC@resend.example>" }, options)).toMatchObject({ threadId: "thr_fromid", via: "message_id" });
    expect(await matchInbound({ from: "maria@aldercreek.example", to: ["grants@riverbendcf.example"], references: "<zzz@x.example> <abc@resend.example>" }, options)).toMatchObject({ threadId: "thr_fromid" });
    expect(await matchInbound({ from: "maria@aldercreek.example", to: ["grants@riverbendcf.example"] }, options)).toBeNull();
  });

  it("strips quoted history", () => {
    expect(stripQuotedReply("Thanks, Tuesday works.\r\n\r\nOn Mon, May 3, 2027 at 9:00 AM Dana Ortiz <dana@riverbendcf.example> wrote:\r\n> Interview slots")).toBe("Thanks, Tuesday works.");
  });
});
