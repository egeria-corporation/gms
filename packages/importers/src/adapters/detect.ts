// SPDX-License-Identifier: AGPL-3.0-only
// Recognising an export by its header row, and the mapping an adapter gives. Detection reads the
// columns that survived the sensitive screen only (the caller screens first), so a dropped column
// never decides anything.
import type { ImportTarget, Mapping } from "../target.ts";
import { suggestMapping } from "../target.ts";
import { fold } from "../values.ts";
import type { ImportAdapter } from "./types.ts";

/** A strong header counts this much toward a match, an usual one 1. */
const STRONG = 3;
/** An export is recognised with two strong headers, or one and at least this many usual ones. */
const MIN_USUAL_WITH_ONE_STRONG = 3;

export interface Detection {
  adapter: ImportAdapter;
  score: number;
  /** The headers that matched the system's signature, as they are in the file. */
  matched: string[];
}

function scoreOf(adapter: ImportAdapter, header: readonly string[]): Detection {
  const folded = header.map((h) => ({ h, f: fold(h) }));
  const strong = folded.filter(({ f }) => adapter.signature.strong.includes(f));
  const usual = folded.filter(({ f }) => adapter.signature.usual.includes(f) && !adapter.signature.strong.includes(f));
  const recognised = strong.length >= 2 || (strong.length === 1 && usual.length >= MIN_USUAL_WITH_ONE_STRONG);
  return { adapter, score: recognised ? strong.length * STRONG + usual.length : 0, matched: [...strong, ...usual].map((x) => x.h) };
}

/**
 * The system whose export this header looks like, or null when none matches clearly (no system
 * reaches the bar, or two tie for the best match). The person can always pick another.
 */
export function detectAdapter(header: readonly string[], among: readonly ImportAdapter[]): Detection | null {
  const scored = among.map((a) => scoreOf(a, header)).filter((d) => d.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1]!.score === scored[0]!.score) return null;
  return scored[0]!;
}

/** How well a header matches one system (for a test, or to say why a chosen system fits poorly). */
export const signatureMatch = (adapter: ImportAdapter, header: readonly string[]): Detection => scoreOf(adapter, header);

/**
 * The mapping for a file from a known system. A mapping saved for exactly these columns comes
 * first (the person's own choice); then the system's preset, one column per field; then the
 * general suggestion (G2's words, with a similar source's saved mapping) for what is left.
 */
export function adapterMapping<F extends string>(adapter: ImportAdapter, target: ImportTarget<F>, header: readonly string[], saved: { exact?: Mapping<F> | null; similar?: Mapping<F> | null } = {}): Mapping<F> {
  const preset = adapter.presets[target.key];
  if (!preset) return suggestMapping(target, header, saved.exact ?? saved.similar ?? null);
  const out: Mapping<F> = {};
  const used = new Set<string>();
  const present = new Set(header);
  const take = (field: F, column: string) => {
    out[field] = column;
    used.add(column);
  };
  if (saved.exact) for (const f of target.fields) if (saved.exact[f.key] && present.has(saved.exact[f.key]!) && !used.has(saved.exact[f.key]!)) take(f.key, saved.exact[f.key]!);
  const folded = header.map((h) => ({ h, f: fold(h) }));
  for (const f of target.fields) {
    if (out[f.key]) continue;
    for (const candidate of preset[f.key] ?? []) {
      const hit = folded.find((x) => x.f === candidate && !used.has(x.h));
      if (hit) {
        take(f.key, hit.h);
        break;
      }
    }
  }
  const rest = suggestMapping(target, header.filter((h) => !used.has(h)), saved.similar ?? null);
  for (const f of target.fields) if (!out[f.key] && rest[f.key]) take(f.key, rest[f.key]!);
  return out;
}
