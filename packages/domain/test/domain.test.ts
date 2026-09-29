// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  APPLICATION_STATUS,
  applicationMachine,
  assertTransition,
  canTransition,
  deadlineState,
  DomainError,
  evaluateEligibility,
  formatEin,
  formatMoney,
  fromPgError,
  mercuryFeeCents,
  parseMoneyToCents,
  parseScopes,
  PAYMENT_STATUS,
  paymentMachine,
  referenceNumber,
  slugify,
  splitInstallments,
  sumCents,
  toProblem,
  zonedTimeToUtc,
  type EligibilityRule,
} from '../src';

describe('money', () => {
  it('formats and parses cents exactly', () => {
    expect(formatMoney(1250050)).toBe('$12,500.50');
    expect(formatMoney(2500000, 'USD', { compact: true })).toBe('$25,000');
    expect(parseMoneyToCents('$12,500.50')).toBe(1250050);
    expect(parseMoneyToCents('12500')).toBe(1250000);
    expect(parseMoneyToCents('12.5')).toBe(1250);
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('1.234')).toBeNull();
  });
  it('rejects non-integer sums', () => {
    expect(sumCents([100, 250])).toBe(350);
    expect(() => sumCents([1.5])).toThrow();
  });
  it('splits installments exactly', () => {
    expect(splitInstallments(1000001, 2)).toEqual([500000, 500001]);
    expect(splitInstallments(900, 3).reduce((a, b) => a + b)).toBe(900);
  });
  it('computes Mercury fees', () => {
    expect(mercuryFeeCents('ach', 500000)).toBe(0);
    expect(mercuryFeeCents('domestic_wire', 500000)).toBe(0);
    expect(mercuryFeeCents('international_wire', 500000, { chargeBearer: 'OUR' })).toBe(1500);
    expect(mercuryFeeCents('international_wire', 500000)).toBe(0);
    expect(mercuryFeeCents('international_wire', 500000, { currency: 'EUR' })).toBe(5000);
  });
});

describe('state machines', () => {
  it('allows and rejects application transitions', () => {
    expect(canTransition(applicationMachine, 'in_progress', 'submitted')).toBe(true);
    expect(canTransition(applicationMachine, 'awarded', 'in_progress')).toBe(false);
    expect(() => assertTransition(applicationMachine, 'declined', 'awarded')).toThrowError(DomainError);
  });
  it('payments cannot skip from scheduled to reconciled', () => {
    expect(canTransition(paymentMachine, 'scheduled', 'reconciled')).toBe(false);
    expect(canTransition(paymentMachine, 'awaiting_bank_approval', 'sent')).toBe(true);
  });
  it('uses the exact labels', () => {
    expect(APPLICATION_STATUS.invited_to_next_stage.label).toBe('Invited to next stage');
    expect(PAYMENT_STATUS.awaiting_bank_approval.label).toBe('Awaiting bank approval (Mercury)');
    expect(PAYMENT_STATUS.awaiting_approval.label).toBe('Awaiting approval (GMS)');
  });
});

describe('dates', () => {
  it('adds business days from the calendar day in the workspace timezone', () => {
    // Friday 5:30 PM in Los Angeles is already Saturday in UTC; counting starts from Friday.
    expect(addBusinessDays('2027-03-06T01:30:00Z', 1, 'America/Los_Angeles')).toBe('2027-03-08');
    expect(addBusinessDays('2027-03-06T01:30:00Z', 3, 'America/Los_Angeles')).toBe('2027-03-10');
    expect(addBusinessDays('2027-03-02T17:30:00Z', 3, 'America/Los_Angeles')).toBe('2027-03-05');
    expect(addBusinessDays(new Date('2027-03-02T17:30:00Z'), 10, 'UTC')).toBe('2027-03-16');
  });
  it('converts PT wall-clock deadlines to UTC across DST', () => {
    expect(zonedTimeToUtc('2026-12-05T17:00', 'America/Los_Angeles').toISOString()).toBe('2026-12-06T01:00:00.000Z');
    expect(zonedTimeToUtc('2026-07-01T17:00', 'America/Los_Angeles').toISOString()).toBe('2026-07-02T00:00:00.000Z');
  });
  it('applies grace windows and extensions', () => {
    const closesAt = '2026-12-06T01:00:00.000Z';
    expect(deadlineState(new Date('2026-12-06T01:10:00Z'), { closesAt, graceMinutes: 15 })).toMatchObject({
      open: true,
      inGrace: true,
    });
    expect(deadlineState(new Date('2026-12-06T01:20:00Z'), { closesAt, graceMinutes: 15 }).open).toBe(false);
    expect(
      deadlineState(new Date('2026-12-08T00:00:00Z'), { closesAt, graceMinutes: 15, extensionAt: '2026-12-09T00:00:00Z' }).open,
    ).toBe(true);
    expect(deadlineState(new Date('2026-11-01T00:00:00Z'), { opensAt: '2026-11-03T08:00:00Z', closesAt }).open).toBe(false);
  });
});

describe('eligibility', () => {
  const rules: EligibilityRule[] = [
    {
      id: 'r1',
      position: 1,
      question: 'Is your organization a 501(c)(3) or fiscally sponsored?',
      kind: 'yes_no',
      config: { required: true },
      knockoutMessage: 'Only 501(c)(3)s',
    },
    {
      id: 'r2',
      position: 2,
      question: 'Annual budget',
      kind: 'number_max',
      config: { max: 2000000 },
      knockoutMessage: 'Budget must be under $2M',
    },
    {
      id: 'r3',
      position: 3,
      question: 'Counties',
      kind: 'multi_any',
      config: { options: ['Alder', 'Bramble', 'Cinder', 'Other'], allowed: ['Alder', 'Bramble', 'Cinder'] },
      knockoutMessage: 'Tri-county only',
    },
  ];
  it('passes, knocks out, and reports missing answers', () => {
    expect(evaluateEligibility(rules, { r1: 'yes', r2: 480000, r3: ['Alder'] }).eligible).toBe(true);
    const ko = evaluateEligibility(rules, { r1: true, r2: 3_000_000, r3: ['Alder'] });
    expect(ko.eligible).toBe(false);
    expect(ko.outcomes[1]!.message).toBe('Budget must be under $2M');
    const partial = evaluateEligibility(rules, { r1: true });
    expect(partial.eligible).toBeNull();
    expect(partial.missing.map((m) => m.ruleId)).toEqual(['r2', 'r3']);
  });
});

describe('errors & misc', () => {
  it('maps to RFC 9457 problem details', () => {
    const p = toProblem(new DomainError('deadline_passed', 'Closed at 5 PM PT'), '/x');
    expect(p).toMatchObject({ status: 409, code: 'deadline_passed', title: 'The deadline has passed', instance: '/x' });
    expect(toProblem(new Error('boom')).status).toBe(500);
  });
  it('maps Postgres invariant errors', () => {
    expect(fromPgError({ code: 'P0001', hint: 'maker_checker' })?.code).toBe('forbidden');
    expect(fromPgError({ code: '42501', message: 'new row violates row-level security policy' })?.code).toBe('forbidden');
  });
  it('formats references, slugs and EINs', () => {
    expect(referenceNumber('HRF', 2027, 42)).toBe('HRF-2027-00042');
    expect(slugify('Youth Arts Fund 2027!')).toBe('youth-arts-fund-2027');
    expect(formatEin('000000001')).toBe('00-0000001');
    expect(parseScopes('applications:read bogus applications:write')).toEqual(['applications:read', 'applications:write']);
  });
});
