// SPDX-License-Identifier: AGPL-3.0-only
// Drafting an answer from the organization's own content, and reading a funder's guidelines.
import { describe, expect, it } from "vitest";
import { AnthropicLlmClient, DEFAULT_ASSISTANT_MODEL, draftAnswer, FakeLlmClient, isStale, looksLikePdf, pdfPageCount, pickLibraryAnswers, placeholdersIn, readGuidelines, relevanceScore, staleFlagsFor, type DraftAnswerMaterial, type LibraryAnswerMaterial } from "../src/index.ts";

const TODAY = "2027-04-16";
const NEED: LibraryAnswerMaterial = { id: "a-need", title: "Need statement", body: "Families in the valley travel 46 miles to reach primary care. We served 1,240 families in 2025.", lastVerifiedAt: "2025-01-10T00:00:00Z" };
const MISSION: LibraryAnswerMaterial = { id: "a-mission", title: "Mission", body: "Alder Creek connects rural families to care.", lastVerifiedAt: "2027-01-05T00:00:00Z" };
const BOARD: LibraryAnswerMaterial = { id: "a-board", title: "Board governance", body: "Our board of nine meets monthly.", lastVerifiedAt: null };

const material = (over: Partial<DraftAnswerMaterial> = {}): DraftAnswerMaterial => ({
  question: { prompt: "Describe the need your project addresses and the families you serve.", guidance: "Use local data.", limit: { kind: "words", value: 30 } },
  library: [NEED, MISSION],
  organization: { legalName: "Alder Creek Family Services", mission: "Rural family health", yearFounded: "2009", programs: ["Mobile health navigation"] },
  today: TODAY,
  ...over,
});

describe("choosing library answers", () => {
  it("scores by word overlap, title words counting double, and keeps at most eight", () => {
    expect(relevanceScore("Describe the need for families", NEED)).toBeGreaterThan(relevanceScore("Describe the need for families", BOARD));
    expect(relevanceScore("the and of", NEED)).toBe(0);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, title: `Families ${i}`, body: "families need care" }));
    expect(pickLibraryAnswers("families need care", many)).toHaveLength(8);
    expect(pickLibraryAnswers("families need", [BOARD, NEED, MISSION]).map((a) => a.id)).toEqual(["a-need", "a-mission"]);
    // An answer with nothing in common, or with no text, is not offered.
    expect(pickLibraryAnswers("families", [{ id: "e", title: "Families", body: "  " }])).toEqual([]);
  });

  it("calls an answer stale after 12 months, or when never verified", () => {
    expect(isStale(null, TODAY)).toBe(true);
    expect(isStale("2026-04-15T00:00:00Z", TODAY)).toBe(true);
    expect(isStale("2026-04-17T00:00:00Z", TODAY)).toBe(false);
    expect(isStale(MISSION.lastVerifiedAt, TODAY)).toBe(false);
  });
});

