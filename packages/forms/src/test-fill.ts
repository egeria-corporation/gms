// SPDX-License-Identifier: AGPL-3.0-only
// Test-fill: a realistic, valid response generated from a form, for previews and tests.
// Deterministic for a given seed. Fictional data only.
import { getPath, isPlainObject } from "./pointer.ts";
import { resolveRef } from "./schema-subset.ts";
import type { FormDefinition, FormSchema, Json, JsonObject } from "./types.ts";
import { evaluateUi } from "./ui-schema.ts";
import { effectiveSchema, validateAgainstSchema } from "./validate.ts";
import { fromMinor, isMoney, toMinor } from "./widgets.ts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = "families clinic rural outreach navigators county partners training mobile health access program community services staff measure visits enrollment referrals quarterly outcomes".split(" ");
const ORGS = ["Alder Creek Family Services", "Harbor Light Community Clinic", "Juniper Ridge Youth Alliance", "Maple Hollow Food Bank"];
const PEOPLE = ["Maria Santos", "Jamal Reed", "Lena Fischer", "Priya Natarajan"];
const CITIES = ["Riverbend", "Cascade Falls", "Alder Creek", "Juniper Ridge"];

export interface TestFillOptions {
  seed?: number;
  /** Fill optional fields too (default true). */
  includeOptional?: boolean;
}

