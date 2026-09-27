// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hiddenInBlindReview, IDENTIFYING_CG_PATHS, IDENTIFYING_FIELD_TYPES } from '../src/blind';

describe('hiddenInBlindReview', () => {
  it('hides flagged fields, identifying field types and identifying CommonGrants mappings', () => {
    expect(hiddenInBlindReview({ type: 'long_text', blind: true })).toBe(true);
    expect(hiddenInBlindReview({ type: 'ein', blind: false })).toBe(true);
    expect(hiddenInBlindReview({ type: 'attestation', blind: false })).toBe(true);
    expect(hiddenInBlindReview({ type: 'text', blind: false, cgMapping: 'contact.email' })).toBe(true);
    expect(hiddenInBlindReview({ type: 'text', blind: false, cgMapping: 'organization.ein' })).toBe(true);
    expect(hiddenInBlindReview({ type: 'long_text', blind: false, cgMapping: 'organization.mission' })).toBe(false);
    expect(hiddenInBlindReview({ type: 'currency', blind: false })).toBe(false);
  });

  it('matches the database rule in gms_private.blind_hidden (migration 1700)', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/20260927001700_blind_review_identifiers.sql', import.meta.url), 'utf8');
    for (const t of IDENTIFYING_FIELD_TYPES) expect(sql, t).toContain(`'${t}'`);
    for (const p of IDENTIFYING_CG_PATHS) expect(sql, p).toContain(`'${p}'`);
  });
});
