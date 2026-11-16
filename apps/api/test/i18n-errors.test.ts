// SPDX-License-Identifier: AGPL-3.0-only
// User-facing API errors in the person's language (docs/i18n.md): `code` and the English `message`
// never change; a GMS route asked in Spanish adds `detailLocalized` beside the code when the code is
// in the `errors` catalog; the CommonGrants routes keep their error shape exactly.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ALL_CATALOGS } from "@gms/i18n/server";
import { beforeEach, describe, expect, it } from "vitest";
import { localizedDetail } from "../src/lib/error-locale.ts";
import { harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
});

const MISSING = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
type Body = { status: number; message: string; errors: { code: string; detailLocalized?: string }[] };
const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await h.request(path, { headers: { ...s.funder, ...headers } });
  return { status: res.status, body: (await res.json()) as Body };
};

describe("detailLocalized", () => {
  it("is added on a GMS route asked in Spanish, beside the unchanged code and English message", async () => {
    const english = await get(`/gms/applications/app_${MISSING}`);
    for (const ask of [{ "Accept-Language": "es-MX,es;q=0.9,en;q=0.5" }, { Cookie: "gms_lang=es" }]) {
      const r = await get(`/gms/applications/app_${MISSING}`, ask);
      expect(r.status).toBe(404);
      expect(r.body.message).toBe(english.body.message);
      expect(r.body.errors[0]).toEqual({ code: "not_found", detailLocalized: "No se encontró la solicitud." });
    }
    expect((await get(`/gms/applications/app_${MISSING}?lang=es`)).body.errors[0]!.detailLocalized).toBe("No se encontró la solicitud.");
  });

  it("is absent in English, and when the person chose English over a Spanish browser", async () => {
    expect((await get(`/gms/applications/app_${MISSING}`)).body.errors[0]).toEqual({ code: "not_found" });
    expect((await get(`/gms/applications/app_${MISSING}`, { "Accept-Language": "es", Cookie: "gms_lang=en" })).body.errors[0]).toEqual({ code: "not_found" });
  });

  it("is absent for a code the catalog does not hold", () => {
    expect(localizedDetail({ code: "not_a_catalogued_code" }, "es")).toBeNull();
    expect(localizedDetail({ code: "conflict" }, "es")).toBe("Este registro cambió mientras trabajaba. Vuelva a cargar la página e inténtelo de nuevo.");
    expect(localizedDetail({ code: "conflict" }, "en")).toBeNull();
    // A resource the catalog does not name reads the code's own message.
    expect(localizedDetail({ code: "not_found", resource: "Something new" }, "es")).toBe("No encontramos lo que buscaba. Es posible que se haya eliminado o que no tenga acceso.");
  });

  it("never changes the CommonGrants error shape", async () => {
    const r = await get(`/common-grants/applications/${MISSING}`, { "Accept-Language": "es" });
    expect(r.status).toBe(404);
    expect(r.body.errors).toEqual([{ code: "not_found" }]);
    expect(Object.keys(r.body).sort()).toEqual(["errors", "message", "status"]);
  });
});

describe("the errors catalog", () => {
  /** Every code the API's routes and services raise, with how often (`new ApiError(status, "code"`, and the auth helpers). */
  function rankedCodes(): string[] {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
    const count = new Map<string, number>();
    const src = new URL("../src/", import.meta.url).pathname;
    for (const file of walk(src)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/new ApiError\(\s*\d+\s*,\s*"([a-z0-9_]+)"|\b(?:forbidden|authError)\("([a-z0-9_]+)"/g)) count.set(m[1] ?? m[2]!, (count.get(m[1] ?? m[2]!) ?? 0) + 1);
      count.set("not_found", (count.get("not_found") ?? 0) + (text.match(/\b(notFound|required)\(/g)?.length ?? 0));
      count.set("bad_request", (count.get("bad_request") ?? 0) + (text.match(/\bbadRequest\(/g)?.length ?? 0));
    }
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code]) => code);
  }

  it("holds the 80 most common user-facing codes, each in English and Spanish", () => {
    const es = ALL_CATALOGS.es.errors as Record<string, string>;
    const top = rankedCodes().slice(0, 80);
    expect(top.length).toBe(80);
    expect(top.filter((code) => !(`code.${code}` in es))).toEqual([]);
  });
});
