// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Payments server actions. Every mutation goes through act() (validation, roles, RLS, audit, outbox).
import { revalidatePath } from 'next/cache';
import { act, type ActionResult } from '@/lib/server/act';
import { rls } from '@/lib/server/db';

const P = '/console/payments';

function refresh() {
  revalidatePath(P, 'layout');
  revalidatePath('/console', 'page');
}

export async function connectBankAction(input: { provider: 'mercury' | 'manual'; environment: 'fake' | 'sandbox'; apiToken?: string }) {
  const r = await act<{ connectionId: string; accounts: number; webhook: string }>('bank.connect', {
    provider: input.provider,
    environment: input.environment,
    ...(input.apiToken ? { apiToken: input.apiToken } : {}),
  });
  refresh();
  return r;
}

export async function syncBankAction() {
  const r = await act<{ accounts: number }>('bank.sync', {});
  refresh();
  return r;
}

export async function mapProgramAccountAction(input: { programId: string; bankAccountId: string }) {
  const r = await act<{ ok: true }>('bank.map_program_account', input);
  refresh();
  return r;
}

export async function invitePayeeAction(input: { applicantOrgId: string; contactEmail?: string }) {
  const r = await act<{ payeeId: string; status: string }>('payees.invite', { applicantOrgId: input.applicantOrgId, ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}) });
  refresh();
  return r;
}

export async function reissuePayeeAction(payeeId: string) {
  const r = await act<{ ok: true }>('payees.reissue', { payeeId });
  refresh();
  return r;
}

export interface DraftPayment {
  id: string;
  awardId: string;
  awardReference: string;
  grantee: string;
  dueDate: string | null;
  amountCents: number;
  feeCents: number;
  payeeStatus: string | null;
}

export interface ProposeOutput {
  batchId: string | null;
  included: number;
  totalCents: number;
  feeCents: number;
  blocked: { installmentId: string; awardReference: string; grantee: string; amountCents: number; reasons: string[] }[];
}

/** Builds a draft batch, then reads its payments back (under RLS) for the preview table. */
export async function proposeBatchAction(input: {
  sourceAccountId?: string;
  method: 'ach' | 'check' | 'domestic_wire' | 'international_wire';
  dueBefore: string;
  name?: string;
  replaceBatchId?: string | null;
}): Promise<ActionResult<ProposeOutput & { payments: DraftPayment[] }>> {
  if (input.replaceBatchId) await act('payments.cancel_batch', { batchId: input.replaceBatchId });
  const r = await act<ProposeOutput>('payments.propose_batch', {
    method: input.method,
    dueBefore: input.dueBefore,
    ...(input.sourceAccountId ? { sourceAccountId: input.sourceAccountId } : {}),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
  });
  refresh();
  if (!r.ok) return r;
  const batchId = r.data.batchId;
  const payments: DraftPayment[] = batchId
    ? await rls(async (trx) => {
        const rows = await trx
          .selectFrom('payments as p')
          .innerJoin('awards as a', 'a.id', 'p.award_id')
          .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
          .leftJoin('installments as i', 'i.id', 'p.installment_id')
          .leftJoin('payees as y', 'y.id', 'p.payee_id')
          .select(['p.id', 'p.award_id', 'a.reference', 'o.legal_name', 'i.due_date', 'p.amount_cents', 'p.fee_cents', 'y.status as payee_status'])
          .where('p.batch_id', '=', batchId)
          .orderBy('i.due_date')
          .orderBy('a.reference')
          .execute();
        return rows.map((x) => ({
          id: x.id,
          awardId: x.award_id,
          awardReference: x.reference,
          grantee: x.legal_name ?? '—',
          dueDate: x.due_date,
          amountCents: x.amount_cents,
          feeCents: x.fee_cents,
          payeeStatus: x.payee_status,
        }));
      })
    : [];
  return { ok: true, data: { ...r.data, payments } };
}

export async function submitBatchAction(batchId: string) {
  const r = await act<{ ok: true }>('payments.submit_batch_for_approval', { batchId });
  refresh();
  return r;
}

export async function approveBatchAction(input: { batchId: string; note?: string }) {
  const r = await act<{ status: string; needsSecondApproval: boolean }>('payments.approve_batch', { batchId: input.batchId, ...(input.note?.trim() ? { note: input.note.trim() } : {}) });
  refresh();
  return r;
}

export async function rejectBatchAction(input: { batchId: string; reason: string }) {
  const r = await act<{ ok: true }>('payments.reject_batch', input);
  refresh();
  return r;
}

export async function cancelBatchAction(batchId: string) {
  const r = await act<{ ok: true }>('payments.cancel_batch', { batchId });
  refresh();
  return r;
}

export async function resolveExceptionAction(input: { exceptionId: string; resolution: 'resolved' | 'ignored'; paymentId?: string; note: string }) {
  const r = await act<{ ok: true }>('payments.resolve_exception', { exceptionId: input.exceptionId, resolution: input.resolution, note: input.note, ...(input.paymentId ? { paymentId: input.paymentId } : {}) });
  refresh();
  return r;
}

export async function retryPaymentAction(paymentId: string) {
  const r = await act<{ ok: true }>('payments.retry', { paymentId });
  refresh();
  return r;
}

export async function recordManualAction(input: {
  awardId: string;
  installmentId?: string;
  amountCents: number;
  paidOn: string;
  method: 'ach' | 'check' | 'domestic_wire' | 'international_wire' | 'manual';
  reference?: string;
  memo?: string;
}) {
  const r = await act<{ id: string }>('payments.record_manual', {
    awardId: input.awardId,
    amountCents: input.amountCents,
    paidOn: input.paidOn,
    method: input.method,
    ...(input.installmentId ? { installmentId: input.installmentId } : {}),
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    ...(input.memo?.trim() ? { memo: input.memo.trim() } : {}),
  });
  refresh();
  revalidatePath('/console/awards', 'layout');
  return r;
}

export async function importCsvAction(rows: { awardReference: string; amountCents: number; paidOn: string; method?: string; reference?: string }[]) {
  const r = await act<{ imported: number; errors: { row: number; message: string }[] }>('payments.import_csv', { rows });
  refresh();
  revalidatePath('/console/awards', 'layout');
  return r;
}
