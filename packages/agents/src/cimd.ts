// SPDX-License-Identifier: AGPL-3.0-only
// OAuth Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document): a client_id that is an
// https URL whose JSON document describes the client. Fetched with SSRF protections:
//   - https only, default port, no userinfo/fragment, a non-root path
//   - every resolved address must be public (no loopback, private, link-local, CGNAT, multicast, ULA …); the
//     check runs inside the socket's DNS lookup, so DNS rebinding between "check" and "connect" is not possible
//   - no redirects, 5 s total timeout, 5 KB body cap, JSON content type
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { parseScopes } from '@gms/domain';

export const CIMD_MAX_BYTES = 5 * 1024;
export const CIMD_TIMEOUT_MS = 5000;

export class CimdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CimdError';
  }
}

function ipv4Private(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** True for any address a server-side fetch must never reach. */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(addr)) return ipv4Private(addr);
  if (!net.isIPv6(addr)) return true;
  if (addr === '::' || addr === '::1') return true;
  const mapped = /^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr) ?? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return ipv4Private(mapped[1]!);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(addr)) return true; // hex-form IPv4-mapped: refuse outright
  const first = parseInt(addr.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (addr.startsWith('64:ff9b:')) return true; // NAT64
  if (addr.startsWith('2001:db8:') || addr.startsWith('2001:0db8:')) return true; // documentation
  if (addr.startsWith('2002:')) return true; // 6to4 can embed private IPv4
  return false;
}

/** Validates a CIMD client_id URL (syntax only). */
export function validateClientIdUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new CimdError('client_id is not a valid URL.');
  }
  if (u.protocol !== 'https:') throw new CimdError('client_id URLs must use https.');
  if (u.username || u.password) throw new CimdError('client_id URLs must not contain credentials.');
  if (u.hash) throw new CimdError('client_id URLs must not contain a fragment.');
  if (u.port && u.port !== '443') throw new CimdError('client_id URLs must use the default https port.');
  if (u.pathname === '/' || u.pathname === '') throw new CimdError('client_id URLs must have a path.');
  if (/(^|\/)\.\.?(\/|$)/.test(u.pathname)) throw new CimdError('client_id URLs must not contain dot segments.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new CimdError('client_id URLs must point to a public host.');
  }
  if ((net.isIP(host) && isPrivateAddress(host)) || !host.includes('.')) throw new CimdError('client_id URLs must point to a public host.');
  return u;
}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, '', 4);
    const list = addresses ?? [];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new CimdError(`Refusing to connect: ${hostname} resolves to a non-public address.`), '', 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
};

/** GETs a CIMD document with every SSRF guard above. */
export function fetchClientMetadataSafely(raw: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<unknown> {
  const url = validateClientIdUrl(raw);
  const timeoutMs = opts.timeoutMs ?? CIMD_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? CIMD_MAX_BYTES;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    const req = https.request(
      url,
      { method: 'GET', headers: { accept: 'application/json', 'user-agent': 'GMS-CIMD/1.0' }, lookup: safeLookup, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return done(new CimdError(`The client metadata document returned HTTP ${res.statusCode} (redirects are not followed).`));
        }
        const type = String(res.headers['content-type'] ?? '');
        if (!/json/i.test(type)) {
          res.resume();
          return done(new CimdError('The client metadata document must be served as JSON.'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            done(new CimdError(`The client metadata document is larger than ${maxBytes} bytes.`));
          } else chunks.push(c);
        });
        res.on('end', () => {
          try {
            done(null, JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
          } catch {
            done(new CimdError('The client metadata document is not valid JSON.'));
          }
        });
        res.on('error', (e) => done(e));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(new CimdError('Timed out fetching the client metadata document.'));
    }, timeoutMs);
    req.on('timeout', () => {
      req.destroy();
      done(new CimdError('Timed out fetching the client metadata document.'));
    });
    req.on('error', (e) => done(e instanceof CimdError ? e : new CimdError(`Could not fetch the client metadata document: ${e.message}`)));
    req.end();
  });
}

/** RFC 8252-aware redirect URI rules shared by DCR and CIMD. */
export function isAllowedRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return isLoopbackHost(u.hostname);
  // Private-use URI schemes for native apps (reverse domain name, RFC 8252 §7.1).
  return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/.test(u.protocol) && !/^(javascript|data|file|vbscript|blob|about):$/.test(u.protocol);
}

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/** Exact match, except that loopback redirect URIs may use any port (RFC 8252 §7.3). */
export function redirectUriMatches(registered: readonly string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;
  let c: URL;
  try {
    c = new URL(candidate);
  } catch {
    return false;
  }
  if (c.protocol !== 'http:' || !isLoopbackHost(c.hostname)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return u.protocol === 'http:' && isLoopbackHost(u.hostname) && u.hostname === c.hostname && u.pathname === c.pathname && u.search === c.search;
    } catch {
      return false;
    }
  });
}

export interface ClientMetadata {
  clientId: string;
  name: string;
  redirectUris: string[];
  logoUri: string | null;
  clientUri: string | null;
  scopes: string[];
}

function optionalHttps(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new CimdError(`${field} must be a string.`);
  try {
    if (new URL(v).protocol === 'https:') return v.slice(0, 500);
  } catch {
    // fall through
  }
  throw new CimdError(`${field} must be an https URL.`);
}

/** Validates a fetched CIMD document for the given client_id URL. */
export function parseClientMetadataDocument(clientId: string, doc: unknown): ClientMetadata {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new CimdError('The client metadata document must be a JSON object.');
  const d = doc as Record<string, unknown>;
  if (d.client_id !== clientId) throw new CimdError('The document’s client_id must equal the URL it was fetched from.');
  if ('client_secret' in d || 'client_secret_expires_at' in d) throw new CimdError('Client metadata documents must not contain a client secret.');
  const auth = d.token_endpoint_auth_method ?? 'none';
  if (auth !== 'none') throw new CimdError('Only public clients (token_endpoint_auth_method "none") can use a client metadata document here.');
  const uris = d.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 20 || !uris.every(isAllowedRedirectUri)) {
    throw new CimdError('redirect_uris must be a non-empty list of https (or loopback http / private-use scheme) URIs.');
  }
  const grants = d.grant_types ?? ['authorization_code'];
  if (!Array.isArray(grants) || !grants.every((g) => g === 'authorization_code' || g === 'refresh_token')) {
    throw new CimdError('grant_types may only contain authorization_code and refresh_token.');
  }
  const name = typeof d.client_name === 'string' && d.client_name.trim() ? d.client_name.trim().slice(0, 100) : new URL(clientId).hostname;
  return {
    clientId,
    name,
    redirectUris: uris as string[],
    logoUri: optionalHttps(d.logo_uri, 'logo_uri'),
    clientUri: optionalHttps(d.client_uri, 'client_uri'),
    scopes: typeof d.scope === 'string' ? parseScopes(d.scope) : [],
  };
}
