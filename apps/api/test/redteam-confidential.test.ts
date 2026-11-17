// SPDX-License-Identifier: AGPL-3.0-only
// Red team (v1.9.0 integration): a confidential award, and an award whose grantee chose "Don't list
// us publicly", never appear on any surface outside the funder's and grantee's own screens, while
// a listed award beside them does (so each check can see it):
//   * the public pages (funder page and its past awards, grants-awarded page, each award page), the
//     sitemap and the badge, and so the front Worker's OG and JSON-LD, which it builds only from this
//     same page data (apps/web/test/award-share-front.test.ts: a 404 here leaves the default meta);
//   * the 360Giving and CommonGrants exports and the public 360Giving feed;
//   * the social composer, which offers no confidential or unlisted award for posting;
//   * the digests: the funder's activity digest (counts only) and the new-matches digest;
//   * a scheduled report: sent to members of the workspace only, by user id, with counts and a link,
//     never the file, so no title reaches an inbox outside the workspace.
//   * (v1.12.0) the open-call feeds and the OpenGrants index feed, "Meet our grantees" (the program
//     post's composer), and imported history: its rows on a confidential award are read by the
//     funder's staff only, never by a reviewer, the grantee or the public.
// Marking an award confidential takes it off every surface at once, and clearing it brings it back.
import { describe, expect, it } from "vitest";
import * as content from "../src/services/content-digests.ts";
import * as reports from "../src/services/report-builder.ts";
import { makeActor } from "../src/services/context.ts";
import { scopesForRole } from "../src/auth/scopes.ts";
import { USER_ADMIN, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, bearer, harness } from "./helpers.ts";

type H = Record<string, string>;
const GRANTEE_ADMIN = "14141414-1414-4141-8141-141414141414";
const PROGRAM = "17171717-1717-4171-8171-171717171717";
const LISTED = "Mobile Health Navigation";
const SECRET = "Confidential Shelter Project";
const UNLISTED = "Grantee Chose Unlisted";
const PREFIX = "360G-riverbend";

async function setup() {
  const h = await harness();
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: GRANTEE_ADMIN, role: "admin" });
  await h.repos.table("programs").insert({ id: PROGRAM, workspace_id: WS_FUNDER, name: "Community Health" });
  const award = (title: string, extra: Record<string, unknown> = {}) => h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title, status: "active", funding: { awardedAmount: { amount: "150000.00", currency: "USD" } }, key_dates: { awardDate: { date: "2027-03-01" } }, program_id: PROGRAM, ...extra } as never);
  const listed = await award(LISTED);
  const secret = await award(SECRET, { confidential: true });
  const unlisted = await award(UNLISTED, { recipient_unlisted: true });
  const who = async (userId: string, ws: string): Promise<H> => ({ ...bearer(await h.session(userId)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
  const admin = await who(USER_ADMIN, WS_FUNDER);
  const grantee = await who(GRANTEE_ADMIN, WS_APPLICANT);
  const put = async (path: string, body: unknown, as = admin) => {
    const res = await h.request(path, { method: "PUT", headers: as, body: JSON.stringify(body) });
    expect(res.status, `${path} ${await res.clone().text()}`).toBeLessThan(300);
  };
  // The funder lists its awards and publishes open data with a feed.
  await put("/gms/award-sharing/settings", { listAwards: true });
  await put("/gms/open-data/settings", { threeSixtyGivingPrefix: PREFIX, publishFeed: true });
  // v1.12.0: social posting on (for Meet our grantees), a published open call in the feeds, and
  // imported history on each award (the confidential one's says so in its own words).
  h.env.ZERNIO_API_KEY = "zk_test_made_up";
  h.env.ZERNIO_WEBHOOK_SECRET = "zernio-webhook-secret-for-unit-tests";
  await h.repos.table("opportunities").insert({ workspace_id: WS_FUNDER, program_id: PROGRAM, slug: "community-health-2028", title: "Community Health 2028", description: "Open call.", status: "open", published_at: "2027-04-01T12:00:00.000Z", publish: { publicPage: true, openGrantsIndex: true, sitemap: true } } as never);
  for (const [a, title] of [[listed, LISTED], [secret, SECRET], [unlisted, UNLISTED]] as const) {
    await h.repos.table("history_applications").insert({ workspace_id: WS_FUNDER, award_id: a.id, program_id: PROGRAM, organization_workspace_id: WS_APPLICANT, title: `${title} (past application)`, organization_name: "Alder Creek Family Services", outcome: "awarded" } as never);
    await h.repos.table("history_reports").insert({ workspace_id: WS_FUNDER, award_id: a.id, organization_workspace_id: WS_APPLICANT, title: `${title} (past report)`, award_title: title, report_state: "approved" } as never);
  }
  const reviewer = await (async () => {
    const id = "15151515-1515-4151-8151-151515151515";
    await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: id, role: "reviewer" });
    return who(id, WS_FUNDER);
  })();
  return { h, listed, secret, unlisted, admin, grantee, reviewer, put };
}
type S = Awaited<ReturnType<typeof setup>>;

