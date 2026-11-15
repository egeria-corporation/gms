// SPDX-License-Identifier: AGPL-3.0-only
// "Request a free migration" (the switch pages). A visitor, signed in or not, asks OpenGrants for
// a free, human-run migration from the system they use today. The preview shows exactly what will
// be sent; sending emails it through the notify/Resend path to CONSULTING_REQUEST_TO (the setting
// and default of the consulting request, reused), with replies going to the person, and sends the
// person a confirmation that carries no free text from the form.
//
// Human only: there is no MCP tool and the route refuses API and agent tokens. Anonymous visitors
// are allowed, so a send needs: the honeypot field empty, a form token the server issued at least
// a few seconds earlier (signed, so the time cannot be made up), and room under the daily limits
// per email address and per network address, counted in KV. KV has no atomic increment, so two
// sends at the same moment can count as one: the limits are a brake, not a quota.
//
// Nothing is stored: no table, no ledger row (there is no workspace). The email to OpenGrants is
// the record. Numbers in the note that look like bank or identity numbers are removed first.
import type { KvPort } from "@gms/mcp";
import { stripSensitiveNumbers } from "@gms/importers";
import { CONSULTING_REQUEST_TO, MIGRATION_NOTE_MAX, cleanLine, cleanText, migrationConfirmationEmail, migrationRequestEmail, type Mailer, type MigrationRequestContent } from "@gms/notify";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";

/** Daily limits and the form's time check: one place to relax them. */
export const MIGRATION_REQUEST_LIMITS = { perEmailPerDay: 3, perAddressPerDay: 20, minSecondsToSubmit: 3, formTokenHours: 24 } as const;

/** The systems the form lists, as on the switch pages (apps/web/src/content/switch.ts), and how each reads in a sentence. */
export const MIGRATION_SYSTEMS = {
  "good-grants": { label: "Good Grants", phrase: "Good Grants" },
  submittable: { label: "Submittable", phrase: "Submittable" },
  "surveymonkey-apply": { label: "SurveyMonkey Apply", phrase: "SurveyMonkey Apply" },
  foundant: { label: "Foundant GLM", phrase: "Foundant GLM" },
  zengine: { label: "Zengine (WizeHive)", phrase: "Zengine" },
  fluxx: { label: "Fluxx", phrase: "Fluxx" },
  smartsimple: { label: "SmartSimple", phrase: "SmartSimple" },
  cybergrants: { label: "Bonterra CyberGrants", phrase: "Bonterra CyberGrants" },
  openwater: { label: "OpenWater", phrase: "OpenWater" },
  spreadsheets: { label: "Spreadsheets, Airtable or GrantHub", phrase: "spreadsheets" },
  other: { label: "Something else", phrase: "your current system" },
} as const;
export type MigrationSystem = keyof typeof MIGRATION_SYSTEMS;

export const MIGRATION_PROGRAMS = { "1": "1", "2-5": "2 to 5", "6-20": "6 to 20", "21+": "More than 20", unsure: "Not sure" } as const;
export const MIGRATION_PAST_AWARDS = { "0-99": "Fewer than 100", "100-999": "100 to 999", "1000-9999": "1,000 to 9,999", "10000+": "10,000 or more", unsure: "Not sure" } as const;
export const MIGRATION_TIMING = { asap: "As soon as possible", "3-months": "In the next 3 months", "6-months": "In 3 to 6 months", "12-months": "In 6 to 12 months", exploring: "Just looking for now" } as const;

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const line = (max: number) => z.string().transform(cleanLine).pipe(z.string().min(1).max(max));

export const migrationRequestInput = z
  .object({
    name: line(200),
    email: z.string().trim().max(320).pipe(z.email()),
    organization: line(200),
    system: z.enum(keys(MIGRATION_SYSTEMS)),
    programs: z.enum(keys(MIGRATION_PROGRAMS)),
    pastAwards: z.enum(keys(MIGRATION_PAST_AWARDS)),
    timing: z.enum(keys(MIGRATION_TIMING)),
    note: z.string().transform(cleanText).pipe(z.string().max(MIGRATION_NOTE_MAX)).optional(),
    /** The form's hidden field. A person never sees it; a send with anything in it is refused. */
    website: z.string().max(500).optional(),
    /** From `GET /gms/migration-requests/form` when the form was shown. Needed to send. */
    formToken: z.string().max(200).optional(),
  })
  .strict();
export type MigrationRequestInput = z.output<typeof migrationRequestInput>;

