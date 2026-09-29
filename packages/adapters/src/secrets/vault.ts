// SPDX-License-Identifier: AGPL-3.0-or-later
// SecretStore backed by Supabase Vault (GMS_SECRET_STORE=vault). Secrets are created with
// vault.create_secret(value, name, description) and read from vault.decrypted_secrets; refs are "vault:<uuid>".
// Refs created earlier by the AES fallback ("aes:<uuid>") keep working: they are routed to AesSecretStore,
// so switching a deployment to Vault never strands existing secrets.
import { randomUUID } from 'node:crypto';
import { getDb, sql, type Database } from '@gms/db';
import type { SecretStore } from '../types';
import { AesSecretStore } from './aes';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class VaultSecretStore implements SecretStore {
  readonly name = 'supabase-vault' as const;
  private readonly aes: AesSecretStore;

  constructor(private readonly db: () => Database = () => getDb()) {
    this.aes = new AesSecretStore(db);
  }

  async put(name: string, value: string, opts: { workspaceId?: string | null } = {}): Promise<string> {
    // Vault secret names are unique; suffix with a uuid so rotations never collide.
    const vaultName = `gms/${opts.workspaceId ?? 'platform'}/${name}/${randomUUID()}`;
    const r = await sql<{ id: string }>`select vault.create_secret(${value}, ${vaultName}, ${`GMS secret: ${name}`}) as id`.execute(this.db());
    const id = r.rows[0]?.id;
    if (!id) throw new Error('vault.create_secret returned no id');
    return `vault:${id}`;
  }

  async get(ref: string): Promise<string | null> {
    if (ref.startsWith('aes:')) return this.aes.get(ref);
    if (!ref.startsWith('vault:')) return null;
    const id = ref.slice(6);
    if (!UUID.test(id)) return null;
    const r = await sql<{ decrypted_secret: string | null }>`select decrypted_secret from vault.decrypted_secrets where id = ${id}::uuid`.execute(this.db());
    return r.rows[0]?.decrypted_secret ?? null;
  }

  async delete(ref: string): Promise<void> {
    if (ref.startsWith('aes:')) return this.aes.delete(ref);
    if (!ref.startsWith('vault:')) return;
    const id = ref.slice(6);
    if (!UUID.test(id)) return;
    await sql`delete from vault.secrets where id = ${id}::uuid`.execute(this.db());
  }
}
