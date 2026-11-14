// SPDX-License-Identifier: AGPL-3.0-only
// The deterministic question parse and the answer counts (apply anywhere).
import { describe, expect, it } from "vitest";
import { countText, detectLimit, isOverLimit, parseQuestions } from "../src/index.ts";

describe("countText", () => {
  it("counts words, characters and characters without spaces", () => {
    expect(countText("")).toEqual({ words: 0, chars: 0, charsNoSpaces: 0 });
    expect(countText("Families travel 46 miles.")).toEqual({ words: 4, chars: 25, charsNoSpaces: 22 });
    expect(countText("  two\n\nwords  ")).toEqual({ words: 2, chars: 14, charsNoSpaces: 8 });
  });
  it("counts a CRLF line break once and code points, not UTF-16 units", () => {
    expect(countText("a\r\nb").chars).toBe(3);
    expect(countText("café 👋").chars).toBe(6);
    expect(countText("well-being, co-op").words).toBe(2);
    expect(countText("tab\tseparated nbsp").words).toBe(3);
  });
  it("tells when an answer is over its limit", () => {
    const c = countText("one two three");
    expect(isOverLimit(c, { kind: "words", value: 3 })).toBe(false);
    expect(isOverLimit(c, { kind: "words", value: 2 })).toBe(true);
    expect(isOverLimit(c, { kind: "chars", value: 12 })).toBe(true);
    expect(isOverLimit(c, { kind: "chars_no_spaces", value: 11 })).toBe(false);
    expect(isOverLimit(c, { kind: null, value: null })).toBe(false);
  });
});

describe("detectLimit", () => {
  it.each([
    ["Describe the need (250 words)", "words", 250],
    ["In a 250-word statement, describe the need.", "words", 250],
    ["Max 500 words.", "words", 500],
    ["Up to 1,000 words", "words", 1000],
    ["Word limit: 300", "words", 300],
    ["Describe it in 1,500 characters.", "chars", 1500],
    ["2,000 characters including spaces", "chars", 2000],
    ["2,000 characters (excluding spaces)", "chars_no_spaces", 2000],
    ["Limit 750 characters without spaces.", "chars_no_spaces", 750],
    ["max 500 chars", "chars", 500],
    ["Character limit: 4,000 (including spaces)", "chars", 4000],
    ["Please answer in no more than 3000 characters. Characters excluding spaces are counted.", "chars_no_spaces", 3000],
  ] as const)("%s", (text, kind, value) => {
    expect(detectLimit(text)).toMatchObject({ kind, value });
  });
  it("finds nothing where no limit is stated", () => {
    expect(detectLimit("What is your 2027 budget?")).toBeNull();
    expect(detectLimit("Describe your work with 3 partner clinics.")).toBeNull();
  });
});

describe("parseQuestions", () => {
  it("splits numbered questions and reads their limits", () => {
    const text = `Application questions

1. Describe the need your project addresses. (250 words)
2) How will you measure success? Max 1,500 characters.
3. Who are your partners?
   List each with their role.`;
    expect(parseQuestions(text)).toEqual([
      { prompt: "Describe the need your project addresses.", limitKind: "words", limitValue: 250, phase: "full" },
      { prompt: "How will you measure success? Max 1,500 characters.", limitKind: "chars", limitValue: 1500, phase: "full" },
      { prompt: "Who are your partners?\nList each with their role.", phase: "full" },
    ]);
  });

  it("splits on blank lines when there is no numbering, and takes the phase given", () => {
    const text = "Tell us about your organization.\n\nWhat is the total project budget?\n\nDescribe your evaluation plan [500 words max].";
    expect(parseQuestions(text, "loi")).toEqual([
      { prompt: "Tell us about your organization.", phase: "loi" },
      { prompt: "What is the total project budget?", phase: "loi" },
      { prompt: "Describe your evaluation plan.", limitKind: "words", limitValue: 500, phase: "loi" },
    ]);
  });

  it("reads one question per line from a single block of lines", () => {
    expect(parseQuestions("Mission?\nVision?\nBudget (100 words)").map((q) => q.prompt)).toEqual(["Mission?", "Vision?", "Budget"]);
  });

  it("handles Q-style, bracketed and bulleted markers and keeps an asking preamble", () => {
    const qs = parseQuestions("Why now?\n\nQ1: First question\nQuestion 2 - Second (2,000 characters excluding spaces)\n(3) Third\n• Fourth");
    expect(qs.map((q) => q.prompt)).toEqual(["Why now?", "First question", "Second", "Third", "Fourth"]);
    expect(qs[2]).toMatchObject({ limitKind: "chars_no_spaces", limitValue: 2000 });
  });

  it("returns nothing for empty text and caps a huge paste", () => {
    expect(parseQuestions("   \n\n ")).toEqual([]);
    expect(parseQuestions(Array.from({ length: 300 }, (_, i) => `${i + 1}. Question ${i + 1}?`).join("\n"))).toHaveLength(200);
  });

  it("is deterministic", () => {
    const text = "1. A (100 words)\n2. B\n\n3. C 2,500 characters";
    expect(parseQuestions(text)).toEqual(parseQuestions(text));
  });
});
