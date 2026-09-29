// SPDX-License-Identifier: AGPL-3.0-or-later
// SMTP mailer (nodemailer) configured from SMTP_URL, e.g. smtps://user:pass@smtp.example.org:465.
// Outside production deploys it is always wrapped by GuardedMailer (./guard.ts).
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailMessage, Mailer, MailResult } from '../types';
import { MailProviderError } from './resend';

export interface SmtpMailerOptions {
  /** SMTP connection URL. Never logged. */
  url?: string;
  /** Pre-built transport (tests use nodemailer's jsonTransport/streamTransport). */
  transport?: Transporter;
}

export class SmtpMailer implements Mailer {
  readonly name = 'smtp' as const;
  private readonly transport: Transporter;

  constructor(opts: SmtpMailerOptions) {
    if (opts.transport) this.transport = opts.transport;
    else {
      if (!opts.url) throw new Error('SMTP_URL is missing');
      this.transport = nodemailer.createTransport(opts.url);
    }
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name };
  }

  async send(msg: MailMessage): Promise<MailResult> {
    const headers: Record<string, string> = { ...(msg.headers ?? {}) };
    for (const [k, v] of Object.entries(msg.tags ?? {})) {
      const name = `X-GMS-Tag-${k.replace(/[^A-Za-z0-9-]/g, '-')}`;
      headers[name] = v.replace(/[\r\n]/g, ' ');
    }
    if (msg.workspaceId) headers['X-GMS-Workspace'] = msg.workspaceId;
    try {
      const info = (await this.transport.sendMail({
        from: msg.fromName ? { name: msg.fromName, address: msg.from } : msg.from,
        to: msg.to,
        replyTo: msg.replyTo,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers,
      })) as { messageId?: string };
      return { provider: 'smtp', messageId: info.messageId ?? '' };
    } catch (err) {
      // nodemailer errors can include the server response but not credentials; keep only the message.
      const message = err instanceof Error ? err.message.replace(/\/\/[^@\s]+@/g, '//[redacted]@') : 'send failed';
      throw new MailProviderError('smtp', 0, `SMTP send failed: ${message}`);
    }
  }
}
