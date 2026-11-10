// SPDX-License-Identifier: AGPL-3.0-only
// The Common App profile as Passport serves it to a consented client:
// `GET /passport/orgs/{orgId}/profile` (scope `org:read`) returns confirmed fields only, each with
// its provenance. The GMS turns that list into the `profile.*` object its form prefill mappings and
// eligibility rules read.

/** One profile value with per-field provenance. `path` is a JSON pointer. */
export interface ProfileField {
  path: string;
  value: unknown;
  source: string;
  sourceRef?: string;
  fetchedAt: string;
  confidence: number;
  confirmedAt: string | null;
}

export interface OrgProfile {
  orgId: string;
  handle?: string;
  /** Passport assurance level, L0–L3. */
  level?: string;
  fields: ProfileField[];
  createdAt?: string;
  lastModifiedAt?: string;
}

const unescape = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Fold `fields[]` into one nested object keyed by the pointer segments, so `/commonApp/financials/totalRevenue`
 * becomes `{ commonApp: { financials: { totalRevenue } } }`. Fields whose pointer starts with `/profile/` are
 * unwrapped (Passport uses both spellings for Common App fields). Later fields win; a field that
 * would overwrite a branch with a leaf (or the reverse) is skipped rather than corrupting the tree.
 */
export function profileToObject(fields: readonly Pick<ProfileField, "path" | "value">[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const f of fields) {
    if (typeof f.path !== "string" || !f.path.startsWith("/")) continue;
    let segments = f.path.slice(1).split("/").map(unescape);
    if (segments[0] === "profile") segments = segments.slice(1);
    if (!segments.length || segments.some((s) => s === "" || FORBIDDEN.has(s))) continue;
    let node = root;
    let ok = true;
    for (const s of segments.slice(0, -1)) {
      const next = node[s];
      if (next === undefined) node = node[s] = {};
      else if (typeof next === "object" && next !== null && !Array.isArray(next)) node = next as Record<string, unknown>;
      else {
        ok = false;
        break;
      }
    }
    const leaf = segments[segments.length - 1]!;
    const existing = node[leaf];
    if (!ok || (typeof existing === "object" && existing !== null && !Array.isArray(existing) && (typeof f.value !== "object" || f.value === null))) continue;
    node[leaf] = f.value;
  }
  return root;
}

/** Pointer → source, for provenance display ("From Passport · IRS BMF"). */
export function profileSources(fields: readonly Pick<ProfileField, "path" | "source">[]): Record<string, string> {
  return Object.fromEntries(fields.filter((f) => typeof f.path === "string").map((f) => [f.path, f.source]));
}
