// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import { getRuntime } from '@gms/actions';
import QRCode from 'qrcode';
import { cookieJar } from '@/lib/auth';
import { rateLimit } from '@/lib/server/rate-limit';
import { getSession } from '@/lib/auth';

export async function enrollTotpAction(): Promise<{ ok: true; factorId: string; secret: string; qr: string } | { ok: false; message: string }> {
  try {
    const r = await getRuntime().adapters.auth.enrollTotp(await cookieJar(), 'Authenticator app');
    const qr = await QRCode.toDataURL(r.otpauthUri, { margin: 1, width: 220 });
    return { ok: true, factorId: r.factorId, secret: r.secret, qr };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Verifies a 6-digit code: completes enrollment, signs in at aal2, and serves as the step-up check. */
export async function verifyTotpAction(factorId: string | null, code: string): Promise<{ ok: boolean; message?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Your session ended. Sign in again.' };
  const rl = await rateLimit(`totp:${session.userId}`, 10, 300);
  if (!rl.ok) return { ok: false, message: 'Too many attempts. Wait a few minutes and try again.' };
  const auth = getRuntime().adapters.auth;
  const jar = await cookieJar();
  let id = factorId;
  if (!id) {
    const factors = await auth.listFactors(jar);
    id = factors.find((f) => f.status === 'verified')?.id ?? factors[0]?.id ?? null;
  }
  if (!id) return { ok: false, message: 'Set up your authenticator app first.' };
  const s = await auth.verifyTotp(jar, id, code);
  return s ? { ok: true } : { ok: false, message: 'That code didn’t match. Check the time on your phone and try the newest code.' };
}
