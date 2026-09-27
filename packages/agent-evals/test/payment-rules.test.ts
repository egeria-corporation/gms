// SPDX-License-Identifier: AGPL-3.0-only
// Scenario: the Ops Assistant proposes payment batches and gets a clear, per-installment reason for everything it
// can't pay — an overdue report that holds payments, or an installment that would exceed the award.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAgentWorld, callTool, type AgentWorld } from '../src';

let w: AgentWorld;

beforeAll(async () => {
  w = await buildAgentWorld('gms_eval_payrules');
}, 180_000);
afterAll(async () => {
  await w?.t.drop();
});

interface Proposal {
  batchId: string | null;
  included: number;
  blocked: { installmentId: string; reasons: string[] }[];
}

async function propose(): Promise<Proposal> {
  const r = await callTool(w.env(), 'propose_payment_batch', {}, w.tokens.opsKey);
  expect(r.isError, r.text).toBe(false);
  return r.structured!.result as Proposal;
}

async function discardDrafts(): Promise<void> {
  // Test housekeeping between proposals: drop draft batches so the installment is proposable again.
  await w.t.db.deleteFrom('payments').where('status', '=', 'in_batch').execute();
  await w.t.db.deleteFrom('payment_batches').where('status', '=', 'draft').execute();
}

describe('propose_payment_batch blocked reasons', () => {
  it('holds an installment while a report that holds payments is overdue, and not when the report is set not to hold', async () => {
    await w.t.db.updateTable('report_requirements').set({ status: 'overdue', holds_payments: true }).where('id', '=', w.ids.requirement).execute();
    const held = await propose();
    const reason = held.blocked.find((b) => b.installmentId === w.ids.installment)?.reasons.join(' ');
    expect(reason).toMatch(/Report overdue: Interim report \(payment hold\)/);
    expect(held.batchId).toBeNull();

    await w.t.db.updateTable('report_requirements').set({ holds_payments: false }).where('id', '=', w.ids.requirement).execute();
    const released = await propose();
    expect(released.included).toBe(1);
    expect(released.blocked.find((b) => b.installmentId === w.ids.installment)).toBeUndefined();
    await discardDrafts();
    await w.t.db.updateTable('report_requirements').set({ status: 'due', holds_payments: true }).where('id', '=', w.ids.requirement).execute();
  });

  it('reports an over-budget installment instead of failing the whole proposal', async () => {
    // Raise the installment above the $20,000 award.
    await w.t.db.updateTable('installments').set({ amount_cents: 2_500_000 }).where('id', '=', w.ids.installment).execute();
    const over = await propose();
    const reason = over.blocked.find((b) => b.installmentId === w.ids.installment)?.reasons.join(' ');
    expect(reason).toMatch(/Over budget/);
    expect(over.batchId).toBeNull();
    await w.t.db.updateTable('installments').set({ amount_cents: 1_000_000 }).where('id', '=', w.ids.installment).execute();
  });
});
