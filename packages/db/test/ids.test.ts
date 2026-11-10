// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { ID_PREFIXES, InvalidIdError, fromApiId, isApiId, parseApiId, toApiId, uuidV7Timestamp, type IdKind } from "../src/index.ts";

const UUID = "01a1c45e-6933-738f-b570-b6071bf24987";

describe("api ids", () => {
  it("has the ten prefixes of the build spec", () => {
    expect(Object.values(ID_PREFIXES).sort()).toEqual(["agr", "app", "awd", "cmp", "frm", "opp", "req", "rev", "sub", "trn"]);
  });

  it("round-trips every kind", () => {
    for (const kind of Object.keys(ID_PREFIXES) as IdKind[]) {
      const id = toApiId(kind, UUID);
      expect(id).toBe(`${ID_PREFIXES[kind]}_01a1c45e6933738fb570b6071bf24987`);
      expect(fromApiId(kind, id)).toBe(UUID);
      expect(parseApiId(id)).toEqual({ kind, uuid: UUID });
      expect(isApiId(kind, id)).toBe(true);
    }
  });

  it("lower-cases the uuid", () => {
    expect(toApiId("award", UUID.toUpperCase())).toBe("awd_01a1c45e6933738fb570b6071bf24987");
  });

  it("refuses an id of another kind", () => {
    const tranche = toApiId("tranche", UUID);
    expect(() => fromApiId("award", tranche)).toThrow(InvalidIdError);
    expect(isApiId("award", tranche)).toBe(false);
  });

  it("refuses malformed input", () => {
    expect(() => toApiId("award", "not-a-uuid")).toThrow(InvalidIdError);
    for (const bad of ["", UUID, "awd_", "awd_xyz", "zzz_01a1c45e6933738fb570b6071bf24987", "awd_01a1c45e6933738fb570b6071bf2498", "AWD_01a1c45e6933738fb570b6071bf24987"]) {
      expect(parseApiId(bad)).toBeNull();
      expect(() => fromApiId("award", bad)).toThrow(InvalidIdError);
    }
    expect(isApiId("award", 42)).toBe(false);
  });

  it("reads the timestamp out of a UUIDv7", () => {
    expect(uuidV7Timestamp(UUID)).toBe(0x01a1c45e6933);
    expect(uuidV7Timestamp("3afc7533-7095-43bb-b21a-5c4dc5568451")).toBeNull();
  });
});
