// SPDX-License-Identifier: AGPL-3.0-only
// Mapping executor for CommonGrants `MappingSchema` (`field`, `const`, `switch`).
//  - `mappingFromCommonGrants` is shaped like the form response and reads from the applicant's
//    cached `OrganizationBase` (+ consented Passport profile under `profile`): prefill.
//  - `mappingToCommonGrants` is shaped like the CommonGrants output and reads from the response:
//    project-back at submit.
import { clone, deepEqual, formatPointer, getAt, getPath, isAtOrUnder, isPlainObject, parsePointer, pointerToScope, setAt } from "./pointer.ts";
import { resolveRef } from "./schema-subset.ts";
import { isPrefillSource, type DefinitionError, type FormDefinition, type FormSchema, type Json, type JsonObject, type MappingFunction, type MappingSchema, type Provenance } from "./types.ts";
import { schemaAtScope } from "./ui-schema.ts";
import { effectiveSchema } from "./validate.ts";
import { isMoney, type Money } from "./widgets.ts";

export function isMappingFunction(node: unknown): node is MappingFunction {
  if (!isPlainObject(node)) return false;
  const keys = Object.keys(node);
  if (keys.length !== 1) return false;
  if (keys[0] === "field") return typeof node.field === "string";
  if (keys[0] === "const") return true;
  if (keys[0] === "switch") {
    const sw = node.switch;
    return isPlainObject(sw) && typeof sw.field === "string" && isPlainObject(sw.case);
  }
  return false;
}

export function evaluateMappingFunction(fn: MappingFunction, source: unknown): Json | undefined {
  if ("field" in fn) return clone(getPath(source, fn.field));
  if ("const" in fn) return clone(fn.const);
  const v = getPath(source, fn.switch.field);
  const key = v === undefined || v === null ? undefined : String(v);
  const hit = key !== undefined && Object.prototype.hasOwnProperty.call(fn.switch.case, key) ? fn.switch.case[key] : fn.switch.default;
  return clone(hit);
}

export interface MappingLeaf {
  /** JSON pointer of the leaf in the mapping's output. */
  path: string;
  value: Json;
}

/** Runs a mapping. Leaves that resolve to undefined are omitted from the output. */
export function applyMapping(mapping: MappingSchema | undefined, source: unknown): { value: JsonObject; leaves: MappingLeaf[] } {
  const value: JsonObject = {};
  const leaves: MappingLeaf[] = [];
  const walk = (node: MappingSchema, segs: string[]) => {
    for (const [key, child] of Object.entries(node)) {
      const path = [...segs, key];
      if (isMappingFunction(child)) {
        const v = evaluateMappingFunction(child, source);
        if (v !== undefined) {
          setAt(value, path, v);
          leaves.push({ path: formatPointer(path), value: v });
        }
      } else if (isPlainObject(child)) walk(child as MappingSchema, path);
    }
  };
  if (mapping) walk(mapping, []);
  return { value, leaves };
}

/** The object prefill mappings read from: the CG organization with the Passport profile under `profile`. */
export function buildPrefillSource(org: JsonObject, profile?: JsonObject | null): JsonObject {
  return profile ? { ...org, profile } : { ...org };
}

/** Pointers of fields rendered with the `passportField` widget (read-only, always follow Passport). */
export function passportFieldPaths(form: Pick<FormDefinition, "jsonSchema" | "uiSchema">): string[] {
  const root = effectiveSchema(form);
  const out: string[] = [];
  const walk = (node: FormSchema | undefined, segs: string[], depth: number) => {
    if (!node || depth > 32) return;
    const n = node.$ref ? resolveRef(root, node.$ref) ?? node : node;
    if (n["x-widget"] === "passportField") {
      out.push(formatPointer(segs));
      return;
    }
    for (const [k, v] of Object.entries(n.properties ?? {})) walk(v, [...segs, k], depth + 1);
  };
  walk(root, [], 0);
  return out;
}

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0);

export interface PrefillResult {
  response: JsonObject;
  provenance: Provenance;
  /** Paths written from Passport on this run. */
  applied: string[];
  /** Paths left alone because the applicant (or another source) had already entered a value. */
  skipped: string[];
}

