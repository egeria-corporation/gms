// SPDX-License-Identifier: AGPL-3.0-only
// API-visible ids. Rows are keyed by UUIDv7; outside the database an id travels as
// `<prefix>_<32 hex digits>` (the UUID without dashes), so a pasted id says what it names.

export const ID_PREFIXES = {
  opportunity: "opp",
  competition: "cmp",
  form: "frm",
  application: "app",
  review: "rev",
  award: "awd",
  agreement: "agr",
  tranche: "trn",
  requirement: "req",
  submission: "sub",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdKind];

const KIND_BY_PREFIX = new Map<string, IdKind>(
  (Object.entries(ID_PREFIXES) as [IdKind, IdPrefix][]).map(([kind, prefix]) => [prefix, kind]),
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_ID_RE = /^([a-z]{3})_([0-9a-f]{32})$/;

export class InvalidIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIdError";
  }
}

/** `toApiId("award", "0190…-…")` → `awd_0190…`. */
export function toApiId(kind: IdKind, uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new InvalidIdError(`toApiId: not a UUID`);
  return `${ID_PREFIXES[kind]}_${uuid.replaceAll("-", "").toLowerCase()}`;
}

/** Parses any prefixed id. Returns null when the string is not a well-formed GMS id. */
export function parseApiId(value: string): { kind: IdKind; uuid: string } | null {
  const m = API_ID_RE.exec(value);
  if (!m) return null;
  const kind = KIND_BY_PREFIX.get(m[1]!);
  if (!kind) return null;
  const h = m[2]!;
  return { kind, uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
}

/**
 * `fromApiId("award", "awd_0190…")` → the UUID. Throws when the id is malformed or names another
 * kind of record, so a tranche id can never be used where an award id is expected.
 */
export function fromApiId(kind: IdKind, value: string): string {
  const parsed = parseApiId(value);
  if (!parsed) throw new InvalidIdError(`expected a ${ID_PREFIXES[kind]}_ id`);
  if (parsed.kind !== kind) throw new InvalidIdError(`expected a ${ID_PREFIXES[kind]}_ id, got ${ID_PREFIXES[parsed.kind]}_`);
  return parsed.uuid;
}

export function isApiId(kind: IdKind, value: unknown): value is string {
  return typeof value === "string" && parseApiId(value)?.kind === kind;
}

/** Milliseconds since the Unix epoch encoded in a UUIDv7 (its first 48 bits), or null for other versions. */
export function uuidV7Timestamp(uuid: string): number | null {
  if (!UUID_RE.test(uuid) || uuid[14] !== "7") return null;
  return Number.parseInt(uuid.replaceAll("-", "").slice(0, 12), 16);
}
