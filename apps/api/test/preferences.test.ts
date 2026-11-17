// SPDX-License-Identifier: AGPL-3.0-only
// A person's language (docs/i18n.md, migration 0043): read with /gms/me, saved by the person only,
// and the language their emails are written in.
import { beforeEach, describe, expect, it } from "vitest";
import { mailMembers } from "../src/services/member-mail.ts";
import { recipientLocale, recipientLocales } from "../src/services/preferences.ts";
import { USER_ADMIN, USER_OFFICER, WS_FUNDER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const me = async (userId: string) => ((await (await h.request("/gms/me", bearer(await h.session(userId)))).json()) as { data: { locale: string | null } }).data;
const save = async (userId: string, body: unknown) => h.request("/gms/me/preferences", { method: "PUT", headers: { ...bearer(await h.session(userId)).headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("a person's language", () => {
  it("is none until they choose, then follows them", async () => {
    expect((await me(USER_ADMIN)).locale).toBeNull();
    const res = await save(USER_ADMIN, { locale: "es" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({ locale: "es" });
    expect((await me(USER_ADMIN)).locale).toBe("es");
    // Someone else's is their own.
    expect((await me(USER_OFFICER)).locale).toBeNull();
    // Cleared, the browser's language applies again.
    await save(USER_ADMIN, { locale: null });
    expect((await me(USER_ADMIN)).locale).toBeNull();
  });

  it("is only a language the GMS speaks, and nothing else rides along", async () => {
    expect((await save(USER_ADMIN, { locale: "fr" })).status).toBe(400);
    expect((await save(USER_ADMIN, { locale: "es", userId: USER_OFFICER })).status).toBe(400);
    expect((await save(USER_ADMIN, null)).status).toBe(400);
    expect(h.preferences.rows.size).toBe(0);
  });

  it("is set by the signed-in person, never by an API client or agent", async () => {
    const token = await clientCredentialsToken(h);
    const res = await h.request("/gms/me/preferences", { method: "PUT", headers: { ...bearer(token).headers, "Content-Type": "application/json" }, body: JSON.stringify({ locale: "es" }) });
    expect([401, 403]).toContain(res.status);
    expect((await h.request("/gms/me/preferences", { method: "PUT", body: "{}" })).status).toBe(401);
    expect(h.preferences.rows.size).toBe(0);
  });

  it("answers 501 where the server cannot store it, and /gms/me still works", async () => {
    h.withoutPorts.add("preferences");
    expect((await save(USER_ADMIN, { locale: "es" })).status).toBe(501);
    expect((await me(USER_ADMIN)).locale).toBeNull();
  });
});

describe("the language of a person's emails", () => {
  it("is their saved language, else English; an address without an account is English", async () => {
    await h.preferences.setLocale(USER_ADMIN, "es");
    const ports = { preferences: h.preferences };
    expect(await recipientLocale(ports, USER_ADMIN)).toBe("es");
    expect(await recipientLocale(ports, USER_OFFICER)).toBe("en");
    expect(await recipientLocale(ports, null)).toBe("en");
    expect(await recipientLocale({}, USER_ADMIN)).toBe("en");
    expect(Object.fromEntries(await recipientLocales(ports, [USER_ADMIN, USER_OFFICER, USER_ADMIN]))).toEqual({ [USER_ADMIN]: "es", [USER_OFFICER]: "en" });
  });

  it("is English when the store cannot be read: an email is never held back by a preference", async () => {
    const broken = { preferences: { locales: async () => Promise.reject(new Error("down")), setLocale: async () => {} } };
    expect(await recipientLocale(broken, USER_ADMIN)).toBe("en");
  });

  it("writes a member notice in each member's language when the notice is localized", async () => {
    await h.preferences.setLocale(USER_ADMIN, "es");
    const ctx = { repos: h.repos, ledger: h.ledger, now: () => h.clock.now, config: { mailFrom: "GMS <no-reply@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory, preferences: h.preferences } } as unknown as Parameters<typeof mailMembers>[0];
    const before = h.mailer.sent.length;
    await mailMembers(ctx, {
      workspaceId: WS_FUNDER,
      category: "application",
      subject: "unused",
      text: "unused",
      userIds: [USER_ADMIN, USER_OFFICER],
      always: true,
      idempotencyKey: "i18n-test",
      localized: (locale) => (locale === "es" ? { subject: "Nueva solicitud", text: "Llegó una solicitud." } : { subject: "New application", text: "An application arrived." }),
    });
    const sent = h.mailer.sent.slice(before);
    const byTo = Object.fromEntries(sent.map((m) => [m.to[0], [m.subject, m.locale ?? "en"]]));
    expect(byTo).toEqual({ "helen.ortiz@riverbendcf.example": ["Nueva solicitud", "es"], "dana.ortiz@riverbendcf.example": ["New application", "en"] });
  });
});
