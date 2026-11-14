// SPDX-License-Identifier: AGPL-3.0-only
// Outside applications (applications to funders that are not on this GMS): the stage vocabulary,
// which moves the screens offer, live answer counts against a question's limit, and the
// deterministic question splitter the mock uses for the paste flow. The API stays the authority
// on every move and every count; this only lets the screens draw without a round trip.

export const OUTSIDE_STAGES = ["prospect", "deciding", "loi", "invited", "drafting", "submitted", "awarded", "declined", "withdrawn", "not_pursuing"] as const;
export type OutsideStage = (typeof OUTSIDE_STAGES)[number];

export const STAGE_LABELS: Record<OutsideStage, string> = {
  prospect: "Prospect",
  deciding: "Deciding",
  loi: "Letter of inquiry",
  invited: "Invited to apply",
  drafting: "Drafting",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
  withdrawn: "Withdrawn",
  not_pursuing: "Not pursuing",
};

/** Where each stage may go next (the `outside_application` machine in packages/workflow). */
export const TRANSITIONS: Record<OutsideStage, readonly OutsideStage[]> = {
  prospect: ["deciding", "loi", "drafting", "not_pursuing"],
  deciding: ["loi", "drafting", "not_pursuing"],
  loi: ["invited", "declined", "withdrawn", "not_pursuing"],
  invited: ["drafting"],
  drafting: ["submitted", "withdrawn", "not_pursuing"],
  submitted: ["awarded", "declined", "withdrawn"],
  awarded: [],
  declined: [],
  withdrawn: [],
  not_pursuing: [],
};

/** Stages reached only by recording a submission or a decision, never by a plain move. */
const RECORDED: ReadonlySet<OutsideStage> = new Set(["submitted", "awarded", "declined"]);
/** Decided or dropped: the only way on is reopen. */
export const CLOSED_STAGES: ReadonlySet<OutsideStage> = new Set(["awarded", "declined", "withdrawn", "not_pursuing"]);

/**
 * The plain moves offered from a stage (`POST …/stage`). Withdrawing after a submission is offered
 * in the decision dialog instead, so it is recorded with the other outcomes.
 */
export const plainMoves = (from: OutsideStage): OutsideStage[] => TRANSITIONS[from].filter((s) => !RECORDED.has(s) && !(from === "submitted" && s === "withdrawn"));
export const canMarkSubmitted = (stage: OutsideStage) => TRANSITIONS[stage].includes("submitted");
export type DecisionOutcome = "awarded" | "declined" | "withdrawn";
/** Outcomes the decision dialog offers: all three after a submission, a decline after a letter of inquiry. */
export const decisionOutcomes = (stage: OutsideStage): DecisionOutcome[] => (stage === "submitted" ? ["awarded", "declined", "withdrawn"] : stage === "loi" ? ["declined"] : []);
export const canReopen = (stage: OutsideStage) => CLOSED_STAGES.has(stage);

/** What a plain move reads as on its button. */
export const MOVE_LABELS: Record<OutsideStage, string> = {
  prospect: "Back to prospect",
  deciding: "Deciding whether to apply",
  loi: "Writing a letter of inquiry",
  invited: "Invited to apply",
  drafting: "Drafting the application",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
  withdrawn: "We withdrew",
  not_pursuing: "Not pursuing this",
};

// ------------------------------------------------------------------------------------ counts

export type LimitKind = "words" | "chars" | "chars_no_spaces";
export interface TextCounts {
  words: number;
  chars: number;
  charsNoSpaces: number;
}

/** Words split on whitespace; characters are Unicode code points, so an emoji or an accent counts once. */
export function countText(text: string): TextCounts {
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/u).length : 0,
    chars: [...text].length,
    charsNoSpaces: [...text.replace(/\s+/gu, "")].length,
  };
}

const COUNT_KEY: Record<LimitKind, keyof TextCounts> = { words: "words", chars: "chars", chars_no_spaces: "charsNoSpaces" };
export const countFor = (counts: TextCounts, kind: LimitKind) => counts[COUNT_KEY[kind]];
export const isOverLimit = (counts: TextCounts, kind: LimitKind | null | undefined, value: number | null | undefined) =>
  !!kind && typeof value === "number" && value > 0 && countFor(counts, kind) > value;

export const LIMIT_UNITS: Record<LimitKind, string> = { words: "words", chars: "characters", chars_no_spaces: "characters without spaces" };
export const limitPhrase = (kind: LimitKind | null | undefined, value: number | null | undefined) =>
  kind && value ? `${value.toLocaleString("en-US")} ${LIMIT_UNITS[kind]}` : "No limit";

