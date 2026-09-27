// SPDX-License-Identifier: AGPL-3.0-only
// SupabaseAuthAdapter: Supabase Auth through @supabase/ssr (sessions in HTTP-only cookies).
//  - Magic links: by default GMS generates the link with the admin API (auth.admin.generateLink) and sends it
//    with its own (branded, guarded) Mailer, so development never emails real people and every workspace
//    brand applies. Without a mailer/service key it falls back to signInWithOtp({ emailRedirectTo }) and
//    Supabase sends the mail (configure the template to link to /auth/callback?token_hash=…&type=email).
//  - Callback: verifyOtp({ token_hash, type }) or exchangeCodeForSession(code) (PKCE).
//  - Sessions: getClaims() verifies the JWT (JWKS / auth server) — never trust getSession() alone.
//  - MFA: TOTP via auth.mfa.enroll / challengeAndVerify; `aal` comes from the verified JWT.
import { createServerClient, type CookieOptions as SsrCookieOptions } from '@supabase/ssr';
import { createClient, type EmailOtpType, type SupabaseClient } from '@supabase/supabase-js';
import { sql, type Database } from '@gms/db';
import type { AuthAdapter, CookieJar, CookieOptions, Mailer, Session, TotpFactor } from '../types';

export interface SupabaseAuthOptions {
  url?: string;
  /** Publishable / anon key. */
  anonKey?: string;
  /** Service role key (admin API). Server-only. */
  serviceRoleKey?: string;
  /** When given (with a service role key), magic links are sent through this mailer. */
  mailer?: Mailer;
  fromEmail?: string;
  renderMagicLink?: (input: { link: string; email: string; brandName?: string }) => Promise<{ subject: string; html: string; text: string }>;
  /** Service DB, used to look up existing users by email. */
  db?: () => Database;
  secureCookies?: boolean;
}

const OTP_TYPES: readonly EmailOtpType[] = ['magiclink', 'email', 'signup', 'invite', 'recovery', 'email_change'];

function toJarOptions(o: SsrCookieOptions): CookieOptions {
  const sameSite = o.sameSite === true ? 'strict' : o.sameSite === false ? undefined : o.sameSite;
  let maxAge = o.maxAge;
  if (maxAge === undefined && o.expires) maxAge = Math.max(0, Math.floor((o.expires.getTime() - Date.now()) / 1000));
  return {
    httpOnly: o.httpOnly,
    secure: o.secure,
    sameSite: sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none' ? sameSite : undefined,
    path: o.path ?? '/',
    maxAge,
    domain: o.domain,
  };
}

export class SupabaseAuthAdapter implements AuthAdapter {
  readonly name = 'supabase-auth' as const;
  private readonly url: string;
  private readonly anonKey: string;
  readonly #serviceRoleKey: string | undefined;
  private readonly storageKey: string;

