// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
  AuthAdapter,
  DiligenceSource,
  LLMProvider,
  Mailer,
  PaymentRail,
  Scanner,
  SecretStore,
  Storage,
} from '@gms/adapters/types';
import type { Tx } from '@gms/db';

/** External dependencies injected into every action run. Real or fake per environment. */
export interface ActionDeps {
  mailer: Mailer;
  storage: Storage;
  scanner: Scanner;
  secrets: SecretStore;
  llm: LLMProvider | null;
  diligence: DiligenceSource;
  auth: AuthAdapter | null;
  /** Resolves the payment rail configured for a workspace (fake-mercury, mercury sandbox, or manual). */
  paymentRail(workspaceId: string, db: Tx): Promise<PaymentRail>;
  /** Absolute origin for a workspace, e.g. http://halcyon.localhost:3000 */
  origin(workspaceSlug: string | null): string;
  clock(): Date;
}
