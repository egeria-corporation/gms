// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { decideApproval, getRuntime } from '@gms/actions';
import { isDomainError, toProblem, type ProblemDetails } from '@gms/domain';
import { revalidatePath } from 'next/cache';
import { humanContext } from '@/lib/server/act';
import { kickOutbox } from '@/lib/server/outbox';

export async function decide(
  approvalRequestId: string,
  decision: 'confirm' | 'reject',
  token: string | null,
  note: string | null,
): Promise<{ ok: true; status: string; error?: string } | { ok: false; problem: ProblemDetails }> {
  try {
    const rt = getRuntime();
    const r = await decideApproval(rt.executor, rt.db, { approvalRequestId, decision, token, note }, await humanContext());
    kickOutbox();
    revalidatePath('/portal');
    return { ok: true, status: r.status, ...(r.error ? { error: r.error } : {}) };
  } catch (err) {
    if (!isDomainError(err)) console.error('[confirm] failed', err);
    return { ok: false, problem: toProblem(err) };
  }
}
