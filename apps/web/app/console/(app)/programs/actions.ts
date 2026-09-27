// SPDX-License-Identifier: AGPL-3.0-only
'use server';
// C-02 programs & budgets: create/edit programs and set fiscal-year budgets.
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export interface ProgramInput {
  name: string;
  description: string | null;
  causeArea: string | null;
  leadUserId: string | null;
}

export async function createProgramAction(input: ProgramInput) {
  const r = await act<{ id: string }>('programs.create', input);
  revalidatePath('/console/programs');
  return r;
}

export async function updateProgramAction(programId: string, input: Partial<ProgramInput> & { status?: 'active' | 'archived' }) {
  const r = await act('programs.update', { programId, ...input });
  revalidatePath('/console/programs');
  revalidatePath(`/console/programs/${programId}`);
  return r;
}

export async function setBudgetAction(programId: string, fiscalYear: number, amountCents: number) {
  const r = await act('programs.set_budget', { programId, fiscalYear, amountCents });
  revalidatePath('/console/programs');
  revalidatePath(`/console/programs/${programId}`);
  return r;
}
