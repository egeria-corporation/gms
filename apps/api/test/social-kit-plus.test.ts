// SPDX-License-Identifier: AGPL-3.0-only
// Social posting, plus (v1.12.0), against the fake Zernio (no network).
//   "Two weeks left": the daily run makes one prompt per call, fourteen days before its deadline,
//   only for a workspace with a connected account; funder admins see it in their notifications
//   and digest; it opens the composer prefilled with the reminder; an admin may dismiss it; and
//   nothing is ever posted by it.
//   "Meet our grantees": the composer lists only a program's awards that may be public, tags a
//   grantee's page only with its consent, and posts only on a person's click after the preview.
import { FakeZernio } from "@gms/social";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promptSocialReminders, sendDigests } from "../src/jobs.ts";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";

// Test values only; not real Zernio credentials.
const ZERNIO_KEY = "zk_test_unit_key_not_real";
const ZERNIO_SECRET = "zernio-webhook-secret-for-unit-tests";
const OTHER_ADMIN = "49494949-4949-4494-8494-494949494949";
const GRANTEE_ADMIN = "49494949-4949-4494-8494-4949494949a1";
const SECOND_GRANTEE = "49494949-4949-4494-8494-4949494949a2";
const OPP = "0190b000-0000-7000-8000-0000000004c1";
const QUIET_OPP = "0190b000-0000-7000-8000-0000000004c2";
const OTHER_OPP = "0190b000-0000-7000-8000-0000000004c3";
const LATE_OPP = "0190b000-0000-7000-8000-0000000004c4";
const PROGRAM = "0190b000-0000-7000-8000-0000000004d1";
const OTHER_PROGRAM = "0190b000-0000-7000-8000-0000000004d2";

let h: Harness;
let fake: FakeZernio;
let seq = 0;

const json = (headers: Record<string, string>) => ({ ...headers, "Content-Type": "application/json" });
const person = async (user: string, ws: string) => json({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws });
const agent = async (user: string, ws: string, scope: string) => json({ Authorization: `Bearer ${await h.forge({ sub: user, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: ws, jti: `tok-kit-${++seq}` })}`, "X-GMS-Workspace": ws });
const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await h.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { data?: unknown; errors?: { code?: string }[] } };
};
const data = <T>(r: { body: { data?: unknown } }) => r.body.data as T;
const base = () => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: WEB, passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory } });
const day = (n: number) => new Date(Date.UTC(2027, 3, 16 + n, 14, 40)).toISOString();
const dateIn = (days: number) => new Date(Date.UTC(2027, 3, 16 + days)).toISOString().slice(0, 10);
const at = (n: number) => void (h.clock.now = new Date(day(n)));

interface Draft {
  shareable: boolean;
  reason: string | null;
  suggestions: { label: string; text: string; kind?: string }[];
  link: string | null;
  imageUrl: string | null;
  reminder?: { id: string; deadline: string } | null;
  program?: { id: string; name: string } | null;
  grantees?: { awardId: string; name: string; tag: string | null; line: string }[];
  parts?: { intro: string; outro: string } | null;
}
type Notice = { id: string; type: string; category: string; title: string; titleLocalized?: string; subjectType: string | null; subjectId: string | null };

async function connect(user: string, ws: string, platform: string, username: string) {
  const who = await person(user, ws);
  const start = await call("POST", "/gms/social/connect", who, { platform });
  const back = new URL(fake.approve(data<{ authUrl: string }>(start).authUrl, username));
  const done = await call("POST", "/gms/social/connect/callback", who, { state: back.searchParams.get("gs"), profileId: back.searchParams.get("profileId"), accountId: back.searchParams.get("accountId") });
  expect(done.status).toBe(201);
  return data<{ id: string }>(done);
}

