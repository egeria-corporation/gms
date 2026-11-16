// SPDX-License-Identifier: AGPL-3.0-only
// A person's own preferences: the language the GMS speaks to them in (docs/i18n.md). The web app
// reads it from `GET /gms/me` and saves it with `PUT /gms/me/preferences`; whatever sends someone an
// email asks `recipientLocale` for the language to write in. One row per person (migration 0043).
import { DEFAULT_LOCALE, isLocale, type Locale } from "@gms/i18n";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { parse } from "../lib/input.ts";
import { authorize, type ServiceContext, type ServicePorts } from "./context.ts";

export interface PreferencesPort {
  /** The saved language of each person who chose one; people without a choice are absent. */
  locales(userIds: readonly string[]): Promise<Map<string, Locale>>;
  /** Save a person's language; null clears it (the browser's language again, English for emails). */
  setLocale(userId: string, locale: Locale | null): Promise<void>;
}

const unavailable = () => new ApiError(501, "preferences_unavailable", "Saving preferences is not available on this server");

/** The signed-in person's saved language, or null when they never chose (or the server cannot store one). */
export async function myLocale(ctx: Pick<ServiceContext, "ports" | "actor">): Promise<Locale | null> {
  const userId = ctx.actor.userId;
  if (!userId || !ctx.ports.preferences) return null;
  return (await ctx.ports.preferences.locales([userId])).get(userId) ?? null;
}

const PreferencesInput = z.object({ locale: z.enum(["en", "es"]).nullable() }).strict();

/** Save the signed-in person's language. A person only: an agent or API client never changes it. */
export async function setMyPreferences(ctx: ServiceContext, body: unknown): Promise<{ locale: Locale | null }> {
  await authorize(ctx, { person: true });
  const { locale } = parse(PreferencesInput, body);
  if (!ctx.ports.preferences) throw unavailable();
  await ctx.ports.preferences.setLocale(ctx.actor.userId!, locale);
  return { locale };
}

/**
 * The language to write to each person in: their saved preference, else English. Someone without
 * an account (an address only) is written to in English. Never throws: a store that cannot be read
 * means English, so an email is never held back by a preference.
 */
export async function recipientLocales(ports: Pick<ServicePorts, "preferences">, userIds: readonly (string | null | undefined)[]): Promise<Map<string, Locale>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  const saved = ids.length && ports.preferences ? await ports.preferences.locales(ids).catch(() => new Map<string, Locale>()) : new Map<string, Locale>();
  return new Map(ids.map((id) => [id, saved.get(id) ?? DEFAULT_LOCALE]));
}

export async function recipientLocale(ports: Pick<ServicePorts, "preferences">, userId: string | null | undefined): Promise<Locale> {
  return userId ? ((await recipientLocales(ports, [userId])).get(userId) ?? DEFAULT_LOCALE) : DEFAULT_LOCALE;
}

export class MemoryPreferences implements PreferencesPort {
  readonly rows = new Map<string, Locale | null>();
  async locales(userIds: readonly string[]): Promise<Map<string, Locale>> {
    const out = new Map<string, Locale>();
    for (const id of userIds) {
      const l = this.rows.get(id);
      if (l) out.set(id, l);
    }
    return out;
  }
  async setLocale(userId: string, locale: Locale | null): Promise<void> {
    this.rows.set(userId, locale);
  }
}

/** The part of the Supabase client this port uses: the `user_preferences` table (service role). */
export interface SupabasePreferencesLike {
  from(table: "user_preferences"): {
    select(columns: string): { in(column: string, values: readonly string[]): PromiseLike<{ data: unknown; error: { message: string } | null }> };
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
  };
}

export class SupabasePreferences implements PreferencesPort {
  constructor(private readonly db: SupabasePreferencesLike) {}
  async locales(userIds: readonly string[]): Promise<Map<string, Locale>> {
    if (!userIds.length) return new Map();
    const { data, error } = await this.db.from("user_preferences").select("user_id, locale").in("user_id", userIds);
    if (error) throw new Error(`Reading preferences failed: ${error.message}`);
    const out = new Map<string, Locale>();
    for (const row of (data as { user_id: string; locale: string | null }[] | null) ?? []) if (isLocale(row.locale)) out.set(row.user_id, row.locale);
    return out;
  }
  async setLocale(userId: string, locale: Locale | null): Promise<void> {
    const { error } = await this.db.from("user_preferences").upsert({ user_id: userId, locale }, { onConflict: "user_id" });
    if (error) throw new Error(`Saving preferences failed: ${error.message}`);
  }
}
