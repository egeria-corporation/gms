// SPDX-License-Identifier: AGPL-3.0-only
// The language to write an email in when the recipient is known by address (docs/i18n.md): the saved
// preference of the person with that address, English for an address without an account, and
// English when the preference cannot be read. Never throws: an email is not held back by a language.
import { DEFAULT_LOCALE, type Locale } from "@gms/i18n";
import type { ServiceContext } from "./context.ts";
import { recipientLocale, recipientLocales } from "./preferences.ts";

type Ctx = Pick<ServiceContext, "repos" | "ports" | "now">;

/** An invitee's language: the account with that address, when there is one. */
export async function addressLocale(ctx: Pick<ServiceContext, "ports">, email: string | null | undefined): Promise<Locale> {
  if (!email || !ctx.ports.identity || !ctx.ports.preferences) return DEFAULT_LOCALE;
  const userId = await ctx.ports.identity.findByEmail(email.trim().toLowerCase()).catch(() => null);
  return recipientLocale(ctx.ports, userId);
}

/**
 * Each address's language for a workspace's mail. A live member's sign-in address is in that
 * member's language. Any other address (the organization's own, from its Passport record) is read
 * by the organization's admins: it is in their language when every admin chose the same one, and
 * English otherwise.
 */
export async function memberAddressLocales(ctx: Ctx, workspaceId: string | null | undefined, emails: readonly string[]): Promise<Map<string, Locale>> {
  const out = new Map(emails.map((e) => [e.toLowerCase(), DEFAULT_LOCALE as Locale]));
  if (!workspaceId || !emails.length || !ctx.ports.directory || !ctx.ports.preferences) return out;
  try {
    const now = ctx.now().getTime();
    const members = (await ctx.repos.table("workspace_members").find({ workspace_id: workspaceId })).filter((m) => !m.expires_at || Date.parse(m.expires_at) > now);
    const people = await ctx.ports.directory.lookup(members.map((m) => m.user_id));
    const admins = members.filter((m) => m.role === "admin").map((m) => m.user_id);
    const byEmail = new Map<string, string>();
    for (const m of members) {
      const email = people.get(m.user_id)?.email?.toLowerCase();
      if (email && out.has(email)) byEmail.set(email, m.user_id);
    }
    const locales = await recipientLocales(ctx.ports, [...new Set([...byEmail.values(), ...admins])]);
    const adminLocales = new Set(admins.map((id) => locales.get(id) ?? DEFAULT_LOCALE));
    const organization = adminLocales.size === 1 ? [...adminLocales][0]! : DEFAULT_LOCALE;
    for (const email of out.keys()) {
      const userId = byEmail.get(email);
      out.set(email, userId ? (locales.get(userId) ?? DEFAULT_LOCALE) : organization);
    }
  } catch {
    // Unreadable: everyone in English.
  }
  return out;
}

/** Addresses grouped by language, English first, each group in the order given. */
export function byLocale(emails: readonly string[], locales: ReadonlyMap<string, Locale>): [Locale, string[]][] {
  const groups = new Map<Locale, string[]>();
  for (const e of emails) {
    const l = locales.get(e.toLowerCase()) ?? DEFAULT_LOCALE;
    groups.set(l, [...(groups.get(l) ?? []), e]);
  }
  return [...groups].sort(([a], [b]) => (a === DEFAULT_LOCALE ? -1 : b === DEFAULT_LOCALE ? 1 : a.localeCompare(b)));
}
