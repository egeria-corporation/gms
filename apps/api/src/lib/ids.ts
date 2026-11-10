// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes speak prefixed ids (`opp_<uuid>`); /common-grants routes speak bare UUIDs. Both
// prefixed spellings in the codebase are accepted on input: `opp_<uuid>` and `opp_<32 hex>`.
import { parseApiId } from "@gms/db";
import { isUuid, parseId, prefixedId, type IdKind } from "@gms/protocol";
import { notFound } from "./errors.ts";

export const apiId = (kind: IdKind, uuid: string): string => prefixedId(kind, uuid);

/** The UUID behind an id from a path or body; 404 when it is not an id of this kind. */
export function uuidOf(kind: IdKind, value: string | undefined, what: string): string {
  if (value) {
    const direct = parseId(kind, value);
    if (direct) return direct;
    const compact = parseApiId(value);
    if (compact && compact.kind === kind) return compact.uuid;
  }
  throw notFound(what);
}

/** A bare UUID (workspaces, programs, rubrics, users have no prefix); 404 otherwise. */
export function bareUuid(value: string | undefined, what: string): string {
  if (value && isUuid(value)) return value.toLowerCase();
  throw notFound(what);
}
