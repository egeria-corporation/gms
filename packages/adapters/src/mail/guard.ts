// SPDX-License-Identifier: AGPL-3.0-or-later
// GuardedMailer: outside production deploys, real mailers (Resend/SMTP) may only deliver to Resend's test
// addresses (…@resend.dev) or to hosts listed in GMS_EMAIL_ALLOWLIST. Everything else is captured in the dev
// outbox with the tag redirected=true, so development and demo data can never email a real person.
import { isProductionDeploy } from '../crypto';
import type { MailMessage, Mailer, MailResult } from '../types';

export interface GuardedMailerOptions {
  /** Hosts (domains) or full addresses allowed through; defaults to GMS_EMAIL_ALLOWLIST (comma-separated). */
  allowlist?: readonly string[];
  /** Defaults to isProductionDeploy(). In production the guard passes everything through. */
  production?: boolean;
}

export function parseAllowlist(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/** Extracts a single bare address from "Name <a@b>" or "a@b". Returns null for lists or malformed input. */
export function bareAddress(to: string): string | null {
  const t = to.trim();
  const angle = /^[^<>]*<([^<>\s]+)>$/.exec(t);
  const addr = (angle ? angle[1]! : t).toLowerCase();
  if (/[,;\s]/.test(addr)) return null;
  if (!/^[^@\s]+@[a-z0-9.-]+\.[a-z0-9-]+$/.test(addr)) return null;
  return addr;
}

export function isDeliverableOutsideProduction(to: string, allowlist: readonly string[]): boolean {
  const addr = bareAddress(to);
  if (!addr) return false;
  const host = addr.slice(addr.lastIndexOf('@') + 1);
  if (host === 'resend.dev') return true;
  return allowlist.some((entry) => (entry.includes('@') ? entry === addr : entry === host));
}

export class GuardedMailer implements Mailer {
  readonly name: Mailer['name'];
  private readonly allowlist: readonly string[];
  private readonly production: boolean;

  constructor(
    readonly inner: Mailer,
    readonly fallback: Mailer,
    opts: GuardedMailerOptions = {},
  ) {
    this.name = inner.name;
    this.allowlist = (opts.allowlist ?? parseAllowlist(process.env.GMS_EMAIL_ALLOWLIST)).map((s) => s.toLowerCase().replace(/^@/, ''));
    this.production = opts.production ?? isProductionDeploy();
  }

  async send(msg: MailMessage): Promise<MailResult> {
    if (this.production) return this.inner.send(msg);
    if (isDeliverableOutsideProduction(msg.to, this.allowlist)) {
      // Custom headers must not add recipients behind the guard's back.
      const headers = Object.fromEntries(
        Object.entries(msg.headers ?? {}).filter(([k]) => !/^(to|cc|bcc|resent-(to|cc|bcc))$/i.test(k.trim())),
      );
      return this.inner.send({ ...msg, headers });
    }
    return this.fallback.send({
      ...msg,
      tags: { ...(msg.tags ?? {}), redirected: 'true', intended_provider: this.inner.name },
    });
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, secret: string): boolean {
    return this.inner.verifyWebhook ? this.inner.verifyWebhook(rawBody, headers, secret) : false;
  }
}
