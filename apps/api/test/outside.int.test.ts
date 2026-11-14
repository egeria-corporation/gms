// SPDX-License-Identifier: AGPL-3.0-only
// Integration: apply anywhere on the real schema (migration 0029) against a running stack
// (`supabase start`), through the same service-role client the Worker uses. Skipped unless
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set; CI's integration job exports them and runs
// `pnpm test:int`. Rows are left behind on purpose (the ledger is append-only); every run uses
// fresh handles and ids.
import type { DbClient } from "@gms/db";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { RpcLike } from "../src/lib/rate-limit.ts";
import { calendarTokenHash, feedWorkspace } from "../src/services/calendar.ts";
import { CONSULTING_LIMITS, SupabaseConsultingStore } from "../src/services/consulting.ts";
import { RepoError } from "../src/services/repos/types.ts";
import { SupabaseRepos } from "../src/services/repos/supabase.ts";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = Math.random().toString(36).slice(2, 10);

describe.skipIf(!URL_ || !KEY)("Apply anywhere on the real schema", () => {
  let db: DbClient;
  let repos: SupabaseRepos;
  let applicantId: string;
  let otherId: string;
  let funderId: string;
  let appId: string;
  const person = crypto.randomUUID();

  beforeAll(async () => {
    db = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as DbClient;
    repos = new SupabaseRepos(db);
    applicantId = (await repos.table("workspaces").insert({ kind: "applicant", handle: `int-oa-a-${run}`, display_name: "Integration Applicant" })).id;
    otherId = (await repos.table("workspaces").insert({ kind: "applicant", handle: `int-oa-b-${run}`, display_name: "Integration Other" })).id;
    funderId = (await repos.table("workspaces").insert({ kind: "funder", handle: `int-oa-f-${run}`, display_name: "Integration Funder" })).id;
    appId = (await repos.table("outside_applications").insert({ workspace_id: applicantId, title: "Integration outside application", funder_name: "Northwind" })).id;
  });

  it("keeps outside applications in applicant workspaces and in the workspace of what they name", async () => {
    await expect(repos.table("outside_applications").insert({ workspace_id: funderId, title: "Funder side", funder_name: "X" })).rejects.toBeInstanceOf(RepoError);
    await expect(repos.table("outside_questions").insert({ workspace_id: otherId, outside_application_id: appId, prompt: "Into another workspace" })).rejects.toBeInstanceOf(RepoError);
    await expect(repos.table("tasks").insert({ workspace_id: otherId, subject_type: "outside_application", subject_id: appId, title: "Not mine" })).rejects.toBeInstanceOf(RepoError);
    const q = await repos.table("outside_questions").insert({ workspace_id: applicantId, outside_application_id: appId, prompt: "Describe the need.", limit_kind: "words", limit_value: 250 });
    await repos.table("outside_answers").insert({ workspace_id: applicantId, question_id: q.id, version: 1, body: "x", provenance: "user" });
    // The same version twice is a conflict the service retries on.
    await expect(repos.table("outside_answers").insert({ workspace_id: applicantId, question_id: q.id, version: 1, body: "y", provenance: "user" })).rejects.toMatchObject({ kind: "conflict" });
  });

  it("refuses a second prospect for the same OpenGrants listing as a conflict", async () => {
    const ref = `og-int-${run}`;
    await repos.table("outside_applications").insert({ workspace_id: applicantId, title: "Listing", funder_name: "X", source: "opengrants", source_ref: ref, stage: "prospect" });
    await expect(repos.table("outside_applications").insert({ workspace_id: applicantId, title: "Listing again", funder_name: "X", source: "opengrants", source_ref: ref, stage: "prospect" })).rejects.toMatchObject({ kind: "conflict" });
  });

  it("counts consulting requests under one lock: parallel requests cannot pass a limit", async () => {
    const store = new SupabaseConsultingStore(db as unknown as RpcLike, repos);
    const claim = () => store.claim({ workspaceId: applicantId, applicationId: appId, requestedBy: person, contactName: "Ana", contactEmailMasked: "a…@aldercreek.example", fieldsSent: ["title", "funder"] }, CONSULTING_LIMITS);
    const results = await Promise.all(Array.from({ length: 6 }, claim));
    expect(results.filter((r) => r.ok)).toHaveLength(CONSULTING_LIMITS.perApplication);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? null : r.limit))).toEqual(["application", "application", "application"]);
    const first = results.find((r) => r.ok)!;
    if (first.ok) {
      await store.release(first.requestId);
      expect((await claim()).ok).toBe(true);
    }
    expect((await store.claim({ workspaceId: otherId, applicationId: appId, requestedBy: person, contactName: "Ana", contactEmailMasked: "a…@x.example", fieldsSent: [] }, CONSULTING_LIMITS))).toEqual({ ok: false, limit: "not_found" });
  });

  it("finds a calendar feed by its token's hash only", async () => {
    const token = `gms_cal_${(run + "A".repeat(43)).slice(0, 43)}`;
    await repos.table("calendar_feeds").insert({ workspace_id: applicantId, token_sha256: await calendarTokenHash(token) });
    expect(await feedWorkspace(repos, token)).toBe(applicantId);
    expect(await feedWorkspace(repos, `${token.slice(0, -1)}B`)).toBeNull();
  });
});
