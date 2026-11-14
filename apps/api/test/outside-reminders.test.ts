// SPDX-License-Identifier: AGPL-3.0-only
// Outside application deadline reminders (the daily job) and the weekly digest's deadline list.
import { beforeEach, describe, expect, it } from "vitest";
import { sendDigests, sendOutsideReminders } from "../src/jobs.ts";
import { WS_APPLICANT, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let oaId: string;

const base = () => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory } });
const prefs = (userId: string, p: Record<string, unknown>) => h.repos.table("workspace_members").update({ workspace_id: WS_APPLICANT, user_id: userId }, { notification_preferences: p as never });
const inDays = (n: number) => new Date(h.clock.now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const data = async <T>(method: string, path: string, body?: unknown) => (await s.call<{ data: T }>(s.applicant, method, path, body ?? {})).body.data;

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreek.example", name: "Maria Santos" });
  h.directory.users.set(USER_APPLICANT_EDITOR, { email: "jamal.reed@aldercreek.example", name: "Jamal Reed" });
  const oa = await data<{ id: string }>("POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", fullDue: inDays(7), internalDue: inDays(2), loiDue: inDays(30) });
  oaId = oa.id;
  const [q1] = await data<{ id: string }[]>("POST", `/gms/outside-applications/${oaId}/questions`, { questions: [{ prompt: "Need?", assigneeUserId: USER_APPLICANT_EDITOR }, { prompt: "Budget?" }] });
  void q1;
  h.mailer.sent.length = 0;
});

describe("outside deadline reminders", () => {
  it("emails the owner and the people on open questions at 7 and 2 days, once", async () => {
    const out = await sendOutsideReminders(base());
    expect(out).toMatchObject({ checked: 2, reminded: 2, failed: 0 });
    const subjects = h.mailer.sent.map((m) => `${m.to[0]} ${m.subject}`).sort();
    expect(subjects).toEqual([
      "jamal.reed@aldercreek.example Full application due in 7 days: Rural clinics 2027",
      "jamal.reed@aldercreek.example Internal deadline due in 2 days: Rural clinics 2027",
      "maria.santos@aldercreek.example Full application due in 7 days: Rural clinics 2027",
      "maria.santos@aldercreek.example Internal deadline due in 2 days: Rural clinics 2027",
    ]);
    const mail = h.mailer.sent.find((m) => m.subject.startsWith("Full"))!;
    expect(mail.text).toContain("2 questions are not yet approved.");
    expect(mail.html).toContain(`https://app.gms.test/w/alder-creek/outside/${oaId}`);
    // A second run on the same day sends nothing new.
    await sendOutsideReminders(base());
    expect(h.mailer.sent).toHaveLength(4);
  });

  it("honours a person who turned deadline email off, and skips the days between", async () => {
    await prefs(USER_APPLICANT_EDITOR, { digest: "immediate", channels: { outside_deadline: { inApp: true, email: false } } });
    await sendOutsideReminders(base());
    expect(new Set(h.mailer.sent.map((m) => m.to[0]))).toEqual(new Set(["maria.santos@aldercreek.example"]));
    h.mailer.sent.length = 0;
    h.clock.now = new Date(h.clock.now.getTime() + 86_400_000);
    // Six days to the full deadline and one to the internal one: neither is a reminder day.
    expect((await sendOutsideReminders(base())).checked).toBe(0);
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("sends nothing for an archived application, or for the full deadline once submitted", async () => {
    await data("POST", `/gms/outside-applications/${oaId}/submit`, { submittedAt: h.clock.now.toISOString(), method: "portal" });
    expect((await sendOutsideReminders(base())).checked).toBe(0);
    await data("POST", `/gms/outside-applications/${oaId}/decision`, { outcome: "withdrawn" });
    await data("POST", `/gms/outside-applications/${oaId}/reopen`);
    await data("POST", `/gms/outside-applications/${oaId}/archive`);
    expect((await sendOutsideReminders(base())).checked).toBe(0);
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe("weekly digest", () => {
  it("lists outside deadlines due in the next 14 days, even with nothing else new", async () => {
    await prefs(USER_APPLICANT, { digest: "weekly", channels: {} });
    const out = await sendDigests(base(), "weekly");
    expect(out.sent).toBe(1);
    const mail = h.mailer.sent.find((m) => m.to[0] === "maria.santos@aldercreek.example")!;
    expect(mail.text).toContain("Deadlines in the next 14 days:");
    expect(mail.text).toContain(`- ${inDays(2)} Internal deadline: Rural clinics 2027 (Northwind Family Foundation)`);
    expect(mail.text).toContain(`- ${inDays(7)} Application due: Rural clinics 2027 (Northwind Family Foundation)`);
    expect(mail.text).not.toContain(inDays(30));
  });

  it("leaves the deadlines out for a member who turned deadline email off", async () => {
    await prefs(USER_APPLICANT, { digest: "weekly", channels: { outside_deadline: { inApp: true, email: false } } });
    await sendDigests(base(), "weekly");
    expect(h.mailer.sent.filter((m) => m.to[0] === "maria.santos@aldercreek.example").every((m) => !m.text.includes("Deadlines in the next 14 days"))).toBe(true);
  });
});
