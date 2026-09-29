// SPDX-License-Identifier: AGPL-3.0-or-later
// Billing stub for self-hosted and v1 deployments: every workspace is on the self_hosted plan.
import type { BillingAdapter } from '../types';

export class StubBilling implements BillingAdapter {
  readonly name = 'stub' as const;
  constructor(private readonly plan = process.env.GMS_DEFAULT_PLAN ?? 'self_hosted') {}

  async planFor(_workspaceId: string): Promise<{ plan: string; status: 'active' | 'trialing' | 'past_due' | 'none' }> {
    return { plan: this.plan, status: 'active' };
  }
}
