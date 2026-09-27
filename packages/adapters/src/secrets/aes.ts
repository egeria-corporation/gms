// SPDX-License-Identifier: AGPL-3.0-only
// SecretStore fallback: AES-256-GCM (key from GMS_ENCRYPTION_KEY) with ciphertext in gms_private.secrets.
import { getDb, sql, type Database } from '@gms/db';
import { decrypt, encrypt } from '../crypto';
import type { SecretStore } from '../types';

export class AesSecretStore implements SecretStore {
  readonly name = 'aes-256-gcm' as const;
  constructor(private readonly db: () => Database = () => getDb()) {}

  async put(name: string, value: string, opts: { workspaceId?: string | null } = {}): Promise<string> {
    const ciphertext = encrypt(value, 'secrets');
    const r = await sql<{ id: string }>`insert into gms_private.secrets (workspace_id, name, ciphertext)
      values (${opts.workspaceId ?? null}, ${name}, ${ciphertext}) returning id`.execute(this.db());
    return `aes:${r.rows[0]!.id}`;
  }

  async get(ref: string): Promise<string | null> {
    if (!ref.startsWith('aes:')) return null;
    const r = await sql<{ ciphertext: string }>`select ciphertext from gms_private.secrets where id = ${ref.slice(4)}::uuid`.execute(
      this.db(),
    );
    const row = r.rows[0];
    return row ? decrypt(row.ciphertext, 'secrets') : null;
  }

  async delete(ref: string): Promise<void> {
    if (!ref.startsWith('aes:')) return;
    await sql`delete from gms_private.secrets where id = ${ref.slice(4)}::uuid`.execute(this.db());
  }
}
