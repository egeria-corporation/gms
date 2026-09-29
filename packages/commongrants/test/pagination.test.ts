// SPDX-License-Identifier: AGPL-3.0-or-later
import { PaginatedSchema, SortedResultsInfoSchema } from '@common-grants/sdk/schemas';
import { zonedTimeToUtc } from '@gms/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  centsToMoney,
  dateBound,
  decimalToCents,
  HttpError,
  moneyToCents,
  paginatedEnvelope,
  paginationInfo,
  parseApplicationSearch,
  parseAwardSearch,
  parseOpportunitySearch,
  parsePagination,
  problemBody,
  sortInfoOf,
} from '../src';

function expect400(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(400);
    const body = problemBody(e);
    expect(body).toMatchObject({ status: 400, title: 'Bad request' });
    expect(Array.isArray(body.errors)).toBe(true);
    return;
  }
  throw new Error('expected a 400');
}

describe('money', () => {
  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [2_500_000, '25000.00'],
    [2_500_050, '25000.50'],
    [-150, '-1.50'],
    [900_719_925_474_099, '9007199254740.99'],
  ])('%i cents <-> "%s"', (cents, amount) => {
    expect(centsToMoney(cents)).toEqual({ amount, currency: 'USD' });
    expect(decimalToCents(amount)).toBe(cents);
  });

  it('parses CG decimal strings of any scale', () => {
    expect(decimalToCents('100')).toBe(10_000);
    expect(decimalToCents('100.5')).toBe(10_050);
    expect(decimalToCents('100.500')).toBe(10_050);
    expect(moneyToCents({ amount: '12.34', currency: 'usd' })).toEqual({ cents: 1234, currency: 'USD' });
  });

  it('rejects sub-cent precision, non-decimals and non-integers', () => {
    expect(() => decimalToCents('1.005')).toThrow(RangeError);
    expect(() => decimalToCents('1e5')).toThrow(RangeError);
    expect(() => decimalToCents('$5')).toThrow(RangeError);
    expect(() => centsToMoney(1.5)).toThrow(RangeError);
  });
});

describe('pagination parsing', () => {
  it('defaults to page 1 / pageSize 100', () => {
    expect(parsePagination(new URLSearchParams())).toEqual({ page: 1, pageSize: 100 });
    expect(parsePagination(undefined)).toEqual({ page: 1, pageSize: 100 });
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 100 });
  });

  it('parses query and body values', () => {
    expect(parsePagination(new URLSearchParams('page=3&pageSize=25'))).toEqual({ page: 3, pageSize: 25 });
    expect(parsePagination({ page: 2, pageSize: 100 })).toEqual({ page: 2, pageSize: 100 });
  });

  it.each(['page=0', 'page=-1', 'page=abc', 'page=1.5', 'pageSize=0', 'pageSize=101', 'pageSize=x'])('rejects %s with a 400 problem', (qs) => {
    expect400(() => parsePagination(new URLSearchParams(qs)));
  });

  it('computes paginationInfo and a valid CG envelope', () => {
    expect(paginationInfo({ page: 2, pageSize: 2 }, 5)).toEqual({ page: 2, pageSize: 2, totalItems: 5, totalPages: 3 });
    expect(paginationInfo({ page: 1, pageSize: 10 }, 0)).toEqual({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
    const env = paginatedEnvelope([{ a: 1 }], paginationInfo({ page: 1, pageSize: 1 }, 1));
    expect(PaginatedSchema(z.object({ a: z.number() })).safeParse(env).success).toBe(true);
  });
});

describe('search parsing', () => {
  it('parses opportunity filters, sorting and pagination', () => {
    const req = parseOpportunitySearch({
      search: '  arts education ',
      filters: {
        status: { operator: 'in', value: ['open', 'forecasted'] },
        closeDateRange: { operator: 'between', value: { min: '2026-01-01', max: '2026-12-31' } },
        totalFundingAvailableRange: { operator: 'between', value: { min: { amount: '1000', currency: 'USD' }, max: { amount: '1000000', currency: 'USD' } } },
        customFilters: { causeAreas: { operator: 'in', value: ['arts'] }, unknownThing: { operator: 'eq', value: 1 } },
      },
      sorting: { sortBy: 'keyDates.closeDate', sortOrder: 'asc' },
      pagination: { page: 2, pageSize: 10 },
    });
    expect(req.search).toBe('arts education');
    expect(req.sorting).toEqual({ sortBy: 'keyDates.closeDate', sortOrder: 'asc' });
    expect(req.pagination).toEqual({ page: 2, pageSize: 10 });
    expect(req.filters.status?.value).toEqual(['open', 'forecasted']);
    expect(req.filterErrors).toEqual(['Custom filter "unknownThing" is not supported and was ignored.']);
    expect(SortedResultsInfoSchema.safeParse(sortInfoOf(req)).success).toBe(true);
  });

  it('defaults to lastModifiedAt desc and reports unsupported custom sorts', () => {
    expect(parseOpportunitySearch({}).sorting).toEqual({ sortBy: 'lastModifiedAt', sortOrder: 'desc' });
    expect(parseOpportunitySearch(undefined).pagination).toEqual({ page: 1, pageSize: 100 });
    const req = parseOpportunitySearch({ sorting: { sortBy: 'custom', customSortBy: 'popularity' } });
    expect(req.sorting.sortBy).toBe('lastModifiedAt');
    expect(sortInfoOf(req).errors?.[0]).toContain('popularity');
  });

  it.each([
    [[1, 2]],
    ['text'],
    [{ filters: { status: { operator: 'between', value: ['open'] } } }],
    [{ sorting: { sortBy: 'nope' } }],
    [{ pagination: { pageSize: 500 } }],
    [{ filters: { closeDateRange: { operator: 'between', value: { min: 'yesterday', max: '2026-01-01' } } } }],
  ])('rejects invalid bodies with a 400 (%j)', (body) => {
    expect400(() => parseOpportunitySearch(body));
  });

  it('parses award and application search bodies', () => {
    const a = parseAwardSearch({ filters: { status: { operator: 'in', value: ['awarded'] } }, sorting: { sortBy: 'funding.awardedAmount', sortOrder: 'desc' } });
    expect(a.sorting.sortBy).toBe('funding.awardedAmount');
    const p = parseApplicationSearch({ filters: { status: { operator: 'in', value: ['submitted'] } }, sorting: { sortBy: 'submittedAt' } });
    expect(p.sorting).toEqual({ sortBy: 'submittedAt', sortOrder: 'asc' });
  });

  it('turns date filter bounds into workspace-day instants', () => {
    const tz = 'America/Los_Angeles';
    expect(dateBound('2026-12-05', tz, 'start', zonedTimeToUtc)).toEqual({ at: '2026-12-05T08:00:00.000Z', inclusive: true });
    expect(dateBound('2026-12-05', tz, 'end', zonedTimeToUtc)).toEqual({ at: '2026-12-06T08:00:00.000Z', inclusive: false });
    expect(dateBound('2026-12-05T17:00:00Z', tz, 'end', zonedTimeToUtc)).toEqual({ at: '2026-12-05T17:00:00.000Z', inclusive: true });
  });
});
