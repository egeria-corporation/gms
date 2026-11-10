// SPDX-License-Identifier: AGPL-3.0-only
// Budget allocator (build spec §10.5). All amounts are integer minor units of one currency.

export interface AllocationInput {
  /** program.budget */
  budgetMinor: number;
  /** Active awards already committed in the program. */
  committedMinor: number;
  /** Approvals proposed in this panel. */
  proposedMinor: number;
}

export interface Allocation extends AllocationInput {
  /** budget − committed − proposed; negative when over-allocated. */
  availableMinor: number;
  over: boolean;
  overByMinor: number;
}

export function allocation(input: AllocationInput): Allocation {
  for (const [k, v] of Object.entries(input)) {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${k} must be a non-negative integer of minor units.`);
  }
  const availableMinor = input.budgetMinor - input.committedMinor - input.proposedMinor;
  return { ...input, availableMinor, over: availableMinor < 0, overByMinor: Math.max(0, -availableMinor) };
}

export const sumProposed = (decisions: readonly { outcome: string; amountMinor?: number | null }[]): number =>
  decisions.reduce((s, d) => s + (d.outcome === "approve" ? (d.amountMinor ?? 0) : 0), 0);

export interface OverrideRequest {
  role: string;
  userId: string;
  reason: string;
}

export type CommitCheck =
  | { ok: true; allocation: Allocation; override: null | { by: string; reason: string; overByMinor: number } }
  | { ok: false; allocation: Allocation; reason: string };

/** Refuse a commit that over-allocates, unless a workspace admin overrides with a reason. The
 *  returned `override` must be written to the ledger by the caller. */
export function checkCommit(input: AllocationInput, override?: OverrideRequest | null): CommitCheck {
  const a = allocation(input);
  if (!a.over) return { ok: true, allocation: a, override: null };
  if (!override) return { ok: false, allocation: a, reason: `Allocations exceed the program's available budget by ${a.overByMinor} minor units.` };
  if (override.role !== "admin") return { ok: false, allocation: a, reason: "Only a workspace admin can override the budget allocator." };
  if (!override.reason.trim()) return { ok: false, allocation: a, reason: "An override needs a reason; it is recorded in the ledger." };
  return { ok: true, allocation: a, override: { by: override.userId, reason: override.reason.trim(), overByMinor: a.overByMinor } };
}
