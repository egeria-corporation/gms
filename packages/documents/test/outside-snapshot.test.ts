// SPDX-License-Identifier: AGPL-3.0-only
// The "as submitted" record of an outside application: stable bytes for the same input.
import { describe, expect, it } from "vitest";
import { renderOutsideSnapshot, sha256Hex, type OutsideSnapshotInput } from "../src/index.ts";

const INPUT: OutsideSnapshotInput = {
  title: "Rural clinics 2027",
  organization: "Alder Creek Family Services",
  funder: "Northwind Family Foundation",
  program: "Rural Health Access",
  submittedAt: "2027-04-15T12:00:00.000Z",
  method: "Funder's online portal",
  confirmationRef: "NW-2027-0412",
  questions: [
    { phase: "loi", section: null, prompt: "Summarize the project.", limit: "100 words", answer: "Mobile health navigation.", counts: "3 words · 25 characters" },
    { phase: "full", section: "Need", prompt: "Describe the need.", limit: null, answer: "Families travel 46 miles.\n\nClinics close early.", counts: "8 words" },
    { phase: "full", section: "Need", prompt: "Who is served?", limit: "1,500 characters", answer: "", counts: "0 words" },
  ],
};
const ascii = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("renderOutsideSnapshot", () => {
  it("gives the same bytes and hash for the same input", async () => {
    const a = await renderOutsideSnapshot(INPUT, { reference: "outside_0190" });
    const b = await renderOutsideSnapshot(structuredClone(INPUT), { reference: "outside_0190" });
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
    expect(ascii(a)).toMatch(/^%PDF-/);
  });
  it("changes when an answer changes, and carries the submission date as the document date", async () => {
    const a = await renderOutsideSnapshot(INPUT, { reference: "outside_0190" });
    const edited = structuredClone(INPUT);
    edited.questions[0]!.answer = "Mobile health navigation for families.";
    const b = await renderOutsideSnapshot(edited, { reference: "outside_0190" });
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
    expect(ascii(a)).toContain("D:20270415120000");
  });
  it("renders an application with no questions", async () => {
    const pdf = await renderOutsideSnapshot({ ...INPUT, questions: [] }, { reference: "outside_0190" });
    expect(pdf.byteLength).toBeGreaterThan(500);
  });
});
