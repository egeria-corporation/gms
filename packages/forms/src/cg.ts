// SPDX-License-Identifier: AGPL-3.0-only
// CommonGrants mapping: well-known paths, prefill from an applicant profile, and CG export/import.
import { parseMoneyToCents } from '@gms/domain';
import type { CgTransform, CompiledForm } from './compile';
import type { FieldType } from './model';
import { getPath, isEmptyValue, isPlainObject, pruneEmpty, type ResponseData, setPath } from './util';

/** The shape a CommonGrants value takes at a path. */
export type CgValueType = 'string' | 'text' | 'money' | 'date' | 'name' | 'address' | 'email' | 'phone' | 'ein' | 'uei' | 'url' | 'integer' | 'number' | 'string[]';

export interface CgPathInfo {
  path: string;
  label: string;
  type: CgValueType;
  /** Builder field types that fit this path. */
  fieldTypes: readonly FieldType[];
  /** Lowercase phrases that suggest a question fits this path (used by the linter and builder). */
  keywords: readonly string[];
  /** True when the value identifies the applicant (a hint for blind review). */
  identifying?: boolean;
}

/** Well-known CommonGrants-style paths GMS understands for prefill and export. */
export const CG_PATHS: readonly CgPathInfo[] = [
  { path: 'organization.name', label: 'Organization legal name', type: 'string', fieldTypes: ['text'], keywords: ['legal name', 'organization name', 'organization’s name', "organization's name", 'name of your organization', 'org name'], identifying: true },
  { path: 'organization.ein', label: 'Employer Identification Number (EIN)', type: 'ein', fieldTypes: ['ein', 'text'], keywords: ['ein', 'employer identification', 'tax id', 'federal tax'] },
  { path: 'organization.uei', label: 'Unique Entity ID (UEI)', type: 'uei', fieldTypes: ['uei', 'text'], keywords: ['uei', 'unique entity'] },
  { path: 'organization.mission', label: 'Mission statement', type: 'text', fieldTypes: ['long_text', 'rich_text', 'text'], keywords: ['mission'] },
  { path: 'organization.annualBudget', label: 'Annual operating budget', type: 'money', fieldTypes: ['currency'], keywords: ['annual budget', 'operating budget', 'organization budget', 'organizational budget'] },
  { path: 'organization.address', label: 'Mailing address', type: 'address', fieldTypes: ['address'], keywords: ['mailing address', 'organization address', 'street address', 'address'], identifying: true },
  { path: 'organization.website', label: 'Website', type: 'url', fieldTypes: ['text'], keywords: ['website', 'web site', 'url'], identifying: true },
  { path: 'organization.phone', label: 'Organization phone', type: 'phone', fieldTypes: ['phone', 'text'], keywords: ['organization phone', 'main phone'], identifying: true },
  { path: 'organization.email', label: 'Organization email', type: 'email', fieldTypes: ['email', 'text'], keywords: ['organization email', 'general email'], identifying: true },
  { path: 'organization.type', label: 'Organization type', type: 'string', fieldTypes: ['select', 'text'], keywords: ['organization type', 'type of organization', 'legal status'] },
  { path: 'organization.yearFounded', label: 'Year founded', type: 'integer', fieldTypes: ['number'], keywords: ['year founded', 'founded'] },
  { path: 'organization.fiscalSponsor.name', label: 'Fiscal sponsor name', type: 'string', fieldTypes: ['text'], keywords: ['fiscal sponsor name', 'sponsor name', 'sponsor’s name', "sponsor's name"], identifying: true },
  { path: 'organization.fiscalSponsor.ein', label: 'Fiscal sponsor EIN', type: 'ein', fieldTypes: ['ein', 'text'], keywords: ['sponsor ein', 'sponsor’s ein', "sponsor's ein"] },
  { path: 'contact.name', label: 'Primary contact name', type: 'name', fieldTypes: ['name'], keywords: ['contact name', 'primary contact', 'your name'], identifying: true },
  { path: 'contact.title', label: 'Primary contact job title', type: 'string', fieldTypes: ['text'], keywords: ['job title', 'contact title', 'your title'] },
  { path: 'contact.email', label: 'Primary contact email', type: 'email', fieldTypes: ['email', 'text'], keywords: ['contact email', 'email address', 'email'], identifying: true },
  { path: 'contact.phone', label: 'Primary contact phone', type: 'phone', fieldTypes: ['phone', 'text'], keywords: ['contact phone', 'phone number', 'phone'], identifying: true },
  { path: 'project.title', label: 'Project title', type: 'string', fieldTypes: ['text'], keywords: ['project title', 'project name', 'title of your project'] },
  { path: 'project.summary', label: 'Project summary', type: 'text', fieldTypes: ['long_text', 'rich_text', 'text'], keywords: ['project summary', 'summary', 'project description', 'describe your project'] },
  { path: 'project.startDate', label: 'Project start date', type: 'date', fieldTypes: ['date'], keywords: ['start date', 'project start'] },
  { path: 'project.endDate', label: 'Project end date', type: 'date', fieldTypes: ['date'], keywords: ['end date', 'project end'] },
  { path: 'project.beneficiaryCount', label: 'People served', type: 'integer', fieldTypes: ['number'], keywords: ['number of youth', 'youth served', 'people served', 'number served', 'participants'] },
  { path: 'funding.requestedAmount', label: 'Amount requested', type: 'money', fieldTypes: ['currency'], keywords: ['request amount', 'requested amount', 'amount requested', 'how much', 'grant request', 'amount you are requesting'] },
  { path: 'funding.totalProjectCost', label: 'Total project cost', type: 'money', fieldTypes: ['currency'], keywords: ['total project cost', 'total project budget', 'project budget', 'total cost'] },
];

