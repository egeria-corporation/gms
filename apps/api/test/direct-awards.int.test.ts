// SPDX-License-Identifier: AGPL-3.0-only
// Integration: the two atomic steps of a direct award (migration 0028) against a real stack
// (`supabase start`), through the same service-role client the Worker uses. Skipped unless
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set; CI's integration job exports them and runs
// `pnpm test:int`. Rows are left behind on purpose (the ledger is append-only); every run uses
// fresh handles and ids.
import type { DbClient } from "@gms/db";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256b64url } from "../src/auth/crypto.ts";
import type { RpcLike } from "../src/lib/rate-limit.ts";
import { SupabaseDirectAwardStore, SupabaseInvitationLimiter, type DirectAwardStore, type InvitationLimiter } from "../src/services/direct-award-store.ts";
import { SupabaseRepos } from "../src/services/repos/supabase.ts";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = Math.random().toString(36).slice(2, 10);

describe.skipIf(!URL_ || !KEY)("Direct awards on the real schema", () => {
  let db: DbClient;
  let repos: SupabaseRepos;
  let invitedUser: string;
  let otherUser: string;
  let funderId: string;
  let applicantId: string;
  const invited = `int-invited-${run}@aldercreek.example`;

  beforeAll(async () => {
    db = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as DbClient;
    repos = new SupabaseRepos(db);
    const made = async (email: string) => {
      const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
      if (error || !data.user) throw new Error(`could not create the test user: ${error?.message}`);
      return data.user.id;
    };
    invitedUser = await made(invited);
    otherUser = await made(`int-other-${run}@aldercreek.example`);
    funderId = (await repos.table("workspaces").insert({ kind: "funder", handle: `int-da-f-${run}`, display_name: "Integration Direct Funder" })).id;
    applicantId = (await repos.table("workspaces").insert({ kind: "applicant", handle: `int-da-a-${run}`, display_name: "Integration Alder" })).id;
    await repos.table("workspace_members").insert({ workspace_id: applicantId, user_id: invitedUser, role: "admin" });
    await repos.table("workspace_members").insert({ workspace_id: applicantId, user_id: otherUser, role: "admin" });
  });

  it("counts invitation sends under one lock: parallel requests cannot pass a limit", async () => {
    const limiter: InvitationLimiter = new SupabaseInvitationLimiter(db as unknown as RpcLike);
    const limits = { workspace: 3, sender: 99, address: 99, recipient: 99, instance: 100_000 };
    const key = (i: number) => ({ workspaceId: funderId, senderId: otherUser, addressKey: null, recipientDigest: `${run}${String(i).padStart(2, "0")}`.padEnd(43, "x").slice(0, 43) });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => limiter.claim(key(i), limits, new Date())));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? null : r.limit))).toEqual(["workspace", "workspace", "workspace"]);
    const first = results.find((r) => r.ok)!;
    await limiter.release(first.ok ? first.sendId : "", new Date());
    expect((await limiter.claim(key(7), limits, new Date())).ok).toBe(true);
    expect((await limiter.claim(key(8), limits, new Date())).ok).toBe(false);
  });

  it("claims in one step, once, only for the invited and confirmed address", async () => {
    const award = await repos.table("awards").insert({ workspace_id: funderId, recipient_individual: { name: "Integration Alder" }, title: "Integration direct award", status: "offered", funding: { awardedAmount: { amount: "1000.00", currency: "USD" } } });
    const token = `gms_awi_int_${run}_${crypto.randomUUID()}`;
    const tokenHash = await sha256b64url(token);
    await repos.table("award_invitations").insert({ workspace_id: funderId, award_id: award.id, email: invited, organization_name: "Integration Alder", token_hash: tokenHash, expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: otherUser });
    const claims: DirectAwardStore = new SupabaseDirectAwardStore(db as unknown as RpcLike);
    const input = { tokenHash, workspaceId: applicantId, cgStatus: "awarded" };

    expect((await claims.claim({ ...input, userId: otherUser, email: `int-other-${run}@aldercreek.example` }, new Date())).outcome).toBe("email_mismatch");
    // The session address alone is not enough: the account's own confirmed address must match too.
    expect((await claims.claim({ ...input, userId: otherUser, email: invited }, new Date())).outcome).toBe("email_mismatch");

    const outcomes = await Promise.all(Array.from({ length: 4 }, () => claims.claim({ ...input, userId: invitedUser, email: invited.toUpperCase() }, new Date())));
    expect(outcomes.filter((o) => o.outcome === "claimed")).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === "used")).toHaveLength(3);
    expect(await repos.table("awards").one({ id: award.id })).toMatchObject({ status: "accepted", recipient_workspace_id: applicantId, recipient_individual: null });
    expect(await repos.table("consents").find({ applicant_workspace_id: applicantId, funder_workspace_id: funderId })).toEqual([expect.objectContaining({ basis: "award", revoked_at: null })]);
    expect(await repos.table("award_invitations").one({ award_id: award.id })).toMatchObject({ accepted_by: invitedUser, accepted_workspace_id: applicantId });
  });
});
