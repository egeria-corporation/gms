// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Readiness checks in the page's language (lib/readinessText.ts). The English messages are the API's
// own sentences (apps/api/src/services/organization.ts), so a check reads the same in English and is
// worded from the catalog in Spanish; a check worded any other way is shown as it came.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import enShared from "@gms/i18n/catalogs/en/shared.json";
import { changeLocale } from "../src/i18n/current.ts";
import { readinessWords } from "../src/lib/readinessText.ts";

const api = readFileSync(fileURLToPath(new URL("../../api/src/services/organization.ts", import.meta.url)), "utf8");
const plain = Object.entries(enShared as Record<string, string>).filter(([k, v]) => k.startsWith("readiness.") && !v.includes("{"));

afterEach(async () => {
  await changeLocale("en");
});

describe("readiness checks in the page's language", () => {
  it("use the API's own English sentences", () => {
    expect(plain.length).toBeGreaterThan(15);
    for (const [k, v] of plain) expect(api, k).toContain(`"${v}"`);
    expect(api).toContain("`Record last read ${");
    expect(api).toContain("`Add your organization's ${missing.join(\" and \")} in Settings`");
  });

  it("read the same in English and are worded in Spanish", async () => {
    const checks = [
      { key: "identity_verified", state: "fail" as const, label: "Identity verified", reason: "Verify your representatives in Passport" },
      { key: "organization_active", state: "unknown" as const, label: "Organization in good standing", reason: "Connect Passport to see this" },
      { key: "profile_complete", state: "fail" as const, label: "Profile complete", reason: "Add your organization's legal name and contact email in Settings" },
      { key: "passport_linked", state: "pass" as const, label: "Passport connected", reason: "Record last read 2026-11-14" },
    ];
    expect(checks.slice(0, 3).map(readinessWords)).toEqual(checks.slice(0, 3).map(({ label, reason }) => ({ label, reason })));
    expect(readinessWords(checks[3]!).reason).toBe("Record last read Nov 14, 2026");
    await changeLocale("es");
    expect(checks.map(readinessWords)).toEqual([
      { label: "Identidad verificada", reason: "Verifique a sus personas representantes en Passport" },
      { label: "Organización en regla", reason: "Conecte Passport para ver esto" },
      { label: "Perfil completo", reason: "Agregue el nombre legal y el correo de contacto de su organización en Configuración" },
      { label: "Passport conectado", reason: "Registro leído por última vez el 14 de noviembre de 2026" },
    ]);
    // Demo data worded another way, and a check this version does not know, show as they came.
    expect(readinessWords({ key: "identity_verified", state: "pass", label: "Identity verified", reason: "Representatives confirmed Jan 12, 2027" }).reason).toBe("Representatives confirmed Jan 12, 2027");
    expect(readinessWords({ key: "new_check", state: "fail", label: "Something new", reason: "Do this" })).toEqual({ label: "Something new", reason: "Do this" });
  });
});
