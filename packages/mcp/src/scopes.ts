// SPDX-License-Identifier: AGPL-3.0-only
// The GMS scope vocabulary (build spec §9). Tokens carry a subset; every tool declares exactly one.

export const SCOPES = [
  "workspace:admin",
  "programs:read",
  "programs:write",
  "opportunities:read",
  "opportunities:write",
  "competitions:read",
  "competitions:write",
  "forms:read",
  "forms:write",
  "applications:read",
  "applications:write",
  "applications:submit",
  "reviews:read",
  "reviews:write",
  "decisions:write",
  "awards:read",
  "awards:write",
  "agreements:write",
  "payments:read",
  "payments:release",
  "requirements:read",
  "requirements:write",
  "grantees:read",
  "grantees:write",
  "messages:read",
  "messages:write",
  "communications:write",
  "analytics:read",
  "discovery",
  "library:read",
  "library:write",
  "org:read",
  "assist",
] as const;
export type Scope = (typeof SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set(SCOPES);
export function isScope(value: string): value is Scope {
  return SCOPE_SET.has(value);
}

/** A token satisfies `required` when it holds it exactly, or holds `x:write` and `x:read` is required. */
export function hasScope(granted: readonly string[], required: Scope): boolean {
  if (granted.includes(required)) return true;
  if (required.endsWith(":read")) return granted.includes(`${required.slice(0, -":read".length)}:write`);
  return false;
}
