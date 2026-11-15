// SPDX-License-Identifier: AGPL-3.0-only
// Single sign-on (SAML 2.0) for funder workspaces (docs/sso.md). A workspace lists the email
// domains its staff sign in with through the organization's identity provider, proves each with a
// DNS TXT record, and may require single sign-on for people whose address is on an active domain.
// The identity provider is registered in Supabase Auth by the operator
// (scripts/sso/register-provider.mjs), who then marks the domain active (gms.activate_sso_domain).
//
// The requirement is enforced in one place, `assertSsoSatisfied`, which the auth middleware calls
// for every signed-in person's request bound to a workspace. API clients and agents' tokens are not
// sessions and are unaffected; they stay bound to their scopes.
import { z } from "zod";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { audit, authorize, guardWrite, required, type ServiceContext } from "./context.ts";
import type { Repos, Row } from "./repos/types.ts";

type DomainRow = Row<"workspace_sso_domains">;

// ------------------------------------------------------------------------------------ choices (one constant each)

/** The DNS TXT challenge, the same pattern as Passport's domain proof: `gms-verify=<token>` at `_gms-verify.<domain>`, or at the domain itself. */
export const CHALLENGE_LABEL = "_gms-verify";
export const CHALLENGE_PREFIX = "gms-verify=";
/** DNS over HTTPS against Cloudflare's resolver (1.1.1.1), JSON API. No new vendor. */
export const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
/** A workspace lists at most this many domains. */
export const MAX_SSO_DOMAINS = 10;
/** A domain's DNS is looked up at most this often; a quicker check answers with the last result. */
export const DNS_CHECK_INTERVAL_MS = 10_000;
/**
 * An SSO sign-in is a new Supabase account (Supabase never links it to an email-code account with
 * the same address). When true, a person who signs in through the identity provider registered for
 * a workspace's active domain joins that workspace with the role their email-code account already
 * holds there. When false, such a person needs an invitation like anyone else.
 */
export const SSO_JOIN_FROM_EXISTING_MEMBERSHIP = true;

// ------------------------------------------------------------------------------------ domains and sessions

/** Same as the `workspace_sso_domains.domain` check. */
export const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Special-use and private-use TLDs: never an organization's own email domain. */
const INTERNAL_TLDS = new Set(["local", "localhost", "localdomain", "internal", "intranet", "corp", "home", "lan", "private", "test", "example", "invalid", "onion", "arpa", "alt"]);
/** Two-label public suffixes (`co.uk`) that are never an organization's own domain. Not a full list. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "or", "ne", "go", "gob", "nic", "ltd", "plc", "sch", "mil", "nom", "gv", "govt"]);

const invalidDomain = (detail: string) => new ApiError(422, "invalid_domain", detail, [{ code: "invalid", field: "domain", detail }]);

/** Lowercase ASCII (punycode) domain, or a 422 that says what is wrong. Accepts `Example.org.` and `bücher.example`. */
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase().replace(/^@/, "");
  if (!s || s.length > 254) throw invalidDomain("Enter a domain like example.org");
  if (/[\s/@:?#\\[\]]/.test(s)) throw invalidDomain("Enter only the domain, like example.org (no https://, path or port)");
  s = s.replace(/\.$/, "");
  let ascii: string;
  try {
    ascii = new URL(`http://${s}/`).hostname;
  } catch {
    throw invalidDomain("That is not a valid domain");
  }
  if (/^[0-9.]+$/.test(ascii)) throw invalidDomain("Enter a domain, not an IP address");
  if (ascii.length > 253 || !DOMAIN_RE.test(ascii)) throw invalidDomain("That is not a valid domain");
  const labels = ascii.split(".");
  const tld = labels[labels.length - 1]!;
  if (INTERNAL_TLDS.has(tld)) throw invalidDomain("Internal or reserved domains cannot be used for single sign-on");
  if (labels.length === 2 && tld.length === 2 && SECOND_LEVEL.has(labels[0]!)) throw invalidDomain("Enter your organization's own domain, not a registry suffix");
  return ascii;
}

/** The domain of an email address, lowercase; null when there is none. */
export function emailDomainOf(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 1) return null;
  const d = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  return d || null;
}

