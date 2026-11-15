// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in content digests: off by default, turned on by the person only, one-click unsubscribe by a
// signed link, never a repeated match, never an empty email, once per ISO week, nothing for a
// removed member, counts only for funder staff, and no deadline a reminder already sent today.
import { beforeEach, describe, expect, it } from "vitest";
import { sendOutsideReminders } from "../src/jobs.ts";
import { clearDiscoveryCache } from "../src/services/applicant.ts";
import { isoWeek, nextSendOn, readUnsubscribeToken, saveDigestSettings, sendContentDigests, unsubscribeToken } from "../src/services/content-digests.ts";
import { makeActor, type BaseContext } from "../src/services/context.ts";
import { OpenGrantsUnavailableError } from "../src/services/ports.ts";
import { TEST_CREDENTIALS_KEY, WS_APPLICANT, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;

const MARIA = "maria.santos@aldercreek.example";
const JAMAL = "jamal.reed@aldercreek.example";
const base = (extra: Partial<BaseContext["config"]> = {}): BaseContext => ({
  repos: h.repos,
  ledger: h.ledger,
  webhooks: h.webhooks,
  now: () => h.clock.now,
  config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: TEST_CREDENTIALS_KEY, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>", ...extra },
  ports: { mailer: h.mailer, directory: h.directory, openGrants: h.openGrants },
});
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<{ data: T; errors?: { code: string }[] }>(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
type Settings = { digests: { key: string; on: boolean; label: string }[]; promptDismissed: boolean; nextSendOn: string; emailAvailable: boolean };
const mailTo = (to: string) => h.mailer.sent.filter((m) => m.to[0] === to);
const nextWeek = () => void (h.clock.now = new Date(h.clock.now.getTime() + 7 * 86_400_000));
const tokenOf = (m: { headers?: Record<string, string> }) => /token=([^>]+)>/.exec(m.headers?.["List-Unsubscribe"] ?? "")![1]!;

beforeEach(async () => {
  clearDiscoveryCache();
  h = await harness();
  s = await scenario(h);
  h.directory.users.set(USER_APPLICANT, { email: MARIA, name: "Maria Santos" });
  h.directory.users.set(USER_APPLICANT_EDITOR, { email: JAMAL, name: "Jamal Reed" });
  h.mailer.sent.length = 0;
});

describe("choosing digests", () => {
  it("starts with every digest off, and sends nothing to anyone", async () => {
    const mine = await data<Settings>(s.applicant, "GET", "/gms/digests");
    expect(mine.digests.map((d) => [d.key, d.on])).toEqual([
      ["new_matches", false],
      ["deadlines", false],
    ]);
    expect(mine.promptDismissed).toBe(false);
    expect(mine.emailAvailable).toBe(true);
    const funder = await data<Settings>(s.funder, "GET", "/gms/digests");
    expect(funder.digests.map((d) => [d.key, d.on])).toEqual([["funder_activity", false]]);
    // Even people on the weekly event digest get none of these until they turn one on.
    await h.repos.table("workspace_members").update({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT }, { notification_preferences: { digest: "weekly", channels: {} } as never });
    const out = await sendContentDigests(base());
    expect(out).toMatchObject({ sent: 0, empty: 0, failed: 0 });
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("is the person's own choice, per workspace, and only the digests their role gets", async () => {
    const on = await data<Settings>(s.applicant, "PUT", "/gms/digests", { new_matches: true, promptDismissed: true });
    expect(on.digests.find((d) => d.key === "new_matches")?.on).toBe(true);
    expect(on.promptDismissed).toBe(true);
    // The editor in the same workspace is still off.
    expect((await data<Settings>(s.editor, "GET", "/gms/digests")).digests.every((d) => !d.on)).toBe(true);
    const wrong = await s.call<{ errors: { code: string }[] }>(s.applicant, "PUT", "/gms/digests", { funder_activity: true });
    expect(wrong.status).toBe(422);
    expect(wrong.body.errors[0]!.code).toBe("digest_not_offered");
    // An auditor at the funder gets no activity digest.
    const auditor = { ...s.funder, Authorization: `Bearer ${await h.session("cccccccc-cccc-4ccc-8ccc-cccccccccccc")}` };
    expect((await data<Settings>(auditor, "GET", "/gms/digests")).digests).toEqual([]);
    // An agent acting for the person may not turn email on for them.
    const ws = { id: WS_APPLICANT, kind: "applicant" as const, role: "admin", memberScope: null };
    await expect(saveDigestSettings({ ...base(), actor: makeActor("delegated", USER_APPLICANT, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"), workspace: ws, scopes: ["discovery"] }, { deadlines: true })).rejects.toMatchObject({ status: 403, code: "person_required" });
  });

  it("knows the ISO week and the next Monday", () => {
    expect(isoWeek(new Date("2027-04-16T17:00:00Z"))).toBe("2027-W15");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeek(new Date("2026-12-28T12:00:00Z"))).toBe("2026-W53");
    expect(nextSendOn(new Date("2027-04-16T17:00:00Z"))).toBe("2027-04-19");
    expect(nextSendOn(new Date("2027-04-19T09:00:00Z"))).toBe("2027-04-19");
    expect(nextSendOn(new Date("2027-04-19T15:30:00Z"))).toBe("2027-04-26");
  });
});

describe("new matches", () => {
  beforeEach(async () => {
    await data(s.applicant, "PUT", "/gms/digests", { new_matches: true });
  });

  it("sends open opportunities here and OpenGrants matches, with one-click unsubscribe, once a week", async () => {
    const out = await sendContentDigests(base());
    expect(out).toMatchObject({ sent: 1, failed: 0, openGrantsCalls: 1 });
    const [mail] = mailTo(MARIA);
    expect(mail!.subject).toMatch(/^\d+ new funding match(es)? for Alder Creek Family Services$/);
    expect(mail!.text).toContain("Community Health Grants 2027 (Riverbend Community Foundation)");
    expect(mail!.text).toContain("Open for applications here");
    expect(mail!.text).toContain("Rural Health Access Fund (Northwind Family Foundation)");
    expect(mail!.text).toContain("https://app.gms.test/w/alder-creek/find");
    expect(mail!.text).toMatch(/Stop getting this email: https:\/\/app\.gms\.test\/digests\/unsubscribe#token=v1\./);
    expect(mail!.html).not.toMatch(/<img/i);
    expect(mail!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail!.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/gms\.test\/gms\/digests\/unsubscribe\?token=v1\./);
    expect(mail!.idempotencyKey).toMatch(/^digest_new_matches:[0-9a-f-]{36}:2027-W15$/);
    // A second run in the same ISO week sends nothing and records nothing new.
    expect(await sendContentDigests(base())).toMatchObject({ sent: 0, already: 1 });
    expect(h.mailer.sent).toHaveLength(1);
    expect(await h.repos.table("digest_sends").count({ user_id: USER_APPLICANT })).toBe(1);
  });

  it("never repeats a match, and sends no email when nothing is new", async () => {
    await sendContentDigests(base());
    expect(mailTo(MARIA)).toHaveLength(1);
    nextWeek();
    clearDiscoveryCache();
    expect(await sendContentDigests(base())).toMatchObject({ sent: 0, empty: 1 });
    expect(mailTo(MARIA)).toHaveLength(1);
    // A new listing at OpenGrants is the only thing in the next email.
    nextWeek();
    clearDiscoveryCache();
    h.openGrants.call = async () => ({ items: [{ id: "og-1", title: "Rural Health Access Fund" }, { id: "og-9", title: "Valley Family Fund", funder: "Cascade Trust" }] });
    expect(await sendContentDigests(base())).toMatchObject({ sent: 1 });
    const latest = mailTo(MARIA).at(-1)!;
    expect(latest.subject).toBe("1 new funding match for Alder Creek Family Services");
    expect(latest.text).toContain("Valley Family Fund (Cascade Trust)");
    expect(latest.text).not.toContain("Rural Health Access Fund");
    expect(latest.text).not.toContain("Community Health Grants 2027");
  });

  it("leaves out what the workspace already saved or tracks, and what it applied to", async () => {
    await data(s.applicant, "POST", "/gms/discover/saved", { source: "opengrants", externalId: "og-1", title: "Rural Health Access Fund" });
    await data(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    h.mailer.sent.length = 0;
    await sendContentDigests(base());
    const text = mailTo(MARIA).map((m) => m.text).join("\n");
    expect(text).not.toContain("Rural Health Access Fund");
    // The open competition they applied to is not offered again (an OpenGrants listing of the same name that does not point here may be).
    expect(text).not.toContain("Open for applications here");
    expect(text).not.toContain("https://app.gms.test/f/riverbend/o/");
  });

  it("sends the part from this site when OpenGrants is down and says so, and skips when that part is empty", async () => {
    h.openGrants.call = async () => {
      throw new OpenGrantsUnavailableError("OpenGrants answered 429", 429);
    };
    await data(s.editor, "PUT", "/gms/digests", { new_matches: true });
    const out = await sendContentDigests(base());
    // Asked once for the workspace; after the failure nothing more is asked this run.
    expect(out).toMatchObject({ sent: 2, openGrantsCalls: 1, openGrantsDown: true });
    const mail = mailTo(MARIA)[0]!;
    expect(mail.text).toContain("Community Health Grants 2027");
    expect(mail.text).toContain("We couldn't reach OpenGrants this week");
    nextWeek();
    clearDiscoveryCache();
    expect(await sendContentDigests(base())).toMatchObject({ sent: 0, empty: 2 });
  });

  it("stays within the run's OpenGrants budget", async () => {
    const before = h.openGrants.calls.length;
    const out = await sendContentDigests(base(), { maxOpenGrantsCalls: 0 });
    expect(out.openGrantsCalls).toBe(0);
    expect(h.openGrants.calls.length).toBe(before);
    expect(mailTo(MARIA)[0]!.text).toContain("We couldn't reach OpenGrants this week");
  });

  it("previews next Monday's email without sending or recording it", async () => {
    const p = await data<{ willSend: boolean; on: boolean; sendsOn: string; subject: string; text: string }>(s.applicant, "GET", "/gms/digests/preview?digest=new_matches");
    expect(p).toMatchObject({ willSend: true, on: true, sendsOn: "2027-04-19" });
    expect(p.subject).toMatch(/new funding match/);
    expect(p.text).toContain("Community Health Grants 2027");
    expect(h.mailer.sent).toHaveLength(0);
    expect(await h.repos.table("digest_sends").count({})).toBe(0);
  });

  it("stops for a person removed from the workspace", async () => {
    await h.repos.table("workspace_members").remove({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT });
    const out = await sendContentDigests(base());
    expect(out).toMatchObject({ sent: 0, skipped: 1 });
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("does not send when the server cannot sign unsubscribe links", async () => {
    expect(await sendContentDigests(base({ credentialsKey: null }))).toMatchObject({ sent: 0, notConfigured: true });
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe("unsubscribe links", () => {
  beforeEach(async () => {
    await data(s.applicant, "PUT", "/gms/digests", { new_matches: true, deadlines: true });
    await data(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", loiDue: new Date(h.clock.now.getTime() + 10 * 86_400_000).toISOString().slice(0, 10) });
    await sendContentDigests(base());
  });

  it("turns off that one digest with one POST and no sign-in, as a mail app sends it", async () => {
    const mail = h.mailer.sent.find((m) => m.subject.includes("match"))!;
    const res = await h.request(`/gms/digests/unsubscribe?token=${tokenOf(mail)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toMatchObject({ digest: "new_matches", workspace: "Alder Creek Family Services", on: false });
    const after = await data<Settings>(s.applicant, "GET", "/gms/digests");
    expect(after.digests.map((d) => [d.key, d.on])).toEqual([
      ["new_matches", false],
      ["deadlines", true],
    ]);
    // The web page sends the same token as JSON; a second use is harmless.
    const again = await h.request("/gms/digests/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://app.gms.test" }, body: JSON.stringify({ token: tokenOf(mail) }) });
    expect(again.status).toBe(200);
  });

  it("opening the address in a browser changes nothing and leads to the page", async () => {
    const mail = h.mailer.sent.find((m) => m.subject.includes("match"))!;
    const res = await h.request(`/gms/digests/unsubscribe?token=${tokenOf(mail)}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://app.gms.test/digests/unsubscribe#token=${encodeURIComponent(tokenOf(mail))}`);
    expect((await data<Settings>(s.applicant, "GET", "/gms/digests")).digests.every((d) => d.on)).toBe(true);
  });

  it("refuses a forged or altered link, and an expired one", async () => {
    const token = tokenOf(h.mailer.sent[0]!);
    const altered = token.replace(/\.(new_matches|deadlines)\./, (_m, d: string) => `.${d === "deadlines" ? "new_matches" : "deadlines"}.`);
    const post = (t: string) => h.request("/gms/digests/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t }) });
    const forged = await post(altered);
    expect(forged.status).toBe(400);
    expect(((await forged.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("invalid_link");
    const member = (await h.repos.table("workspace_members").one({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT }))!;
    const otherKey = await unsubscribeToken("another-installation-key", member.id, "deadlines", new Date(h.clock.now.getTime() + 86_400_000));
    expect((await post(otherKey)).status).toBe(400);
    expect((await post("v1.not-a-token")).status).toBe(400);
    const old = await unsubscribeToken(TEST_CREDENTIALS_KEY, member.id, "deadlines", new Date(h.clock.now.getTime() - 1000));
    expect(await readUnsubscribeToken(TEST_CREDENTIALS_KEY, old, h.clock.now)).toBe("expired");
    const expired = await post(old);
    expect(expired.status).toBe(410);
    expect(((await expired.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("link_expired");
    // A link from an email keeps working for 90 days, then stops.
    h.clock.now = new Date(h.clock.now.getTime() + 91 * 86_400_000);
    expect((await post(token)).status).toBe(410);
    expect(await h.repos.table("digest_subscriptions").one({ member_id: member.id })).toMatchObject({ new_matches: true, deadlines: true });
  });
});

describe("deadlines", () => {
  const inDays = (n: number) => new Date(h.clock.now.getTime() + n * 86_400_000).toISOString().slice(0, 10);

  it("lists the next 21 days, leaving out what the daily reminder sent the same person today", async () => {
    await data(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", fullDue: inDays(7), loiDue: inDays(3), internalDue: inDays(30) });
    await data(s.applicant, "PUT", "/gms/digests", { deadlines: true });
    await data(s.editor, "PUT", "/gms/digests", { deadlines: true });
    h.mailer.sent.length = 0;
    await sendOutsideReminders(base());
    const reminders = mailTo(MARIA).map((m) => m.subject);
    expect(reminders).toEqual(["Full application due in 7 days: Rural clinics 2027"]);
    h.mailer.sent.length = 0;
    expect(await sendContentDigests(base())).toMatchObject({ sent: 2 });
    const maria = mailTo(MARIA)[0]!;
    expect(maria.subject).toBe("1 deadline in the next 3 weeks: Alder Creek Family Services");
    expect(maria.text).toContain(`${inDays(3)} (in 3 days): Letter of inquiry due, Rural clinics 2027 (Northwind Family Foundation)`);
    expect(maria.text).not.toContain(inDays(7));
    expect(maria.text).not.toContain(inDays(30));
    // Jamal owns nothing on it, so no reminder reached him: his digest has both.
    const jamal = mailTo(JAMAL)[0]!;
    expect(jamal.text).toContain(inDays(3));
    expect(jamal.text).toContain(inDays(7));
  });

  it("sends nothing when no deadline is coming", async () => {
    await data(s.applicant, "PUT", "/gms/digests", { deadlines: true });
    expect(await sendContentDigests(base())).toMatchObject({ sent: 0, empty: 1 });
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe("funder activity", () => {
  it("gives staff this week's counts with links and never an applicant's answers", async () => {
    const started = await data<{ id: string }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    await data(s.applicant, "PUT", `/common-grants/applications/${started.id}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to the nearest clinic." } });
    await data(s.applicant, "PUT", `/common-grants/applications/${started.id}/submit`);
    await data(s.funder, "PUT", "/gms/digests", { funder_activity: true });
    h.mailer.sent.length = 0;
    expect(await sendContentDigests(base())).toMatchObject({ sent: 1 });
    const mail = mailTo("dana.ortiz@riverbendcf.example")[0]!;
    expect(mail.subject).toBe("Riverbend Community Foundation this week: 1 new application");
    expect(mail.text).toContain("Open applications: https://app.gms.test/w/riverbend/applications");
    for (const part of [mail.subject, mail.text, mail.html]) {
      expect(part).not.toContain("Mobile Health Navigation");
      expect(part).not.toContain("46 miles");
      expect(part).not.toContain("Alder Creek");
    }
    expect(mailTo("helen.ortiz@riverbendcf.example")).toHaveLength(0);
  });

  it("skips a quiet week", async () => {
    await data(s.funder, "PUT", "/gms/digests", { funder_activity: true });
    expect(await sendContentDigests(base())).toMatchObject({ sent: 0, empty: 1 });
  });
});
