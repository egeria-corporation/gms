// SPDX-License-Identifier: AGPL-3.0-only
'use server';
// E-01 board docket server actions: create (auto-assembled from approve recommendations), curate items
// (add / remove / reorder) and move through published → in session → closed. All through act().
import { DomainError, toProblem, zonedTimeToUtc } from '@gms/domain';
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';
import { requireTenant } from '@/lib/tenant';

function refresh(docketId?: string) {
  revalidatePath('/console/dockets');
  if (docketId) revalidatePath(`/console/dockets/${docketId}`);
  revalidatePath('/board');
  if (docketId) revalidatePath(`/board/${docketId}`);
}

export interface CreateDocketInput {
  name: string;
  /** Wall-clock "YYYY-MM-DDTHH:mm" in the workspace timezone, or empty. */
  meetingLocal: string;
  quorum: number;
  autoAssemble: boolean;
  opportunityId: string | null;
}

export async function createDocketAction(input: CreateDocketInput) {
  const tenant = await requireTenant();
  let meetingAt: string | null = null;
  if (input.meetingLocal) {
    try {
      meetingAt = zonedTimeToUtc(input.meetingLocal, tenant.timezone).toISOString();
    } catch {
      return { ok: false as const, problem: toProblem(new DomainError('validation_failed', 'Enter the meeting date and time.')) };
    }
  }
  const r = await act<{ id: string; items: number }>('board.create_docket', {
    name: input.name,
    meetingAt,
    quorum: input.quorum,
    autoAssemble: input.autoAssemble,
    ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
  });
  refresh();
  return r;
}

export type DocketOutcome = { applicationId: string; outcome: string; approve: number; decline: number; abstain: number };

/** board.set_docket_status (R2): runs for a person. Closing tallies votes against the quorum. */
export async function setDocketStatusAction(docketId: string, status: 'published' | 'in_session' | 'closed') {
  const r = await act<{ outcomes: DocketOutcome[] }>('board.set_docket_status', { docketId, status });
  refresh(docketId);
  return r;
}

export async function reorderDocketAction(docketId: string, itemIds: string[]) {
  const r = await act('board.reorder_docket', { docketId, itemIds });
  refresh(docketId);
  return r;
}

export async function addDocketItemAction(input: { docketId: string; applicationId: string; recommendedAmountCents: number | null; recommendation: string | null }) {
  const r = await act<{ id: string }>('board.add_docket_item', {
    docketId: input.docketId,
    applicationId: input.applicationId,
    recommendedAmountCents: input.recommendedAmountCents,
    recommendation: input.recommendation?.trim() || null,
  });
  refresh(input.docketId);
  return r;
}

export async function removeDocketItemAction(docketId: string, docketItemId: string) {
  const r = await act('board.remove_docket_item', { docketItemId });
  refresh(docketId);
  return r;
}
