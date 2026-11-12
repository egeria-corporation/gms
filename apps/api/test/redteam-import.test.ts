// SPDX-License-Identifier: AGPL-3.0-only
// Red team (2026-11): bundle import was a cross-tenant row writer. `POST /gms/imports/bundle`
// inserted the request body row by row with the service role. These tests pin the fix: tenants have
// no import route, and the operator's import cannot write outside the workspace it was given.
import { beforeEach, describe, expect, it } from "vitest";
import { importWorkspaceBundle, type BaseContext } from "../src/jobs.ts";
import { USER_ADMIN, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

const baseOf = (h: Harness): BaseContext => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null }, ports: {} });
const STRANGER = "5a5a5a5a-0000-4000-8000-000000000001";
const SHA = "0".repeat(64);
const signature = (name: string) => ({ name, at: "2027-01-01T00:00:00Z", ip: "0.0.0.0", documentSha256: SHA });

let h: Harness;
let s: Scenario;
let victimAward: string;
let victimApp: string;

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  victimApp = started.body.data.id;
  const award = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_individual: { name: "A person" } as never, title: "The victim funder's award", status: "active", funding: { awardedAmount: { amount: "150000.00", currency: "USD" } } as never });
  victimAward = award.id;
});

/** The rows an attacker would send: shared-library rows, children of another funder's records, and finished states. */
function hostileBundle(ownWs: string) {
  const template = crypto.randomUUID();
  const ids = { template, agreement: crypto.randomUUID(), tranche: crypto.randomUUID(), competition: crypto.randomUUID(), decision: crypto.randomUUID(), form: crypto.randomUUID(), rubric: crypto.randomUUID(), amendment: crypto.randomUUID(), requirement: crypto.randomUUID(), budget: crypto.randomUUID(), submission: crypto.randomUUID() };
  const gms = {
    workspace: { handle: "x" },
    // No workspace_id: these used to land in the library every funder sees.
    templates: [{ id: ids.template, kind: "agreement", name: "Standard grant agreement (2027)", body: "The Funder waives all reporting.", version: 1 }],
    rubrics: [{ id: ids.rubric, name: "Planted rubric", version: 1, criteria: [], overall: {} }],
    agreements: [{ id: ids.agreement, workspace_id: ownWs, award_id: victimAward, template_id: template, version: 99, status: "executed", document_sha256: SHA, grantee_signature: signature("Anyone"), funder_signature: signature("Forged Officer"), executed_at: "2027-01-01T00:00:00Z" }],
    requirements: [{ id: ids.requirement, workspace_id: ownWs, award_id: victimAward, type: "report", title: "Planted", status: "accepted" }],
    amendments: [{ id: ids.amendment, workspace_id: ownWs, award_id: victimAward, type: "supplemental", request: { amountMinor: 1 }, status: "approved" }],
    budgets: [{ id: ids.budget, workspace_id: ownWs, award_id: victimAward, kind: "approved", lines: [] }],
    tranches: [{ id: ids.tranche, workspace_id: ownWs, schedule_id: crypto.randomUUID(), award_id: victimAward, seq: 99, amount_minor: 7_500_000, currency: "USD", condition: { type: "manual" }, status: "due", idempotency_key: `trn_${ids.tranche}` }],
    submissions: [{ id: ids.submission, workspace_id: ownWs, requirement_id: ids.requirement, award_id: victimAward, status: "submitted", submitted_at: "2027-01-01T00:00:00Z" }],
    decisions: [{ id: ids.decision, workspace_id: ownWs, competition_id: s.uuid.comp, application_id: victimApp, outcome: "decline", committed_at: "2027-01-01T00:00:00Z" }],
    records: {
      forms: [{ id: ids.form, version: 1, title: "Planted form", purpose: "application", published_at: "2027-01-01T00:00:00Z" }],
      competitions: [{ id: ids.competition, workspace_id: ownWs, opportunity_id: s.uuid.opp, title: "Planted competition", status: "open" }],
    },
  };
  return { gms, ids };
}

