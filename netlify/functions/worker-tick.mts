// SPDX-License-Identifier: AGPL-3.0-only
// Netlify Scheduled Function: every minute, drain queued jobs and run time-based work (≤ 30s budget).
import type { Config } from '@netlify/functions';
import { tick } from '../../apps/worker/src/tick';

export default async function handler(): Promise<Response> {
  const started = Date.now();
  const { ran } = await tick();
  return Response.json({ ok: true, ran, ms: Date.now() - started });
}

export const config: Config = { schedule: '* * * * *' };
