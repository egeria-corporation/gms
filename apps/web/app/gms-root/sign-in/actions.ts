// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Root-host magic-link sign-in (platform operators). Same response whether or not the account exists.
import { getRuntime } from '@gms/actions';
import { z } from 'zod';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/server/rate-limit';
import { requestMeta } from '@/lib/tenant';

export type RootSignInState = { status: 'idle' } | { status: 'sent'; email: string } | { status: 'error'; message: string; field?: 'email' };

const Email = z.string().trim().toLowerCase().email();

function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/operator';
  return next;
}

export async function sendRootMagicLink(_prev: RootSignInState, form: FormData): Promise<RootSignInState> {
  const parsed = Email.safeParse(form.get('email'));
  if (!parsed.success) return { status: 'error', field: 'email', message: 'Enter your email address, like name@example.org.' };
  const email = parsed.data;
  const meta = await requestMeta();
  const perEmail = await rateLimit(`signin:email:${email}`, 5, 900);
  const perIp = await rateLimit(`signin:ip:${meta.ip ?? 'unknown'}`, 20, 900);
  if (!perEmail.ok || !perIp.ok) {
    return { status: 'error', message: `Too many sign-in links were requested. Try again in ${Math.ceil(Math.max(perEmail.resetSeconds, perIp.resetSeconds) / 60)} minutes.` };
  }
  const next = safeNext(String(form.get('next') ?? ''));
  const origin = `${config.protocol}://${config.rootDomain}`;
  try {
    await getRuntime().adapters.auth.sendMagicLink({ email, redirectTo: `${origin}${next}`, workspaceId: null, brandName: 'GMS' });
  } catch (err) {
    console.error('[root sign-in] magic link failed', (err as Error).message);
    return { status: 'error', message: 'We couldn’t send the email just now. Please try again in a minute.' };
  }
  return { status: 'sent', email };
}
