// SPDX-License-Identifier: AGPL-3.0-only
// Small deterministic PRNG (mulberry32) with helpers. Every seed section forks its own stream by name,
// so adding data to one section never changes what another section generates.
import { createHash } from 'node:crypto';

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Picks by weight: [[value, weight], ...]. */
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
  /** n distinct items (or all of them when n >= length). */
  sample<T>(items: readonly T[], n: number): T[];
  /** A new independent stream derived from this seed and a label. */
  fork(label: string): Rng;
}

function hash32(label: string): number {
  return createHash('sha256').update(label).digest().readUInt32LE(0);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(label: string | number): Rng {
  const base = typeof label === 'number' ? String(label) : label;
  const next = mulberry32(hash32(`gms-seed:${base}`));
  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      return next() < p;
    },
    pick(items) {
      if (!items.length) throw new RangeError('pick() from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    weighted(items) {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) {
        r -= w;
        if (r < 0) return v;
      }
      return items[items.length - 1]![0];
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    sample(items, n) {
      return rng.shuffle(items).slice(0, Math.max(0, n));
    },
    fork(sub) {
      return createRng(`${base}/${sub}`);
    },
  };
  return rng;
}