beforeEach(async () => {
  h = await harness();
  fake = new FakeZernio({ apiKey: ZERNIO_KEY, now: () => h.clock.now });
  vi.stubGlobal("fetch", fake.fetch);
  h.env.ZERNIO_API_KEY = ZERNIO_KEY;
  h.env.ZERNIO_WEBHOOK_SECRET = ZERNIO_SECRET;
  await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: OTHER_ADMIN, role: "admin" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: GRANTEE_ADMIN, role: "admin" });
  const published = h.clock.now.toISOString();
  const close = (days: number) => ({ closeDate: { name: "Applications close", eventType: "singleDate", date: dateIn(days) } });
  // Riverbend's call closes in 15 days; its quiet call (no public page) also in 15; a late one opens with 10 left.
  await h.repos.table("opportunities").insert({ id: OPP, workspace_id: WS_FUNDER, slug: "community-health-2027", title: "Community Health Grants 2027", status: "open", published_at: published, key_dates: close(15) });
  await h.repos.table("opportunities").insert({ id: QUIET_OPP, workspace_id: WS_FUNDER, slug: "invited-call", title: "Invited call", status: "open", published_at: published, publish: { publicPage: false }, key_dates: close(15) });
  await h.repos.table("opportunities").insert({ id: LATE_OPP, workspace_id: WS_FUNDER, slug: "late-call", title: "Late call", status: "open", published_at: published, key_dates: close(10) });
  // The other funder's call closes in 15 days too, but it has connected no social account.
  await h.repos.table("opportunities").insert({ id: OTHER_OPP, workspace_id: WS_OTHER, slug: "county-call", title: "County call", status: "open", published_at: published, key_dates: close(15) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Two weeks left", () => {
  it("fires once, at fourteen days, only where an account is connected, and never posts", async () => {
    await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf");
    const before = fake.requests.length;

    at(0); // 15 days left: too early.
    expect(await promptSocialReminders(base())).toMatchObject({ prompted: 0 });
    at(1); // 14 days left.
    expect(await promptSocialReminders(base())).toMatchObject({ prompted: 1, failed: 0 });
    expect(await promptSocialReminders(base())).toMatchObject({ prompted: 0 });
    at(2); // 13 days left: the same call is not asked again.
    expect(await promptSocialReminders(base())).toMatchObject({ prompted: 0 });
    const prompts = await h.repos.table("social_reminder_prompts").find({});
    expect(prompts.map((p) => [p.opportunity_id, p.deadline])).toEqual([[OPP, dateIn(15)]]);

    // Nothing went to Zernio and no post exists.
    expect(fake.requests.slice(before)).toEqual([]);
    expect(await h.repos.table("social_posts").find({})).toEqual([]);
    expect(await h.ledger.list({ workspaceId: WS_FUNDER, eventType: "social.reminder_prompted" })).toHaveLength(1);
  });

  it("reaches funder admins in their notifications and digest, opens the composer prefilled, and may be dismissed", async () => {
    await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf");
    at(1);
    await promptSocialReminders(base());
    const admin = await person(USER_ADMIN, WS_FUNDER);
    const officer = await person(USER_OFFICER, WS_FUNDER);

    const notices = data<{ items: Notice[] }>(await call("GET", "/gms/notifications", admin)).items.filter((n) => n.type === "social.reminder_prompt");
    expect(notices).toEqual([expect.objectContaining({ category: "social_reminder", title: "Post a reminder? Two weeks left: Community Health Grants 2027", subjectType: "opportunity", subjectId: OPP })]);
    const es = data<{ items: Notice[] }>(await call("GET", "/gms/notifications?lang=es", admin)).items.find((n) => n.type === "social.reminder_prompt");
    expect(es?.titleLocalized).toBe("¿Publicar un recordatorio? Quedan dos semanas: Community Health Grants 2027");
    // A program officer is not a funder admin: no prompt.
    expect(data<{ items: Notice[] }>(await call("GET", "/gms/notifications", officer)).items.some((n) => n.type === "social.reminder_prompt")).toBe(false);

    // The admin who opted into the daily digest gets a line.
    await h.repos.table("workspace_members").update({ workspace_id: WS_FUNDER, user_id: USER_ADMIN }, { notification_preferences: { digest: "daily", channels: {} } as never });
    h.mailer.sent.length = 0;
    expect((await sendDigests(base(), "daily")).sent).toBe(1);
    expect(h.mailer.sent[0]!.text).toContain("- Post a reminder? Two weeks left: Community Health Grants 2027");

    // The composer starts from the reminder; posting is still the person's click.
    const draft = data<Draft>(await call("GET", `/gms/social/compose?subjectType=opportunity&subjectId=${OPP}`, admin));
    expect(draft.reminder).toEqual({ id: notices[0]!.id, deadline: dateIn(15) });
    expect(draft.suggestions[0]).toEqual({ kind: "reminder", label: "Reminder", text: `Two weeks left to apply: Community Health Grants 2027, from Riverbend Community Foundation. Apply by May 1, 2027.\n\n${WEB}/f/riverbend/o/community-health-2027?utm_source=social` });
    expect(await h.repos.table("social_posts").find({})).toEqual([]);

    // Dismissing: not by an officer or an agent; by an admin, once, for everyone.
    expect((await call("POST", `/gms/social/reminders/${notices[0]!.id}/dismiss`, officer)).status).toBe(403);
    const robot = await call("POST", `/gms/social/reminders/${notices[0]!.id}/dismiss`, await agent(USER_ADMIN, WS_FUNDER, "communications:write"));
    expect(robot.status).toBe(403);
    expect((await call("POST", `/gms/social/reminders/${notices[0]!.id}/dismiss`, await person(OTHER_ADMIN, WS_OTHER))).status).toBe(404);
    const done = await call("POST", `/gms/social/reminders/${notices[0]!.id}/dismiss`, admin);
    expect(done.status).toBe(200);
    expect(data(done)).toEqual({ id: notices[0]!.id, opportunityId: OPP, dismissed: true });
    expect(data<{ items: Notice[] }>(await call("GET", "/gms/notifications", admin)).items.some((n) => n.type === "social.reminder_prompt")).toBe(false);
    const after = data<Draft>(await call("GET", `/gms/social/compose?subjectType=opportunity&subjectId=${OPP}`, admin));
    expect(after.reminder).toBeNull();
    expect(after.suggestions.some((s) => s.kind === "reminder")).toBe(false);
    // Dismissed is final: the daily run does not ask again.
    at(2);
    expect(await promptSocialReminders(base())).toMatchObject({ prompted: 0 });
  });

  it("is hidden where social posting is not set up", async () => {
    await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf");
    at(1);
    await promptSocialReminders(base());
    delete h.env.ZERNIO_API_KEY;
    const admin = await person(USER_ADMIN, WS_FUNDER);
    expect(data<{ items: Notice[] }>(await call("GET", "/gms/notifications", admin)).items.some((n) => n.type === "social.reminder_prompt")).toBe(false);
    const p = (await h.repos.table("social_reminder_prompts").find({}))[0]!;
    expect((await call("POST", `/gms/social/reminders/${p.id}/dismiss`, admin)).status).toBe(404);
  });
});

