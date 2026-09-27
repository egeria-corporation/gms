// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionAudience, listActions } from '../src';
import '../src/modules/index';

describe('action registry', () => {
  it('has no duplicate action ids across modules (checked in source)', () => {
    const dir = join(__dirname, '..', 'src', 'modules');
    const ids: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/defineAction\(\{\s*id:\s*'([^']+)'/g)) ids.push(m[1]!);
    }
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    expect(ids.length).toBeGreaterThan(80);
  });

  it('every action has an LLM-ready description, schemas, and a risk tier', () => {
    for (const a of listActions()) {
      expect(a.description.length, a.id).toBeGreaterThanOrEqual(30);
      expect(['R0', 'R1', 'R2', 'R3']).toContain(a.riskTier);
      expect(a.input, a.id).toBeTruthy();
      expect(a.output, a.id).toBeTruthy();
    }
  });

  it('no scope can reach an R3 action for agents', () => {
    // R3 actions may list scopes for documentation, but the executor refuses agents regardless.
    const r3 = listActions().filter((a) => a.riskTier === 'R3');
    expect(r3.length).toBeGreaterThan(10);
    for (const a of r3) expect(actionAudience(a)).not.toBe('public');
  });
});
