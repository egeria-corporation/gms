// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// S-08 Custom fields & taxonomies.
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

const PATH = '/console/settings/fields';

export async function saveCustomFieldAction(input: {
  id?: string;
  entity: 'application' | 'org' | 'award' | 'opportunity';
  key: string;
  label: string;
  fieldType: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'currency';
  options: string[];
  required: boolean;
}) {
  const r = await act<{ id: string }>('settings.save_custom_field', input);
  revalidatePath(PATH);
  return r;
}

export async function saveTermAction(input: {
  id?: string;
  kind: 'cause' | 'geography' | 'population';
  code: string;
  label: string;
  parentId?: string | null;
}) {
  const r = await act<{ id: string }>('settings.save_term', input);
  revalidatePath(PATH);
  return r;
}

export async function deleteTermAction(id: string) {
  const r = await act('settings.delete_term', { id });
  revalidatePath(PATH);
  return r;
}
