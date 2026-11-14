// SPDX-License-Identifier: AGPL-3.0-only
// Apply anywhere: a funder's questions pasted as text, and the counts an answer is held to.
// Deterministic only (no model reads the text in this release): questions are split on numbering
// and blank lines, and limits are read from the usual phrasings ("(250 words)", "250-word",
// "1,500 characters", "characters including/excluding spaces", "max 500 chars").

export type LimitKind = "words" | "chars" | "chars_no_spaces";
export type QuestionPhase = "loi" | "full" | "report";

export interface TextCounts {
  /** Runs of non-space characters, as a word processor counts them. */
  words: number;
  /** Characters including spaces and line breaks (Unicode code points; CRLF counts as one). */
  chars: number;
  /** Characters with every space, tab and line break left out. */
  charsNoSpaces: number;
}

const normalize = (text: string) => text.replace(/\r\n?/g, "\n");

/** Counts for an answer. The same rules the web editor shows live. */
export function countText(text: string): TextCounts {
  const t = normalize(text);
  const words = t.split(/\s+/u).filter(Boolean).length;
  let chars = 0;
  let charsNoSpaces = 0;
  for (const ch of t) {
    chars++;
    if (!/\s/u.test(ch)) charsNoSpaces++;
  }
  return { words, chars, charsNoSpaces };
}

/** The count a limit applies to. */
export function countFor(counts: TextCounts, kind: LimitKind): number {
  return kind === "words" ? counts.words : kind === "chars" ? counts.chars : counts.charsNoSpaces;
}

/** Whether an answer is over its question's limit; false when the question has none. */
export function isOverLimit(counts: TextCounts, limit: { kind: LimitKind | null; value: number | null }): boolean {
  return !!limit.kind && typeof limit.value === "number" && countFor(counts, limit.kind) > limit.value;
}

export interface ParsedQuestion {
  prompt: string;
  limitKind?: LimitKind;
  limitValue?: number;
  phase: QuestionPhase;
}

