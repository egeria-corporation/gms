// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { CATALOG, catalogBySurface, catalogUrl, type CatalogScreen } from './catalog';

const range = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${String(from + i).padStart(2, '0')}`);

const REQUIRED = [
  ...range('A', 1, 7),
  ...range('B', 1, 15),
  ...range('C', 1, 8),
  ...range('FB', 1, 8),
  ...range('R', 1, 7),
  ...range('D', 1, 3),
  ...range('E', 1, 2),
  ...range('P', 1, 8),
  ...range('PA', 1, 3),
  ...range('CM', 0, 3),
  ...range('AN', 1, 3),
  ...range('S', 0, 9),
  ...range('F', 1, 5),
  ...range('G', 1, 2),
  ...range('O', 1, 1),
  ...range('H', 1, 5),
  ...range('DS', 1, 6),
  'invite-accept',
  'root-sign-in',
  'platform-directory',
];

describe('screen catalog', () => {
  it('has unique ids', () => {
    const ids = CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every screen id in the spec', () => {
    const ids = new Set(CATALOG.map((s) => s.id));
    expect(REQUIRED.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('uses absolute paths and kebab-case states', () => {
    for (const s of CATALOG) {
      expect(s.path, s.id).toMatch(/^\//);
      if (s.example) expect(s.example, s.id).toMatch(/^\//);
      for (const st of s.states) expect(st, `${s.id} state`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(new Set(s.states).size, `${s.id} duplicate states`).toBe(s.states.length);
    }
  });

  it('keeps root-host screens on the root surface', () => {
    for (const s of CATALOG) expect(s.tenantScoped, s.id).toBe(s.surface !== 'root');
  });

  it('groups every screen exactly once', () => {
    const grouped = catalogBySurface().flatMap((g) => g.screens);
    expect(grouped).toHaveLength(CATALOG.length);
  });

  it('builds state URLs', () => {
    const screen = (over: Partial<CatalogScreen>): CatalogScreen => ({
      id: 'X',
      title: 'X',
      path: '/x',
      states: [],
      surface: 'console',
      tenantScoped: true,
      ...over,
    });
    expect(catalogUrl(screen({}), 'empty')).toBe('/x?state=empty');
    expect(catalogUrl(screen({ path: '/setup?step=brand' }), 'contrast-autofix')).toBe(
      '/setup?step=brand&state=contrast-autofix',
    );
    expect(catalogUrl(screen({ path: '/a/[id]' }))).toBeNull();
    expect(catalogUrl(screen({ path: '/a/[id]', example: '/a/1#top' }), 'open')).toBe('/a/1?state=open#top');
  });
});