/**
 * Prefill at `start` and on explicit refresh. A value is written when the field is empty, was itself
 * prefilled from Passport earlier, or is a `passportField`. Values entered by a user, an agent, the
 * answer library or a prior submission are never overwritten.
 */
export function prefill(
  form: Pick<FormDefinition, "jsonSchema" | "uiSchema" | "mappingFromCommonGrants">,
  source: unknown,
  current: { response?: JsonObject | null; provenance?: Provenance | null } = {},
  /** `self_declared`: the source is a profile the organization entered itself; nothing is locked to it. */
  opts: { as?: "passport" | "self_declared" } = {},
): PrefillResult {
  const tag = opts.as ?? "passport";
  const response = clone(current.response ?? {});
  const provenance: Provenance = { ...(current.provenance ?? {}) };
  const locked = tag === "passport" ? passportFieldPaths(form) : [];
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const leaf of applyMapping(form.mappingFromCommonGrants, source).leaves) {
    const segs = parsePointer(leaf.path);
    const existing = getAt(response, segs);
    const fromPassport = isPrefillSource(provenance[leaf.path]);
    const isLocked = locked.some((l) => isAtOrUnder(leaf.path, l));
    const touchedBelow = Object.entries(provenance).some(([p, src]) => p !== leaf.path && isAtOrUnder(p, leaf.path) && !isPrefillSource(src));
    if (!isLocked && ((!isBlank(existing) && !fromPassport) || touchedBelow)) {
      skipped.push(leaf.path);
      continue;
    }
    if (!deepEqual(existing, leaf.value) || !fromPassport) applied.push(leaf.path);
    setAt(response, segs, leaf.value);
    provenance[leaf.path] = tag;
  }
  return { response, provenance, applied, skipped };
}

/** Project-back at submit: the CommonGrants-shaped object produced by `mappingToCommonGrants`. */
export function projectToCommonGrants(form: Pick<FormDefinition, "mappingToCommonGrants">, response: unknown): JsonObject {
  return applyMapping(form.mappingToCommonGrants, response).value;
}

export interface SubmissionFields {
  title?: string;
  requestedAmount?: Money;
  applicantType?: string;
  customFields?: JsonObject;
}

/** Picks the fields the GMS stamps on the application at submit out of a projection. */
export function extractSubmissionFields(projected: JsonObject): SubmissionFields {
  const out: SubmissionFields = {};
  const title = projected.name ?? projected.title;
  if (typeof title === "string" && title.trim() !== "") out.title = title;
  const custom = isPlainObject(projected.customFields) ? projected.customFields : undefined;
  const nested = custom && isPlainObject(custom.requestedAmount) ? custom.requestedAmount.value : undefined;
  const amount = [projected.requestedAmount, nested, custom?.requestedAmount].find((v) => isMoney(v));
  if (isMoney(amount)) out.requestedAmount = amount;
  const applicant = isPlainObject(projected.applicant) ? projected.applicant.type : undefined;
  const type = projected.applicantType ?? applicant;
  if (typeof type === "string") out.applicantType = type;
  if (custom) out.customFields = custom;
  return out;
}

