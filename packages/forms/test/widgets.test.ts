// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { Json } from "../src/index.ts";
import { checkWordCount, computeBudgetTotals, countWords, fromMinor, sanitizeRichText, toMinor, validateWidget } from "../src/index.ts";

const types = (issues: { path: string; type: string }[]) => issues.map((i) => `${i.path}:${i.type}`);

describe("money", () => {
  it("accepts a CommonGrants Money object", () => {
    expect(validateWidget("money", { amount: "25000.00", currency: "USD" })).toEqual([]);
  });
  it("rejects numbers, bad decimals, negatives and bad currencies", () => {
    expect(types(validateWidget("money", 25000))).toEqual([":money"]);
    expect(types(validateWidget("money", { amount: "25,000", currency: "usd" }))).toEqual(["/amount:money", "/currency:money"]);
    expect(types(validateWidget("money", { amount: "-1.00", currency: "USD" }))).toEqual(["/amount:money"]);
  });
  it("enforces the competition currency", () => {
    expect(types(validateWidget("money", { amount: "1.00", currency: "CAD" }, { currency: "USD" }))).toEqual(["/currency:money"]);
  });
  it("converts to and from minor units", () => {
    expect(toMinor("150000.5")).toBe(15000050);
    expect(toMinor("0.07")).toBe(7);
    expect(fromMinor(15000050)).toBe("150000.50");
  });
});

describe("budgetTable", () => {
  const rows: Json = [
    { category: "Personnel", amount: { amount: "60000.00", currency: "USD" }, notes: "Staff" },
    { category: "Personnel", label: "Benefits", amount: { amount: "15000.00", currency: "USD" } },
    { category: "Indirect", amount: { amount: "5000.00", currency: "USD" } },
  ];
  it("computes totals per category", () => {
    expect(computeBudgetTotals(rows)).toEqual({
      totalMinor: 8000000,
      total: { amount: "80000.00", currency: "USD" },
      byCategory: { Personnel: 7500000, Indirect: 500000 },
    });
  });
  it("passes when the total is within the requested amount", () => {
    const root = { requestedAmount: { amount: "80000.00", currency: "USD" } };
    expect(validateWidget("budgetTable", rows, { maxTotalPath: "/requestedAmount", categories: ["Personnel", "Indirect"] }, root)).toEqual([]);
  });
  it("fails when the total exceeds the requested amount", () => {
    const root = { requestedAmount: { amount: "79999.99", currency: "USD" } };
    const issues = validateWidget("budgetTable", rows, { maxTotalPath: "/requestedAmount" }, root);
    expect(types(issues)).toEqual([":budgetTotal"]);
    expect(issues[0]?.message).toContain("80000.00");
  });
  it("supports a fixed ceiling", () => {
    expect(types(validateWidget("budgetTable", rows, { maxTotal: "1000" }))).toEqual([":budgetTotal"]);
  });
  it("rejects unknown categories, malformed rows and mixed currencies", () => {
    expect(types(validateWidget("budgetTable", [{ category: "Travel", amount: { amount: "1", currency: "USD" } }], { categories: ["Personnel"] }))).toEqual(["/0/category:budgetTable"]);
    expect(types(validateWidget("budgetTable", [{ amount: 5 }, "x"]))).toEqual(["/0/category:budgetTable", "/0/amount:money", "/1:budgetTable"]);
    expect(
      types(validateWidget("budgetTable", [{ category: "A", amount: { amount: "1", currency: "USD" } }, { category: "B", amount: { amount: "1", currency: "EUR" } }])),
    ).toEqual(["/1/amount/currency:budgetTable"]);
    expect(types(validateWidget("budgetTable", {}))).toEqual([":budgetTable"]);
  });
});

