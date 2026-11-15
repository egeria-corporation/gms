// SPDX-License-Identifier: AGPL-3.0-only
// Award sharing and agents: an agent reads the share kit through MCP `get_award_share_kit` (funder
// and grantee sides) on the same service and authorization as the share panel, and gets nothing for
// an award that is not public. Making an award public or private is a person's: no tool does it,
// and agent tokens are refused on the routes whatever their scopes.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";

const GRANTEE_ADMIN = "12121212-1212-4121-8121-121212121212";
let h: Harness;
let seq = 0;
let awardId: string;
let hiddenId: string;

const person = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const agentToken = (user: string, ws: string, scope: string) => h.forge({ sub: user, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: ws, jti: `tok-share-${++seq}` });
const bearerJson = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" });
async function rpc(token: string, method: string, params?: unknown) {
  const res = await h.request("/mcp", { method: "POST", headers: bearerJson(token), body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }) });
  return (await res.json()) as { result: { structuredContent?: Record<string, unknown>; content?: { text?: string }[]; tools?: { name: string }[] } };
}
const tool = async (token: string, name: string, args: Record<string, unknown>) => (await rpc(token, "tools/call", { name, arguments: args })).result;

beforeEach(async () => {
  h = await harness();
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: GRANTEE_ADMIN, role: "admin" });
  const award = (title: string, confidential: boolean) => h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title, status: "active", funding: { awardedAmount: { amount: "50000.00", currency: "USD" } }, confidential } as never);
  awardId = `awd_${(await award("Food Pantry Expansion", false)).id}`;
  hiddenId = `awd_${(await award("Confidential Shelter Project", true)).id}`;
});

describe("an agent and the share kit", () => {
  it("reads it through MCP once the award is public, on both sides", async () => {
    const funderAgent = await agentToken(USER_ADMIN, WS_FUNDER, "awards:read awards:write workspace:admin");
    const before = await tool(funderAgent, "get_award_share_kit", { awardId });
    expect(before.structuredContent?.posts).toBeUndefined();
    expect(JSON.stringify(before)).not.toContain("Food Pantry Expansion");

    expect((await h.request("/gms/award-sharing/settings", { method: "PUT", headers: await person(USER_ADMIN, WS_FUNDER), body: JSON.stringify({ listAwards: true }) })).status).toBe(200);
    const kit = (await tool(funderAgent, "get_award_share_kit", { awardId })).structuredContent as { posts: Record<string, string>; badge: { verified: boolean } };
    expect(kit.posts.linkedin).toContain("We are proud to support Alder Creek Family Services with a $50,000 grant");
    expect(kit.badge.verified).toBe(true);
    const granteeAgent = await agentToken(GRANTEE_ADMIN, WS_APPLICANT, "awards:read");
    const mine = (await tool(granteeAgent, "get_award_share_kit", { awardId })).structuredContent as { posts: Record<string, string> };
    expect(mine.posts.linkedin).toContain("We are grateful to Riverbend Community Foundation for a $50,000 grant");

    // Never for a confidential award, and never another workspace's.
    expect(JSON.stringify(await tool(funderAgent, "get_award_share_kit", { awardId: hiddenId }))).not.toContain("Confidential Shelter Project");
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
    expect((await tool(await agentToken(USER_ADMIN, WS_OTHER, "awards:read"), "get_award_share_kit", { awardId })).structuredContent).toMatchObject({ error: { code: "not_found" } });
  });

  it("cannot list awards, mark one confidential or unlist one: no tool does, and the routes refuse agent tokens", async () => {
    const funderAgent = await agentToken(USER_ADMIN, WS_FUNDER, "awards:read awards:write workspace:admin programs:write");
    const names = (await rpc(funderAgent, "tools/list")).result.tools!.map((t) => t.name);
    expect(names).toContain("get_award_share_kit");
    expect(names.filter((n) => /award_share|confidential|unlist|award_listing|badge/.test(n))).toEqual(["get_award_share_kit"]);
    const granteeAgent = await agentToken(GRANTEE_ADMIN, WS_APPLICANT, "awards:read awards:write");
    expect((await rpc(granteeAgent, "tools/list")).result.tools!.map((t) => t.name).filter((n) => /award_share|confidential|unlist|award_listing|badge/.test(n))).toEqual(["get_award_share_kit"]);

    const code = async (res: Response) => ({ status: res.status, code: ((await res.json()) as { errors?: { code: string }[] }).errors?.[0]?.code });
    const put = (token: string, path: string, body: unknown) => h.request(path, { method: "PUT", headers: bearerJson(token), body: JSON.stringify(body) });
    expect(await code(await put(funderAgent, `/gms/awards/${hiddenId}/confidential`, { confidential: false }))).toEqual({ status: 403, code: "human_only" });
    expect((await put(funderAgent, "/gms/award-sharing/settings", { listAwards: true })).status).toBe(403);
    expect(await code(await put(granteeAgent, `/gms/my/awards/${awardId}/listing`, { unlisted: true }))).toEqual({ status: 403, code: "human_only" });
    expect((await h.repos.table("awards").one({ id: hiddenId.slice(4) }))!.confidential).toBe(true);
  });
});