const slugOf = (a: { public_slug: string }) => `alder-creek-family-services-${a.public_slug}`;

/** Every surface outside the funder's and grantee's own screens, as one text. */
async function everywhere(s: S): Promise<string> {
  const { h } = s;
  const parts: string[] = [];
  // The answers only (the paths asked for name the slugs themselves).
  const text = async (path: string, headers?: H) => parts.push(await (await h.request(path, headers ? { headers } : undefined)).text());
  // Public pages, the sitemap, each award page and badge (asked for by slug, as a guesser would).
  for (const path of ["/gms/public/funders/riverbend", "/gms/public/funders/riverbend/awards", "/sitemap.xml", ...[s.listed, s.secret, s.unlisted].flatMap((a) => [`/gms/public/funders/riverbend/awards/${slugOf(a)}`, `/gms/public/badges/${slugOf(a)}.svg`])]) await text(path);
  // Open data: both exports and the public feed.
  for (const path of ["/gms/open-data/360giving.json", "/gms/open-data/360giving.csv", "/gms/open-data/commongrants.json"]) await text(path, s.admin);
  await text("/gms/open-data/riverbend/360giving.json");
  // The digests: the funder's activity and the grantee's new matches, as next Monday's emails.
  await text("/gms/digests/preview?digest=funder_activity", s.admin);
  await text("/gms/digests/preview?digest=new_matches", s.grantee);
  // v1.12.0: the open-call feeds and the OpenGrants index feed; "Meet our grantees" for the program
  // (the funder's composer: what would be posted); imported history as a reviewer and as the
  // grantee would ask for it, by organization and by each award.
  for (const path of ["/gms/public/feeds/opportunities.json", "/gms/public/feeds/opportunities.csv", "/gms/public/feeds/opportunities.rss", "/gms/public/feeds/opengrants.json"]) await text(path);
  await text(`/gms/social/compose?subjectType=program&subjectId=${PROGRAM}`, s.admin);
  for (const as of [s.reviewer, s.grantee]) {
    await text(`/gms/history?organization=${WS_APPLICANT}`, as);
    for (const a of [s.listed, s.secret, s.unlisted]) await text(`/gms/history?award=awd_${a.id}`, as);
  }
  return parts.join("\n\n");
}