describe("Meet our grantees", () => {
  async function program() {
    await h.repos.table("programs").insert({ id: PROGRAM, workspace_id: WS_FUNDER, name: "Community Health 2027" });
    await h.repos.table("programs").insert({ id: OTHER_PROGRAM, workspace_id: WS_OTHER, name: "County Health" });
    await h.repos.table("workspaces").insert({ id: SECOND_GRANTEE, kind: "applicant", handle: "valley-food-bank", display_name: "Valley Food Bank" });
    await h.repos.table("share_kit_profiles").insert({ workspace_id: SECOND_GRANTEE, page_url: "https://www.linkedin.com/company/valley-food-bank", tag_consent: true, consented_at: h.clock.now.toISOString(), consented_by: GRANTEE_ADMIN });
    // Alder Creek gave its page but did not agree to be tagged.
    await h.repos.table("share_kit_profiles").insert({ workspace_id: WS_APPLICANT, page_url: "https://www.linkedin.com/company/alder-creek-family-services" });
    const award = (title: string, extra: Record<string, unknown> = {}) => h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title, status: "active", program_id: PROGRAM, key_dates: { awardDate: { date: "2027-03-01" } }, ...extra } as never);
    const mobile = await award("Mobile Health Navigation");
    const meals = await award("Weekend Meals", { recipient_workspace_id: SECOND_GRANTEE, key_dates: { awardDate: { date: "2027-04-01" } } });
    await award("Confidential Shelter Project", { confidential: true });
    await award("Grantee Chose Unlisted", { recipient_unlisted: true });
    await award("Offered Not Yet Accepted", { status: "offered" });
    await award("Grant To A Person", { recipient_workspace_id: null, recipient_individual: { name: "Pat Example" } });
    return { mobile, meals };
  }

  it("lists only awards that may be public, tags only with consent, and posts on the person's click", async () => {
    const { mobile, meals } = await program();
    const account = await connect(USER_ADMIN, WS_FUNDER, "linkedin", "riverbend-cf");
    const admin = await person(USER_ADMIN, WS_FUNDER);
    const compose = () => call("GET", `/gms/social/compose?subjectType=program&subjectId=${PROGRAM}`, admin);

    // While the funder does not list awards, there is no one to introduce.
    let draft = data<Draft>(await compose());
    expect(draft).toMatchObject({ shareable: false, grantees: [] });
    expect((await call("PUT", "/gms/award-sharing/settings", admin, { listAwards: true })).status).toBe(200);

    draft = data<Draft>(await compose());
    expect(draft.shareable).toBe(true);
    expect(draft.grantees).toEqual([
      { awardId: `awd_${meals.id}`, name: "Valley Food Bank", tag: "@valley-food-bank", line: "Valley Food Bank (@valley-food-bank): Weekend Meals" },
      { awardId: `awd_${mobile.id}`, name: "Alder Creek Family Services", tag: null, line: "Alder Creek Family Services: Mobile Health Navigation" },
    ]);
    expect(draft.suggestions).toEqual([{ kind: "meet", label: "Meet our grantees", text: `Meet the grantees of our Community Health 2027 program.\n\nValley Food Bank (@valley-food-bank): Weekend Meals\nAlder Creek Family Services: Mobile Health Navigation\n\nSee every grant we have awarded: ${WEB}/f/riverbend/awards?utm_source=social` }]);
    expect(draft.imageUrl).toBe(`${WEB}/og/f/riverbend/awards.png`);
    const text = JSON.stringify(draft);
    for (const hidden of ["Confidential Shelter", "Grantee Chose Unlisted", "Offered Not Yet", "Pat Example", "Grant To A Person", "@alder-creek"]) expect(text).not.toContain(hidden);

    // The award screen's composer offers the program to the funder.
    const awardDraft = data<Draft>(await call("GET", `/gms/social/compose?subjectType=award&subjectId=${mobile.id}`, admin));
    expect(awardDraft.program).toEqual({ id: PROGRAM, name: "Community Health 2027" });

    // Preview, then the click: one post about the program.
    const input = { subject: { type: "program", id: PROGRAM }, content: draft.suggestions[0]!.text, accountIds: [account.id], includeImage: true };
    const preview = await call("POST", "/gms/social/posts/preview", admin, input);
    expect(preview.status).toBe(200);
    // An agent cannot post it.
    expect((await call("POST", "/gms/social/posts", { ...(await agent(USER_ADMIN, WS_FUNDER, "communications:write")), "Idempotency-Key": crypto.randomUUID() }, { ...input, previewToken: data<{ previewToken: string }>(preview).previewToken })).status).toBe(403);
    const sent = await call("POST", "/gms/social/posts", { ...admin, "Idempotency-Key": crypto.randomUUID() }, { ...input, previewToken: data<{ previewToken: string }>(preview).previewToken });
    expect(sent.status).toBe(201);
    expect(data(sent)).toMatchObject({ subject: { type: "program", id: PROGRAM }, status: "published" });
    const reach = data<{ posts: unknown[] }>(await call("GET", `/gms/social/posts?subjectType=program&subjectId=${PROGRAM}`, admin));
    expect(reach.posts).toHaveLength(1);
  });

  it("is a funder's, about its own programs", async () => {
    await program();
    expect((await call("GET", `/gms/social/compose?subjectType=program&subjectId=${OTHER_PROGRAM}`, await person(USER_ADMIN, WS_FUNDER))).status).toBe(404);
    expect((await call("GET", `/gms/social/compose?subjectType=program&subjectId=${PROGRAM}`, await person(GRANTEE_ADMIN, WS_APPLICANT))).status).toBe(404);
    // The grantee's award draft offers no program.
    const mine = (await h.repos.table("awards").find({ workspace_id: WS_FUNDER }))[0]!;
    await call("PUT", "/gms/award-sharing/settings", await person(USER_ADMIN, WS_FUNDER), { listAwards: true });
    const g = data<Draft>(await call("GET", `/gms/social/compose?subjectType=award&subjectId=${mine.id}`, await person(GRANTEE_ADMIN, WS_APPLICANT)));
    expect(g.program ?? null).toBeNull();
  });
});
