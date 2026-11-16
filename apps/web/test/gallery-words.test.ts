// SPDX-License-Identifier: AGPL-3.0-only
// The template gallery names its kinds and tag values in the page's language; the stored values
// (filters, saved tags) stay as they are.
import { afterEach, describe, expect, it } from "vitest";
import { GALLERY_KINDS, KIND_LABEL, KIND_PLURAL } from "../src/api/gallery.ts";
import { changeLocale } from "../src/i18n/current.ts";
import { tagLabel } from "../src/screens/public/galleryParts.tsx";

afterEach(async () => {
  await changeLocale("en");
});

describe("the gallery's words", () => {
  it("read in the page's language, and an unknown tag shows as stored", async () => {
    expect(GALLERY_KINDS).toEqual(["application_form", "report_form", "rubric", "email_template", "program_kit"]);
    expect([KIND_LABEL.rubric, KIND_PLURAL.program_kit, tagLabel("Health")]).toEqual(["Rubric", "Program kits", "Health"]);
    await changeLocale("es");
    expect([KIND_LABEL.rubric, KIND_PLURAL.program_kit, KIND_LABEL.email_template]).toEqual(["Rúbrica", "Kits de programa", "Plantilla de correo"]);
    expect(tagLabel("Health")).toBe("Salud");
    expect(tagLabel("Something new")).toBe("Something new");
  });
});