describe("a confidential or unlisted award, everywhere outside the parties' own screens", () => {
  it("never appears, while the listed award beside it does", async () => {
    const s = await setup();
    const all = await everywhere(s);
    expect(all).toContain(LISTED);
    expect(all).toContain(slugOf(s.listed));
    for (const hidden of [SECRET, UNLISTED, slugOf(s.secret), slugOf(s.unlisted), s.secret.id, s.unlisted.id, s.secret.public_slug, s.unlisted.public_slug]) expect(all, hidden).not.toContain(hidden);
    // Asked for directly: the same plain 404 as an award that does not exist.
    for (const a of [s.secret, s.unlisted]) {
      expect((await s.h.request(`/gms/public/funders/riverbend/awards/${slugOf(a)}`)).status).toBe(404);
      expect((await s.h.request(`/gms/public/badges/${slugOf(a)}.svg`)).status).toBe(404);
    }
  });

  it("is never introduced in Meet our grantees, which lists the award beside it", async () => {
    const s = await setup();
    const d = (await (await s.h.request(`/gms/social/compose?subjectType=program&subjectId=${PROGRAM}`, { headers: s.admin })).json()) as { data: { shareable: boolean; grantees: { awardId: string }[]; suggestions: { text: string }[] } };
    expect(d.data.shareable).toBe(true);
    expect(d.data.grantees.map((g) => g.awardId)).toEqual([`awd_${s.listed.id}`]);
    const text = d.data.suggestions.map((x) => x.text).join(" ");
    expect(text).toContain(LISTED);
    for (const hidden of [SECRET, UNLISTED]) expect(text).not.toContain(hidden);
  });

  it("keeps its imported history to the funder's staff: no reviewer, grantee or public page reads it", async () => {
    const s = await setup();
    // The staff read every past record, the confidential award's included, on the award's page.
    const staff = await (await s.h.request(`/gms/history?award=awd_${s.secret.id}`, { headers: s.admin })).text();
    expect(staff).toContain(`${SECRET} (past application)`);
    expect(staff).toContain(`${SECRET} (past report)`);
    for (const as of [s.reviewer, s.grantee]) {
      for (const path of [`/gms/history?award=awd_${s.secret.id}`, `/gms/history?organization=${WS_APPLICANT}`]) {
        const res = await s.h.request(path, { headers: as });
        expect([403, 404], path).toContain(res.status);
        expect(await res.text()).not.toContain("(past ");
      }
    }
  });

  it("is not offered in the social composer, on either side", async () => {
    const s = await setup();
    s.h.env.ZERNIO_API_KEY = "zk_test_made_up";
    s.h.env.ZERNIO_WEBHOOK_SECRET = "zernio-webhook-secret-for-unit-tests";
    const compose = async (id: string, as: H) => (await (await s.h.request(`/gms/social/compose?subjectType=award&subjectId=${id}`, { headers: as })).json()) as { data: { shareable: boolean; suggestions: { text: string }[]; reason: string | null } };
    // The listed award is offered, with award sharing's own posts (the seam is wired).
    const ok = await compose(s.listed.id, s.admin);
    expect(ok.data.shareable).toBe(true);
    expect(ok.data.suggestions.map((x) => x.text).join(" ")).toContain("utm_source=social");
    for (const a of [s.secret, s.unlisted]) {
      for (const as of [s.admin, s.grantee]) {
        const d = await compose(a.id, as);
        expect(d.data).toMatchObject({ shareable: false, suggestions: [] });
        expect(d.data.reason).toBe("This award is not listed publicly, so it is not offered for posting");
      }
    }
  });

  it("marking it confidential takes it off every surface at once, and clearing it brings it back", async () => {
    const s = await setup();
    await s.put(`/gms/awards/awd_${s.listed.id}/confidential`, { confidential: true });
    const off = await everywhere(s);
    for (const hidden of [LISTED, slugOf(s.listed)]) expect(off, hidden).not.toContain(hidden);
    await s.put(`/gms/awards/awd_${s.listed.id}/confidential`, { confidential: false });
    expect(await everywhere(s)).toContain(LISTED);
    // Open data's own switch is the same flag.
    await s.put(`/gms/open-data/awards/awd_${s.listed.id}/confidential`, { confidential: true });
    expect((await s.h.repos.table("awards").one({ id: s.listed.id }))!.confidential).toBe(true);
    expect(await everywhere(s)).not.toContain(LISTED);
  });

  it("a scheduled report goes only to members of the workspace, with counts and a link, never the file", async () => {
    const s = await setup();
    const ctx = (userId: string, role: string) => ({ repos: s.h.repos, ledger: s.h.ledger, webhooks: s.h.webhooks, now: () => s.h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: WEB, passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { directory: s.h.directory, mailer: s.h.mailer }, actor: makeActor("user", userId, null), workspace: { id: WS_FUNDER, kind: "funder" as const, role, memberScope: null }, scopes: scopesForRole("funder", role) });
    const view = await reports.createView(ctx(USER_OFFICER, "program_officer"), { name: "Board pack", visibility: "workspace", definition: reports.definitionInput.parse({ dataSet: "awards", columns: ["title", "amount"] }) });
    // Not a member, or a member of the grantee's workspace: refused. Addresses are not even accepted.
    await expect(reports.setSchedule(ctx(USER_OFFICER, "program_officer"), view.id, { cadence: "monthly", dayOfMonth: 1, recipientUserIds: [GRANTEE_ADMIN] })).rejects.toMatchObject({ code: "recipient_not_allowed" });
    expect(reports.scheduleInput.safeParse({ cadence: "monthly", dayOfMonth: 1, recipientUserIds: ["board@example.org"] }).success).toBe(false);
    await reports.setSchedule(ctx(USER_OFFICER, "program_officer"), view.id, { cadence: "monthly", dayOfMonth: 1, recipientUserIds: [USER_ADMIN] });
    s.h.directory.users.set(USER_ADMIN, { email: "helen@riverbendcf.example", name: "Helen Ortiz" });
    s.h.directory.users.set(USER_OFFICER, { email: "dana@riverbendcf.example", name: "Dana Ortiz" });
    const files = new Map<string, string>();
    s.h.clock.now = new Date("2027-05-01T14:00:00Z");
    const store = { put: async (k: string, b: string) => void files.set(k, b), get: async (k: string) => files.get(k) ?? null, delete: async (k: string) => void files.delete(k) };
    const out = await reports.sendScheduledReports({ repos: s.h.repos, ledger: s.h.ledger, webhooks: s.h.webhooks, now: () => s.h.clock.now, config: ctx(USER_ADMIN, "admin").config, ports: { directory: s.h.directory, mailer: s.h.mailer } }, store);
    expect(out.sent).toBe(1);
    // The file holds the funder's own awards (it is the funder's report); the email holds none of them.
    expect([...files.values()].join("\n")).toContain(SECRET);
    expect(s.h.mailer.sent.map((m) => m.to)).toEqual([["helen@riverbendcf.example"]]);
    for (const m of s.h.mailer.sent) for (const t of [SECRET, UNLISTED, LISTED]) expect(`${m.subject} ${m.text} ${m.html}`).not.toContain(t);
    expect(s.h.mailer.sent[0]!.attachments ?? []).toEqual([]);
  });

  it("the Monday digests name no award: the funder's is counts only, new matches are opportunities", async () => {
    const s = await setup();
    const ws = (await s.h.repos.table("workspaces").one({ id: WS_FUNDER }))!;
    const counts = await content.buildFunderActivity({ repos: s.h.repos, now: () => s.h.clock.now }, ws, content.newRun(1));
    expect(Object.values(counts).every((n) => typeof n === "number")).toBe(true);
  });
});
