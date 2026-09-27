// SPDX-License-Identifier: AGPL-3.0-only
// Builds the adapter set for the current environment. Every dependency has a fake so a missing credential
// never blocks the app. (Real implementations are selected here as they become available.)
import { getDb, type Database } from '@gms/db';
import { TestAuthAdapter } from './auth/test-auth';
import { FakeLlm } from './llm/fake';
import { DevOutboxMailer } from './mail/dev-outbox';
import { NoopScanner } from './scanner/noop';
import { AesSecretStore } from './secrets/aes';
import { LocalStorage } from './storage/local';
import type { AuthAdapter, LLMProvider, Mailer, Scanner, SecretStore, Storage } from './types';

export interface AdapterSet {
  mailer: Mailer;
  storage: Storage;
  scanner: Scanner;
  secrets: SecretStore;
  llm: LLMProvider | null;
  auth: AuthAdapter;
}

export function createAdapters(opts: { db?: () => Database } = {}): AdapterSet {
  const db = opts.db ?? (() => getDb());
  const mailer = new DevOutboxMailer(db);
  return {
    mailer,
    storage: new LocalStorage(),
    scanner: new NoopScanner(),
    secrets: new AesSecretStore(db),
    llm: new FakeLlm(),
    auth: new TestAuthAdapter({ db, mailer }),
  };
}