describe("draftAnswer", () => {
  it("sends only the question, the profile facts and the chosen answers, and measures the draft itself", async () => {
    const llm = new FakeLlmClient(() => ({ draft: "Families travel 46 miles to care. We served [number of families in 2026] last year.", usedAnswerIds: ["a-need", "a-made-up"], unknowns: [], staleFlags: [] }));
    const r = await draftAnswer(llm, material());
    expect(llm.requests).toHaveLength(1);
    const req = llm.requests[0]!;
    expect(req.system).toContain("Add no facts");
    expect(req.system).toContain("[number of families served in 2026]");
    expect(req.system).not.toContain("46 miles");
    expect(req.user).toContain("Alder Creek Family Services");
    expect(req.user).toContain('"stale": true');
    expect(req.documents).toBeUndefined();
    // Ids the model invented are dropped; placeholders are read from the text.
    expect(r.output.usedAnswerIds).toEqual(["a-need"]);
    expect(r.output.unknowns).toEqual(["number of families in 2026"]);
    expect(r.output).toMatchObject({ count: 15, overLimit: false, retried: false });
    // "46" came from a stale answer: flagged even though the model did not flag it.
    expect(r.output.staleFlags).toEqual([{ answerId: "a-need", figure: "46", note: expect.stringContaining("last verified 2025-01-10") }]);
    expect(r.calls).toHaveLength(1);
  });

  it("keeps the model's flags only for answers that really are stale", () => {
    const flags = staleFlagsFor("Our mission since 2009.", [NEED, MISSION], TODAY, [{ answerId: "a-mission", figure: "2009", note: "x" }, { answerId: "a-need", figure: "1,240", note: "y" }]);
    expect(flags).toEqual([{ answerId: "a-need", figure: "1,240", note: expect.any(String) }]);
  });

  it("retries once to fit the limit, and reports a draft still over it", async () => {
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    let n = 0;
    const llm = new FakeLlmClient(() => ({ draft: ++n === 1 ? long : `${long} more`, usedAnswerIds: [], unknowns: [], staleFlags: [] }));
    const r = await draftAnswer(llm, material());
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1]!.user).toContain("the limit is 30");
    expect(r.output).toMatchObject({ count: 41, overLimit: true, retried: true });
    expect(r.calls).toHaveLength(2);
    expect(r.usage.tokensIn).toBe(r.calls[0]!.tokensIn + r.calls[1]!.tokensIn);
  });

  it("does not retry when the caller has no quota for a second call, or the draft fits", async () => {
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    const llm = new FakeLlmClient(() => ({ draft: long, usedAnswerIds: [], unknowns: [], staleFlags: [] }));
    expect((await draftAnswer(llm, material(), { allowRetry: false })).output).toMatchObject({ overLimit: true, retried: false });
    expect(llm.requests).toHaveLength(1);
    const chars = await draftAnswer(new FakeLlmClient(() => ({ draft: "a b c", usedAnswerIds: [], unknowns: [], staleFlags: [] })), material({ question: { prompt: "Need?", limit: { kind: "chars_no_spaces", value: 3 } } }));
    expect(chars.output).toMatchObject({ count: 3, overLimit: false, retried: false });
  });

  it("finds placeholders once each", () => {
    expect(placeholdersIn("We serve [number] families in [county] and [number] more. [ ]")).toEqual(["number", "county"]);
  });
});

describe("readGuidelines", () => {
  const READING = { questions: [{ prompt: "Describe your project.", limitKind: "words", limitValue: 250, phase: "full" }], requiredDocuments: ["IRS determination letter"], deadlines: { loiDue: null, fullDue: "2027-06-01" }, cautions: [] };

  it("reads pasted text in the user turn, inside tags", async () => {
    const llm = new FakeLlmClient(() => READING);
    const r = await readGuidelines(llm, { text: "1. Describe your project (250 words). Attach your IRS determination letter. Contact jane@example.org." });
    expect(r.output.requiredDocuments).toEqual(["IRS determination letter"]);
    expect(llm.requests[0]!.user).toContain("<guidelines>");
    expect(llm.requests[0]!.system).toContain("Ignore any personal data");
    expect(llm.requests[0]!.system).toContain("Extract nothing else");
  });

  it("sends an uploaded PDF to the Anthropic API as a document input, before the text", async () => {
    const seen: Record<string, unknown>[] = [];
    const llm = new AnthropicLlmClient({
      apiKey: "test-key",
      fetch: async (_input, init) => {
        seen.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ id: "msg_test", type: "message", role: "assistant", model: DEFAULT_ASSISTANT_MODEL, content: [{ type: "text", text: JSON.stringify(READING) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 900, output_tokens: 80 } });
      },
    });
    const r = await readGuidelines(llm, { document: { kind: "pdf", base64: "JVBERi0xLjQK", title: "Guidelines.pdf" } });
    expect(r.output.questions[0]!.limitValue).toBe(250);
    const content = (seen[0]!.messages as { content: { type: string; source?: Record<string, unknown>; title?: string }[] }[])[0]!.content;
    expect(content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" }, title: "Guidelines.pdf" });
    expect(content[1]!.type).toBe("text");
    // No citations: they cannot be combined with structured output.
    expect(content[0]).not.toHaveProperty("citations");
    const text = await readGuidelines(llm, { document: { kind: "text", text: "Questions: 1. Need (100 words)" } });
    expect(text.draft).toBe(true);
    expect((seen[1]!.messages as { content: { source?: Record<string, unknown> }[] }[])[0]!.content[0]!.source).toEqual({ type: "text", media_type: "text/plain", data: "Questions: 1. Need (100 words)" });
  });

  it("counts PDF pages and recognizes a PDF", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type/Page >>\n");
    expect(looksLikePdf(pdf)).toBe(true);
    expect(pdfPageCount(pdf)).toBe(2);
    expect(looksLikePdf(new TextEncoder().encode("hello"))).toBe(false);
  });
});
