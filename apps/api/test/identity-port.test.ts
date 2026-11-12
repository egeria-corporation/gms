// SPDX-License-Identifier: AGPL-3.0-only
// The account rules behind Sign in with Passport, against a stand-in for the Supabase admin client
// and the database functions of migration 0023: an unconfirmed account is replaced, never adopted;
// a link between an account and a Passport user is recorded when the sign-in creates the account,
// or later by `linkPassportUser` (after the account's own second step); a recorded link is fixed.
import { beforeEach, describe, expect, it } from "vitest";
import { AccountMismatchError, SupabaseIdentity, type SupabaseIdentityLike } from "../src/services/ports.ts";

interface FakeUser {
  id: string;
  email: string;
  confirmed: boolean;
  app: Record<string, unknown>;
  /** Made by this test's `createUser` (the database only links an account as "created" when it is new). */
  fresh?: boolean;
}

function fakeSupabase() {
  const users: FakeUser[] = [];
  /** `passport_account_links`: account id → Passport user and how the link was made. */
  const links = new Map<string, { passportUserId: string; basis: string }>();
  /** `passport_link_requests` already claimed by a session. */
  const requests: { userId: string; sessionId: string; passportUserId: string }[] = [];
  /** Sessions whose row says they passed the account's own second step. */
  const verifiedSessions = new Set<string>();
  const calls: string[] = [];
  const failing = new Set<string>();
  let n = 0;
  const ownerOf = (passportUserId: unknown) => [...links].find(([, l]) => l.passportUserId === passportUserId)?.[0] ?? null;
  const client: SupabaseIdentityLike = {
    rpc: async (fn, args) => {
      calls.push(fn);
      if (failing.has(fn)) return { data: null, error: { message: `${fn} is down` } };
      if (fn === "gms_passport_link_state") return { data: [{ account_passport_user: links.get(String(args.p_user))?.passportUserId ?? null, passport_user_account: ownerOf(args.p_passport_user) }], error: null };
      if (fn === "gms_passport_link_created") {
        const u = users.find((x) => x.id === args.p_user);
        if (!u?.fresh || !u.confirmed || u.app.passport_user_id !== args.p_passport_user) return { data: "refused", error: null };
        if (links.has(u.id) || ownerOf(args.p_passport_user)) return { data: links.get(u.id)?.passportUserId === args.p_passport_user ? "already" : "refused", error: null };
        links.set(u.id, { passportUserId: String(args.p_passport_user), basis: "account_created" });
        return { data: "recorded", error: null };
      }
      if (fn === "gms_passport_link_record") {
        const u = users.find((x) => x.id === args.p_user);
        const mine = links.get(String(args.p_user));
        if (mine) return { data: mine.passportUserId === args.p_passport_user ? "already" : "refused", error: null };
        const asked = requests.some((r) => r.userId === args.p_user && r.sessionId === args.p_session && r.passportUserId === args.p_passport_user);
        const tie = u?.app.passport_user_id;
        if (!u?.confirmed || !asked || !verifiedSessions.has(String(args.p_session)) || (tie && tie !== args.p_passport_user) || ownerOf(args.p_passport_user)) return { data: "refused", error: null };
        links.set(u.id, { passportUserId: String(args.p_passport_user), basis: "own_second_step" });
        return { data: "recorded", error: null };
      }
      const email = String(args.p_email).trim().toLowerCase();
      const u = users.filter((x) => x.email.toLowerCase() === email).sort((a, b) => Number(b.confirmed) - Number(a.confirmed))[0];
      if (fn === "gms_user_id_by_email") return { data: u?.id ?? null, error: null };
      if (fn === "gms_account_by_email") return { data: u ? [{ id: u.id, email_confirmed: u.confirmed, passport_user_id: (u.app.passport_user_id as string | undefined) ?? null }] : [], error: null };
      return { data: null, error: { message: `unknown function ${fn}` } };
    },
    auth: {
      admin: {
        createUser: async (attrs) => {
          calls.push("createUser");
          if (users.some((u) => u.email.toLowerCase() === attrs.email.toLowerCase())) return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
          const user = { id: `user-${++n}`, email: attrs.email, confirmed: attrs.email_confirm, app: { ...attrs.app_metadata }, fresh: true };
          users.push(user);
          return { data: { user: { id: user.id } }, error: null };
        },
        deleteUser: async (id) => {
          calls.push("deleteUser");
          const i = users.findIndex((x) => x.id === id);
          if (i < 0) return { error: { message: "not found" } };
          users.splice(i, 1);
          return { error: null };
        },
        generateLink: async () => ({ data: { properties: { hashed_token: "th", verification_type: "magiclink" } }, error: null }),
      },
    },
  };
  /** A session of `userId` that signed in with Passport as `passportUserId` and then passed the account's own second step. */
  const confirmedSession = (userId: string, passportUserId: string, sessionId = `session-of-${userId}`) => {
    requests.push({ userId, sessionId, passportUserId });
    verifiedSessions.add(sessionId);
    return sessionId;
  };
  return { client, users, links, requests, verifiedSessions, calls, failing, confirmedSession };
}