/** What the service needs: no workspace, no repositories, no actor. */
export interface MigrationRequestContext {
  now: () => Date;
  kv: KvPort;
  mailer: Mailer | null;
  /** RESEND_FROM. */
  mailFrom: string | null;
  /** CONSULTING_REQUEST_TO, or null for the default. */
  requestTo: string | null;
  webBaseUrl: string;
  /** The key the form tokens are signed with. */
  formKey: () => Promise<CryptoKey>;
}

const recipient = (ctx: MigrationRequestContext) => ctx.requestTo?.trim() || CONSULTING_REQUEST_TO;

// ------------------------------------------------------------------------------------ form token

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
const FORM_TOKEN = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;

let cachedKey: { source: string; key: Promise<CryptoKey> } | undefined;
/**
 * An HMAC key for form tokens, derived (HKDF-SHA-256, its own `info`) from the private part of the
 * OAuth signing key, so no new secret is needed and a form token can never be read as an access
 * token: it is not a JWT and is signed with a different key.
 */
export function formKeyFrom(signingKeyJwk: string): Promise<CryptoKey> {
  if (cachedKey?.source === signingKeyJwk) return cachedKey.key;
  const key = (async () => {
    const d = (JSON.parse(signingKeyJwk) as { d?: string }).d;
    if (!d) throw new Error("OAUTH_SIGNING_KEY_JWK must be a private key");
    const base = await crypto.subtle.importKey("raw", fromB64url(d), "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("gms/migration-request-form/v1") }, base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"]);
  })();
  cachedKey = { source: signingKeyJwk, key };
  return key;
}

/** A token that says when the form was shown: `<issued ms, base 36>.<nonce>.<HMAC>`. */
export async function issueFormToken(ctx: Pick<MigrationRequestContext, "now" | "formKey">): Promise<{ formToken: string; minSeconds: number }> {
  const issued = ctx.now().getTime().toString(36);
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await ctx.formKey(), enc.encode(`mrf1.${issued}.${nonce}`)));
  return { formToken: `${issued}.${nonce}.${b64url(sig)}`, minSeconds: MIGRATION_REQUEST_LIMITS.minSecondsToSubmit };
}

/** Seconds since the token was issued; null when it is not one this server signed. */
async function formTokenAge(ctx: Pick<MigrationRequestContext, "now" | "formKey">, token: string): Promise<number | null> {
  const m = FORM_TOKEN.exec(token);
  if (!m) return null;
  const ok = await crypto.subtle.verify("HMAC", await ctx.formKey(), fromB64url(m[3]!), enc.encode(`mrf1.${m[1]}.${m[2]}`));
  return ok ? (ctx.now().getTime() - parseInt(m[1]!, 36)) / 1000 : null;
}

async function checkHuman(ctx: MigrationRequestContext, input: MigrationRequestInput) {
  if (input.website?.trim()) throw new ApiError(422, "not_sent", `This request could not be sent. Write to ${recipient(ctx)} instead`);
  const age = input.formToken ? await formTokenAge(ctx, input.formToken) : null;
  if (age === null || age > MIGRATION_REQUEST_LIMITS.formTokenHours * 3600 || age < -60) throw new ApiError(422, "form_expired", "This form has expired. Reload the page and send it again", [{ code: "form_expired", field: "formToken" }]);
  if (age < MIGRATION_REQUEST_LIMITS.minSecondsToSubmit) throw new ApiError(422, "too_fast", "That was quick. Wait a few seconds, then send it again", [{ code: "too_fast", field: "formToken" }]);
}

// ------------------------------------------------------------------------------------ limits

