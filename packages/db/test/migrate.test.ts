// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { listMigrations, migrationChecksum } from '../src/migrate';

describe('migration checksums', () => {
  it('ignore the SPDX license header but not the schema', () => {
    const only = '-- SPDX-License-Identifier: AGPL-3.0-only\r\ncreate table t (id int);\r\n';
    const later = '-- SPDX-License-Identifier: AGPL-3.0-or-later\r\ncreate table t (id int);\r\n';
    expect(migrationChecksum(only)).toBe(migrationChecksum(later));
    expect(migrationChecksum(later)).not.toBe(migrationChecksum(later.replace('id int', 'id bigint')));
  });

  it('keep the full-text hashes recorded before the rule, for an in-place upgrade', () => {
    for (const m of listMigrations()) expect(m.legacyChecksums.length, m.name).toBeGreaterThan(0);
  });
});
