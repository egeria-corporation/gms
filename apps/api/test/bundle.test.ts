// SPDX-License-Identifier: AGPL-3.0-only
// `gms export` and `gms import`: the operator path over the same services as the routes.
import { beforeEach, describe, expect, it } from "vitest";
import { exportWorkspaceBundle, importWorkspaceBundle, type BaseContext } from "../src/jobs.ts";
import { WS_APPLICANT, WS_FUNDER, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

const baseOf = (h: Harness): BaseContext => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null }, ports: {} });

let h: Harness;
let s: Scenario;
let appUuid: string;

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  appUuid = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles." } });
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/submit`);
});

describe("bundle export and import", () => {
  it("exports the three files as the operator and ledgers it as system:cli", async () => {
    const out = await exportWorkspaceBundle(baseOf(h), WS_FUNDER);
    expect(out.files).toEqual(["commongrants.json", "gms.json", "attachments/manifest.json"]);
    expect(out.counts).toMatchObject({ opportunities: 1, competitions: 1, applications: 1 });
    const bundle = out.bundle as unknown as Record<string, Record<string, unknown>>;
    expect(bundle["commongrants.json"]!.protocol).toBe("CommonGrants v0.5.0");
    expect(Object.keys(bundle["gms.json"]!.records as object).sort()).toEqual(["applications", "awards", "competitions", "forms", "opportunities"]);
    const event = (await h.ledger.list({ workspaceId: WS_FUNDER, eventType: "export.bundle" }))[0]!;
    expect(event.actor).toBe("system:cli");
  });

  it("restores a bundle into a fresh instance, is safe to re-run, and skips what has no applicant here", async () => {
    const exported = await exportWorkspaceBundle(baseOf(h), WS_FUNDER);
    const gms = (exported.bundle as Record<string, unknown>)["gms.json"];

    const fresh = await harness();
    const first = await importWorkspaceBundle(baseOf(fresh), WS_FUNDER, { gms });
    expect(first.counts.opportunities).toEqual({ inserted: 1, existing: 0, skipped: 0 });
    expect(first.counts.competitions!.inserted).toBe(1);
    expect(first.counts.forms!.inserted).toBeGreaterThanOrEqual(2);
    expect(first.counts.applications).toEqual({ inserted: 1, existing: 0, skipped: 0 });
    const restored = (await fresh.repos.table("applications").one({ id: appUuid }))!;
    expect(restored).toMatchObject({ status: "submitted", workspace_id: WS_FUNDER, applicant_workspace_id: WS_APPLICANT });
    expect(await fresh.repos.table("form_responses").count({ application_id: appUuid })).toBeGreaterThan(0);

    const again = await importWorkspaceBundle(baseOf(fresh), WS_FUNDER, { gms });
    expect(again.inserted).toBe(0);
    expect(again.existing).toBe(first.inserted);

    // An instance where the applicant has never connected: the application and its responses wait.
    const other = await harness();
    await other.repos.table("workspaces").remove({ id: WS_APPLICANT });
    const partial = await importWorkspaceBundle(baseOf(other), WS_FUNDER, { gms });
    expect(partial.counts.opportunities!.inserted).toBe(1);
    expect(partial.counts.applications).toEqual({ inserted: 0, existing: 0, skipped: 1 });
    expect(partial.counts.form_responses!.inserted).toBe(0);
  });

  it("refuses something that is not a bundle, and an applicant workspace", async () => {
    await expect(importWorkspaceBundle(baseOf(h), WS_FUNDER, { gms: { hello: "world" } })).rejects.toMatchObject({ status: 422 });
    await expect(exportWorkspaceBundle(baseOf(h), WS_APPLICANT)).rejects.toThrow(/funder workspaces/);
  });
});