export function testFill(form: Pick<FormDefinition, "jsonSchema" | "uiSchema">, opts: TestFillOptions = {}): JsonObject {
  const root = effectiveSchema(form);
  const rand = mulberry32(opts.seed ?? 1);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const words = (n: number) => {
    const out = Array.from({ length: n }, () => pick(WORDS)).join(" ");
    return out.charAt(0).toUpperCase() + out.slice(1);
  };
  const later: (() => void)[] = [];
  let result: JsonObject = {};

  const text = (s: FormSchema, key: string): string => {
    if (typeof s.default === "string") return s.default;
    if (typeof s.examples?.[0] === "string") return s.examples[0];
    const wc = s["x-wordCount"];
    let v: string;
    if (wc) v = words(Math.max(wc.min ?? 1, Math.min(wc.max ?? 40, (wc.min ?? 1) + 8)));
    else if (/name/i.test(key) && /org|legal|applicant/i.test(key)) v = pick(ORGS);
    else if (/name|contact|signer/i.test(key)) v = pick(PEOPLE);
    else if (/city/i.test(key)) v = pick(CITIES);
    else if (/title/i.test(key)) v = words(4);
    else v = words(int(6, 14)) + ".";
    if (s.maxLength !== undefined && [...v].length > s.maxLength) v = [...v].slice(0, s.maxLength).join("").trimEnd() || "x".repeat(Math.min(1, s.maxLength));
    while (s.minLength !== undefined && [...v].length < s.minLength) v += " " + pick(WORDS);
    if (s.maxLength !== undefined && [...v].length > s.maxLength) v = [...v].slice(0, s.maxLength).join("");
    return v;
  };

  const widget = (s: FormSchema, path: string, key: string): Json => {
    const o = s["x-widgetOptions"] ?? {};
    switch (s["x-widget"]) {
      case "money":
        return { amount: `${int(10, 250) * 1000}.00`, currency: o.currency ?? "USD" };
      case "fileRef":
        return { documentId: `doc_${int(100000, 999999)}`, name: `${key}.pdf` };
      case "richText":
        return `<p>${words(int(12, 24))}.</p>`;
      case "signature":
        return { name: pick(PEOPLE), attested: true };
      case "address":
        return { line1: `${int(100, 999)} Main Street`, city: pick(CITIES), region: "CA", postalCode: "95000", country: "US" };
      case "phone":
        return "+1 555 010 " + String(int(1000, 9999));
      case "passportField":
        return s.type === "number" || s.type === "integer" ? int(1, 50) : s.type === "boolean" ? true : pick(ORGS);
      case "budgetTable": {
        const categories = o.categories?.length ? o.categories : ["Personnel", "Program costs", "Indirect"];
        const currency = o.currency ?? "USD";
        const rows = categories.map((category) => ({ category, amount: { amount: `${int(1, 9) * 100}.00`, currency }, notes: words(3) }));
        later.push(() => {
          let max: number | null = o.maxTotal !== undefined ? toMinor(o.maxTotal) : null;
          const ref = o.maxTotalPath !== undefined ? getPath(result, o.maxTotalPath) : undefined;
          const refAmount = isMoney(ref) ? ref.amount : typeof ref === "number" ? String(ref) : typeof ref === "string" ? ref : null;
          if (refAmount !== null && /^\d+(\.\d+)?$/.test(refAmount)) max = max === null ? toMinor(refAmount) : Math.min(max, toMinor(refAmount));
          if (max === null) return;
          const share = Math.floor(max / rows.length / 100) * 100;
          const live = getPath(result, path);
          if (Array.isArray(live)) {
            for (const row of live) if (isPlainObject(row) && isMoney(row.amount)) row.amount = { amount: fromMinor(share), currency: row.amount.currency };
          }
        });
        return rows;
      }
      default:
        return null;
    }
  };

  const gen = (schema: FormSchema, path: string, key: string, depth: number): Json => {
    const s = schema.$ref ? resolveRef(root, schema.$ref) ?? schema : schema;
    if (depth > 16) return null;
    if (s.const !== undefined) return s.const;
    if (s.enum?.length) return pick(s.enum);
    if (s["x-widget"]) return widget(s, path, key);
    switch (s.type) {
      case "string":
        switch (s.format) {
          case "email":
            return `${pick(["grants", "info", "programs"])}@${pick(["aldercreek", "harborlight", "juniperridge"])}.example`;
          case "uri":
            return `https://${pick(["aldercreek", "harborlight", "juniperridge"])}.example`;
          case "date":
            return `2027-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
          case "date-time":
            return `2027-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}T${String(int(8, 17)).padStart(2, "0")}:00:00Z`;
          case "phone":
            return "+1 555 010 " + String(int(1000, 9999));
          default:
            return text(s, key);
        }
      case "integer":
      case "number": {
        const min = s.minimum ?? 0;
        const max = s.maximum ?? Math.max(min + 100, 100);
        const v = min + rand() * (max - min);
        return s.type === "integer" ? Math.min(Math.floor(max), Math.max(Math.ceil(min), Math.round(v))) : Math.round(v * 100) / 100;
      }
      case "boolean":
        return rand() < 0.5;
      case "array": {
        const item = s.items ? (s.items.$ref ? resolveRef(root, s.items.$ref) ?? s.items : s.items) : undefined;
        if (!item) return [];
        const min = s.minItems ?? 1;
        if (item.type === "string" && item.enum) {
          const n = Math.max(min, Math.min(s.maxItems ?? item.enum.length, item.enum.length, min || 1, 2));
          return item.enum.slice(0, Math.max(n, min));
        }
        const n = Math.max(min, Math.min(s.maxItems ?? 2, 2));
        return Array.from({ length: n }, (_, i) => gen(item, `${path}/${i}`, key, depth + 1));
      }
      case "object":
      default: {
        const out: JsonObject = {};
        const required = new Set(s.required ?? []);
        for (const [k, sub] of Object.entries(s.properties ?? {})) {
          if (!required.has(k) && opts.includeOptional === false) continue;
          out[k] = gen(sub, `${path}/${k}`, k, depth + 1);
        }
        applyConditional(s, out, path, depth);
        return out;
      }
    }
  };

  const applyConditional = (s: FormSchema, out: JsonObject, path: string, depth: number) => {
    if (!s.if) return;
    const branch = validateAgainstSchema(s.if, out, root, out).length === 0 ? s.then : s.else;
    if (!branch) return;
    const req = new Set(branch.required ?? []);
    for (const [k, sub] of Object.entries(branch.properties ?? {})) {
      const base = s.properties?.[k];
      const merged: FormSchema = { ...(base ?? {}), ...sub };
      if (out[k] === undefined || validateAgainstSchema(merged, out[k], root, out).length > 0) out[k] = gen(merged, `${path}/${k}`, k, depth + 1);
    }
    for (const k of req) {
      if (out[k] === undefined) {
        const base = s.properties?.[k];
        out[k] = base ? gen(base, `${path}/${k}`, k, depth + 1) : words(3);
      }
    }
    applyConditional(branch, out, path, depth);
  };

  result = gen(root, "", "", 0) as JsonObject;
  for (const fn of later) fn();
  // Drop values for fields the UI rules hide, as an applicant could never have entered them.
  for (const hidden of evaluateUi(form.uiSchema, result).hidden) {
    const segs = hidden.split("/").slice(1);
    let cur: Json | undefined = result;
    for (const seg of segs.slice(0, -1)) cur = isPlainObject(cur) ? cur[seg] : undefined;
    const last = segs[segs.length - 1];
    if (isPlainObject(cur) && last !== undefined) delete cur[last];
  }
  return result;
}
