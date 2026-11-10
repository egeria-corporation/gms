// SPDX-License-Identifier: AGPL-3.0-only
// API-visible ids on /gms routes carry a human prefix; /common-grants routes use the bare UUID.

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

export const prefixedId = (kind: IdKind, uuid: string): string => `${ID_PREFIXES[kind]}_${uuid}`;

/** Accepts `awd_<uuid>` or a bare UUID and returns the UUID; null when it is neither or the prefix is for another kind. */
export function parseId(kind: IdKind, value: string): string | null {
  const prefix = `${ID_PREFIXES[kind]}_`;
  const bare = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return isUuid(bare) ? bare.toLowerCase() : null;
}
