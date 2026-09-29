// SPDX-License-Identifier: AGPL-3.0-or-later
// TestAuthAdapter: magic links + TOTP MFA backed by gms_private.test_auth_* tables.
// Only for the plain-Postgres tier and tests: requires GMS_AUTH_MODE=test and refuses production deploys.
import { getDb, sql, type Database } from '@gms/db';
import { jwtVerify, SignJWT } from 'jose';
import { authenticator } from 'otplib';
import { decrypt, deriveKey, encrypt, isProductionDeploy, randomToken, sha256Hex } from '../crypto';
import type { AuthAdapter, CookieJar, Mailer, Session, TotpFactor } from '../types';

export const SESSION_COOKIE = 'gms_session';
const SESSION_TTL_S = 60 * 60 * 12;
const LINK_TTL_MIN = 15;

export interface TestAuthOptions {
  db?: () => Database;
  mailer: Mailer;
  fromEmail?: string;
  /** Renders the magic-link email; defaults to a plain branded message. */
  renderMagicLink?: (input: { link: string; email: string; brandName?: string }) => Promise<{ subject: string; html: string; text: string }>;
  secureCookies?: boolean;
}

export function assertTestAuthAllowed(): void {
  if (process.env.GMS_AUTH_MODE !== 'test') {
    throw new Error('TestAuthAdapter requires GMS_AUTH_MODE=test.');
  }
  if (isProductionDeploy()) {
    throw new Error('TestAuthAdapter is never allowed in production deployments.');
  }
}

authenticator.options = { window: 1, step: 30, digits: 6 };

export class TestAuthAdapter implements AuthAdapter {
  readonly name = 'test-auth' as const;
  private readonly db: () => Database;
  private readonly key = new Uint8Array(deriveKey('test-auth-session'));

  constructor(private readonly opts: TestAuthOptions) {
    assertTestAuthAllowed();
    this.db = opts.db ?? (() => getDb());
  }

  private async issueLink(email: string, redirectTo: string): Promise<string> {
    const token = randomToken(24);
    await sql`insert into gms_private.test_auth_tokens (token_hash, email, redirect_to, expires_at)
      values (${sha256Hex(token)}, ${email.toLowerCase()}, ${redirectTo}, now() + make_interval(mins => ${LINK_TTL_MIN}))`.execute(this.db());
    const url = new URL(redirectTo);
    const callback = new URL('/auth/callback', url.origin);
    callback.searchParams.set('token', token);
    callback.searchParams.set('next', url.pathname + url.search);
    return callback.toString();
  }

  async sendMagicLink(input: { email: string; redirectTo: string; workspaceId?: string | null; brandName?: string }): Promise<void> {
    const link = await this.issueLink(input.email, input.redirectTo);
    const rendered = this.opts.renderMagicLink
      ? await this.opts.renderMagicLink({ link, email: input.email, brandName: input.brandName })
      : {
          subject: `Your sign-in link${input.brandName ? ` for ${input.brandName}` : ''}`,
          html: `<p>Use this link to sign in. It works once and expires in ${LINK_TTL_MIN} minutes.</p><p><a href="${link}">Sign in</a></p>`,
          text: `Use this link to sign in. It works once and expires in ${LINK_TTL_MIN} minutes.\n\n${link}`,
        };
    await this.opts.mailer.send({
      to: input.email,
      from: this.opts.fromEmail ?? 'no-reply@gms.example',
      fromName: input.brandName ?? 'GMS',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      workspaceId: input.workspaceId ?? null,
      tags: { kind: 'magic_link' },
    });
  }

  async generateLink(email: string, redirectTo: string): Promise<string> {
    return this.issueLink(email, redirectTo);
  }

  async ensureUser(input: { email: string; fullName?: string }): Promise<string> {
    const email = input.email.toLowerCase();
    const existing = await sql<{ id: string }>`select id from auth.users where lower(email) = ${email}`.execute(this.db());
    if (existing.rows[0]) return existing.rows[0].id;
    const r = await sql<{ id: string }>`insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
      values (${email}, now(), ${JSON.stringify({ full_name: input.fullName ?? '' })}::jsonb) returning id`.execute(this.db());
    return r.rows[0]!.id;
  }

