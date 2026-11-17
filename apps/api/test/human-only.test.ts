// SPDX-License-Identifier: AGPL-3.0-only
// Human only (v1.9.0 integration): every action the brief names as a person's own is refused to an
// agent (a delegated token carrying every scope of the person's role) and to an API client (a
// workspace token carrying every scope), with a valid body. Driven from one list, so an entry is
// one line; each refusal must be a 403 that says a person is needed (or, for a gated MCP action,
// that a person must approve it), never a 400, 404 or success, and nothing is written.
import { beforeEach, describe, expect, it } from "vitest";
import { SCOPES, WORKSPACE_CLAIM, scopesForRole } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, WS_APPLICANT, WS_FUNDER, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

const NOWHERE = "00000000-0000-4000-8000-00000000dead";
/** The refusals that say a signed-in person is needed. */
const PERSON_CODES = ["human_only", "person_required", "person_only", "approval_required"];

interface Entry {
  what: string;
  side: "funder" | "applicant";
  method: "POST" | "PUT" | "DELETE";
  path: (x: Fixture) => string;
  body?: (x: Fixture) => unknown;
}
interface Fixture {
  s: Scenario;
  outside: string;
  run: string;
}

const ENTRIES: Entry[] = [
  { what: "social preview", side: "funder", method: "POST", path: () => "/gms/social/posts/preview", body: (x) => ({ subject: { type: "opportunity", id: x.s.uuid.opp }, content: "Applications are open.", accountIds: [NOWHERE] }) },
  { what: "social post", side: "funder", method: "POST", path: () => "/gms/social/posts", body: (x) => ({ subject: { type: "opportunity", id: x.s.uuid.opp }, content: "Applications are open.", accountIds: [NOWHERE], previewToken: "x".repeat(20) }) },
  { what: "social connect", side: "funder", method: "POST", path: () => "/gms/social/connect", body: () => ({ platform: "linkedin" }) },
  { what: "social connect callback", side: "funder", method: "POST", path: () => "/gms/social/connect/callback", body: () => ({ state: "x".repeat(20), profileId: "prof_1", accountId: "acc_1" }) },
  { what: "social disconnect", side: "funder", method: "DELETE", path: () => `/gms/social/accounts/${NOWHERE}` },
  { what: "send-package email preview", side: "applicant", method: "POST", path: (x) => `/gms/outside-applications/${x.outside}/package/email/preview`, body: () => ({ to: "grants@northwind.example", message: "Hello" }) },
  { what: "send-package email", side: "applicant", method: "POST", path: (x) => `/gms/outside-applications/${x.outside}/package/email`, body: () => ({ to: "grants@northwind.example", message: "Hello", previewDigest: "a".repeat(64) }) },
  { what: "digest on", side: "applicant", method: "PUT", path: () => "/gms/digests", body: () => ({ new_matches: true }) },
  { what: "digest off", side: "funder", method: "PUT", path: () => "/gms/digests", body: () => ({ funder_activity: false }) },
  { what: "Fluxx connect", side: "funder", method: "POST", path: () => "/gms/imports/connections/fluxx", body: () => ({ instanceUrl: "https://acme.fluxx.io", clientId: "made-up-id", clientSecret: "made-up-secret" }) },
  { what: "Zengine connect", side: "funder", method: "POST", path: () => "/gms/imports/connections/zengine", body: () => ({ token: "made-up-token" }) },
  { what: "import commit", side: "funder", method: "POST", path: (x) => `/gms/imports/runs/${x.run}/commit` },
  { what: "gallery share", side: "funder", method: "POST", path: () => `/gms/workspaces/${WS_FUNDER}/gallery/submissions`, body: () => ({ source: { type: "rubric", id: NOWHERE }, title: "A rubric", summary: "A rubric to share.", tags: { fieldOfWork: [], grantSize: [], audience: [] }, licence: "CC-BY-4.0" }) },
  { what: "COI signature", side: "funder", method: "POST", path: (x) => `/gms/competitions/${x.s.compId}/coi-policy/sign`, body: () => ({ policyVersion: 1, signedName: "Dana Ortiz", agree: true, conflicts: [] }) },
  { what: "SSO requirement", side: "funder", method: "PUT", path: () => "/gms/sso/requirement", body: () => ({ require: true }) },
  { what: "migration request", side: "funder", method: "POST", path: () => "/gms/migration-requests", body: () => ({ name: "Ana Ruiz", email: "ana@riverbendcf.example", organization: "Riverbend Community Foundation", system: "fluxx", programs: "2-5", pastAwards: "100-999", timing: "asap", formToken: "x".repeat(40) }) },
];

