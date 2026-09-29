// SPDX-License-Identifier: AGPL-3.0-or-later
// Eligibility pre-check rules (A-04, check_eligibility tool, A2A skill).

export type EligibilityRuleKind = 'yes_no' | 'number_max' | 'number_min' | 'select_in' | 'multi_any';

export interface EligibilityRule {
  id: string;
  position: number;
  question: string;
  helpText?: string | null;
  kind: EligibilityRuleKind;
  /**
   * yes_no:     { required: true|false }            answer must equal required
   * number_max: { max: number, unit?: 'usd'|'count' } answer <= max
   * number_min: { min: number }                      answer >= min
   * select_in:  { options: string[], allowed: string[] }  answer in allowed
   * multi_any:  { options: string[], allowed: string[] }  at least one answer in allowed
   */
  config: Record<string, unknown>;
  knockoutMessage: string;
}

export type EligibilityAnswer = boolean | number | string | string[] | null | undefined;

export interface EligibilityOutcome {
  ruleId: string;
  question: string;
  passed: boolean | null;
  message?: string;
}

export interface EligibilityResult {
  eligible: boolean | null;
  outcomes: EligibilityOutcome[];
  /** Questions still unanswered (drives A2A INPUT_REQUIRED). */
  missing: { ruleId: string; question: string; kind: EligibilityRuleKind; options?: string[] }[];
}

function asNumber(v: EligibilityAnswer): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asBool(v: EligibilityAnswer): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['yes', 'y', 'true'].includes(s)) return true;
    if (['no', 'n', 'false'].includes(s)) return false;
  }
  return null;
}

export function evaluateRule(rule: EligibilityRule, answer: EligibilityAnswer): boolean | null {
  const c = rule.config;
  switch (rule.kind) {
    case 'yes_no': {
      const b = asBool(answer);
      if (b === null) return null;
      return b === (c.required !== false);
    }
    case 'number_max': {
      const n = asNumber(answer);
      if (n === null) return null;
      return n <= Number(c.max);
    }
    case 'number_min': {
      const n = asNumber(answer);
      if (n === null) return null;
      return n >= Number(c.min);
    }
    case 'select_in': {
      if (typeof answer !== 'string' || !answer) return null;
      return ((c.allowed as string[] | undefined) ?? []).includes(answer);
    }
    case 'multi_any': {
      const arr = Array.isArray(answer) ? answer : typeof answer === 'string' && answer ? [answer] : [];
      if (!arr.length) return null;
      const allowed = (c.allowed as string[] | undefined) ?? [];
      return arr.some((a) => allowed.includes(a));
    }
  }
}

export function evaluateEligibility(
  rules: readonly EligibilityRule[],
  answers: Record<string, EligibilityAnswer>,
): EligibilityResult {
  const sorted = [...rules].sort((a, b) => a.position - b.position);
  const outcomes: EligibilityOutcome[] = [];
  const missing: EligibilityResult['missing'] = [];
  for (const r of sorted) {
    const passed = evaluateRule(r, answers[r.id]);
    outcomes.push({ ruleId: r.id, question: r.question, passed, ...(passed === false ? { message: r.knockoutMessage } : {}) });
    if (passed === null) {
      missing.push({
        ruleId: r.id,
        question: r.question,
        kind: r.kind,
        ...(Array.isArray(r.config.options) ? { options: r.config.options as string[] } : {}),
      });
    }
  }
  const failed = outcomes.some((o) => o.passed === false);
  return { eligible: failed ? false : missing.length ? null : true, outcomes, missing };
}
