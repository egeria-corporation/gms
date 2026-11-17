// SPDX-License-Identifier: AGPL-3.0-only
// Grant history from a grants system: its export lists every application, and only the awarded
// ones are grant history. After the dry run (../plan.ts) checks each row, the rows the system says
// were never awarded (a decision or status word such as Declined, or no amount awarded) are set
// aside as skipped, with the reason, instead of asking the person to fix them. Applications are
// not imported as anything else here; the GMS has no target for another funder's applications yet.
import type { Plan } from "../plan.ts";
import { reconcile } from "../plan.ts";
import type { SourceTable } from "../table.ts";
import type { ImportTarget } from "../target.ts";
import { fold, readAmount, readCurrency } from "../values.ts";
import type { ImportAdapter } from "./types.ts";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Why a row was never awarded, in plain words, or null. `cells` is the row as the table holds it. */
export function notAwardedReason(adapter: ImportAdapter, plan: Pick<Plan, "columns" | "mapping">, header: readonly string[], cells: readonly string[]): string | null {
  const kept = new Set(plan.columns);
  const mapping = plan.mapping as Record<string, string | undefined>;
  const at = (column: string | undefined) => (column && kept.has(column) ? (cells[header.indexOf(column)] ?? "").trim() : "");
  const words = adapter.decision.notAwarded;
  const columns = new Set<string>([...header.filter((h) => kept.has(h) && adapter.decision.columns.includes(fold(h))), ...(mapping.status && kept.has(mapping.status) ? [mapping.status] : [])]);
  for (const column of columns) {
    const value = at(column);
    const f = fold(value);
    if (f && words.some((w) => f === w || f.startsWith(`${w} `))) return `Not awarded in ${adapter.system} (${clip(column, 40)}: ${clip(value, 40)})`;
  }
  const currency = readCurrency(at(mapping.currency) || undefined) ?? "USD";
  const amount = readAmount(at(mapping.awardedAmount) || undefined, currency);
  if (amount === undefined || amount === 0) return `No amount awarded in the ${adapter.system} export`;
  return null;
}

/**
 * Sets aside the rows a system's export says were never awarded (grant history only). Rows keep
 * their line, key and money; a set-aside row is a skip with its reason and creates nothing.
 */
export function setAsideNotAwarded<F extends string, N>(plan: Plan<F, N>, table: SourceTable, adapter: ImportAdapter, target: Pick<ImportTarget, "key">): Plan<F, N> {
  if (target.key !== "award_history" || !adapter.presets.award_history) return plan;
  const byLine = new Map(table.rows.map((r) => [r.line, r.cells]));
  const rows = plan.rows.map((r) => {
    const cells = byLine.get(r.line);
    const why = cells ? notAwardedReason(adapter, plan, table.header, cells) : null;
    return why ? { ...r, outcome: "skip" as const, reason: why, problems: [], record: null } : r;
  });
  return { ...plan, rows, reconciliation: reconcile(rows) };
}