async function sha256Hex(s: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The KV counters a send uses: the email address by its hash, never the address itself. */
async function counters(ctx: MigrationRequestContext, email: string, address: string | null) {
  const day = ctx.now().toISOString().slice(0, 10);
  return [
    { key: `migration-request:email:${(await sha256Hex(email.toLowerCase())).slice(0, 32)}:${day}`, limit: MIGRATION_REQUEST_LIMITS.perEmailPerDay, code: "too_many_requests_for_email", message: `Up to ${MIGRATION_REQUEST_LIMITS.perEmailPerDay} requests a day can be sent from one email address` },
    { key: `migration-request:address:${address ?? "no-address"}:${day}`, limit: MIGRATION_REQUEST_LIMITS.perAddressPerDay, code: "too_many_requests", message: `Up to ${MIGRATION_REQUEST_LIMITS.perAddressPerDay} requests a day can be sent from one network` },
  ];
}
const TTL = 2 * 86_400;

// ------------------------------------------------------------------------------------ content

function contentOf(input: MigrationRequestInput): MigrationRequestContent {
  const stripped = input.note ? stripSensitiveNumbers(input.note) : { text: "", removed: 0 };
  return {
    name: input.name,
    email: input.email,
    organization: input.organization,
    system: MIGRATION_SYSTEMS[input.system].label,
    programs: MIGRATION_PROGRAMS[input.programs],
    pastAwards: MIGRATION_PAST_AWARDS[input.pastAwards],
    timing: MIGRATION_TIMING[input.timing],
    note: stripped.text || null,
    numbersRemoved: stripped.removed,
  };
}

const pageUrl = (ctx: MigrationRequestContext, system: MigrationSystem) => `${ctx.webBaseUrl}/switch${system === "other" ? "" : `/${system}`}`;

/** Exactly what would be sent, and to whom: the request and the confirmation. Nothing is sent or counted. */
export function previewMigrationRequest(ctx: MigrationRequestContext, input: MigrationRequestInput) {
  const content = contentOf(input);
  const mail = migrationRequestEmail(content);
  const confirmation = migrationConfirmationEmail({ systemPhrase: MIGRATION_SYSTEMS[input.system].phrase, pageUrl: pageUrl(ctx, input.system) });
  return {
    to: recipient(ctx),
    replyTo: content.email,
    subject: mail.subject,
    text: mail.text,
    name: content.name,
    email: content.email,
    organization: content.organization,
    system: input.system,
    systemLabel: content.system,
    programs: input.programs,
    programsLabel: content.programs,
    pastAwards: input.pastAwards,
    pastAwardsLabel: content.pastAwards,
    timing: input.timing,
    timingLabel: content.timing,
    note: content.note,
    numbersRemoved: content.numbersRemoved,
    confirmation: { to: content.email, subject: confirmation.subject, text: confirmation.text },
  };
}

/** Send the request and the confirmation. Checked for a person first, then counted against the limits. */
export async function sendMigrationRequest(ctx: MigrationRequestContext, input: MigrationRequestInput, address: string | null) {
  await checkHuman(ctx, input);
  const { mailer, mailFrom: from } = ctx;
  if (!mailer || !from) throw new ApiError(503, "mail_not_configured", `This server cannot send email, so the request cannot be sent. Write to ${recipient(ctx)} instead`);
  const limits = await counters(ctx, input.email, address);
  const used = await Promise.all(limits.map(async (l) => Number((await ctx.kv.get(l.key)) ?? "0")));
  const over = limits.findIndex((l, i) => used[i]! >= l.limit);
  if (over >= 0) throw new ApiError(429, limits[over]!.code, limits[over]!.message);
  await Promise.all(limits.map((l, i) => ctx.kv.put(l.key, String(used[i]! + 1), { expirationTtl: TTL })));

  const content = contentOf(input);
  const mail = migrationRequestEmail(content);
  const requestId = crypto.randomUUID();
  try {
    await mailer.send({ from, to: [recipient(ctx)], replyTo: content.email, subject: mail.subject, text: mail.text, html: mail.html, idempotencyKey: `migration-request:${requestId}`, tags: [{ name: "kind", value: "migration_request" }] });
  } catch {
    // Give the counts back: nothing went out. (Best effort, like the counting itself.)
    await Promise.all(limits.map(async (l) => ctx.kv.put(l.key, String(Math.max(0, Number((await ctx.kv.get(l.key)) ?? "1") - 1)), { expirationTtl: TTL }))).catch(() => undefined);
    throw new ApiError(502, "mail_failed", "The request could not be sent. Try again in a few minutes");
  }
  const confirmation = migrationConfirmationEmail({ systemPhrase: MIGRATION_SYSTEMS[input.system].phrase, pageUrl: pageUrl(ctx, input.system) });
  let confirmationSent = true;
  try {
    await mailer.send({ from, to: [content.email], replyTo: recipient(ctx), subject: confirmation.subject, text: confirmation.text, html: confirmation.html, idempotencyKey: `migration-confirmation:${requestId}`, tags: [{ name: "kind", value: "migration_confirmation" }] });
  } catch {
    // The request reached OpenGrants; the reply will come all the same.
    confirmationSent = false;
  }
  const sentAt = ctx.now().toISOString();
  // No address and no note in the log: the email to OpenGrants is the record.
  log("info", "migration_request.sent", { requestId, system: input.system, confirmationSent });
  return { sent: true, requestId, sentAt, to: recipient(ctx), replyTo: content.email, confirmationSent, message: `A person at OpenGrants will reply to ${content.email}. Migration help can start right away.` };
}
