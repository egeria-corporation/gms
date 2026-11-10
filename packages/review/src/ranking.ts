// SPDX-License-Identifier: AGPL-3.0-only
import { scoreReview, type Rubric, type Scores } from "./scoring.ts";

export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Sample standard deviation (n − 1). A panel is a sample of reviewer opinion; 0 when n < 2. */
export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export interface SubmittedReview {
  applicationId: string;
  reviewerId: string;
  scores: Scores;
}

export interface RankingRow {
  applicationId: string;
  /** 1-based; applications with the same mean and median share a rank. Null when n = 0. */
  rank: number | null;
  n: number;
  mean: number | null;
  median: number | null;
  stdev: number | null;
  spreadFlag: boolean;
  /** Each reviewer's overall score, for the panel view. */
  overalls: { reviewerId: string; overall: number }[];
  /** Reviews that could not be scored (missing or invalid criteria). */
  incomplete: string[];
}

const DEFAULT_SPREAD = 15;

/** Rank applications by mean overall score. Recomputed on read; nothing here is stored. */
export function rankApplications(rubric: Rubric, applicationIds: readonly string[], reviews: readonly SubmittedReview[], opts: { spreadThreshold?: number } = {}): RankingRow[] {
  const threshold = opts.spreadThreshold ?? rubric.spreadThreshold ?? DEFAULT_SPREAD;
  const rows: RankingRow[] = applicationIds.map((applicationId) => {
    const overalls: RankingRow["overalls"] = [];
    const incomplete: string[] = [];
    for (const r of reviews) {
      if (r.applicationId !== applicationId) continue;
      const s = scoreReview(rubric, r.scores);
      if (s.overall === null) incomplete.push(r.reviewerId);
      else overalls.push({ reviewerId: r.reviewerId, overall: s.overall });
    }
    const xs = overalls.map((o) => o.overall);
    const sd = stdev(xs);
    return {
      applicationId,
      rank: null,
      n: xs.length,
      mean: xs.length ? mean(xs) : null,
      median: xs.length ? median(xs) : null,
      stdev: xs.length ? sd : null,
      spreadFlag: sd > threshold,
      overalls,
      incomplete,
    };
  });
  rows.sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1) || (b.median ?? -1) - (a.median ?? -1) || a.applicationId.localeCompare(b.applicationId));
  let prev: RankingRow | undefined;
  rows.forEach((row, i) => {
    if (row.n === 0) return;
    row.rank = prev && prev.mean === row.mean && prev.median === row.median ? prev.rank : i + 1;
    prev = row;
  });
  return rows;
}
