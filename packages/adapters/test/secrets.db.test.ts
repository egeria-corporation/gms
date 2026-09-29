// SPDX-License-Identifier: AGPL-3.0-or-later
// AES fallback + Supabase Vault ref routing. The plain-Postgres tier has no Vault, so the test database gets a
// minimal emulation of Vault's public surface (vault.create_secret, vault.secrets, vault.decrypted_secrets).
import { sql } from '@gms/db';
import { createTestDatabase, type TestDatabase } from '@gms/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AesSecretStore } from '../src/secrets/aes';
import { VaultSecretStore } from '../src/secrets/vault';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase('gms_adapters_secrets');
  await sql`create schema if not exists vault`.execute(tdb.db);
  await sql`create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text not null default '', secret text not null, created_at timestamptz not null default now())`.execute(tdb.db);
  await sql`create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at from vault.secrets`.execute(tdb.db);
  await sql`create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
    language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$`.execute(tdb.db);
});
afterAll(async () => {
  await tdb?.drop();
});

describe('AesSecretStore', () => {
  it('encrypts at rest and round-trips', async () => {
    const s = new AesSecretStore(() => tdb.db);
    const ref = await s.put('mercury_token', 'secret-token:mercury_sandbox_abc');
    expect(ref).toMatch(/^aes:[0-9a-f-]{36}$/);
    const raw = await sql<{ ciphertext: string }>`select ciphertext from gms_private.secrets where id = ${ref.slice(4)}::uuid`.execute(tdb.db);
    expect(raw.rows[0]!.ciphertext).not.toContain('mercury_sandbox_abc');
    expect(await s.get(ref)).toBe('secret-token:mercury_sandbox_abc');
    expect(await s.get('vault:00000000-0000-0000-0000-000000000000')).toBeNull();
    await s.delete(ref);
    expect(await s.get(ref)).toBeNull();
  });
});

describe('VaultSecretStore', () => {
  it('stores in Vault and returns vault: refs', async () => {
    const s = new VaultSecretStore(() => tdb.db);
    const ref = await s.put('webhook_secret', 'whsec_value', { workspaceId: '11111111-1111-1111-1111-111111111111' });
    expect(ref).toMatch(/^vault:[0-9a-f-]{36}$/);
    const row = await sql<{ name: string }>`select name from vault.secrets where id = ${ref.slice(6)}::uuid`.execute(tdb.db);
    expect(row.rows[0]!.name).toMatch(/^gms\/11111111-1111-1111-1111-111111111111\/webhook_secret\//);
    expect(await s.get(ref)).toBe('whsec_value');
    // Same logical name twice never collides.
    const ref2 = await s.put('webhook_secret', 'rotated', { workspaceId: '11111111-1111-1111-1111-111111111111' });
    expect(await s.get(ref2)).toBe('rotated');
    await s.delete(ref);
    expect(await s.get(ref)).toBeNull();
  });

  it('routes legacy aes: refs to the AES store and ignores malformed refs', async () => {
    const aes = new AesSecretStore(() => tdb.db);
    const vault = new VaultSecretStore(() => tdb.db);
    const legacy = await aes.put('old', 'from-aes');
    expect(await vault.get(legacy)).toBe('from-aes');
    await vault.delete(legacy);
    expect(await aes.get(legacy)).toBeNull();
    expect(await vault.get('vault:not-a-uuid')).toBeNull();
    expect(await vault.get('plain')).toBeNull();
  });
});
