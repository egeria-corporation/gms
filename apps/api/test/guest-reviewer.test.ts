// SPDX-License-Identifier: AGPL-3.0-only
// The guest reviewer loop (C4): the welcome is an external reviewer's only, the done screen offers
// a panel of their own once, a dismissal sticks, and the offer's events are counted where no
// funder reads them.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { PANEL_OFFER_SHOWS, suggestionFromEmail } from "../src/services/guest-reviewer.ts";
import { CLIENT_AGENT, USER_ADMIN, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

const GUEST = "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4";
const STAFF_REVIEWER = "c4c4c4c4-0000-4c4c-8c4c-c4c4c4c4c4c5";
let h: Harness;
let s: Scenario;
let guest: Record<string, string>;
let apps: string[];

type Data<T> = { data: T };
const headers = async (user: string, ws?: string) => ({ ...bearer(await h.session(user)).headers, ...(ws ? { "X-GMS-Workspace": ws } : {}), "Content-Type": "application/json" });
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<Data<T>>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const assign = async (appId: string, reviewer: string, dueAt: string | null) => {
  const rubric = (await h.repos.table("rubrics").find({ workspace_id: WS_FUNDER }))[0]!;
  return h.repos.table("review_assignments").insert({ workspace_id: WS_FUNDER, application_id: appId, stage: "loi", reviewer_user_id: reviewer, rubric_id: rubric.id, rubric_version: rubric.version, due_at: dueAt, status: "assigned" });
};
const submitAll = async () => {
  for (const a of await h.repos.table("review_assignments").find({ reviewer_user_id: GUEST })) await h.repos.table("review_assignments").update({ id: a.id }, { status: "submitted" });
};
type Done = { done: boolean; submitted: number; assigned: number; offer: { show: boolean; suggestion: { domain: string; name: string; handle: string } | null } };

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  h.directory.users.set(GUEST, { email: "jo.lee@city-foundation.org", name: "Jo Lee" });
  // The funder invites the guest to review the competition; the guest accepts with their sign-in.
  const inv = await data<{ token: string }>(s.funder, "POST", "/gms/review-assignments/invite", { email: "jo.lee@city-foundation.org", competitionId: s.compId });
  const accepted = await data<{ role: string }>(await headers(GUEST), "POST", "/gms/invitations/accept", { token: inv.token });
  expect(accepted.role).toBe("external_reviewer");
  guest = await headers(GUEST, WS_FUNDER);
  apps = [];
  for (const title of ["Mobile Health Navigation", "Valley Food Bank"]) {
    const row = await h.repos.table("applications").insert({ workspace_id: WS_FUNDER, applicant_workspace_id: WS_APPLICANT, competition_id: s.uuid.comp, opportunity_id: s.uuid.opp, title, stage: "loi", status: "submitted", cg_status: "submitted", submitted_at: h.clock.now.toISOString() });
    apps.push(row.id);
  }
  await assign(apps[0]!, GUEST, "2027-03-20T23:59:00.000Z");
  await assign(apps[1]!, GUEST, "2027-03-10T23:59:00.000Z");
});

