// SPDX-License-Identifier: AGPL-3.0-only
// Dev mailer: captures every message in the dev_outbox table (viewable at /dev/mail). Never delivers.
import { getDb, type Database } from '@gms/db';
import type { MailMessage, Mailer, MailResult } from '../types';

export class DevOutboxMailer implements Mailer {
  readonly name = 'dev-outbox' as const;
  constructor(private readonly db: () => Database = () => getDb()) {}

  async send(msg: MailMessage): Promise<MailResult> {
    const row = await this.db()
      .insertInto('dev_outbox')
      .values({
        workspace_id: msg.workspaceId ?? null,
        to_email: msg.to,
        from_email: msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        tags: JSON.stringify(msg.tags ?? {}),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { provider: 'dev-outbox', messageId: row.id };
  }
}
