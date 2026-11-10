// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { GENESIS_HASH, MemoryLedgerStore, archiveDay, buildArchive, formatActor, parseActor, record, verifyArchive, type Actor } from "../src/index.ts";

const at = (iso: string) => ({ now: () => new Date(iso) });

describe("actors", () => {
  const cases: [Actor, string][] = [
    [{ kind: "user", userId: "u1" }, "user:u1"],
    [{ kind: "client", clientId: "c1" }, "client:c1"],
    [{ kind: "delegated", userId: "u1", clientId: "c1" }, "user:u1/client:c1"],
    [{ kind: "system", job: "ledger-archive" }, "system:ledger-archive"],
    [{ kind: "passport" }, "passport"],
  ];
  it.each(cases)("formats and parses %j", (actor, wire) => {
    expect(formatActor(actor)).toBe(wire);
    expect(parseActor(wire)).toEqual(actor);
  });
  it("rejects unknown formats", () => expect(parseActor("root")).toBeNull());
});

describe("record", () => {
  it("appends an event with the actor in wire format", async () => {
    const store = new MemoryLedgerStore();
    const e = await record(
      store,
      { workspaceId: "ws1", actor: { kind: "user", userId: "u1" }, eventType: "application.submitted", subjectType: "application", subjectId: "app_1", data: { stage: "loi" } },
      at("2027-04-16T10:00:00Z"),
    );
    expect(e.actor).toBe("user:u1");
    expect(await store.list({ workspaceId: "ws1" })).toEqual([e]);
    expect(await store.count({ workspaceId: "other" })).toBe(0);
  });

  it("refuses malformed event types and bank or identity keys", async () => {
    const store = new MemoryLedgerStore();
    const base = { workspaceId: "ws1", actor: { kind: "passport" } as const, subjectType: "tranche", subjectId: "trn_1" };
    await expect(record(store, { ...base, eventType: "Submitted" })).rejects.toThrow(/event type/);
    const key = ["account", "number"].join("_");
    await expect(record(store, { ...base, eventType: "tranche.settled", data: { external: { [key]: "x" } } })).rejects.toThrow(/bank or identity/);
    expect(store.events).toHaveLength(0);
  });
});

describe("archive hash chain", () => {
  async function seeded() {
    const store = new MemoryLedgerStore();
    const base = { workspaceId: "ws1", actor: { kind: "system", job: "test" } as const, subjectType: "award", subjectId: "awd_1" };
    await record(store, { ...base, eventType: "award.created" }, at("2027-05-18T09:00:00Z"));
    await record(store, { ...base, eventType: "award.status_changed", data: { to: "accepted" } }, at("2027-05-18T15:00:00Z"));
    await record(store, { ...base, eventType: "award.status_changed", data: { to: "active" } }, at("2027-05-19T08:00:00Z"));
    return store;
  }

  it("chains every line to the one before and verifies", async () => {
    const store = await seeded();
    const { jsonl, lastHash, count } = await buildArchive(await store.list({}));
    expect(count).toBe(3);
    const lines = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].prevHash).toBe(GENESIS_HASH);
    expect(lines[1].prevHash).toBe(lines[0].hash);
    expect(lines[2].hash).toBe(lastHash);
    expect(await verifyArchive(jsonl)).toEqual({ ok: true, lastHash, count: 3 });
  });

  it("detects an edited line and a removed line", async () => {
    const { jsonl } = await buildArchive(await (await seeded()).list({}));
    const edited = jsonl.replace('"to":"accepted"', '"to":"cancelled"');
    expect(await verifyArchive(edited)).toMatchObject({ ok: false, line: 2 });
    const removed = jsonl.split("\n").filter((_, i) => i !== 1).join("\n");
    expect(await verifyArchive(removed)).toMatchObject({ ok: false, line: 2 });
  });

  it("archives one UTC day per object and carries the chain across days", async () => {
    const store = await seeded();
    const puts = new Map<string, string>();
    const bucket = { put: async (key: string, value: string) => void puts.set(key, value) };
    const d1 = await archiveDay(store, bucket, "2027-05-18");
    const d2 = await archiveDay(store, bucket, "2027-05-19", d1.lastHash);
    expect(d1).toMatchObject({ key: "ledger/2027/05/18.jsonl", count: 2, prevHash: GENESIS_HASH });
    expect(d2).toMatchObject({ key: "ledger/2027/05/19.jsonl", count: 1, prevHash: d1.lastHash });
    expect(await verifyArchive(puts.get(d2.key)!, d1.lastHash)).toMatchObject({ ok: true });
    expect(await verifyArchive(puts.get(d2.key)!)).toMatchObject({ ok: false, line: 1 });
  });
});