  constructor(private readonly opts: SupabaseAuthOptions = {}) {
    const url = opts.url ?? process.env.SUPABASE_URL;
    const anonKey = opts.anonKey ?? process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) are required for Supabase Auth');
    this.url = url;
    this.anonKey = anonKey;
    this.#serviceRoleKey = opts.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, url: this.url };
  }

  /** Per-request server client wired to the cookie jar. */
  private server(cookies: CookieJar): SupabaseClient {
    const secure = this.opts.secureCookies ?? !/^http:\/\/(localhost|127\.0\.0\.1)/.test(this.url);
    return createServerClient(this.url, this.anonKey, {
      cookieOptions: { httpOnly: true, sameSite: 'lax', secure, path: '/' },
      cookies: {
        getAll: () => {
          if (cookies.getAll) return cookies.getAll();
          // Fallback for jars that cannot enumerate: probe the session cookie and its chunks.
          const names = [this.storageKey, `${this.storageKey}-code-verifier`, ...Array.from({ length: 10 }, (_, i) => `${this.storageKey}.${i}`)];
          return names.flatMap((name) => {
            const value = cookies.get(name);
            return value === undefined ? [] : [{ name, value }];
          });
        },
        setAll: (list) => {
          for (const c of list) {
            if (!c.value || c.options.maxAge === 0) cookies.delete(c.name);
            else cookies.set(c.name, c.value, toJarOptions(c.options));
          }
        },
      },
    });
  }

  private admin(): SupabaseClient {
    const key = this.#serviceRoleKey;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for admin auth operations');
    return createClient(this.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private callbackUrl(redirectTo: string, params: Record<string, string>): string {
    const target = new URL(redirectTo);
    const cb = new URL('/auth/callback', target.origin);
    for (const [k, v] of Object.entries(params)) cb.searchParams.set(k, v);
    cb.searchParams.set('next', target.pathname + target.search);
    return cb.toString();
  }

  async generateLink(email: string, redirectTo: string): Promise<string> {
    const { data, error } = await this.admin().auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } });
    if (error || !data.properties?.hashed_token) throw new Error(`could not generate a sign-in link: ${error?.message ?? 'no token'}`);
    return this.callbackUrl(redirectTo, { token_hash: data.properties.hashed_token, type: 'magiclink' });
  }

  async sendMagicLink(input: { email: string; redirectTo: string; workspaceId?: string | null; brandName?: string }): Promise<void> {
    if (this.opts.mailer && this.#serviceRoleKey) {
      const link = await this.generateLink(input.email, input.redirectTo);
      const rendered = this.opts.renderMagicLink
        ? await this.opts.renderMagicLink({ link, email: input.email, brandName: input.brandName })
        : {
            subject: `Your sign-in link${input.brandName ? ` for ${input.brandName}` : ''}`,
            html: `<p>Use this link to sign in. It works once and expires soon.</p><p><a href="${link}">Sign in</a></p>`,
            text: `Use this link to sign in. It works once and expires soon.\n\n${link}`,
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
      return;
    }
    const client = createClient(this.url, this.anonKey, { auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' } });
    const target = new URL(input.redirectTo);
    const emailRedirectTo = new URL('/auth/callback', target.origin);
    emailRedirectTo.searchParams.set('next', target.pathname + target.search);
    const { error } = await client.auth.signInWithOtp({ email: input.email, options: { emailRedirectTo: emailRedirectTo.toString(), shouldCreateUser: true } });
    if (error) throw new Error(`could not send the sign-in link: ${error.message}`);
  }

  private async sessionFromToken(client: SupabaseClient, accessToken?: string): Promise<Session | null> {
    const { data, error } = await client.auth.getClaims(accessToken);
    if (error || !data?.claims) return null;
    const c = data.claims;
    if (c.role !== 'authenticated' || typeof c.sub !== 'string') return null;
    const aal = c.aal === 'aal2' ? 'aal2' : 'aal1';
    const email = typeof c.email === 'string' ? c.email : '';
    const sessionId = typeof c.session_id === 'string' ? c.session_id : '';
    return {
      userId: c.sub,
      email,
      aal,
      sessionId,
      expiresAt: new Date((typeof c.exp === 'number' ? c.exp : 0) * 1000).toISOString(),
      claims: { sub: c.sub, role: 'authenticated', email, aal, session_id: sessionId },
    };
  }

  async handleCallback(params: URLSearchParams, cookies: CookieJar): Promise<Session | null> {
    const client = this.server(cookies);
    const tokenHash = params.get('token_hash');
    const type = params.get('type') as EmailOtpType | null;
    const code = params.get('code');
    if (tokenHash && type && OTP_TYPES.includes(type)) {
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error || !data.session) return null;
      return this.sessionFromToken(client, data.session.access_token);
    }
    if (code) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error || !data.session) return null;
      return this.sessionFromToken(client, data.session.access_token);
    }
    return null;
  }

  async getSession(cookies: CookieJar): Promise<Session | null> {
    try {
      return await this.sessionFromToken(this.server(cookies));
    } catch {
      return null;
    }
  }

  async signOut(cookies: CookieJar): Promise<void> {
    await this.server(cookies).auth.signOut({ scope: 'local' });
  }

  async listFactors(cookies: CookieJar): Promise<TotpFactor[]> {
    const { data, error } = await this.server(cookies).auth.mfa.listFactors();
    if (error || !data) return [];
    return data.totp.map((f) => ({ id: f.id, status: f.status === 'verified' ? 'verified' : 'unverified', friendlyName: f.friendly_name ?? null }));
  }

  async enrollTotp(cookies: CookieJar, friendlyName = 'Authenticator app'): Promise<{ factorId: string; secret: string; otpauthUri: string }> {
    const { data, error } = await this.server(cookies).auth.mfa.enroll({ factorType: 'totp', friendlyName });
    if (error || !data) throw new Error(`could not enroll an authenticator: ${error?.message ?? 'unknown error'}`);
    return { factorId: data.id, secret: data.totp.secret, otpauthUri: data.totp.uri };
  }

  async verifyTotp(cookies: CookieJar, factorId: string, code: string): Promise<Session | null> {
    const client = this.server(cookies);
    const { data, error } = await client.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
    if (error || !data) return null;
    return this.sessionFromToken(client, data.access_token);
  }

  async ensureUser(input: { email: string; fullName?: string }): Promise<string> {
    const email = input.email.toLowerCase();
    const existing = await this.findUserId(email);
    if (existing) return existing;
    const admin = this.admin();
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: input.fullName ?? '' } });
    if (data?.user) return data.user.id;
    // Lost a race with another creator: look it up again.
    const again = await this.findUserId(email);
    if (again) return again;
    throw new Error(`could not create user: ${error?.message ?? 'unknown error'}`);
  }

  private async findUserId(email: string): Promise<string | null> {
    if (this.opts.db) {
      const r = await sql<{ id: string }>`select id from auth.users where lower(email) = ${email} limit 1`.execute(this.opts.db());
      return r.rows[0]?.id ?? null;
    }
    const admin = this.admin();
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !data) return null;
      const hit = data.users.find((u) => u.email?.toLowerCase() === email);
      if (hit) return hit.id;
      if (data.users.length < 1000) return null;
    }
    return null;
  }
}
