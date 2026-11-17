// SPDX-License-Identifier: AGPL-3.0-only
// Contract: live responses of the connected-apps routes (Slack alerts, Google Calendar, Google
// Drive, the Salesforce import source) validate against the compiled OpenAPI document
// (`pnpm spec:compile`). Skipped when it has not been compiled; CI compiles it first.
import { FixtureCalendarSync, FixtureDriveFiles, FixtureSalesforceSource, FixtureSlackAlerts } from "@gms/connectors";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { USER_ADMIN, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const SPEC = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

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

const APPLICANT_ADMIN = "12121212-1212-4121-8121-121212121212";

describe.skipIf(!existsSync(SPEC))("connected apps contract", () => {
  let ajv: Ajv;
  let h: Harness;
  let applicant: Record<string, string>;
  let funder: Record<string, string>;

  const schema = (path: string, method: string, status: string): ValidateFunction => ajv.compile({ $ref: `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer("application/json")}/schema` });
  async function valid<T>(who: Record<string, string>, path: string, method: "get" | "post" | "put" | "delete", url: string, status: number, body?: unknown): Promise<T> {
    const res = await h.request(url, { method: method.toUpperCase(), headers: who, ...(method === "get" || method === "delete" ? {} : { body: JSON.stringify(body ?? {}) }) });
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
    Object.assign(h.extraPorts, {
      slack: new FixtureSlackAlerts(),
      calendar: new FixtureCalendarSync(),
      drive: new FixtureDriveFiles(),
      salesforce: new FixtureSalesforceSource({ Opportunity: [{ Id: "006000000000001AAA", Name: "Clean water", Account: { Name: "Hart Foundation" }, npsp__Requested_Amount__c: 1000 }] }),
    });
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: APPLICANT_ADMIN, role: "admin" });
    applicant = { ...bearer(await h.session(APPLICANT_ADMIN)).headers, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" };
    funder = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
  });

  it("Slack alerts and the connector match the document", async () => {
    await valid(funder, "/gms/connectors/{provider}", "post", "/gms/connectors/slack", 200, {});
    await valid(funder, "/gms/connectors/{provider}", "get", "/gms/connectors/slack", 200);
    await valid(funder, "/gms/connected-apps/slack/channels", "get", "/gms/connected-apps/slack/channels", 200);
    await valid(funder, "/gms/connected-apps/slack", "put", "/gms/connected-apps/slack", 200, { channelId: "C0GRANTS01", events: ["new_application", "deadline_soon"], enabled: true });
    await valid(funder, "/gms/connected-apps/slack", "get", "/gms/connected-apps/slack", 200);
    await valid(funder, "/gms/connected-apps/slack", "delete", "/gms/connected-apps/slack", 200);
  });

  it("Google Calendar matches the document", async () => {
    await valid(applicant, "/gms/connected-apps/calendar", "get", "/gms/connected-apps/calendar", 200);
    await valid(applicant, "/gms/connected-apps/calendar", "post", "/gms/connected-apps/calendar", 200, {});
    await valid(applicant, "/gms/connected-apps/calendar/calendars", "get", "/gms/connected-apps/calendar/calendars", 200);
    await valid(applicant, "/gms/connected-apps/calendar", "put", "/gms/connected-apps/calendar", 200, { calendarId: "primary" });
    await valid(applicant, "/gms/connected-apps/calendar/sync", "post", "/gms/connected-apps/calendar/sync", 200);
    await valid(applicant, "/gms/connected-apps/calendar", "delete", "/gms/connected-apps/calendar", 200);
  });

  it("Salesforce as an import source and the configuration match the document", async () => {
    await valid(applicant, "/gms/imports/sources", "get", "/gms/imports/sources?target=outside_applications", 200);
    await valid(applicant, "/gms/imports/read", "post", "/gms/imports/read", 200, { target: "outside_applications", source: { kind: "salesforce", preset: "npsp_grants" } });
    await valid(applicant, "/gms/connectors/{provider}", "post", "/gms/connectors/google_drive", 200, {});
    await valid(funder, "/gms/config", "get", "/gms/config", 200);
  });
});
