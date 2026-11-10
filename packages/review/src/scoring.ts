// SPDX-License-Identifier: AGPL-3.0-only
// Rubric scoring (build spec §10.5): numeric criteria are normalized to 0–1, categorical criteria
// are mapped by the rubric, and the overall score is the weighted sum × 100.

export type Scale =
  | { type: "numeric"; min: number; max: number }
  | { type: "categorical"; options: readonly { value: string; label?: string; score: number }[] };

export interface Criterion {
  key: string;
  label: string;
  description?: string;
  weight: number;
  scale: Scale;
  guidance?: string;
}

export interface Rubric {
  id: string;
  version: number;
  criteria: readonly Criterion[];
  /** Flag an application when the reviewers' stdev (in overall points) exceeds this. */
  spreadThreshold?: number;
}

export type ScoreValue = number | string;
/** criterion key → value (a bare value or `{ value, comment }` as stored in `reviews.scores`). */
export type Scores = Record<string, ScoreValue | { value: ScoreValue; comment?: string } | undefined>;

export interface ScoreIssue {
  criterion: string;
  message: string;
}

export interface ScoredReview {
  complete: boolean;
  /** 0–100, or null while any criterion is missing or invalid. */
  overall: number | null;
  /** criterion key → normalized 0–1 */
  normalized: Record<string, number>;
  issues: ScoreIssue[];
}

const raw = (v: Scores[string]): ScoreValue | undefined => (typeof v === "object" && v !== null ? v.value : v);

/** Normalize one criterion value to 0–1, or return a message saying why it cannot be scored. */
export function normalize(criterion: Criterion, value: ScoreValue | undefined): number | string {
  if (value === undefined || value === "") return `${criterion.label} has no score.`;
  const s = criterion.scale;
  if (s.type === "numeric") {
    if (typeof value !== "number" || Number.isNaN(value)) return `${criterion.label} needs a number.`;
    if (value < s.min || value > s.max) return `${criterion.label} must be between ${s.min} and ${s.max}.`;
    return s.max === s.min ? 1 : (value - s.min) / (s.max - s.min);
  }
  const opt = s.options.find((o) => o.value === value);
  if (!opt) return `${criterion.label} must be one of ${s.options.map((o) => o.label ?? o.value).join(", ")}.`;
  return Math.min(1, Math.max(0, opt.score));
}

export function validateRubric(rubric: Rubric): string[] {
  const errors: string[] = [];
  if (!rubric.criteria.length) errors.push("A rubric needs at least one criterion.");
  const keys = new Set<string>();
  for (const c of rubric.criteria) {
    if (keys.has(c.key)) errors.push(`Criterion key "${c.key}" is used twice.`);
    keys.add(c.key);
    if (!(c.weight > 0)) errors.push(`${c.label}: weight must be greater than zero.`);
    if (c.scale.type === "numeric" && !(c.scale.max > c.scale.min)) errors.push(`${c.label}: the scale maximum must exceed the minimum.`);
    if (c.scale.type === "categorical") {
      if (!c.scale.options.length) errors.push(`${c.label}: a categorical scale needs options.`);
      if (c.scale.options.some((o) => o.score < 0 || o.score > 1)) errors.push(`${c.label}: option scores must be between 0 and 1.`);
    }
  }
  return errors;
}

/** Weighted overall score. Weights are relative: they are divided by their sum. */
export function scoreReview(rubric: Rubric, scores: Scores): ScoredReview {
  const normalized: Record<string, number> = {};
  const issues: ScoreIssue[] = [];
  const totalWeight = rubric.criteria.reduce((s, c) => s + c.weight, 0);
  let sum = 0;
  for (const c of rubric.criteria) {
    const n = normalize(c, raw(scores[c.key]));
    if (typeof n === "string") issues.push({ criterion: c.key, message: n });
    else {
      normalized[c.key] = n;
      sum += n * c.weight;
    }
  }
  const complete = issues.length === 0 && totalWeight > 0;
  return { complete, overall: complete ? (sum / totalWeight) * 100 : null, normalized, issues };
}