/** What the session says about single sign-on: its address and the identity providers it signed in through. */
export interface SessionSso {
  email: string | null;
  /** Provider ids of the `sso/saml` entries in the session's `amr` claim; empty for any other sign-in. */
  ssoProviderIds: readonly string[];
}

/** The SSO facts of a signed-in person's session; none for API clients and agents. */
export const sessionSsoOf = (user: { email: string | null; ssoProviderIds?: readonly string[] } | undefined | null): SessionSso => ({
  email: user?.email ?? null,
  ssoProviderIds: user?.ssoProviderIds ?? [],
});

/** The values a workspace's IT team enters in their identity provider, from the project's address. */
export function serviceProviderOf(supabaseUrl: string | null | undefined) {
  if (!supabaseUrl) return null;
  let base: string;
  try {
    base = new URL(supabaseUrl).origin;
  } catch {
    return null;
  }
  const metadataUrl = `${base}/auth/v1/sso/saml/metadata`;
  return { entityId: metadataUrl, metadataUrl, metadataDownloadUrl: `${metadataUrl}?download=true`, acsUrl: `${base}/auth/v1/sso/saml/acs`, nameIdFormat: "emailAddress or persistent" };
}

// ------------------------------------------------------------------------------------ enforcement (the one place)

/**
 * A workspace that requires single sign-on for the member's email domain refuses a session that
 * did not come through the identity provider registered for that domain. Other workspaces, other
 * domains and tokens are untouched. Called by the auth middleware for every session request.
 */
export async function assertSsoSatisfied(repos: Repos, workspaceId: string, user: { email: string | null; ssoProviderIds?: readonly string[] }): Promise<void> {
  const domain = emailDomainOf(user.email);
  if (!domain) return;
  const rows = await repos.table("workspace_sso_domains").find({ workspace_id: workspaceId, domain, status: "active", require_sso: true });
  if (!rows.length) return;
  const providers = user.ssoProviderIds ?? [];
  if (rows.some((r) => r.provider_id !== null && providers.includes(r.provider_id))) return;
  throw forbidden("sso_required", "This workspace requires single sign-on");
}

// ------------------------------------------------------------------------------------ DNS TXT proof

export interface TxtLookup {
  /** DNS RCODE: 0 NOERROR, 3 NXDOMAIN, others are failures. */
  status: number;
  records: string[];
}
export type TxtResolver = (name: string) => Promise<TxtLookup>;
export type ChallengeCheck = { result: "matched"; at: string } | { result: "not_found" } | { result: "mismatch"; found: number };

export class DnsLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DnsLookupError";
  }
}

export const challengeRecordName = (domain: string) => `${CHALLENGE_LABEL}.${domain}`;
export const challengeRecordValue = (token: string) => `${CHALLENGE_PREFIX}${token}`;

/** 32 random bytes, base64url (43 characters): the shape the table's check expects. */
export function newChallengeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The value of a DoH TXT answer: one or more quoted strings (concatenated) with `\"` and `\DDD` escapes, or bare text. */
export function parseTxtData(data: string): string {
  const s = data.trim();
  if (!s.startsWith('"')) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;
    if (s[i] !== '"') {
      const m = /^\S+/.exec(s.slice(i))!;
      out += m[0];
      i += m[0].length;
      continue;
    }
    i++;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === "\\" && i + 1 < s.length) {
        const dec = /^\d{3}/.exec(s.slice(i + 1));
        if (dec) {
          out += String.fromCharCode(Number(dec[0]));
          i += 4;
        } else {
          out += s[i + 1];
          i += 2;
        }
      } else {
        out += s[i];
        i++;
      }
    }
    i++;
  }
  return out;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The TXT values (type 16) of a DoH JSON answer. */
export function parseDohTxt(body: unknown): TxtLookup {
  const b = rec(body);
  const status = typeof b.Status === "number" ? b.Status : 2;
  const answers = Array.isArray(b.Answer) ? b.Answer : [];
  return { status, records: answers.map(rec).filter((a) => a.type === 16 && typeof a.data === "string").map((a) => parseTxtData(a.data as string)) };
}

