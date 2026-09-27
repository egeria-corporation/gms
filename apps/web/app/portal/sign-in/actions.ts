// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { getRuntime } from '@gms/actions';
import { z } from 'zod';
import { rateLimit } from '@/lib/server/rate-limit';
import { requestMeta, requireTenant } from '@/lib/tenant';

export type SignInState = { status: 'idle' } | { status: 'sent'; email: string } | { status: 'error'; message: string; field?: 'email' };

const Email = z.string().trim().toLowerCase().email();

function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/portal';
  return next;
}

export async function sendMagicLink(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = Email.safeParse(form.get('email'));
  if (!parsed.success) return { status: 'error', field: 'email', message: 'Enter your email address, like name@example.org.' };
  const email = parsed.data;
  const tenant = await requireTenant();
  const meta = await requestMeta();
  const perEmail = await rateLimit(`signin:email:${email}`, 5, 900);
  const perIp = await rateLimit(`signin:ip:${meta.ip ?? 'unknown'}`, 20, 900);
  if (!perEmail.ok || !perIp.ok) {
    return { status: 'error', message: `Too many sign-in links were requested. Try again in ${Math.ceil(Math.max(perEmail.resetSeconds, perIp.resetSeconds) / 60)} minutes.` };
  }
  const next = safeNext(String(form.get('next') ?? ''));
  try {
    await getRuntime().adapters.auth.sendMagicLink({ email, redirectTo: `${tenant.origin}${next}`, workspaceId: tenant.id, brandName: tenant.brand.displayName });
  } catch (err) {
    console.error('[sign-in] magic link failed', (err as Error).message);
    return { status: 'error', message: 'We couldn’t send the email just now. Please try again in a minute.' };
  }
  // Same response whether or not the account exists (no account enumeration).
  return { status: 'sent', email };
}
