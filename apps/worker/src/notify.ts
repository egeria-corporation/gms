// SPDX-License-Identifier: AGPL-3.0-only
// Branded email + in-app notifications for the worker. Every email is recorded in email_deliveries.
import { originFor, type Runtime } from '@gms/actions';
import type { Database } from '@gms/db';
import { renderEmail, type Brand, type TemplateKey, type TemplateProps } from '@gms/email';

export interface WorkspaceInfo {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  origin: string;
  brand: Brand;
  senderName: string;
  replyTo: string | null;
}

const SOURCE_URL = process.env.NEXT_PUBLIC_GMS_SOURCE_URL ?? process.env.GMS_SOURCE_URL ?? 'https://github.com/egeria-corporation/gms';
const FROM = process.env.GMS_EMAIL_FROM ?? 'no-reply@gms.example';

const cache = new Map<string, { at: number; info: WorkspaceInfo }>();

export async function workspaceInfo(db: Database, workspaceId: string): Promise<WorkspaceInfo | null> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < 60_000) return hit.info;
  const w = await db
    .selectFrom('workspaces as w')
    .innerJoin('workspace_brand as b', 'b.workspace_id', 'w.id')
    .select(['w.id', 'w.slug', 'w.name', 'w.timezone', 'b.display_name', 'b.primary_color', 'b.accent_color', 'b.heading_font', 'b.logo_path', 'b.email_sender_name', 'b.email_reply_to'])
    .where('w.id', '=', workspaceId)
    .executeTakeFirst();
  if (!w) return null;
  const origin = originFor(w.slug);
  const info: WorkspaceInfo = {
    id: w.id,
    slug: w.slug,
    name: w.name,
    timezone: w.timezone,
    origin,
    senderName: w.email_sender_name ?? w.display_name,
    replyTo: w.email_reply_to,
    brand: {
      displayName: w.display_name,
      logoUrl: w.logo_path ? `${origin}/brand/logo` : null,
      primaryColor: w.primary_color,
      accentColor: w.accent_color,
      headingFont: w.heading_font,
      replyTo: w.email_reply_to,
      sourceUrl: SOURCE_URL,
    },
  };
  cache.set(workspaceId, { at: Date.now(), info });
  return info;
}

export async function sendTemplate<K extends TemplateKey>(
  rt: Runtime,
  ws: WorkspaceInfo | null,
  to: string,
  template: K,
  props: TemplateProps<K>,
  opts: { bulkMessageId?: string; deliveryId?: string } = {},
): Promise<void> {
  const brand: Brand = ws?.brand ?? { displayName: 'GMS', primaryColor: '#1F4E79', accentColor: '#C9822B', sourceUrl: SOURCE_URL };
  const rendered = await renderEmail(template, props, brand);
  let deliveryId = opts.deliveryId;
  if (!deliveryId) {
    const d = await rt.db
      .insertInto('email_deliveries')
      .values({ workspace_id: ws?.id ?? null, bulk_message_id: opts.bulkMessageId ?? null, template_key: template, to_email: to, subject: rendered.subject, provider: rt.adapters.mailer.name, status: 'queued' })
      .returning('id')
      .executeTakeFirstOrThrow();
    deliveryId = d.id;
  }
  try {
    const res = await rt.adapters.mailer.send({
      to,
      from: FROM,
      fromName: ws?.senderName ?? 'GMS',
      replyTo: ws?.replyTo ?? undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      workspaceId: ws?.id ?? null,
      tags: { template, delivery: deliveryId },
    });
    await rt.db.updateTable('email_deliveries').set({ status: 'sent', provider: res.provider, provider_message_id: res.messageId }).where('id', '=', deliveryId).execute();
  } catch (err) {
    await rt.db.updateTable('email_deliveries').set({ status: 'failed', error: (err as Error).message.slice(0, 500) }).where('id', '=', deliveryId).execute();
    throw err;
  }
}

export async function notifyInApp(db: Database, input: { workspaceId: string | null; userIds: string[]; kind: string; title: string; body?: string; link?: string }): Promise<void> {
  const ids = [...new Set(input.userIds)].filter(Boolean);
  if (!ids.length) return;
  await db
    .insertInto('notifications')
    .values(ids.map((user_id) => ({ workspace_id: input.workspaceId, user_id, kind: input.kind, title: input.title, body: input.body ?? null, link: input.link ?? null })))
    .execute();
}

/** Staff members with the given roles (active). */
export async function staffWith(db: Database, workspaceId: string, roles: string[]): Promise<{ id: string; email: string; name: string | null }[]> {
  return db
    .selectFrom('workspace_members as m')
    .innerJoin('profiles as p', 'p.id', 'm.user_id')
    .select(['p.id', 'p.email', 'p.full_name as name'])
    .where('m.workspace_id', '=', workspaceId)
    .where('m.status', '=', 'active')
    .where('m.role', 'in', roles)
    .execute();
}

/** People who should hear about an application: the applicant, org admins, and active collaborators. */
export async function applicationRecipients(db: Database, applicationId: string): Promise<{ id: string; email: string; name: string | null }[]> {
  const app = await db.selectFrom('applications').select(['applicant_user_id', 'applicant_org_id']).where('id', '=', applicationId).executeTakeFirst();
  if (!app) return [];
  const people = new Map<string, { id: string; email: string; name: string | null }>();
  const main = await db.selectFrom('profiles').select(['id', 'email', 'full_name as name']).where('id', '=', app.applicant_user_id).executeTakeFirst();
  if (main) people.set(main.id, main);
  if (app.applicant_org_id) {
    const admins = await db
      .selectFrom('applicant_org_members as m')
      .innerJoin('profiles as p', 'p.id', 'm.user_id')
      .select(['p.id', 'p.email', 'p.full_name as name'])
      .where('m.org_id', '=', app.applicant_org_id)
      .where('m.role', '=', 'org_admin')
      .execute();
    for (const a of admins) people.set(a.id, a);
  }
  return [...people.values()];
}

export async function orgAdmins(db: Database, orgId: string | null): Promise<{ id: string; email: string; name: string | null }[]> {
  if (!orgId) return [];
  return db
    .selectFrom('applicant_org_members as m')
    .innerJoin('profiles as p', 'p.id', 'm.user_id')
    .select(['p.id', 'p.email', 'p.full_name as name'])
    .where('m.org_id', '=', orgId)
    .where('m.role', '=', 'org_admin')
    .execute();
}
