// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { act, type ActionResult } from '@/lib/server/act';

export async function subscribeAction(opportunityId: string, subscribe: boolean): Promise<ActionResult<{ ok: true }>> {
  return act('opportunities.subscribe', { opportunityId, subscribe });
}

export async function checkEligibilityAction(
  opportunityId: string,
  answers: Record<string, boolean | number | string | string[] | null>,
): Promise<ActionResult<{ eligible: boolean | null; outcomes: { ruleId: string; question: string; passed: boolean | null; message?: string }[]; missing: { ruleId: string; question: string }[] }>> {
  return act('opportunities.check_eligibility', { opportunityId, answers });
}