let h: Harness;
let x: Fixture;
let seq = 0;

beforeEach(async () => {
  h = await harness();
  const s = await scenario(h);
  h.env.ZERNIO_API_KEY = "zk_test_made_up";
  h.env.ZERNIO_WEBHOOK_SECRET = "zernio-webhook-secret-for-unit-tests";
  const fr = await h.repos.table("funder_records").insert({ workspace_id: WS_APPLICANT, name: "Northwind Foundation" } as never);
  const outside = await h.repos.table("outside_applications").insert({ workspace_id: WS_APPLICANT, funder_record_id: fr.id, title: "Rural clinics 2027", stage: "drafting" } as never);
  const run = await h.repos.table("import_runs").insert({ workspace_id: WS_FUNDER, target: "award_history", source: "csv", source_label: "history.csv", mapping: {} as never, rows_total: 1 } as never);
  x = { s, outside: outside.id, run: run.id };
});

/** An agent acting for the workspace's admin, with every scope of that role; and an API client with every scope. */
async function tokens(side: Entry["side"]) {
  const ws = side === "funder" ? WS_FUNDER : WS_APPLICANT;
  const user = side === "funder" ? USER_ADMIN : USER_APPLICANT;
  const agent = await h.forge({ sub: user, client_id: CLIENT_AGENT, scope: scopesForRole(side, "admin").join(" "), [WORKSPACE_CLAIM]: ws, jti: `tok-human-${++seq}` });
  const client = await h.forge({ scope: SCOPES.join(" "), [WORKSPACE_CLAIM]: ws, jti: `tok-client-${++seq}` });
  return { ws, as: { agent, client } };
}

describe("a person's own actions refuse agents and API clients", () => {
  it("lists every action the brief names", () => {
    expect(ENTRIES.map((e) => e.what)).toEqual(["social preview", "social post", "social connect", "social connect callback", "social disconnect", "send-package email preview", "send-package email", "digest on", "digest off", "Fluxx connect", "Zengine connect", "import commit", "gallery share", "COI signature", "SSO requirement", "migration request"]);
  });

  it.each(ENTRIES.map((e) => [e.what, e] as const))("%s", async (_what, e) => {
    const { ws, as } = await tokens(e.side);
    const writesBefore = h.ledger.events.length;
    for (const [kind, token] of Object.entries(as)) {
      const body = e.body?.(x);
      const res = await h.request(e.path(x), { method: e.method, headers: { Authorization: `Bearer ${token}`, "X-GMS-Workspace": ws, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await res.text();
      const code = (JSON.parse(text) as { errors?: { code?: string }[]; code?: string }).errors?.[0]?.code ?? "";
      expect([e.what, kind, res.status], text.slice(0, 300)).toEqual([e.what, kind, 403]);
      expect(PERSON_CODES, `${e.what} as ${kind}: ${text.slice(0, 200)}`).toContain(code);
    }
    // Nothing happened: no ledger event, no post, account, subscription, connection, submission or signature.
    expect(h.ledger.events.length).toBe(writesBefore);
    expect(await h.repos.table("social_posts").count({})).toBe(0);
    expect(await h.repos.table("package_sends").count({})).toBe(0);
    expect(await h.repos.table("digest_subscriptions").count({})).toBe(0);
    expect(await h.repos.table("connector_accounts").count({ provider: ["fluxx", "zengine"] })).toBe(0);
    expect(await h.repos.table("gallery_submissions").count({})).toBe(0);
    expect(await h.repos.table("coi_signatures").count({})).toBe(0);
    expect(h.mailer.sent).toEqual([]);
  });
});
