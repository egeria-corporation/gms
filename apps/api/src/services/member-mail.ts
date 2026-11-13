// SPDX-License-Identifier: AGPL-3.0-only
// Email to the people in a workspace, honoring each member's notification preferences:
// a category with `email: false` is never mailed; `digest: daily|weekly` holds the mail for the
// digest job; `immediate` (and `off`, which means "no digest") sends at once. A few notices are
// `always` sent at once to everyone who has not turned the category's email off (revision
// requests, payment confirmations).
//
// Addresses come from the auth provider through the UserDirectory port. Without a mailer, a
// sender address or a directory, nothing is sent and nothing fails.
import { escapeHtml } from "@gms/notify";
import { audit, type BaseContext, type ServiceContext } from "./context.ts";
import { deriveFor, normalizePreferences, type Category } from "./notifications.ts";
import type { Row } from "./repos/types.ts";

type Member = Row<"workspace_members">;
type Mailing = Pick<ServiceContext, "repos" | "ports" | "config" | "now" | "ledger">;

const live = (m: Member, now: Date) => !m.expires_at || Date.parse(m.expires_at) > now.getTime();
const paragraphs = (text: string) => text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");

export interface MemberMail {
  workspaceId: string;
  category: Category;
  subject: string;
  /** Plain text; the HTML part is derived from it. */
  text: string;
  /** Where the notice leads, appended as the last line. */
  link?: string;
  /** The person who caused the notice is not mailed about it. */
  exceptUserId?: string | null;
  /** Only members with one of these roles; everyone when absent. */
  roles?: readonly string[];
  /** Sent at once even to members on a digest (still not to members who turned the category's email off). */
  always?: boolean;
  replyTo?: string;
  /** Made unique per recipient; a retried send is not delivered twice. */
  idempotencyKey: string;
}

export async function mailMembers(ctx: Mailing, mail: MemberMail): Promise<{ sent: number; deferred: number; skipped: number }> {
  const out = { sent: 0, deferred: 0, skipped: 0 };
  const { mailer, directory } = ctx.ports;
  const from = ctx.config.mailFrom;
  if (!mailer || !from || !directory) return out;
  const members = (await ctx.repos.table("workspace_members").find({ workspace_id: mail.workspaceId })).filter((m) => live(m, ctx.now()) && m.user_id !== mail.exceptUserId && (!mail.roles || mail.roles.includes(m.role)));
  const people = await directory.lookup(members.map((m) => m.user_id));
  const body = mail.link ? `${mail.text}\n\n${mail.link}` : mail.text;
  for (const m of members) {
    const prefs = normalizePreferences(m.notification_preferences as never);
    const to = people.get(m.user_id)?.email;
    if (!to || !prefs.channels[mail.category].email) {
      out.skipped++;
      continue;
    }
    if (!mail.always && (prefs.digest === "daily" || prefs.digest === "weekly")) {
      out.deferred++;
      continue;
    }
    try {
      await mailer.send({ from, to: [to], subject: mail.subject, text: body, html: paragraphs(body), ...(mail.replyTo ? { replyTo: mail.replyTo } : {}), idempotencyKey: `${mail.idempotencyKey}:${m.user_id}` });
      out.sent++;
    } catch {
      // A failed notice never fails the action that caused it; the in-app notification remains.
      out.skipped++;
    }
  }
  return out;
}

const PERIOD_MS = { daily: 86_400_000, weekly: 7 * 86_400_000 } as const;

/**
 * The digest job: one email per member on that cadence, listing what happened since their last
 * digest in the categories they still want by email. The send is ledgered
 * (`notification.digest_sent`, subject = the membership), which is also how the next run knows
 * where to start; the ledger key makes a re-run on the same day a no-op.
 */
export async function sendDigests(base: BaseContext, cadence: "daily" | "weekly"): Promise<{ sent: number; empty: number; failed: number }> {
  const out = { sent: 0, empty: 0, failed: 0 };
  const { mailer, directory } = base.ports;
  const from = base.config.mailFrom;
  if (!mailer || !from || !directory) return out;
  const now = base.now();
  const day = now.toISOString().slice(0, 10);
  const members = (await base.repos.table("workspace_members").find({})).filter((m) => live(m, now) && normalizePreferences(m.notification_preferences as never).digest === cadence);
  const people = await directory.lookup(members.map((m) => m.user_id));
  for (const m of members) {
    try {
      const to = people.get(m.user_id)?.email;
      const ws = await base.repos.table("workspaces").one({ id: m.workspace_id });
      if (!to || !ws) continue;
      const last = (await base.ledger.list({ workspaceId: ws.id, eventType: "notification.digest_sent", subjectId: m.id, limit: 1 }))[0];
      if (last && (last.data as { day?: string }).day === day) continue;
      const since = last?.occurredAt ?? new Date(now.getTime() - PERIOD_MS[cadence]).toISOString();
      const prefs = normalizePreferences(m.notification_preferences as never);
      const items = (await deriveFor(base, m, ws)).filter((n) => n.at > since && prefs.channels[n.category].email);
      if (!items.length) {
        out.empty++;
        continue;
      }
      const lines = items.slice(0, 50).map((n) => `- ${n.title}${n.message ? `: ${n.message}` : ""}`);
      const link = `${base.config.webBaseUrl}/notifications`;
      const text = `Here is what happened in ${ws.display_name} since your last digest.\n\n${lines.join("\n")}${items.length > 50 ? `\n… and ${items.length - 50} more` : ""}\n\n${link}`;
      await mailer.send({ from, to: [to], subject: `${ws.display_name}: ${items.length} update${items.length === 1 ? "" : "s"}`, text, html: paragraphs(text), idempotencyKey: `digest:${m.id}:${day}` });
      await audit({ ...base, actor: { kind: "system", userId: null, clientId: null, ledger: { kind: "system", job: "digest" }, id: "system:digest" }, workspace: null, scopes: [] }, "notification.digest_sent", "workspace_member", m.id, { cadence, day, count: items.length }, ws.id);
      out.sent++;
    } catch {
      out.failed++;
    }
  }
  return out;
}
