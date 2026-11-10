// SPDX-License-Identifier: AGPL-3.0-only
// Member email honors each person's notification preferences; digests are sent once per period.
import { beforeEach, describe, expect, it } from "vitest";
import { sendDigests } from "../src/jobs.ts";
import { USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let appUuid: string;

const base = () => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory } });
const prefs = (userId: string, workspaceId: string, p: Record<string, unknown>) => h.repos.table("workspace_members").update({ workspace_id: workspaceId, user_id: userId }, { notification_preferences: p as never });

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreek.example", name: "Maria Santos" });
  h.directory.users.set(USER_APPLICANT_EDITOR, { email: "jamal.reed@aldercreek.example", name: "Jamal Reed" });
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  appUuid = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles." } });
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/submit`);
  h.mailer.sent.length = 0;
});

async function post(who: Record<string, string>, body: string) {
  const thread = await s.call<{ data: { id: string } }>(who, "POST", "/gms/threads", { subjectType: "application", subjectId: appUuid, visibility: "shared" });
  return s.call(who, "POST", `/gms/threads/${thread.body.data.id}/messages`, { body });
}

describe("thread messages", () => {
  it("emails the other side and the author's teammates, never the author, with a reply address into the thread", async () => {
    expect((await post(s.funder, "Interview slots are open.")).status).toBeLessThan(300);
    const to = h.mailer.sent.map((m) => m.to[0]).sort();
    expect(to).toEqual(["helen.ortiz@riverbendcf.example", "jamal.reed@aldercreek.example", "maria.santos@aldercreek.example"]);
    expect(to).not.toContain("dana.ortiz@riverbendcf.example");
    const mail = h.mailer.sent.find((m) => m.to[0] === "maria.santos@aldercreek.example")!;
    expect(mail.text).toContain("Interview slots are open.");
    expect(mail.text).toContain(`/w/alder-creek/applications/app_${appUuid}`);
    expect(mail.replyTo).toMatch(/^thread\+[0-9a-f-]{36}@gms\.test$/);
  });

  it("honors email off and holds mail for members on a digest", async () => {
    await prefs(USER_APPLICANT, WS_APPLICANT, { digest: "immediate", channels: { application: { inApp: true, email: false } } });
    await prefs(USER_APPLICANT_EDITOR, WS_APPLICANT, { digest: "daily", channels: {} });
    await prefs(USER_ADMIN, WS_FUNDER, { digest: "off", channels: {} });
    await post(s.funder, "Thanks for the revised budget.");
    // "off" means no digest: that member is mailed at once. The other two are not mailed now.
    expect(h.mailer.sent.map((m) => m.to[0])).toEqual(["helen.ortiz@riverbendcf.example"]);
  });
});

describe("digests", () => {
  it("sends one digest per member per day, only for categories they still want by email", async () => {
    await prefs(USER_APPLICANT_EDITOR, WS_APPLICANT, { digest: "daily", channels: {} });
    await prefs(USER_APPLICANT, WS_APPLICANT, { digest: "daily", channels: { application: { inApp: true, email: false } } });
    await s.call(s.funder, "POST", `/gms/applications/app_${appUuid}/request-revision`, { fields: [{ formId: s.loiFormId, path: "/need" }], message: "Please cite the county assessment." });
    h.mailer.sent.length = 0;

    const first = await sendDigests(base(), "daily");
    expect(first.sent).toBe(1);
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]!.to).toEqual(["jamal.reed@aldercreek.example"]);
    expect(h.mailer.sent[0]!.text).toContain("https://app.gms.test/notifications");
    expect((await h.ledger.list({ workspaceId: WS_APPLICANT, eventType: "notification.digest_sent" }))).toHaveLength(1);

    // A second run the same day sends nothing; weekly members are a different run.
    expect((await sendDigests(base(), "daily")).sent).toBe(0);
    expect((await sendDigests(base(), "weekly")).sent).toBe(0);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it("does nothing without a mailer", async () => {
    await prefs(USER_OFFICER, WS_FUNDER, { digest: "daily", channels: {} });
    expect(await sendDigests({ ...base(), ports: {} }, "daily")).toEqual({ sent: 0, empty: 0, failed: 0 });
  });
});

describe("invitations", () => {
  it("emails the invitation link and says so", async () => {
    const r = await s.call<{ data: { emailed: boolean; acceptUrl: string } }>({ ...s.funder, Authorization: `Bearer ${await h.session(USER_ADMIN)}` }, "POST", `/gms/workspaces/${WS_FUNDER}/invitations`, { email: "priya.natarajan@riverbendcf.example", role: "reviewer" });
    expect(r.status).toBeLessThan(300);
    expect(r.body.data.emailed).toBe(true);
    const mail = h.mailer.sent.at(-1)!;
    expect(mail.to).toEqual(["priya.natarajan@riverbendcf.example"]);
    expect(mail.text).toContain(r.body.data.acceptUrl);
  });
});