/** Save-time check: prefill targets and project-back sources must be fields of the form. */
export function validateMappings(form: Pick<FormDefinition, "jsonSchema" | "mappingFromCommonGrants" | "mappingToCommonGrants">): DefinitionError[] {
  const errors: DefinitionError[] = [];
  // A target is in the form when it is a declared field, or sits inside a declared object that
  // does not enumerate its properties (widget values such as an address).
  const inForm = (pointer: string): boolean => {
    const segs = parsePointer(pointer);
    for (let n = segs.length; n > 0; n--) {
      const node = schemaAtScope(form.jsonSchema, pointerToScope(formatPointer(segs.slice(0, n))));
      if (node) return n === segs.length || (node.type === "object" && !node.properties);
    }
    return false;
  };
  const walk = (node: unknown, segs: string[], which: "mappingFromCommonGrants" | "mappingToCommonGrants") => {
    if (!isPlainObject(node)) {
      errors.push({ path: `${which}${formatPointer(segs)}`, message: "must be a mapping function or a nested mapping" });
      return;
    }
    if (isMappingFunction(node)) {
      if (which === "mappingFromCommonGrants") {
        if (!inForm(formatPointer(segs))) errors.push({ path: `${which}${formatPointer(segs)}`, message: "does not match a field in the form" });
      } else {
        const fn: MappingFunction = node;
        const src = "field" in fn ? fn.field : "switch" in fn ? fn.switch.field : null;
        const pointer = src === null ? null : src.startsWith("/") ? src : "/" + src.split(".").join("/");
        if (pointer !== null && !inForm(pointer)) errors.push({ path: `${which}${formatPointer(segs)}`, message: `reads "${src}", which is not a field in the form` });
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, [...segs, k], which);
  };
  for (const which of ["mappingFromCommonGrants", "mappingToCommonGrants"] as const) {
    const m = form[which];
    if (m === undefined || m === null) continue;
    if (!isPlainObject(m)) errors.push({ path: which, message: "must be an object" });
    else for (const [k, v] of Object.entries(m)) walk(v, [k], which);
  }
  return errors;
}

export interface PrefillPath {
  path: string;
  label: string;
  source: "organization" | "profile";
}

/**
 * The paths the builder's prefill picker offers (§10.2), relative to the prefill source
 * (`buildPrefillSource`): the organization as Passport serves it in CommonGrants v0.5.0
 * `OrganizationBase` shape, with the Common App profile under `profile`.
 *
 * - Organization paths follow `OrganizationBase`: identifiers are `{ id }` objects keyed by registry
 *   code, `orgType` is a PCS term (`term`, `code`), addresses use `stateOrProvince`, phones are
 *   `{ countryCode, number }`, custom fields wrap their value.
 * - Profile paths follow Passport's profile field pointers (`/commonApp/...`), which the API folds
 *   into an object with `profileToObject`. They need the applicant's `org:read` grant, and Passport
 *   serves only values the organization has confirmed.
 *
 * Eligibility rules read the same data as `org.<organization path>` and `profile.<path after "profile.">`.
 */
export const PREFILL_PATHS: readonly PrefillPath[] = [
  { path: "name", label: "Organization name", source: "organization" },
  { path: "identifiers.org:us:ein.id", label: "EIN", source: "organization" },
  { path: "orgType.term", label: "Organization type", source: "organization" },
  { path: "orgType.code", label: "Organization type (PCS code)", source: "organization" },
  { path: "status.value", label: "Organization status", source: "organization" },
  { path: "addresses.primary.street1", label: "Primary address: street", source: "organization" },
  { path: "addresses.primary.street2", label: "Primary address: street line 2", source: "organization" },
  { path: "addresses.primary.city", label: "Primary address: city", source: "organization" },
  { path: "addresses.primary.stateOrProvince", label: "Primary address: state", source: "organization" },
  { path: "addresses.primary.postalCode", label: "Primary address: postal code", source: "organization" },
  { path: "addresses.primary.country", label: "Primary address: country", source: "organization" },
  { path: "phones.primary.number", label: "Primary phone", source: "organization" },
  { path: "emails.primary", label: "Primary email", source: "organization" },
  { path: "mission", label: "Mission", source: "organization" },
  { path: "yearFounded", label: "Year founded", source: "organization" },
  { path: "socials.website", label: "Website", source: "organization" },
  { path: "customFields.verificationLevel.value", label: "Passport verification level", source: "organization" },
  { path: "customFields.verifiedAt.value", label: "Passport verified at", source: "organization" },
  { path: "customFields.attestation.value", label: "Passport attestation", source: "organization" },
  { path: "profile.commonApp.financials.budget", label: "Annual budget", source: "profile" },
  { path: "profile.commonApp.fiscalYearEnd", label: "Fiscal year end (MM-DD)", source: "profile" },
  { path: "profile.commonApp.staffCount", label: "Staff count", source: "profile" },
  { path: "profile.commonApp.financials.totalRevenue", label: "Total revenue", source: "profile" },
  { path: "profile.commonApp.financials.totalExpenses", label: "Total expenses", source: "profile" },
  { path: "profile.commonApp.financials.netAssets", label: "Net assets", source: "profile" },
  { path: "profile.commonApp.irs.subsection", label: "IRS 501(c) subsection code", source: "profile" },
  { path: "profile.commonApp.irs.ntee", label: "NTEE code", source: "profile" },
];
