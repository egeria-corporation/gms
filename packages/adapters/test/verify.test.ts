// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { computeMercurySignature, parseSignatureHeader, signMercuryWebhook, verifyMercurySignature, verifyMercurySignatureDetailed } from '../src/payments/verify';

const secret = 'whsec_test_secret_value';
const body = JSON.stringify({ id: 'evt_1', resourceType: 'transaction', resourceId: 'txn_1', operationType: 'update', mergePatch: { status: 'sent' } });
const now = new Date('2026-09-27T12:00:00Z');

describe('Mercury webhook signatures', () => {
  it('accepts a valid signature (header name is case-insensitive)', () => {
    const header = signMercuryWebhook(body, secret, now);
    expect(verifyMercurySignature(body, { 'Mercury-Signature': header }, secret, now)).toBe(true);
    expect(verifyMercurySignature(body, { 'mercury-signature': header }, secret, now)).toBe(true);
  });

  it('matches the documented construction: hex HMAC-SHA256 of "<t>.<body>"', () => {
    const t = Math.floor(now.getTime() / 1000);
    expect(signMercuryWebhook(body, secret, now)).toBe(`t=${t},v1=${computeMercurySignature(body, secret, t)}`);
    expect(computeMercurySignature(body, secret, t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a tampered body', () => {
    const header = signMercuryWebhook(body, secret, now);
    expect(verifyMercurySignatureDetailed(body.replace('sent', 'failed'), { 'mercury-signature': header }, secret, { now })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects the wrong secret', () => {
    const header = signMercuryWebhook(body, 'whsec_other', now);
    expect(verifyMercurySignature(body, { 'mercury-signature': header }, secret, now)).toBe(false);
    expect(verifyMercurySignature(body, { 'mercury-signature': signMercuryWebhook(body, secret, now) }, '', now)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyMercurySignatureDetailed(body, {}, secret, { now })).toEqual({ ok: false, reason: 'missing_header' });
    expect(verifyMercurySignatureDetailed(body, { 'mercury-signature': 'v1=abc' }, secret, { now })).toEqual({ ok: false, reason: 'malformed_header' });
    expect(parseSignatureHeader('t=123,v1=nothex')).toBeNull();
  });

  it('rejects stale timestamps outside the 5-minute replay window', () => {
    const header = signMercuryWebhook(body, secret, new Date(now.getTime() - 5 * 60_000 - 1_000));
    expect(verifyMercurySignatureDetailed(body, { 'mercury-signature': header }, secret, { now })).toEqual({ ok: false, reason: 'stale_timestamp' });
    const edge = signMercuryWebhook(body, secret, new Date(now.getTime() - 4 * 60_000));
    expect(verifyMercurySignature(body, { 'mercury-signature': edge }, secret, now)).toBe(true);
  });

  it('rejects timestamps too far in the future', () => {
    const header = signMercuryWebhook(body, secret, new Date(now.getTime() + 6 * 60_000));
    expect(verifyMercurySignatureDetailed(body, { 'mercury-signature': header }, secret, { now })).toEqual({ ok: false, reason: 'future_timestamp' });
  });

  it('accepts any matching v1 signature during secret rotation', () => {
    const t = Math.floor(now.getTime() / 1000);
    const header = `t=${t},v1=${computeMercurySignature(body, 'old', t)},v1=${computeMercurySignature(body, secret, t)}`;
    expect(verifyMercurySignature(body, { 'mercury-signature': header }, secret, now)).toBe(true);
  });
});
