// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the QuickBooks sync routes (/gms/accounting, and /gms/connectors/quickbooks)
// validate against the compiled OpenAPI document (`pnpm spec:compile`). Skipped when it has not been
// compiled; CI compiles it first.
import { FixtureQuickBooksBooks } from "@gms/connectors";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { syncAccounting } from "../src/services/accounting.ts";
import { systemContext, type BaseContext } from "../src/services/context.ts";
import { applyTrancheUpdate } from "../src/services/tranches.ts";
import { USER_ADMIN, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const PROGRAM = "0190a000-0000-7000-8000-00000000c001";

function withoutExamples(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutExamples);
  if (node === null || typeof node !== "object") return node;
  const out = Object.fromEntries(Object.entries(node).filter(([k]) => k !== "example" && k !== "examples").map(([k, v]) => [k, withoutExamples(v)]));
  if (out.nullable === true) {
    const { nullable: _nullable, description, ...rest } = out;
    return { ...(description === undefined ? {} : { description }), anyOf: [rest, { enum: [null] }] };
  }
  return out;
}

describe.skipIf(!existsSync(SPEC))("QuickBooks sync contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let funder: Record<string, string>;
  const books = new FixtureQuickBooksBooks();

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid<T>(path: string, method: "get" | "post" | "put" | "delete", url: string, status: number, body?: unknown): Promise<T> {
    const res = await h.request(url, { method: method.toUpperCase(), headers: funder, ...(method === "get" || method === "delete" ? {} : { body: JSON.stringify(body ?? {}) }) });
    const json = (await res.json()) as { data: T };
    expect(res.status, `${method} ${url} ${JSON.stringify(json).slice(0, 300)}`).toBe(status);
    const v = schema(path, method, String(status));
    v(json);
    expect(v.errors ?? [], `${method.toUpperCase()} ${url}`).toEqual([]);
    return json.data;
  }

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    ajv.addSchema({ $id: "openapi", ...(withoutExamples(parse(readFileSync(SPEC, "utf8"))) as object) });
    h = await harness();
    Object.assign(h.extraPorts, { quickbooks: books });
    await h.repos.table("programs").insert({ id: PROGRAM, workspace_id: WS_FUNDER, name: "Community health" });
    funder = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
  });

  it("the setting, the options, the vendors, the entries and each entry's actions", async () => {
    await valid("/gms/connectors/{provider}", "post", "/gms/connectors/quickbooks", 200, {});
    await valid("/gms/connectors/{provider}", "get", "/gms/connectors/quickbooks", 200);
    await valid("/gms/accounting", "get", "/gms/accounting", 200);
    await valid("/gms/accounting/options", "get", "/gms/accounting/options", 200);
    await valid("/gms/accounting/settings", "put", "/gms/accounting/settings", 200, { expenseId: "61", paidFromId: "35", tracking: "class", programs: { [PROGRAM]: "5000000000000012345" }, vendorPolicy: "create", syncEnabled: true });
    const a = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title: "Clean water", program_id: PROGRAM, status: "active" } as never);
    const s = await h.repos.table("payment_schedules").insert({ workspace_id: WS_FUNDER, award_id: a.id } as never);
    const t = await h.repos.table("tranches").insert({ workspace_id: WS_FUNDER, schedule_id: s.id, award_id: a.id, seq: 1, amount_minor: 2_500_000, status: "due" } as never);
    await valid("/gms/accounting/vendors", "get", "/gms/accounting/vendors", 200);
    await valid("/gms/accounting/vendors", "put", "/gms/accounting/vendors", 200, { vendors: [{ granteeId: WS_APPLICANT, vendorId: "56" }] });
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    const base = { repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { webBaseUrl: "https://app.gms.test" }, ports: { quickbooks: books } } as unknown as BaseContext;
    await applyTrancheUpdate(systemContext(base, { job: "test" }, { id: WS_FUNDER, kind: "funder" }), { trancheId: t.id, path: ["settled"], patch: { mode: "resolve", external: { reference: "Wire 1", paidAt: "2027-04-15", last4: "0000" } } } as never, "funder");
    await valid("/gms/accounting/entries", "get", "/gms/accounting/entries", 200);
    await syncAccounting(base);
    await valid("/gms/accounting/entries", "get", "/gms/accounting/entries?compare=true", 200);
    await h.repos.table("tranches").update({ id: t.id }, { amount_minor: 2_000_000 });
    await syncAccounting(base);
    const [entry] = await h.repos.table("accounting_entries").find({ workspace_id: WS_FUNDER });
    const handled = await valid<{ status: string }>("/gms/accounting/entries/{id}/handled", "post", `/gms/accounting/entries/${entry!.id}/handled`, 200);
    expect(handled.status).toBe("handled");
    await h.repos.table("accounting_entries").update({ id: entry!.id }, { status: "failed", reason: "refused" });
    await valid("/gms/accounting/entries/{id}/retry", "post", `/gms/accounting/entries/${entry!.id}/retry`, 200);
    await valid("/gms/connectors/{provider}", "delete", "/gms/connectors/quickbooks", 200);
  });
});