const EMAIL = "dana@aldercreek.example";
let f: ReturnType<typeof fakeSupabase>;
let identity: SupabaseIdentity;
beforeEach(() => {
  f = fakeSupabase();
  identity = new SupabaseIdentity(f.client);
});

describe("the account for a Passport sign-in", () => {
  it("is created confirmed and linked to the Passport user at once, when the email is new", async () => {
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1", name: "Dana" })).toEqual({ userId: "user-1", created: true, link: "recorded" });
    expect(f.users).toEqual([{ id: "user-1", email: EMAIL, confirmed: true, app: { passport_user_id: "pp-1" }, fresh: true }]);
    expect(f.links.get("user-1")).toEqual({ passportUserId: "pp-1", basis: "account_created" });
    // The same Passport user again: the recorded link, and nothing more is written.
    f.calls.length = 0;
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "user-1", created: false, link: "recorded" });
    expect(f.calls).toEqual(["gms_account_by_email", "gms_passport_link_state"]);
  });

  it("is still created when the link cannot be written, and then waits for its own second step like any other", async () => {
    f.failing.add("gms_passport_link_created");
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "user-1", created: true, link: "pending" });
    expect(f.links.size).toBe(0);
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "user-1", created: false, link: "pending" });
  });

  it("is the existing one when its email was proven here, and nothing is linked by the sign-in itself", async () => {
    f.users.push({ id: "existing", email: EMAIL, confirmed: true, app: { provider: "email" } });
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "existing", created: false, link: "pending" });
    expect(f.users[0]!.app).toEqual({ provider: "email" });
    expect(f.links.size).toBe(0);
    expect(f.calls).toEqual(["gms_account_by_email", "gms_passport_link_state"]);
  });

  it("records the link when told to (after the account's own second step), once, and never replaces it", async () => {
    f.users.push({ id: "existing", email: EMAIL, confirmed: true, app: { provider: "email" } });
    const session = f.confirmedSession("existing", "pp-1");
    expect(await identity.linkPassportUser("existing", "pp-1", session)).toBe("recorded");
    expect(f.links.get("existing")).toEqual({ passportUserId: "pp-1", basis: "own_second_step" });
    // The account's app metadata is not what holds the link, and is not touched.
    expect(f.users[0]!.app).toEqual({ provider: "email" });
    // From then on the same Passport user signs in as a linked account.
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "existing", created: false, link: "recorded" });
    expect(await identity.linkPassportUser("existing", "pp-1", session)).toBe("already");
    expect(await identity.linkPassportUser("existing", "pp-2", f.confirmedSession("existing", "pp-2", "another-session"))).toBe("refused");
    expect(f.links.get("existing")).toEqual({ passportUserId: "pp-1", basis: "own_second_step" });
  });

  it("does not record a link the database cannot vouch for: no request from that session, or no second step passed in it", async () => {
    f.users.push({ id: "existing", email: EMAIL, confirmed: true, app: {} });
    expect(await identity.linkPassportUser("existing", "pp-1", "a-session-that-asked-for-nothing")).toBe("refused");
    f.requests.push({ userId: "existing", sessionId: "single-step-session", passportUserId: "pp-1" });
    expect(await identity.linkPassportUser("existing", "pp-1", "single-step-session")).toBe("refused");
    // The request names the Passport user; the caller cannot swap in another.
    f.verifiedSessions.add("single-step-session");
    expect(await identity.linkPassportUser("existing", "pp-2", "single-step-session")).toBe("refused");
    expect(f.links.size).toBe(0);
  });

  it("does not give one Passport user two accounts: not by linking, not by signing in with another email", async () => {
    f.users.push({ id: "first", email: EMAIL, confirmed: true, app: {} }, { id: "second", email: "other@aldercreek.example", confirmed: true, app: {} });
    f.links.set("first", { passportUserId: "pp-1", basis: "own_second_step" });
    expect(await identity.linkPassportUser("second", "pp-1", f.confirmedSession("second", "pp-1"))).toBe("refused");
    expect(f.links.has("second")).toBe(false);
    // Its email changed at Passport: to one that has an account here, and to one that has none.
    await expect(identity.ensureUser("other@aldercreek.example", { passportUserId: "pp-1" })).rejects.toBeInstanceOf(AccountMismatchError);
    await expect(identity.ensureUser("brand.new@aldercreek.example", { passportUserId: "pp-1" })).rejects.toBeInstanceOf(AccountMismatchError);
    expect(f.calls).not.toContain("createUser");
    expect(f.users).toHaveLength(2);
  });

  it("is refused to a different Passport user once a link is recorded, and the link is not replaced", async () => {
    f.users.push({ id: "existing", email: EMAIL, confirmed: true, app: {} });
    f.links.set("existing", { passportUserId: "pp-1", basis: "own_second_step" });
    await expect(identity.ensureUser(EMAIL, { passportUserId: "pp-2" })).rejects.toBeInstanceOf(AccountMismatchError);
    expect(f.links.get("existing")).toEqual({ passportUserId: "pp-1", basis: "own_second_step" });
  });

  it("an account only tied to a Passport user in its app metadata (before links were recorded) is not linked yet, and can only ever be linked to that one", async () => {
    f.users.push({ id: "tied", email: EMAIL, confirmed: true, app: { passport_user_id: "pp-1" } });
    // The same Passport user is signed in, but Passport's second step does not count until the link is recorded.
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "tied", created: false, link: "pending" });
    // Anyone else with this email at Passport is refused, as before.
    await expect(identity.ensureUser(EMAIL, { passportUserId: "pp-2" })).rejects.toBeInstanceOf(AccountMismatchError);
    expect(await identity.linkPassportUser("tied", "pp-2", f.confirmedSession("tied", "pp-2", "wrong-user"))).toBe("refused");
    expect(await identity.linkPassportUser("tied", "pp-1", f.confirmedSession("tied", "pp-1"))).toBe("recorded");
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "tied", created: false, link: "recorded" });
  });

  it("is never an account nobody confirmed: that one is deleted and a fresh one made", async () => {
    f.users.push({ id: "strangers", email: EMAIL, confirmed: false, app: {} });
    const made = await identity.ensureUser(EMAIL, { passportUserId: "pp-1" });
    expect(made).toEqual({ userId: "user-1", created: true, link: "recorded" });
    expect(f.users.map((u) => u.id)).toEqual(["user-1"]);
    // It is not confirmed in place under any path.
    expect(f.calls).toEqual(["gms_account_by_email", "gms_passport_link_state", "deleteUser", "createUser", "gms_passport_link_created"]);
  });

  it("fails closed when the unconfirmed account cannot be removed", async () => {
    f.users.push({ id: "strangers", email: EMAIL, confirmed: false, app: {} });
    f.client.auth.admin.deleteUser = async () => ({ error: { message: "still referenced" } });
    await expect(identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).rejects.toThrow("Replacing the unconfirmed account failed");
    expect(f.users).toEqual([{ id: "strangers", email: EMAIL, confirmed: false, app: {} }]);
  });

  it("two sign-ins for a new person at once: the one that lost the race signs in to the account the other made", async () => {
    // The other sign-in creates the account between this one's lookup and its own create.
    const create = f.client.auth.admin.createUser;
    f.client.auth.admin.createUser = async (attrs) => {
      await create({ ...attrs });
      f.links.set("user-1", { passportUserId: "pp-1", basis: "account_created" });
      return create(attrs);
    };
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "user-1", created: false, link: "recorded" });
    expect(f.users).toHaveLength(1);
  });
});