describe("the welcome", () => {
  it("names the funder, the competition, how many, the due date and where to start", async () => {
    const w = await data<{ funder: { name: string; handle: string }; competitions: { title: string; assigned: number; dueAt: string }[]; assigned: number; open: number; dueAt: string; coi: { note: string; link: string }; startUrl: string; done: boolean }>(guest, "GET", "/gms/guest-review/welcome");
    const funder = (await h.repos.table("workspaces").one({ id: WS_FUNDER }))!;
    expect(w.funder).toEqual({ name: funder.display_name, handle: funder.handle });
    const comp = (await h.repos.table("competitions").one({ id: s.uuid.comp }))!;
    expect(w.competitions).toHaveLength(1);
    expect(w.competitions[0]).toMatchObject({ title: comp.title, assigned: 2, dueAt: "2027-03-10T23:59:00.000Z" });
    expect(w).toMatchObject({ assigned: 2, open: 2, dueAt: "2027-03-10T23:59:00.000Z", done: false, startUrl: `/review/assignments?ws=${funder.handle}` });
    // The conflict-of-interest link opens the reviewer portal's policy signing.
    expect(w.coi.link).toBe(`/review/assignments?ws=${funder.handle}&sign=1`);
    expect(w.coi.note).toContain("conflict of interest");
    // A recused application no longer counts.
    const [first] = await h.repos.table("review_assignments").find({ application_id: apps[1]! });
    await h.repos.table("review_assignments").update({ id: first!.id }, { status: "recused" });
    expect(await data<{ assigned: number; dueAt: string }>(guest, "GET", "/gms/guest-review/welcome")).toMatchObject({ assigned: 1, dueAt: "2027-03-20T23:59:00.000Z" });
  });

  it("is an external reviewer's only", async () => {
    await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: STAFF_REVIEWER, role: "reviewer" });
    const agent = { ...bearer(await h.forge({ sub: GUEST, client_id: CLIENT_AGENT, scope: "reviews:read reviews:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-guest" })).headers, "Content-Type": "application/json" };
    for (const [who, status, code] of [
      [await headers(STAFF_REVIEWER, WS_FUNDER), 403, "insufficient_role"],
      [s.funder, 403, "insufficient_role"],
      [await headers(USER_ADMIN, WS_FUNDER), 403, "insufficient_role"],
      [s.applicant, 403, "insufficient_scope"],
      [agent, 403, "person_required"],
    ] as const) {
      for (const path of ["/gms/guest-review/welcome", "/gms/guest-review/done"]) {
        const r = await s.call<{ errors: { code: string }[] }>(who, "GET", path);
        expect(r.status, path).toBe(status);
        expect(r.body.errors[0]!.code).toBe(code);
      }
      expect((await s.call(who, "POST", "/gms/guest-review/offer", { event: "shown" })).status).toBe(403);
    }
    // Another funder's workspace: not a member.
    expect((await s.call(await headers(GUEST, WS_OTHER), "GET", "/gms/guest-review/welcome")).status).toBe(403);
  });
});