const CG_BY_PATH = new Map(CG_PATHS.map((p) => [p.path, p]));

export function cgPathInfo(path: string): CgPathInfo | undefined {
  return CG_BY_PATH.get(path);
}

/** Which transform turns a field's answer into the CG value at `path`. */
export function cgTransformFor(fieldType: FieldType, path: string): CgTransform {
  const info = CG_BY_PATH.get(path);
  if (fieldType === 'currency' && (!info || info.type === 'money')) return 'money';
  if (fieldType === 'name' && (!info || info.type === 'name')) return 'name';
  if (fieldType === 'address' && (!info || info.type === 'address')) return 'address';
  return 'identity';
}

/**
 * Suggests a well-known CG path for a question, from its label and type.
 * Returns undefined when nothing fits well.
 */
export function suggestCgPath(field: { label: string; type: FieldType }): CgPathInfo | undefined {
  const label = field.label.toLowerCase();
  let best: { info: CgPathInfo; score: number } | undefined;
  for (const info of CG_PATHS) {
    if (!info.fieldTypes.includes(field.type)) continue;
    for (const kw of info.keywords) {
      const re = new RegExp(`(^|[^a-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
      if (!re.test(label)) continue;
      // Longer keyword matches are more specific; the preferred field type wins ties.
      const score = kw.length * 10 + (info.fieldTypes[0] === field.type ? 5 : 0);
      if (!best || score > best.score) best = { info, score };
    }
  }
  return best?.info;
}

// ---------------------------------------------------------------------------
// Value transforms
// ---------------------------------------------------------------------------

export interface CgMoney {
  amount: string;
  currency: string;
}

function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function toCgValue(value: unknown, transform: CgTransform, currency: string): unknown {
  switch (transform) {
    case 'money':
      return typeof value === 'number' ? { amount: centsToAmount(value), currency } : undefined;
    case 'name':
      if (!isPlainObject(value)) return undefined;
      return pruneEmpty({ firstName: value.first, lastName: value.last });
    case 'address':
      if (!isPlainObject(value)) return undefined;
      return pruneEmpty({
        street1: value.line1,
        street2: value.line2,
        city: value.city,
        stateOrProvince: value.state,
        postalCode: value.postal,
        county: value.county,
        country: 'US',
      });
    case 'identity':
      return value;
  }
}

function fromCgValue(value: unknown, transform: CgTransform): unknown {
  switch (transform) {
    case 'money': {
      if (typeof value === 'number') return Math.round(value * 100);
      if (isPlainObject(value)) {
        const amount = value.amount;
        if (typeof amount === 'string' || typeof amount === 'number') return parseMoneyToCents(amount) ?? undefined;
      }
      if (typeof value === 'string') return parseMoneyToCents(value) ?? undefined;
      return undefined;
    }
    case 'name':
      if (!isPlainObject(value)) return undefined;
      return pruneEmpty({ first: value.firstName, last: value.lastName });
    case 'address':
      if (!isPlainObject(value)) return undefined;
      return pruneEmpty({
        line1: value.street1,
        line2: value.street2,
        city: value.city,
        state: value.stateOrProvince,
        postal: value.postalCode,
        county: value.county,
      });
    case 'identity':
      return value;
  }
}

// ---------------------------------------------------------------------------
// Profile prefill and CG round trip
// ---------------------------------------------------------------------------

/**
 * A CommonGrants-shaped applicant profile, e.g.
 * `{ organization: { name, ein, annualBudget: { amount, currency } }, contact: { name: { firstName, lastName }, email } }`.
 */
export type CgProfile = Record<string, unknown>;

/** Converts a CommonGrants-shaped object into form data for every mapped field that has a value. */
export function fromCommonGrants(compiled: CompiledForm, cg: CgProfile): ResponseData {
  const out: ResponseData = {};
  for (const [fieldId, entry] of Object.entries(compiled.mappingToCg)) {
    const raw = getPath(cg, entry.path);
    if (isEmptyValue(raw)) continue;
    const v = fromCgValue(raw, entry.transform);
    if (!isEmptyValue(v)) out[fieldId] = v;
  }
  return out;
}

/**
 * Answers to prefill from the applicant's saved profile. Only fields that are still empty in
 * `current` are returned, so prefill never overwrites what the applicant typed.
 */
export function prefillFromProfile(compiled: CompiledForm, profile: CgProfile, current: ResponseData = {}): ResponseData {
  const all = fromCommonGrants(compiled, profile);
  const out: ResponseData = {};
  for (const [k, v] of Object.entries(all)) if (isEmptyValue(current[k])) out[k] = v;
  return out;
}

/** Builds a CommonGrants-shaped object from form data, following `mappingToCg`. */
export function toCommonGrants(compiled: CompiledForm, data: ResponseData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [fieldId, entry] of Object.entries(compiled.mappingToCg)) {
    const value = data[fieldId];
    if (isEmptyValue(value)) continue;
    const currency = compiled.fieldMeta[fieldId]?.currency ?? 'USD';
    const v = toCgValue(value, entry.transform, currency);
    if (!isEmptyValue(v)) setPath(out, entry.path, v);
  }
  return out;
}

