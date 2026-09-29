// SPDX-License-Identifier: AGPL-3.0-or-later
import { DomainError } from '@gms/domain';
import { describe, expect, it } from 'vitest';
import { CsvParser, csvCell, parseCsv } from '../src/csv';
import { MANUAL_RAIL_MESSAGE, ManualRail, parsePaymentsCsv, paymentsToCsv } from '../src/payments/manual';

describe('CSV parser', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and embedded newlines', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', 'z'],
    ]);
  });

  it('parses identically when quotes span chunk boundaries', () => {
    const text = 'id,name\n1,"Quote "" here"\n2,"a,b"\n';
    for (let split = 1; split < text.length; split++) {
      const p = new CsvParser();
      const rows = [...p.push(text.slice(0, split)), ...p.push(text.slice(split)), ...p.end()];
      expect(rows).toEqual([
        ['id', 'name'],
        ['1', 'Quote " here'],
        ['2', 'a,b'],
      ]);
    }
  });

  it('neutralizes spreadsheet formulas on export', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-5', { numeric: true })).toBe('-5');
  });
});

describe('ManualRail', () => {
  it('refuses to invite or send with a clear domain error', async () => {
    const rail = new ManualRail();
    expect(rail.name).toBe('manual');
    expect(rail.environment).toBe('none');
    const err = await rail.requestSendMoney().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).message).toBe(MANUAL_RAIL_MESSAGE);
    await expect(rail.createRecipientInvite()).rejects.toThrow(MANUAL_RAIL_MESSAGE);
    expect(await rail.listAccounts()).toEqual([]);
    expect(rail.verifyWebhook()).toBe(false);
  });

  it('validates recorded payments', () => {
    const rail = new ManualRail();
    expect(rail.recordPayment({ awardReference: 'HF-2026-001', payeeName: 'Cedar Hollow Food Pantry', amountCents: 500_000, paidOn: '2026-09-01', method: 'check' })).toMatchObject({
      currency: 'USD',
      method: 'check',
      reference: null,
    });
    expect(() => rail.recordPayment({ awardReference: '', payeeName: 'X', amountCents: 0, paidOn: '2026-02-30' })).toThrow(DomainError);
  });
});

describe('payments CSV', () => {
  it('round-trips export → import', () => {
    const csv = paymentsToCsv([
      { paymentId: 'p1', awardReference: 'HF-2026-001', payeeName: 'Eastside Youth Music Collective', amountCents: 1_250_050, paidOn: '2026-09-01', method: 'ach', reference: 'ACH 881', memo: 'Installment 1, "spring"' },
      { awardReference: 'HF-2026-002', payeeName: 'Cedar Hollow Food Pantry', amountCents: 5, paidOn: '2026-09-02', method: 'check' },
    ]);
    expect(csv.split('\r\n')[0]).toBe('payment_id,award_reference,payee_name,amount,currency,method,paid_on,reference,memo,status');
    expect(csv).toContain('12500.50');
    expect(csv).toContain('0.05');
    const parsed = parsePaymentsCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((r) => [r.amountCents, r.method, r.memo])).toEqual([
      [1_250_050, 'ach', 'Installment 1, "spring"'],
      [5, 'check', null],
    ]);
    expect(parsed.rows[0]!.paymentId).toBe('p1');
    expect(parsed.ignoredColumns).toEqual([]);
  });

  it('validates headers', () => {
    const r = parsePaymentsCsv('award_reference,amount\nX,1');
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.column)).toEqual(['payee_name', 'paid_on']);
    expect(parsePaymentsCsv('').errors[0]!.message).toMatch(/empty/);
    expect(parsePaymentsCsv('amount,amount,payee_name,award_reference,paid_on\n').errors[0]!.message).toMatch(/more than once/);
  });

  it('reports errors per row and keeps valid rows', () => {
    const text = [
      'Award Reference,Payee Name,Amount,Paid On,Method,Extra',
      'HF-1,Org A,"$1,234.56",2026-09-01,wire,ignored',
      'HF-2,Org B,12.345,2026-09-01,ach,',
      'HF-3,,-5,13/45/2026,bitcoin,',
      ',,,,,',
      'HF-4,Org D,100,9/3/2026,,',
    ].join('\n');
    const r = parsePaymentsCsv(text);
    expect(r.ignoredColumns).toEqual(['extra']);
    expect(r.rows.map((x) => [x.line, x.awardReference, x.amountCents, x.method, x.paidOn])).toEqual([
      [2, 'HF-1', 123_456, 'domestic_wire', '2026-09-01'],
      [6, 'HF-4', 10_000, 'manual', '2026-09-03'],
    ]);
    expect(r.errors.filter((e) => e.line === 3).map((e) => e.column)).toEqual(['amount']);
    expect(r.errors.filter((e) => e.line === 4).map((e) => e.column)).toEqual(['payee_name', 'amount', 'paid_on', 'method']);
  });

  it('caps the number of rows', () => {
    const text = ['award_reference,payee_name,amount,paid_on', ...Array.from({ length: 3 }, () => 'A,B,1,2026-01-01')].join('\n');
    expect(parsePaymentsCsv(text, { maxRows: 2 }).errors[0]!.message).toMatch(/limit is 2/);
  });
});