describe("the done screen", () => {
  it("thanks only once every review is in, and offers a panel once", async () => {
    expect(await data<Done>(guest, "GET", "/gms/guest-review/done")).toMatchObject({ done: false, offer: { show: false } });
    await submitAll();
    const d = await data<Done>(guest, "GET", "/gms/guest-review/done");
    expect(d).toMatchObject({ done: true, submitted: 2, assigned: 2, offer: { show: true, suggestion: { domain: "city-foundation.org", name: "City Foundation", handle: "city-foundation" } } });
    expect(await data(guest, "POST", "/gms/guest-review/offer", { event: "shown" })).toEqual({ event: "shown", counted: true });
    expect(PANEL_OFFER_SHOWS).toBe(1);
    // Once: the next visit shows it no more, and showing it again is not counted again.
    expect((await data<Done>(guest, "GET", "/gms/guest-review/done")).offer).toEqual({ show: false, suggestion: null });
    expect(await data(guest, "POST", "/gms/guest-review/offer", { event: "shown" })).toEqual({ event: "shown", counted: false });
    const events = h.ledger.events.filter((e) => e.eventType.startsWith("guest_reviewer."));
    expect(events.map((e) => [e.eventType, e.workspaceId, e.subjectType, e.subjectId])).toEqual([["guest_reviewer.panel_offer_shown", null, "user", GUEST]]);
    // No email follows the offer.
    expect(h.mailer.sent.filter((m) => m.to.includes("jo.lee@city-foundation.org")).map((m) => m.subject)).toEqual([expect.stringContaining("invited you to review")]);
  });

  it("a dismissal sticks, in every funder's workspace", async () => {
    await submitAll();
    expect((await data<Done>(guest, "GET", "/gms/guest-review/done")).offer.show).toBe(true);
    expect(await data(guest, "POST", "/gms/guest-review/offer", { event: "dismissed" })).toEqual({ event: "dismissed", counted: true });
    expect((await data<Done>(guest, "GET", "/gms/guest-review/done")).offer.show).toBe(false);
    // Invited by a second funder and done there too: still not shown.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: GUEST, role: "external_reviewer", scope: { competitionIds: [] } as never });
    const rubric = await h.repos.table("rubrics").insert({ workspace_id: WS_OTHER, name: "Other rubric", criteria: [] as never });
    const comp = await h.repos.table("competitions").insert({ workspace_id: WS_OTHER, opportunity_id: (await h.repos.table("opportunities").insert({ workspace_id: WS_OTHER, title: "Other opp", slug: "other-opp" })).id, title: "Other competition" });
    const app = await h.repos.table("applications").insert({ workspace_id: WS_OTHER, applicant_workspace_id: WS_APPLICANT, competition_id: comp.id, opportunity_id: comp.opportunity_id, title: "Elsewhere", stage: "loi", status: "submitted", cg_status: "submitted", submitted_at: h.clock.now.toISOString() });
    await h.repos.table("review_assignments").insert({ workspace_id: WS_OTHER, application_id: app.id, stage: "loi", reviewer_user_id: GUEST, rubric_id: rubric.id, rubric_version: rubric.version, status: "submitted" });
    expect(await data<Done>(await headers(GUEST, WS_OTHER), "GET", "/gms/guest-review/done")).toMatchObject({ done: true, offer: { show: false } });
  });

  it("counts a click and a funder workspace made with funder setup, and offers no more to someone who runs one", async () => {
    await submitAll();
    expect(await data(guest, "POST", "/gms/guest-review/offer", { event: "clicked" })).toEqual({ event: "clicked", counted: true });
    // The same creation as funder setup, with its daily caps.
    const made = await s.call<Data<{ workspace: { id: string; kind: string } }>>(await headers(GUEST), "POST", "/gms/workspaces", { kind: "funder", handle: "city-foundation", displayName: "City Foundation" });
    expect(made.status).toBe(201);
    const id = made.body.data.workspace.id;
    // Someone else's workspace, or an old one, is not counted as made from the offer.
    expect((await s.call(guest, "POST", "/gms/guest-review/offer", { event: "created", workspaceId: WS_FUNDER })).status).toBe(422);
    expect(await data(guest, "POST", "/gms/guest-review/offer", { event: "created", workspaceId: id })).toEqual({ event: "created", counted: true });
    const created = h.ledger.events.find((e) => e.eventType === "guest_reviewer.panel_offer_created")!;
    expect(created).toMatchObject({ workspaceId: null, data: { workspaceId: id } });
    expect((await data<Done>(guest, "GET", "/gms/guest-review/done")).offer.show).toBe(false);
    // The funder whose panel they reviewed reads none of it.
    const ledger = await s.call(await headers(USER_ADMIN, WS_FUNDER), "GET", "/gms/ledger?pageSize=100");
    expect(ledger.status).toBe(200);
    expect(JSON.stringify(ledger.body)).toContain("invitation.accepted");
    expect(JSON.stringify(ledger.body)).not.toContain("guest_reviewer.");
  });

  it("someone who already runs a funder workspace is not offered one", async () => {
    await submitAll();
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: GUEST, role: "program_officer" });
    expect(await data<Done>(guest, "GET", "/gms/guest-review/done")).toMatchObject({ done: true, offer: { show: false } });
  });
});

describe("the suggestion", () => {
  it("is the organization's own label, never a shared mail provider's", () => {
    expect(suggestionFromEmail("jo@cityfoundation.org")).toEqual({ domain: "cityfoundation.org", name: "Cityfoundation", handle: "cityfoundation" });
    expect(suggestionFromEmail("jo@mail.valley-trust.org.uk")).toEqual({ domain: "mail.valley-trust.org.uk", name: "Valley Trust", handle: "valley-trust" });
    expect(suggestionFromEmail("jo@gmail.com")).toBeNull();
    expect(suggestionFromEmail("jo@Outlook.com")).toBeNull();
    expect(suggestionFromEmail("not-an-email")).toBeNull();
    expect(suggestionFromEmail("jo@ab.org")).toEqual({ domain: "ab.org", name: "Ab", handle: "ab-reviews" });
  });
});