  private async setSessionCookie(cookies: CookieJar, sessionId: string, userId: string, email: string, aal: 'aal1' | 'aal2', expiresAt: Date) {
    const jwt = await new SignJWT({ sid: sessionId, email, aal })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    cookies.set(SESSION_COOKIE, jwt, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.opts.secureCookies ?? false,
      path: '/',
      maxAge: SESSION_TTL_S,
    });
  }

  private toSession(userId: string, email: string, sessionId: string, aal: 'aal1' | 'aal2', expiresAt: Date, mfaAt: string | null = null): Session {
    return {
      userId,
      email,
      aal,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      mfaAt,
      claims: {
        sub: userId,
        role: 'authenticated',
        email,
        aal,
        session_id: sessionId,
        ...(mfaAt ? { amr: [{ method: 'totp', timestamp: Math.floor(Date.parse(mfaAt) / 1000) }] } : {}),
      },
    };
  }

  async handleCallback(params: URLSearchParams, cookies: CookieJar): Promise<Session | null> {
    const token = params.get('token');
    if (!token) return null;
    const r = await sql<{ email: string }>`update gms_private.test_auth_tokens set used_at = now()
      where token_hash = ${sha256Hex(token)} and used_at is null and expires_at > now() returning email`.execute(this.db());
    const email = r.rows[0]?.email;
    if (!email) return null;
    const userId = await this.ensureUser({ email });
    await sql`update auth.users set last_sign_in_at = now() where id = ${userId}::uuid`.execute(this.db());
    const expiresAt = new Date(Date.now() + SESSION_TTL_S * 1000);
    const s = await sql<{ id: string }>`insert into gms_private.test_auth_sessions (user_id, aal, expires_at)
      values (${userId}::uuid, 'aal1', ${expiresAt.toISOString()}) returning id`.execute(this.db());
    const sessionId = s.rows[0]!.id;
    await this.setSessionCookie(cookies, sessionId, userId, email, 'aal1', expiresAt);
    return this.toSession(userId, email, sessionId, 'aal1', expiresAt);
  }

  async getSession(cookies: CookieJar): Promise<Session | null> {
    const raw = cookies.get(SESSION_COOKIE);
    if (!raw) return null;
    try {
      const { payload } = await jwtVerify(raw, this.key, { algorithms: ['HS256'] });
      const sid = String(payload.sid ?? '');
      const r = await sql<{ user_id: string; aal: 'aal1' | 'aal2'; expires_at: string; email: string; mfa_at: string | null }>`
        select s.user_id, s.aal, s.expires_at, s.mfa_at, u.email from gms_private.test_auth_sessions s join auth.users u on u.id = s.user_id
        where s.id = ${sid}::uuid and s.revoked_at is null and s.expires_at > now()
          and (u.banned_until is null or u.banned_until < now())`.execute(this.db());
      const row = r.rows[0];
      if (!row) return null;
      return this.toSession(row.user_id, row.email, sid, row.aal, new Date(row.expires_at), row.mfa_at ? new Date(row.mfa_at).toISOString() : null);
    } catch {
      return null;
    }
  }

  async signOut(cookies: CookieJar): Promise<void> {
    const s = await this.getSession(cookies);
    if (s) await sql`update gms_private.test_auth_sessions set revoked_at = now() where id = ${s.sessionId}::uuid`.execute(this.db());
    cookies.delete(SESSION_COOKIE);
  }

  async listFactors(cookies: CookieJar): Promise<TotpFactor[]> {
    const s = await this.getSession(cookies);
    if (!s) return [];
    const r = await sql<{ id: string; status: 'unverified' | 'verified'; friendly_name: string | null }>`
      select id, status, friendly_name from gms_private.test_auth_factors where user_id = ${s.userId}::uuid order by created_at`.execute(
      this.db(),
    );
    return r.rows.map((f) => ({ id: f.id, status: f.status, friendlyName: f.friendly_name }));
  }

  async enrollTotp(cookies: CookieJar, friendlyName = 'Authenticator app'): Promise<{ factorId: string; secret: string; otpauthUri: string }> {
    const s = await this.getSession(cookies);
    if (!s) throw new Error('not signed in');
    const secret = authenticator.generateSecret();
    const r = await sql<{ id: string }>`insert into gms_private.test_auth_factors (user_id, friendly_name, secret_ciphertext)
      values (${s.userId}::uuid, ${friendlyName}, ${encrypt(secret, 'totp')}) returning id`.execute(this.db());
    return { factorId: r.rows[0]!.id, secret, otpauthUri: authenticator.keyuri(s.email, 'GMS', secret) };
  }

  async verifyTotp(cookies: CookieJar, factorId: string, code: string): Promise<Session | null> {
    const s = await this.getSession(cookies);
    if (!s) return null;
    const r = await sql<{ secret_ciphertext: string }>`select secret_ciphertext from gms_private.test_auth_factors
      where id = ${factorId}::uuid and user_id = ${s.userId}::uuid`.execute(this.db());
    const row = r.rows[0];
    if (!row) return null;
    const ok = authenticator.check(code.replace(/\s/g, ''), decrypt(row.secret_ciphertext, 'totp'));
    if (!ok) return null;
    await sql`update gms_private.test_auth_factors set status = 'verified' where id = ${factorId}::uuid`.execute(this.db());
    const mfaAt = new Date().toISOString();
    await sql`update gms_private.test_auth_sessions set aal = 'aal2', mfa_at = ${mfaAt} where id = ${s.sessionId}::uuid`.execute(this.db());
    const expiresAt = new Date(s.expiresAt);
    await this.setSessionCookie(cookies, s.sessionId, s.userId, s.email, 'aal2', expiresAt);
    return this.toSession(s.userId, s.email, s.sessionId, 'aal2', expiresAt, mfaAt);
  }
}

/** Test helper: the current TOTP code for a stored factor (used by E2E and seeds; test mode only). */
export async function currentTotpForFactor(db: Database, factorId: string): Promise<string> {
  assertTestAuthAllowed();
  const r = await sql<{ secret_ciphertext: string }>`select secret_ciphertext from gms_private.test_auth_factors where id = ${factorId}::uuid`.execute(db);
  const row = r.rows[0];
  if (!row) throw new Error('factor not found');
  return authenticator.generate(decrypt(row.secret_ciphertext, 'totp'));
}

/** Seeds a verified TOTP factor with a known secret (test mode only). */
export async function seedTotpFactor(db: Database, userId: string, secret: string): Promise<string> {
  assertTestAuthAllowed();
  const r = await sql<{ id: string }>`insert into gms_private.test_auth_factors (user_id, friendly_name, secret_ciphertext, status)
    values (${userId}::uuid, 'Authenticator app', ${encrypt(secret, 'totp')}, 'verified') returning id`.execute(db);
  return r.rows[0]!.id;
}

export function totpNow(secret: string): string {
  return authenticator.generate(secret);
}
