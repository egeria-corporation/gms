// SPDX-License-Identifier: AGPL-3.0-only
// Mercury reconciliation for resolve mode. Mercury is read-only here: the GMS lists outbound
// transactions, proposes matches to tranches, and a person confirms. Confirming calls `recordExternal`.
// A bank transaction carries an amount, a date, a counterparty name and a memo, and nothing that identifies a bank account.
import type { TrancheStatus } from "@gms/workflow";
import type { Tranche } from "./types.ts";

export interface BankTransaction {
  id: string;
  /** Outbound amount in minor units, positive. */
  amountMinor: number;
  currency: string;
  postedAt: string;
  counterpartyName: string;
  memo: string | null;
  matchedTrancheId: string | null;
}

export interface MatchCandidate {
  tranche: Tranche;
  /** The recipient's legal and display names. */
  recipientNames: string[];
}

export interface MatchProposal {
  transactionId: string;
  trancheId: string;
  /** Best name similarity, 0–1. */
  score: number;
  amountDeltaMinor: number;
  /** More than one tranche fits this transaction: a person must choose. */
  ambiguous: boolean;
}

export const AMOUNT_TOLERANCE_MINOR = 1;
export const NAME_THRESHOLD = 0.8;

const SUFFIXES = new Set(["inc", "incorporated", "llc", "corp", "corporation", "co", "company", "ltd", "the", "of", "and"]);

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w))
    .join(" ");
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity over character bigrams of the normalized names. 1 means identical. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  let nx = 0;
  let ny = 0;
  for (const n of bx.values()) nx += n;
  for (const n of by.values()) ny += n;
  if (!nx || !ny) return 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0);
  return (2 * overlap) / (nx + ny);
}

const MATCHABLE: TrancheStatus[] = ["due", "ready"];

/** Propose matches: amount within one cent, same currency, counterparty name similarity at least 0.8. */
export function proposeMatches(transactions: readonly BankTransaction[], candidates: readonly MatchCandidate[]): MatchProposal[] {
  const out: MatchProposal[] = [];
  for (const txn of transactions) {
    if (txn.matchedTrancheId || txn.amountMinor <= 0) continue;
    const fits = candidates
      .filter((c) => MATCHABLE.includes(c.tranche.status) && c.tranche.currency === txn.currency && Math.abs(c.tranche.amountMinor - txn.amountMinor) <= AMOUNT_TOLERANCE_MINOR)
      .map((c) => ({ c, score: Math.max(0, ...c.recipientNames.map((n) => nameSimilarity(n, txn.counterpartyName))) }))
      .filter((f) => f.score >= NAME_THRESHOLD)
      .sort((a, b) => b.score - a.score || a.c.tranche.seq - b.c.tranche.seq);
    for (const f of fits) {
      out.push({ transactionId: txn.id, trancheId: f.c.tranche.id, score: Math.round(f.score * 1000) / 1000, amountDeltaMinor: txn.amountMinor - f.c.tranche.amountMinor, ambiguous: fits.length > 1 });
    }
  }
  return out;
}
