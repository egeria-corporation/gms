// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads for pages run under RLS as the viewer (or anon). Mutations never happen here: use act().
import 'server-only';
import { getRuntime } from '@gms/actions';
import { withRls, type Tx } from '@gms/db';
import { claims } from '../auth';

export async function rls<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  return withRls(await claims(), fn, getRuntime().db);
}

/** Anonymous reads (public pages), regardless of who is signed in. */
export async function anon<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  return withRls({ role: 'anon' }, fn, getRuntime().db);
}