/** TXT lookups through Cloudflare's DNS-over-HTTPS resolver. */
export function dohResolver(fetchFn: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i), timeoutMs = 5000): TxtResolver {
  return async (name) => {
    let res: Response;
    try {
      res = await fetchFn(`${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=TXT`, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new DnsLookupError(`DNS lookup failed: ${(e as Error).name}`);
    }
    if (!res.ok) throw new DnsLookupError(`DNS resolver responded ${res.status}`);
    const result = parseDohTxt(await res.json());
    if (result.status !== 0 && result.status !== 3) throw new DnsLookupError(`DNS resolver returned RCODE ${result.status}`);
    return result;
  };
}

/** Look for `gms-verify=<token>` at `_gms-verify.<domain>`, then at the domain itself. */
export async function checkChallenge(domain: string, token: string, resolve: TxtResolver): Promise<ChallengeCheck> {
  const expected = challengeRecordValue(token);
  let other = 0;
  for (const name of [challengeRecordName(domain), domain]) {
    const { records } = await resolve(name);
    if (records.some((r) => r.trim() === expected)) return { result: "matched", at: name };
    other += records.filter((r) => r.trim().startsWith(CHALLENGE_PREFIX)).length;
  }
  return other ? { result: "mismatch", found: other } : { result: "not_found" };
}

// ------------------------------------------------------------------------------------ views

/** Where a domain is: the admin publishes the DNS record, OpenGrants connects the identity provider, then it is active. */
export type DomainStage = "add_dns_record" | "waiting_for_provider" | "active";

const stageOf = (r: DomainRow): DomainStage => (r.status === "active" ? "active" : r.verified_at ? "waiting_for_provider" : "add_dns_record");

export const domainView = (r: DomainRow) => ({
  id: r.id,
  domain: r.domain,
  status: r.status as "pending" | "active",
  stage: stageOf(r),
  required: r.require_sso,
  dns: { recordType: "TXT" as const, recordName: challengeRecordName(r.domain), recordValue: challengeRecordValue(r.verification_token), alsoAcceptedAt: r.domain },
  verifiedAt: r.verified_at,
  lastCheckedAt: r.last_checked_at,
  lastCheckResult: r.last_check_result as "matched" | "not_found" | "mismatch" | "error" | null,
  providerId: r.provider_id,
  activatedAt: r.activated_at,
  createdAt: r.created_at,
});

/** Whether this session could turn the requirement on, and if not, what to do first. */
function requirementCheck(rows: DomainRow[], session: SessionSso): { ok: boolean; reason: string | null } {
  const active = rows.filter((r) => r.status === "active");
  if (!active.length) return { ok: false, reason: "Single sign-on can be required once one of your domains is active." };
  const through = (r: DomainRow) => r.provider_id !== null && session.ssoProviderIds.includes(r.provider_id);
  // An admin whose own address is on an active domain must have come through that domain's provider.
  const own = active.find((r) => r.domain === emailDomainOf(session.email));
  if (own ? !through(own) : !active.some(through)) {
    return { ok: false, reason: "Sign in with single sign-on first, so you know it works before you require it." };
  }
  return { ok: true, reason: null };
}

// ------------------------------------------------------------------------------------ admin actions

const ADMIN = { scope: "workspace:admin", kind: "funder", roles: ["admin"] } as const;

/** Changing who can sign in is for a signed-in admin only: never an agent or an API client. */
async function humanAdmin(ctx: ServiceContext) {
  if (ctx.actor.kind !== "user" || !ctx.actor.userId) throw forbidden("human_only", "Single sign-on settings are changed by a signed-in admin, never by an agent or API client");
  return authorize(ctx, { ...ADMIN, person: true });
}

async function domainsOf(ctx: ServiceContext, workspaceId: string) {
  return ctx.repos.table("workspace_sso_domains").find({ workspace_id: workspaceId }, { orderBy: "created_at" });
}

/** The workspace's single sign-on settings: its domains, the requirement and the values for its IT team. */
export async function getSsoSettings(ctx: ServiceContext, env: { supabaseUrl: string | null | undefined }, session: SessionSso) {
  const ws = await authorize(ctx, ADMIN);
  const rows = await domainsOf(ctx, ws.id);
  const active = rows.filter((r) => r.status === "active");
  return {
    domains: rows.map(domainView),
    /** True when every active domain requires single sign-on. */
    requireSso: active.length > 0 && active.every((r) => r.require_sso),
    canRequire: requirementCheck(rows, session),
    serviceProvider: serviceProviderOf(env.supabaseUrl),
    session: { signedInThroughSso: session.ssoProviderIds.length > 0 },
    maxDomains: MAX_SSO_DOMAINS,
  };
}

export const domainInput = z.object({ domain: z.string().min(1).max(260) }).strict();

/** Add a domain. It stays pending until its DNS record is checked and the operator connects the identity provider. */
export async function addSsoDomain(ctx: ServiceContext, input: z.output<typeof domainInput>) {
  const ws = await humanAdmin(ctx);
  const domain = normalizeDomain(input.domain);
  const rows = await domainsOf(ctx, ws.id);
  if (rows.some((r) => r.domain === domain)) throw new ApiError(409, "domain_exists", `${domain} is already on this workspace's list`);
  if (rows.length >= MAX_SSO_DOMAINS) throw new ApiError(409, "too_many_domains", `A workspace can list up to ${MAX_SSO_DOMAINS} domains`);
  const taken = await ctx.repos.table("workspace_sso_domains").one({ domain, status: "active" });
  if (taken) throw new ApiError(409, "domain_in_use", `${domain} already signs in to another workspace. Ask OpenGrants for help if it is yours`);
  const row = await guardWrite("This domain", () =>
    ctx.repos.table("workspace_sso_domains").insert({
      workspace_id: ws.id,
      domain,
      status: "pending",
      require_sso: false,
      provider_id: null,
      verification_token: newChallengeToken(),
      verified_at: null,
      last_checked_at: null,
      last_check_result: null,
      activated_at: null,
      created_by: ctx.actor.userId,
    }),
  );
  await audit(ctx, "sso_domain.added", "sso_domain", row.id, { domain, recordName: challengeRecordName(domain) });
  return domainView(row);
}

async function loadDomain(ctx: ServiceContext, workspaceId: string, id: string) {
  const row = await ctx.repos.table("workspace_sso_domains").one({ id });
  if (!row || row.workspace_id !== workspaceId) throw notFound("Domain");
  return row;
}

/** Look up the domain's TXT record now. A match records the proof; anything else is kept as the last result. */
export async function checkSsoDomain(ctx: ServiceContext, id: string, resolve: TxtResolver) {
  const ws = await humanAdmin(ctx);
  const row = await loadDomain(ctx, ws.id, id);
  if (row.verified_at) return { domain: domainView(row), check: { result: "matched" as const, checkedAt: row.last_checked_at ?? row.verified_at } };
  const now = ctx.now();
  if (row.last_checked_at && now.getTime() - Date.parse(row.last_checked_at) < DNS_CHECK_INTERVAL_MS) {
    return { domain: domainView(row), check: { result: row.last_check_result ?? "not_found", checkedAt: row.last_checked_at } };
  }
  let result: "matched" | "not_found" | "mismatch" | "error";
  try {
    result = (await checkChallenge(row.domain, row.verification_token, resolve)).result;
  } catch (e) {
    if (!(e instanceof DnsLookupError)) throw e;
    result = "error";
  }
  const at = now.toISOString();
  const [updated] = await ctx.repos.table("workspace_sso_domains").update({ id: row.id }, { last_checked_at: at, last_check_result: result, ...(result === "matched" ? { verified_at: at } : {}) });
  if (result === "matched") await audit(ctx, "sso_domain.verified", "sso_domain", row.id, { domain: row.domain, proof: "dns_txt" });
  return { domain: domainView(required(updated, "Domain")), check: { result, checkedAt: at } };
}

/** Remove a domain. Removing an active one ends its requirement; the operator removes its identity provider. */
export async function removeSsoDomain(ctx: ServiceContext, id: string) {
  const ws = await humanAdmin(ctx);
  const row = await loadDomain(ctx, ws.id, id);
  await ctx.repos.table("workspace_sso_domains").remove({ id: row.id });
  await audit(ctx, "sso_domain.removed", "sso_domain", row.id, { domain: row.domain, status: row.status, wasRequired: row.require_sso, providerId: row.provider_id });
  return { removed: true, domain: row.domain, wasActive: row.status === "active" };
}

export const requirementInput = z.object({ require: z.boolean() }).strict();

/**
 * Require single sign-on for every active domain, or stop requiring it. Turning it on needs an
 * active domain and an admin who is signed in through single sign-on now, so the person who turns
 * it on is never the one it locks out. Turning it off is always allowed.
 */
export async function setSsoRequirement(ctx: ServiceContext, input: z.output<typeof requirementInput>, session: SessionSso) {
  const ws = await humanAdmin(ctx);
  const rows = await domainsOf(ctx, ws.id);
  const before = rows.filter((r) => r.require_sso).map((r) => r.domain);
  if (input.require) {
    const check = requirementCheck(rows, session);
    if (!check.ok) throw new ApiError(409, rows.some((r) => r.status === "active") ? "sso_session_required" : "no_active_domain", check.reason!);
    for (const r of rows.filter((x) => x.status === "active" && !x.require_sso)) await ctx.repos.table("workspace_sso_domains").update({ id: r.id }, { require_sso: true });
  } else {
    for (const r of rows.filter((x) => x.require_sso)) await ctx.repos.table("workspace_sso_domains").update({ id: r.id }, { require_sso: false });
  }
  const after = (await domainsOf(ctx, ws.id)).filter((r) => r.require_sso).map((r) => r.domain);
  if (before.join() !== after.join()) await audit(ctx, input.require ? "sso.required" : "sso.requirement_off", "workspace", ws.id, { domains: after, before });
  return { requireSso: input.require, requiredDomains: after };
}

// ------------------------------------------------------------------------------------ joining through single sign-on

/**
 * After an SSO sign-in: join each workspace whose active domain matches the session's address and
 * whose registered identity provider is the one the session came through, with the role the
 * person's email-code account (same address, by the account's own email) already holds there.
 * Never creates a role nobody held; a person with no membership needs an invitation.
 */
export async function joinThroughSso(ctx: ServiceContext, session: SessionSso) {
  if (ctx.actor.kind !== "user" || !ctx.actor.userId) throw forbidden("human_only", "Joining through single sign-on is done by the signed-in person");
  await authorize(ctx, { person: true });
  if (!session.ssoProviderIds.length) throw new ApiError(409, "sso_session_required", "Sign in with single sign-on first");
  const domain = emailDomainOf(session.email);
  const email = session.email?.trim().toLowerCase() ?? "";
  const directory = ctx.ports.directory;
  if (!SSO_JOIN_FROM_EXISTING_MEMBERSHIP || !domain || !directory) return { joined: [] as { workspaceId: string; handle: string; name: string; role: string }[] };
  const me = ctx.actor.userId;
  const rows = (await ctx.repos.table("workspace_sso_domains").find({ domain, status: "active" })).filter((r) => r.provider_id !== null && session.ssoProviderIds.includes(r.provider_id));
  const joined: { workspaceId: string; handle: string; name: string; role: string }[] = [];
  const nowMs = ctx.now().getTime();
  for (const r of rows) {
    if (await ctx.repos.table("workspace_members").one({ workspace_id: r.workspace_id, user_id: me })) continue;
    const members = (await ctx.repos.table("workspace_members").find({ workspace_id: r.workspace_id }, { orderBy: "created_at" })).filter((m) => m.user_id !== me && (!m.expires_at || Date.parse(m.expires_at) > nowMs));
    if (!members.length) continue;
    const people = await directory.lookup(members.map((m) => m.user_id));
    const source = members.find((m) => people.get(m.user_id)?.email?.trim().toLowerCase() === email);
    if (!source) continue;
    const scope = { ...((source.scope as Record<string, unknown> | null) ?? {}), email, joinedThrough: "sso" } as Row<"workspace_members">["scope"];
    const inserted = await ctx.repos.table("workspace_members").insert({ workspace_id: r.workspace_id, user_id: me, role: source.role, scope, expires_at: source.expires_at, invited_by: source.invited_by }).catch(() => null);
    if (!inserted) continue;
    await audit(ctx, "member.joined_through_sso", "workspace", r.workspace_id, { userId: me, fromUserId: source.user_id, role: source.role, domain, providerId: r.provider_id }, r.workspace_id);
    const w = await ctx.repos.table("workspaces").one({ id: r.workspace_id });
    joined.push({ workspaceId: r.workspace_id, handle: w?.handle ?? "", name: w?.display_name ?? "", role: source.role });
  }
  return { joined };
}