describe("bundle import", () => {
  it("has no route for tenants: a workspace admin gets 410 and nothing is written", async () => {
    const me = { ...bearer(await h.session(STRANGER)).headers, "Content-Type": "application/json" };
    const made = await h.request("/gms/workspaces", { method: "POST", headers: me, body: JSON.stringify({ kind: "funder", handle: "shell-funder", displayName: "Shell Funder" }) });
    const evilWs = ((await made.json()) as { data: { workspace: { id: string } } }).data.workspace.id;
    const { gms, ids } = hostileBundle(evilWs);
    const res = await s.call<{ errors: { code: string }[] }>({ ...me, "X-GMS-Workspace": evilWs }, "POST", "/gms/imports/bundle", { gms });
    expect(res.status).toBe(410);
    expect(res.body.errors[0]!.code).toBe("import_not_available");
    // The victim funder's own admin is refused the same way: restoring is the operator's job.
    const admin = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    expect((await s.call(admin, "POST", "/gms/imports/bundle", { gms })).status).toBe(410);
    for (const [table, id] of [["templates", ids.template], ["rubrics", ids.rubric], ["agreements", ids.agreement], ["requirements", ids.requirement], ["amendments", ids.amendment], ["budgets", ids.budget], ["decisions", ids.decision], ["forms", ids.form], ["competitions", ids.competition], ["tranches", ids.tranche], ["submissions", ids.submission]] as const) {
      expect(await h.repos.table(table).count({ id } as never), table).toBe(0);
    }
  });

  it("as the operator, never writes outside the target workspace", async () => {
    // WS_OTHER is the import target; the hostile rows point at WS_FUNDER's award, application and opportunity.
    const { gms, ids } = hostileBundle(WS_OTHER);
    const out = await importWorkspaceBundle(baseOf(h), WS_OTHER, { gms });
    // Library rows are owned by the target workspace, never shared (workspace_id null).
    expect((await h.repos.table("templates").one({ id: ids.template }))!.workspace_id).toBe(WS_OTHER);
    expect((await h.repos.table("rubrics").one({ id: ids.rubric }))!.workspace_id).toBe(WS_OTHER);
    expect((await h.repos.table("forms").one({ id: ids.form }))!.workspace_id).toBe(WS_OTHER);
    // Children of another workspace's award, application or opportunity are skipped.
    for (const [table, id] of [["agreements", ids.agreement], ["requirements", ids.requirement], ["amendments", ids.amendment], ["budgets", ids.budget], ["decisions", ids.decision], ["competitions", ids.competition], ["tranches", ids.tranche], ["submissions", ids.submission]] as const) {
      expect(await h.repos.table(table).count({ id } as never), table).toBe(0);
    }
    expect(out.counts.agreements).toEqual({ inserted: 0, existing: 0, skipped: 1 });
    expect(out.counts.competitions).toEqual({ inserted: 0, existing: 0, skipped: 1 });
  });

  it("as the operator, cannot supersede a form or rubric of the shared library or of another workspace", async () => {
    const shared = await h.repos.table("forms").insert({ workspace_id: null, title: "Shared library form", purpose: "application", published_at: h.clock.now.toISOString() });
    const theirs = (await h.repos.table("rubrics").find({ workspace_id: WS_FUNDER }))[0]!;
    const gms = {
      workspace: { handle: "x" },
      rubrics: [{ id: theirs.id, version: 99, name: "Superseding rubric", criteria: [], overall: {} }],
      records: { forms: [{ id: shared.id, version: 99, title: "Superseding form", purpose: "application", published_at: "2027-01-01T00:00:00Z" }] },
    };
    const out = await importWorkspaceBundle(baseOf(h), WS_OTHER, { gms });
    expect(out.counts.forms).toEqual({ inserted: 0, existing: 0, skipped: 1 });
    expect(out.counts.rubrics).toEqual({ inserted: 0, existing: 0, skipped: 1 });
    expect(await h.repos.table("forms").count({ id: shared.id })).toBe(1);
    expect(await h.repos.table("rubrics").count({ id: theirs.id, version: 99 })).toBe(0);
  });

  it("as the operator, does not adopt a row that already exists in another workspace", async () => {
    // A tranche whose award id is another funder's existing award: "already exists" must not make it a known parent.
    const schedule = await h.repos.table("payment_schedules").insert({ workspace_id: WS_FUNDER, award_id: victimAward });
    const planted = crypto.randomUUID();
    const gms = {
      workspace: { handle: "x" },
      records: { awards: [{ id: victimAward, workspace_id: WS_OTHER, title: "Same id as the victim's award", status: "active", recipient_individual: { name: "x" } }] },
      tranches: [{ id: planted, workspace_id: WS_OTHER, schedule_id: schedule.id, award_id: victimAward, seq: 99, amount_minor: 7_500_000, currency: "USD", condition: { type: "manual" }, status: "due", idempotency_key: `trn_${planted}` }],
    };
    const out = await importWorkspaceBundle(baseOf(h), WS_OTHER, { gms });
    expect(out.counts.awards).toEqual({ inserted: 0, existing: 0, skipped: 1 });
    expect(out.counts.tranches).toEqual({ inserted: 0, existing: 0, skipped: 1 });
    expect(await h.repos.table("tranches").count({ id: planted })).toBe(0);
    expect((await h.repos.table("awards").one({ id: victimAward }))!.workspace_id).toBe(WS_FUNDER);
  });
});