export interface DetectedLimit {
  kind: LimitKind;
  value: number;
  /** Where the phrase is in the text, so a parenthesised limit can be left out of the prompt. */
  index: number;
  length: number;
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{1,7})`;
const QUAL = String.raw`(?:(?:a\s+)?max(?:imum)?\.?(?:\s+of)?\s*:?\s*|up\s+to\s+|no\s+more\s+than\s+|not\s+(?:to\s+)?exceed(?:ing)?\s+|limit(?:ed)?\s*(?:to|of)?\s*:?\s*)?`;
const EXCLUDING = String.raw`(?:excluding|excludes|exclusive\s+of|without|not\s+including|no)\s+spaces`;
const INCLUDING = String.raw`(?:including|includes|inclusive\s+of|with)\s+spaces`;
// ", excluding spaces" or "(including spaces)": a closing bracket is taken only with its opening one.
const SPACES = String.raw`(?:\s*,?\s*(?:${EXCLUDING}|${INCLUDING})|\s*[([]\s*(?:${EXCLUDING}|${INCLUDING})\s*[)\]])?`;
const excludes = (m: RegExpExecArray): LimitKind => (new RegExp(EXCLUDING, "i").test(m[0]) ? "chars_no_spaces" : "chars");

const PATTERNS: { re: RegExp; kind: (m: RegExpExecArray) => LimitKind; value: (m: RegExpExecArray) => string }[] = [
  // "500 words", "250-word", "max 250 words", "up to 1,000 words"
  { re: new RegExp(String.raw`${QUAL}${NUM}\s*-?\s*words?\b`, "i"), kind: () => "words", value: (m) => m[1]! },
  // "word limit: 500", "word count of 300"
  { re: new RegExp(String.raw`words?\s+(?:limit|count|maximum|max)\.?\s*(?:of|is)?\s*:?\s*${NUM}`, "i"), kind: () => "words", value: (m) => m[1]! },
  // "1,500 characters", "max 500 chars", "2000 characters (excluding spaces)"
  { re: new RegExp(String.raw`${QUAL}${NUM}\s*-?\s*(?:characters?|chars?)\b${SPACES}`, "i"), kind: excludes, value: (m) => m[1]! },
  // "character limit: 2,000 (including spaces)"
  { re: new RegExp(String.raw`(?:characters?|chars?)\s+(?:limit|count|maximum|max)\.?\s*(?:of|is)?\s*:?\s*${NUM}${SPACES}`, "i"), kind: excludes, value: (m) => m[1]! },
];

/** The first limit stated in a question, if any. */
export function detectLimit(text: string): DetectedLimit | null {
  let best: DetectedLimit | null = null;
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const value = Number(p.value(m).replace(/,/g, ""));
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) continue;
    let kind = p.kind(m);
    // "characters excluding spaces" said after the number in another sentence of the same question.
    if (kind === "chars" && new RegExp(String.raw`characters?\s*[(,]?\s*${EXCLUDING}`, "i").test(text)) kind = "chars_no_spaces";
    if (!best || m.index < best.index) best = { kind, value, index: m.index, length: m[0].length };
  }
  return best;
}

/** A line that starts a numbered or bulleted item: "1.", "1)", "(1)", "Q1:", "Question 1 -", "a)", "-", "•". */
const MARKER = /^\s*(?:(?:Q(?:uestion)?\s*)?\d{1,3}(?:\.\d{1,3})*\s*[.):-](?=\s)|\(\d{1,3}\)|(?:Q(?:uestion)?\s*)\d{1,3}\b|[a-z][.)](?=\s)|[-*•●▪◦–])\s*/i;

const MAX_QUESTIONS = 200;
const MAX_PROMPT = 5000;

/** Leave a limit written in brackets on its own, "(250 words)", out of the prompt: the limit is kept separately. */
function stripBracketedLimit(prompt: string, limit: DetectedLimit | null): string {
  if (!limit) return prompt;
  const before = prompt.slice(0, limit.index);
  const after = prompt.slice(limit.index + limit.length);
  const open = /[([]\s*(?:(?:a\s+)?max(?:imum)?\.?|limit:?|up\s+to)?\s*$/i.exec(before);
  const close = /^\s*(?:max(?:imum)?|limit|or\s+(?:less|fewer))?\.?\s*[)\]]/i.exec(after);
  if (!open || !close) return prompt;
  return `${before.slice(0, open.index).trimEnd()}${after.slice(close[0].length)}`.replace(/\s+([?.!,;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

function toQuestion(raw: string, phase: QuestionPhase): ParsedQuestion | null {
  const text = raw
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  const limit = detectLimit(text);
  const prompt = stripBracketedLimit(text, limit).slice(0, MAX_PROMPT).trim() || text.slice(0, MAX_PROMPT);
  return { prompt, ...(limit ? { limitKind: limit.kind, limitValue: limit.value } : {}), phase };
}

/**
 * Split pasted text into questions. With numbering or bullets, each marker starts a question and
 * the lines after it belong to it; text before the first marker is kept only when it asks
 * something (ends in "?" or states a limit). Without markers, each paragraph (blank-line separated)
 * is a question, and a single paragraph of several lines is one question per line.
 */
export function parseQuestions(input: string, phase: QuestionPhase = "full"): ParsedQuestion[] {
  const text = normalize(input).replace(/\t/g, " ").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const marked = lines.filter((l) => MARKER.test(l)).length;
  const chunks: string[] = [];
  if (marked > 0) {
    let current: string[] | null = null;
    const preamble: string[] = [];
    for (const line of lines) {
      if (MARKER.test(line)) {
        if (current) chunks.push(current.join("\n"));
        current = [line.replace(MARKER, "")];
      } else if (current) current.push(line);
      else preamble.push(line);
    }
    if (current) chunks.push(current.join("\n"));
    for (const para of preamble.join("\n").split(/\n\s*\n/).reverse()) {
      const p = para.trim();
      if (p && (/\?\s*$/.test(p) || detectLimit(p))) chunks.unshift(p);
    }
  } else {
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length === 1 && paragraphs[0]!.includes("\n")) chunks.push(...paragraphs[0]!.split("\n"));
    else chunks.push(...paragraphs);
  }
  const out: ParsedQuestion[] = [];
  for (const c of chunks) {
    const q = toQuestion(c, phase);
    if (q) out.push(q);
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

// ------------------------------------------------------------------------------------ library variants

export type VariantKey = "short" | "medium" | "long";
/** About how long each variant of a library answer is, in words (contract: about 50, 150 and 500). */
export const VARIANT_WORDS: Readonly<Record<VariantKey, number>> = { short: 50, medium: 150, long: 500 };

/**
 * The version of a library answer that best fits a question's limit: the longest one within the
 * limit, or the shortest when none fits. Without a limit, the answer itself.
 */
export function bestVariant(answer: { body: string; variants?: Partial<Record<VariantKey, string>> | null }, limit: { kind: LimitKind; value: number } | null): { key: VariantKey | "body"; text: string; fits: boolean } {
  const options: { key: VariantKey | "body"; text: string }[] = [{ key: "body", text: answer.body }];
  for (const k of ["short", "medium", "long"] as const) {
    const t = answer.variants?.[k];
    if (typeof t === "string" && t.trim()) options.push({ key: k, text: t });
  }
  if (!limit) return { ...options[0]!, fits: true };
  const sized = options.map((o) => ({ ...o, n: countFor(countText(o.text), limit.kind) }));
  const fitting = sized.filter((o) => o.n <= limit.value).sort((a, b) => b.n - a.n);
  const pick = fitting[0] ?? sized.sort((a, b) => a.n - b.n)[0]!;
  return { key: pick.key, text: pick.text, fits: pick.n <= limit.value };
}