describe("fileRef", () => {
  it("accepts a document id or a Passport locker reference, not both", () => {
    expect(validateWidget("fileRef", { documentId: "doc_1", name: "a.pdf" })).toEqual([]);
    expect(validateWidget("fileRef", { passportDocumentId: "pdoc_1" })).toEqual([]);
    expect(types(validateWidget("fileRef", { documentId: "doc_1", passportDocumentId: "pdoc_1" }))).toEqual([":fileRef"]);
    expect(types(validateWidget("fileRef", {}))).toEqual([":fileRef"]);
    expect(types(validateWidget("fileRef", "doc_1"))).toEqual([":fileRef"]);
  });
});

describe("richText", () => {
  it("keeps the allowed subset", () => {
    const html = '<p>Two <strong>navigators</strong> and <a href="https://aldercreek.example">a van</a>.</p><ul><li>One</li></ul>';
    const out = sanitizeRichText(html);
    expect(out.removed).toEqual([]);
    expect(out.html).toBe('<p>Two <strong>navigators</strong> and <a href="https://aldercreek.example" rel="noopener noreferrer">a van</a>.</p><ul><li>One</li></ul>');
    expect(validateWidget("richText", html)).toEqual([]);
  });
  it("drops scripts with their content, event handlers, unsafe links and unknown tags", () => {
    const out = sanitizeRichText('<p onclick="x()">Hi<script>alert(1)</script> <a href="javascript:alert(1)">l</a><img src=x onerror=y><!-- c --></p>');
    expect(out.html).toBe("<p>Hi <a>l</a></p>");
    expect(out.removed).toEqual(expect.arrayContaining(["tag:script", "attr:onclick", "href", "tag:img", "comment"]));
  });
  it("escapes stray angle brackets and survives unterminated tags", () => {
    expect(sanitizeRichText("a < b > c").html).toBe("a &lt; b &gt; c");
    expect(sanitizeRichText("<script>alert(1)").html).toBe("");
    expect(sanitizeRichText("<scr<script>x</script>ipt>alert(1)</script>").html).not.toMatch(/<script/i);
  });
  it("is idempotent", () => {
    const once = sanitizeRichText('<p class="x">a < b</p><div>c</div>').html;
    expect(sanitizeRichText(once)).toEqual({ html: once, removed: [] });
  });
  it("fails validation when something would be removed", () => {
    expect(types(validateWidget("richText", "<p>ok</p><iframe src=x></iframe>"))).toEqual([":richText"]);
    expect(types(validateWidget("richText", 4))).toEqual([":richText"]);
  });
});

describe("word count", () => {
  it("counts words, ignoring markup", () => {
    expect(countWords("  one two\nthree ")).toBe(3);
    expect(countWords("<p>one <strong>two</strong></p><p>three</p>")).toBe(3);
    expect(countWords("")).toBe(0);
  });
  it("applies limits", () => {
    expect(checkWordCount("one two three", { max: 2 })?.type).toBe("wordCount");
    expect(checkWordCount("one", { min: 2 })?.message).toContain("at least 2");
    expect(checkWordCount("one two", { min: 1, max: 2 })).toBeNull();
  });
});

describe("signature, address, phone, passportField", () => {
  it("signature needs a typed name and the attestation", () => {
    expect(validateWidget("signature", { name: "Maria Santos", attested: true })).toEqual([]);
    expect(types(validateWidget("signature", { name: " ", attested: false }))).toEqual(["/name:signature", "/attested:signature"]);
  });
  it("address needs line1, city and country", () => {
    expect(validateWidget("address", { line1: "410 Orchard Lane", city: "Alder Creek", country: "US", region: "CA" })).toEqual([]);
    expect(types(validateWidget("address", { line2: 4 }))).toEqual(["/line1:address", "/city:address", "/country:address", "/line2:address"]);
  });
  it("phone accepts common formats", () => {
    expect(validateWidget("phone", "+1 555 010 4821")).toEqual([]);
    expect(validateWidget("phone", "(555) 010-4821")).toEqual([]);
    expect(types(validateWidget("phone", "call me"))).toEqual([":phone"]);
    expect(types(validateWidget("phone", "12345"))).toEqual([":phone"]);
  });
  it("passportField carries no validation of its own", () => {
    expect(validateWidget("passportField", "anything")).toEqual([]);
  });
});
