// SPDX-License-Identifier: AGPL-3.0-only
// Thin bridge to @gms/forms so action modules depend on one small surface.
import {
  compileForm,
  FormModelSchema,
  prefillFromProfile,
  toCommonGrants,
  validateResponses,
  type CompiledForm,
} from '@gms/forms';
import type { JsonValue } from '@gms/db';

export type { CompiledForm };

export interface FieldError {
  pointer: string;
  fieldId?: string;
  pageId?: string;
  message: string;
}

const cache = new Map<string, CompiledForm>();

export function compiledFor(version: { id: string; builder_model: JsonValue }): CompiledForm {
  const hit = cache.get(version.id);
  if (hit) return hit;
  const model = FormModelSchema.parse(version.builder_model);
  const compiled = compileForm(model);
  if (cache.size > 200) cache.clear();
  cache.set(version.id, compiled);
  return compiled;
}

export function validate(
  compiled: CompiledForm,
  data: Record<string, unknown>,
  mode: 'save' | 'submit',
): { valid: boolean; errors: FieldError[]; knockouts: { fieldId: string; message: string }[] } {
  const r = validateResponses(compiled, data, { mode });
  return {
    valid: r.valid,
    errors: r.errors.map((e) => ({ pointer: e.pointer, message: e.message, ...(e.fieldId ? { fieldId: e.fieldId } : {}), ...(e.pageId ? { pageId: e.pageId } : {}) })),
    knockouts: r.knockouts.map((k) => ({ fieldId: k.fieldId, message: k.message })),
  };
}

export function prefill(compiled: CompiledForm, profile: Record<string, unknown>): Record<string, unknown> {
  return prefillFromProfile(compiled, profile);
}

export function cgView(compiled: CompiledForm, data: Record<string, unknown>): Record<string, unknown> {
  return toCommonGrants(compiled, data) as Record<string, unknown>;
}

function pick(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Requested amount in cents via the funding.requestedAmount CG mapping (currency fields store cents). */
export function requestedAmountCents(compiled: CompiledForm, data: Record<string, unknown>): number | null {
  const v = pick(cgView(compiled, data), 'funding.requestedAmount');
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (v && typeof v === 'object' && 'amount' in v) {
    const a = Number((v as { amount: unknown }).amount);
    return Number.isFinite(a) ? Math.round(a * 100) : null;
  }
  return null;
}

export function projectTitle(compiled: CompiledForm, data: Record<string, unknown>): string | null {
  const v = pick(cgView(compiled, data), 'project.title');
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null;
}