// ------------------------------------------------------------------------------------ parse

export type QuestionPhase = "loi" | "full" | "report";
export interface ParsedQuestion {
  prompt: string;
  limitKind?: LimitKind;
  limitValue?: number;
  phase: QuestionPhase;
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})*|\d+)`;

/** A limit the funder wrote into a question: "(250 words)", "250-word", "1,500 characters including spaces", "max 500 chars". */
export function detectLimit(text: string): { limitKind: LimitKind; limitValue: number } | null {
  const n = (s: string) => Number(s.replace(/,/g, ""));
  const chars = new RegExp(`${NUM}[\\s-]*(?:characters?|chars?)\\b([^.;)\\n]*)`, "i").exec(text);
  const words = new RegExp(`${NUM}[\\s-]*words?\\b`, "i").exec(text);
  const hit = [chars ? { at: chars.index, kind: "chars" as const, m: chars } : null, words ? { at: words.index, kind: "words" as const, m: words } : null]
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.at - b.at)[0];
  if (!hit) return null;
  const value = n(hit.m[1]!);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (hit.kind === "words") return { limitKind: "words", limitValue: value };
  // "characters excluding spaces", "characters without spaces", "characters (no spaces)"
  const rest = `${hit.m[2] ?? ""} ${text.slice(hit.at + hit.m[0].length, hit.at + hit.m[0].length + 30)}`;
  const noSpaces = /\b(excluding|without|not including|no)\s+spaces\b/i.test(rest);
  return { limitKind: noSpaces ? "chars_no_spaces" : "chars", limitValue: value };
}

const NUMBERED = /^\s*(?:(?:Q(?:uestion)?\s*)?\d{1,3}[.):]|\(?[a-hA-H][.)]|[-•*])\s+/;
const PHASE_HEADING: Array<[RegExp, QuestionPhase]> = [
  [/\b(letter of (inquiry|intent)|loi|concept (paper|note)|pre-?proposal)\b/i, "loi"],
  [/\b(full (proposal|application)|proposal narrative|application questions)\b/i, "full"],
  [/\b(report|reporting)\b/i, "report"],
];

/** A short line without a question mark or a limit, alone in its block: a heading, not a question. */
function headingPhase(block: string): QuestionPhase | "heading" | null {
  const line = block.trim();
  if (line.includes("\n") || line.length > 60 || /[?]/.test(line) || detectLimit(line) || NUMBERED.test(line)) return null;
  if (!/:$/.test(line) && !/^[^a-z]*$/.test(line) && line.split(/\s+/).length > 5) return null;
  for (const [re, phase] of PHASE_HEADING) if (re.test(line)) return phase;
  return /:$/.test(line) || /^[^a-z]*$/.test(line) ? "heading" : null;
}

/**
 * Splits pasted guidelines into questions: on numbering ("1.", "2)", "Q3:", "a.", bullets) and on
 * blank lines. Headings such as "Letter of inquiry" set the phase of what follows. Nothing is saved.
 */
export function parseQuestions(text: string, defaultPhase: QuestionPhase = "full"): ParsedQuestion[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const b = current.join("\n").trim();
    if (b) blocks.push(b);
    current = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) flush();
    else if (NUMBERED.test(raw)) {
      flush();
      current.push(raw);
    } else current.push(raw);
  }
  flush();

  let phase = defaultPhase;
  const out: ParsedQuestion[] = [];
  for (const block of blocks) {
    const h = headingPhase(block);
    if (h) {
      if (h !== "heading") phase = h;
      continue;
    }
    const prompt = block.replace(NUMBERED, "").replace(/\s*\n\s*/g, " ").trim();
    if (!prompt) continue;
    const limit = detectLimit(prompt);
    out.push({ prompt, phase, ...(limit ?? {}) });
  }
  return out;
}

// ------------------------------------------------------------------------------------ links

/** A pasted address of an opportunity page on this GMS (`/f/{handle}/o/{slug}`), or null for anything else. */
export function gmsOpportunityOf(link: string, ownHosts: string[]): { handle: string; slug: string } | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(url.protocol) || !ownHosts.includes(url.host)) return null;
  const m = /^\/f\/([a-z0-9-]{1,64})\/o\/([a-z0-9-]{1,120})\/?$/.exec(url.pathname);
  return m ? { handle: m[1]!, slug: m[2]! } : null;
}

/** An http(s) address a person typed, or null. */
export function webAddress(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
