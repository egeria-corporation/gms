// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// Dev-only: simulate the bank side of the fake Mercury rail for the current tenant. These are not GMS mutations
// (they play Mercury), so they use the fake controls directly; afterwards the system polls run through the
// executor so GMS picks up the change exactly as it would in production.
import { getRuntime, systemContext, type WorkspaceRef } from '@gms/actions';
import { fakeMercuryControls } from '@gms/adapters';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { config } from '@/lib/config';
import { kickOutbox } from '@/lib/server/outbox';
import { requireTenant } from '@/lib/tenant';

export type DevResult = { ok: true; message: string } | { ok: false; message: string };

async function context() {
  if (!config.devToolsEnabled) throw new Error('Dev tools are disabled in this environment.');
  const tenant = await requireTenant();
  const rt = getRuntime();
  const ws: WorkspaceRef = { id: tenant.id, slug: tenant.slug, name: tenant.name, timezone: tenant.timezone };
  const conn = await rt.db
    .selectFrom('bank_connections')
    .select(['provider', 'environment'])
    .where('workspace_id', '=', tenant.id)
    .where('status', '=', 'connected')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  if (!conn || conn.provider !== 'mercury' || conn.environment !== 'fake') {
    throw new Error('This workspace is not connected to the simulated bank. Connect it on Payments → Bank connection (environment “Simulated bank”).');
  }
  return { rt, ws, tenant, controls: fakeMercuryControls(tenant.id, rt.db) };
}

async function pollAll(rt: ReturnType<typeof getRuntime>, ws: WorkspaceRef) {
  const ctx = systemContext(ws, 'worker');
  const payees = await rt.executor.run<{ ready: number; expired: number }>('system.poll_payees', {}, ctx);
  const bank = await rt.executor.run<{ sent: number; failed: number }>('system.poll_bank_requests', {}, ctx);
  kickOutbox();
  const bits = [
    payees.ready ? `${payees.ready} payee(s) now Ready` : '',
    payees.expired ? `${payees.expired} invite(s) expired` : '',
    bank.sent ? `${bank.sent} payment(s) now Sent` : '',
    bank.failed ? `${bank.failed} payment(s) Failed` : '',
  ].filter(Boolean);
  return bits.length ? ` GMS picked it up: ${bits.join(', ')}.` : ' GMS polled; nothing else changed yet.';
}

function done() {
  revalidatePath('/dev/mercury');
  revalidatePath('/console/payments', 'layout');
}

async function wrap(fn: () => Promise<string>): Promise<DevResult> {
  try {
    const message = await fn();
    done();
    return { ok: true, message };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function seedAccountsAction(): Promise<DevResult> {
  return wrap(async () => {
    const { rt, ws, controls } = await context();
    await controls.seedAccounts([
      { name: 'Operating', mask: '4821', availableCents: 250_000_000 },
      { name: 'Grants disbursement', mask: '7730', availableCents: 1_200_000_000 },
    ]);
    const r = await rt.executor.run<{ accounts: number }>('bank.sync', {}, systemContext(ws, 'worker'));
    return `Simulated accounts ready; GMS synced ${r.accounts} account(s).`;
  });
}

export async function completeInviteAction(inviteId: string): Promise<DevResult> {
  return wrap(async () => {
    const { rt, ws, controls } = await context();
    await controls.completeInvite(inviteId);
    return `Invite completed (the grantee finished onboarding).${await pollAll(rt, ws)}`;
  });
}

export async function expireInviteAction(inviteId: string): Promise<DevResult> {
  return wrap(async () => {
    const { rt, ws, controls } = await context();
    await controls.expireInvite(inviteId);
    return `Invite expired.${await pollAll(rt, ws)}`;
  });
}

export async function approveRequestAction(requestId: string): Promise<DevResult> {
  return wrap(async () => {
    const { rt, ws, controls } = await context();
    const r = await controls.approveRequest(requestId);
    return `Request approved in “Mercury”; transaction ${r.transaction.id} is pending.${await pollAll(rt, ws)}`;
  });
}

export async function rejectRequestAction(requestId: string): Promise<DevResult> {
  return wrap(async () => {
    const { rt, ws, controls } = await context();
    await controls.rejectRequest(requestId);
    return `Request rejected in “Mercury”.${await pollAll(rt, ws)}`;
  });
}

export async function settleTransactionAction(txId: string): Promise<DevResult> {
  return wrap(async () => {
    const { rt, ws, controls } = await context();
    await controls.settleTransaction(txId);
    return `Transaction settled (sent).${await pollAll(rt, ws)}`;
  });
}

export async function failTransactionAction(txId: string): Promise<DevResult> {
  return wrap(async () => {
    const { rt, ws, controls } = await context();
    await controls.failTransaction(txId, 'Recipient account closed (simulated)');
    return `Transaction failed; funds returned to the account.${await pollAll(rt, ws)}`;
  });
}

export async function reconcileAction(): Promise<DevResult> {
  return wrap(async () => {
    const { rt, ws } = await context();
    const r = await rt.executor.run<{ mirrored: number; reconciled: number; exceptions: number }>('system.reconcile', { days: 30 }, systemContext(ws, 'worker'));
    kickOutbox();
    return `Reconciliation ran: ${r.mirrored} transaction(s) mirrored, ${r.reconciled} reconciled, ${r.exceptions} new exception(s).`;
  });
}

/** Signs the latest event for a resource (as Mercury would) and POSTs it to this app's /webhooks/mercury. */
export async function emitWebhookAction(eventType: string, resourceId: string): Promise<DevResult> {
  return wrap(async () => {
    const { controls, tenant } = await context();
    if (!/^[a-zA-Z.]{3,60}$/.test(eventType)) throw new Error('Unknown event type.');
    const { rawBody, headers: signed } = await controls.emitWebhook(eventType, resourceId);
    const h = await headers();
    const host = h.get('host') ?? '';
    const port = /:(\d+)$/.exec(host)?.[1];
    // Tenant subdomains of localhost don't resolve from Node on every OS: post to the loopback address and name
    // the tenant with the dev-only override header instead.
    const local = /localhost|127\.0\.0\.1/.test(host);
    const url = local ? `http://127.0.0.1${port ? `:${port}` : ''}/webhooks/mercury` : `${tenant.origin}/webhooks/mercury`;
    const res = await fetch(url, { method: 'POST', body: rawBody, headers: { ...signed, ...(local ? { 'x-gms-tenant': tenant.slug } : {}) }, cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as { duplicate?: boolean; error?: string };
    if (!res.ok) throw new Error(`The webhook endpoint answered ${res.status}${body.error ? ` (${body.error})` : ''}.`);
    return `Webhook ${eventType} delivered (HTTP ${res.status}${body.duplicate ? ', duplicate — already received' : ''}). GMS applies it in the background.`;
  });
}
