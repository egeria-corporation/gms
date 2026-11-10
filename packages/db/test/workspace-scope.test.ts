// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createServiceClient, forWorkspace, isUuid, type DbClient } from "../src/index.ts";

const WS = "20000000-0000-7000-8000-000000000001";

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };

/** Records what a scope asks the client to do, without a network. */
function fakeClient() {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const start = (op: string, payload?: unknown) => {
        const call: Call = { table, op, payload, filters: [] };
        calls.push(call);
        const builder = {
          eq(column: string, value: unknown) {
            call.filters.push([column, value]);
            return builder;
          },
        };
        return builder;
      };
      return {
        select: (columns: string) => start("select", columns),
        insert: (rows: unknown) => start("insert", rows),
        update: (patch: unknown) => start("update", patch),
        delete: () => start("delete"),
      };
    },
  };
  return { client: client as unknown as DbClient, calls };
}

describe("forWorkspace", () => {
  it("rejects a workspace id that is not a UUID", () => {
    const { client } = fakeClient();
    expect(() => forWorkspace(client, "riverbend")).toThrow(TypeError);
    expect(() => forWorkspace(client, "")).toThrow(TypeError);
  });

  it("filters every read by workspace_id", () => {
    const { client, calls } = fakeClient();
    forWorkspace(client, WS).select("applications", "id, status");
    forWorkspace(client, WS).select("programs");
    expect(calls).toEqual([
      { table: "applications", op: "select", payload: "id, status", filters: [["workspace_id", WS]] },
      { table: "programs", op: "select", payload: "*", filters: [["workspace_id", WS]] },
    ]);
  });

  it("stamps workspace_id on every inserted row", () => {
    const { client, calls } = fakeClient();
    forWorkspace(client, WS).insert("tasks", [{ title: "One" }, { title: "Two" }]);
    forWorkspace(client, WS).insert("tasks", { title: "Three" });
    expect(calls[0]!.payload).toEqual([
      { title: "One", workspace_id: WS },
      { title: "Two", workspace_id: WS },
    ]);
    expect(calls[1]!.payload).toEqual([{ title: "Three", workspace_id: WS }]);
  });

  it("refuses a caller-supplied workspace_id on insert and update", () => {
    const { client, calls } = fakeClient();
    const ws = forWorkspace(client, WS);
    const other = "20000000-0000-7000-8000-000000000002";
    expect(() => ws.insert("tasks", { title: "x", workspace_id: other } as never)).toThrow(/set by the scope/);
    expect(() => ws.update("tasks", { workspace_id: other } as never)).toThrow(/cannot be changed/);
    expect(calls).toEqual([]);
  });

  it("filters updates and deletes by workspace_id", () => {
    const { client, calls } = fakeClient();
    const ws = forWorkspace(client, WS);
    ws.update("programs", { name: "Community Health" }).eq("id", "p1");
    ws.delete("tasks").eq("id", "t1");
    expect(calls[0]).toEqual({ table: "programs", op: "update", payload: { name: "Community Health" }, filters: [["workspace_id", WS], ["id", "p1"]] });
    expect(calls[1]).toEqual({ table: "tasks", op: "delete", payload: undefined, filters: [["workspace_id", WS], ["id", "t1"]] });
  });

  it("recognizes UUIDs", () => {
    expect(isUuid(WS)).toBe(true);
    expect(isUuid("20000000-0000-7000-8000-00000000000")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("createServiceClient", () => {
  it("requires both settings and a real URL, without echoing values", () => {
    expect(() => createServiceClient({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "k" })).toThrow("SUPABASE_URL is not set");
    expect(() => createServiceClient({ SUPABASE_URL: "http://localhost:57321", SUPABASE_SERVICE_ROLE_KEY: " " })).toThrow("SUPABASE_SERVICE_ROLE_KEY is not set");
    expect(() => createServiceClient({ SUPABASE_URL: "not a url", SUPABASE_SERVICE_ROLE_KEY: "k" })).toThrow("SUPABASE_URL is not a valid URL");
    expect(() => createServiceClient({ SUPABASE_URL: "ftp://example.test", SUPABASE_SERVICE_ROLE_KEY: "k" })).toThrow("must be an http(s) URL");
  });

  it("builds a client for a valid environment", () => {
    const db = createServiceClient({ SUPABASE_URL: "http://localhost:57321", SUPABASE_SERVICE_ROLE_KEY: "test-service-key" });
    expect(typeof db.from).toBe("function");
  });
});
