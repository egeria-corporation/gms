// SPDX-License-Identifier: AGPL-3.0-only
// Structured logging with redaction. Request and response bodies are never logged. Credentials and
// anything named like bank or identity data are replaced before they reach the console.

const CREDENTIAL_KEY = /(secret|token|password|passwd|authorization|cookie|jwk|private|api[_-]?key|signature|verifier|^code$|assertion|credential)/i;
// The GMS must never hold these at all (CLAUDE.md). If one ever reaches a log call it is a bug upstream; drop it here too.
const BANK_OR_IDENTITY_KEY = /(routing|account[\s_-]*(number|num|no)|iban|ssn|social[\s_-]*security|birth|dob|government[\s_-]*id|passport[\s_-]*(number|num|no)|tax[\s_-]*id)/i;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// Client secrets, refresh tokens, codes, invitation links (workspace and direct-award) and webhook
// secrets. No word boundary before the prefix: inside an encoded URL one follows `%3D` directly.
const OPAQUE = /(gms_(?:cs|rt|ac|inv|awi)_|whsec_)[A-Za-z0-9_-]{8,}/g;
const REDACTED = "[REDACTED]";

export function redactString(s: string): string {
  return s.replace(JWT_LIKE, REDACTED).replace(BEARER, `$1 ${REDACTED}`).replace(OPAQUE, `$1${REDACTED}`);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[…]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = CREDENTIAL_KEY.test(k) || BANK_OR_IDENTITY_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    return out;
  }
  return value;
}

/** Path plus query parameter names only; values may carry identifiers we do not want in logs. */
export function loggablePath(url: string): string {
  const u = new URL(url);
  const keys = [...new Set(u.searchParams.keys())];
  return keys.length ? `${u.pathname}?${keys.map((k) => `${k}=…`).join("&")}` : u.pathname;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSink = (line: string, level: LogLevel) => void;

/* eslint-disable no-console -- this module is the one sanctioned console writer */
const consoleSink: LogSink = (line, level) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};
/* eslint-enable no-console */

let sink: LogSink = consoleSink;

/** Tests swap the sink to capture output. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? consoleSink;
}

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  sink(JSON.stringify({ level, msg: redactString(msg), ...(redact(fields) as object), t: new Date().toISOString() }), level);
}
