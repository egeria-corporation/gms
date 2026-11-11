// SPDX-License-Identifier: AGPL-3.0-only
// The account rules behind Sign in with Passport, against a stand-in for the Supabase admin client:
// an unconfirmed account is replaced, never adopted; the Passport user is recorded once and then fixed.
import { beforeEach, describe, expect, it } from "vitest";
import { AccountMismatchError, SupabaseIdentity, type SupabaseIdentityLike } from "../src/services/ports.ts";

interface FakeUser {
  id: string;
  email: string;
  confirmed: boolean;
  app: Record<string, unknown>;
}

function fakeSupabase() {
  const users: FakeUser[] = [];
  const calls: string[] = [];
  let n = 0;
  const client: SupabaseIdentityLike = {
    rpc: async (fn, args) => {
      calls.push(fn);
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
          const user = { id: `user-${++n}`, email: attrs.email, confirmed: attrs.email_confirm, app: { ...attrs.app_metadata } };
          users.push(user);
          return { data: { user: { id: user.id } }, error: null };
        },
        updateUserById: async (id, attrs) => {
          calls.push("updateUserById");
          const u = users.find((x) => x.id === id);
          if (!u) return { error: { message: "not found" } };
          Object.assign(u.app, attrs.app_metadata);
          return { error: null };
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
  return { client, users, calls };
}

const EMAIL = "dana@aldercreek.example";
let f: ReturnType<typeof fakeSupabase>;
let identity: SupabaseIdentity;
beforeEach(() => {
  f = fakeSupabase();
  identity = new SupabaseIdentity(f.client);
});

describe("the account for a Passport sign-in", () => {
  it("is created confirmed, with the Passport user recorded, when the email is new", async () => {
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1", name: "Dana" })).toEqual({ userId: "user-1", created: true });
    expect(f.users).toEqual([{ id: "user-1", email: EMAIL, confirmed: true, app: { passport_user_id: "pp-1" } }]);
  });

  it("is the existing one when its email was proven here, and the Passport user is recorded on first use", async () => {
    f.users.push({ id: "existing", email: EMAIL, confirmed: true, app: { provider: "email" } });
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "existing", created: false });
    expect(f.users[0]!.app).toEqual({ provider: "email", passport_user_id: "pp-1" });
    // The same Passport user again changes nothing.
    f.calls.length = 0;
    expect(await identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).toEqual({ userId: "existing", created: false });
    expect(f.calls).toEqual(["gms_account_by_email"]);
  });

  it("is refused to a different Passport user once one is recorded, and the record is not replaced", async () => {
    f.users.push({ id: "existing", email: EMAIL, confirmed: true, app: { passport_user_id: "pp-1" } });
    await expect(identity.ensureUser(EMAIL, { passportUserId: "pp-2" })).rejects.toBeInstanceOf(AccountMismatchError);
    expect(f.users[0]!.app).toEqual({ passport_user_id: "pp-1" });
    expect(f.calls).not.toContain("updateUserById");
  });

  it("is never an account nobody confirmed: that one is deleted and a fresh one made", async () => {
    f.users.push({ id: "strangers", email: EMAIL, confirmed: false, app: {} });
    const made = await identity.ensureUser(EMAIL, { passportUserId: "pp-1" });
    expect(made).toEqual({ userId: "user-1", created: true });
    expect(f.users.map((u) => u.id)).toEqual(["user-1"]);
    // It is not confirmed in place under any path.
    expect(f.calls).toEqual(["gms_account_by_email", "deleteUser", "createUser"]);
  });

  it("fails closed when the unconfirmed account cannot be removed", async () => {
    f.users.push({ id: "strangers", email: EMAIL, confirmed: false, app: {} });
    f.client.auth.admin.deleteUser = async () => ({ error: { message: "still referenced" } });
    await expect(identity.ensureUser(EMAIL, { passportUserId: "pp-1" })).rejects.toThrow("Replacing the unconfirmed account failed");
    expect(f.users).toEqual([{ id: "strangers", email: EMAIL, confirmed: false, app: {} }]);
  });
});
