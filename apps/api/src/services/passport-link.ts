// SPDX-License-Identifier: AGPL-3.0-only
// How a funder workspace reaches Passport (build spec §11.1). The admin pastes the client id and
// secret created in Passport's funder console; the secret is stored AES-GCM encrypted and never
// returned. Linking verifies the credentials against Passport before anything is saved.
import { PassportApiError, PassportAuthError, PassportClient, PassportUnavailableError, clientCredentialsTokens, decryptSecret, encryptSecret } from "@gms/passport-client";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { audit, authorize, required, type ServiceContext } from "./context.ts";
import { einOf } from "./organization.ts";
import { replaceProfileWithPassport } from "./profile.ts";
import type { Row } from "./repos/types.ts";

/** What a funder's Passport client must be able to do for the GMS (build spec §2 item 1). */
export const FUNDER_LINK_SCOPES = ["org:read", "payee:read", "award:write", "disbursement:read", "disbursement:write"] as const;

export const linkInput = z
  .object({
    clientId: z.string().trim().min(1).max(200),
    clientSecret: z.string().min(8).max(500),
    /** The funder's organization in Passport. Needed the first time; the client is verified against it before it is stored. */
    passportOrgId: z.uuid().optional(),
  })
  .strict();

type CheckState = "pass" | "fail" | "unknown";

function configured(ctx: ServiceContext): { baseUrl: string; key: string } {
  if (!ctx.config.passportBaseUrl || !ctx.config.credentialsKey) throw new ApiError(503, "passport_not_configured", "Passport linking is not configured on this server");
  return { baseUrl: ctx.config.passportBaseUrl, key: ctx.config.credentialsKey };
}

function client(ctx: ServiceContext, baseUrl: string, clientId: string, clientSecret: string): PassportClient {
  const tokens = clientCredentialsTokens({ baseUrl, clientId, clientSecret, scopes: [...FUNDER_LINK_SCOPES], fetch: ctx.config.passportFetch, now: ctx.now });
  return new PassportClient({ baseUrl, tokens, fetch: ctx.config.passportFetch, awardWrite: ctx.config.passportAwardWrite === true });
}

/** One live call that proves the client works for this funder: its funding sources. */
async function verify(passport: PassportClient, orgId: string): Promise<{ state: CheckState; reason: string; canDebit: boolean | null }> {
  try {
    const sources = await passport.listFunderSources(orgId);
    const canDebit = sources.some((s) => s.canDebit);
    return { state: "pass", reason: canDebit ? "Passport accepted the client and a funding source can be debited" : "Passport accepted the client. No funding source can be debited yet", canDebit };
  } catch (e) {
    if (e instanceof PassportUnavailableError) return { state: "unknown", reason: "Passport can't be reached right now", canDebit: null };
    if (e instanceof PassportAuthError) return { state: "fail", reason: "Passport rejected the client id or secret", canDebit: null };
    if (e instanceof PassportApiError) return { state: "fail", reason: "Passport refused this client for the workspace's organization", canDebit: null };
    throw e;
  }
}

const linkView = (l: Row<"passport_links">) => ({ mode: l.mode, clientId: l.client_id, scopes: l.scopes, linkedAt: l.linked_at, lastOkAt: l.last_ok_at });

/** The Passport client for a linked funder workspace; null when there is no live link. Used by payments. */
export async function passportClientFor(ctx: ServiceContext, workspaceId: string): Promise<PassportClient | null> {
  if (!ctx.config.passportBaseUrl || !ctx.config.credentialsKey) return null;
  const link = await ctx.repos.table("passport_links").one({ workspace_id: workspaceId, mode: "funder_client", revoked_at: null });
  if (!link?.client_id || !link.client_secret_enc) return null;
  return client(ctx, ctx.config.passportBaseUrl, link.client_id, await decryptSecret(link.client_secret_enc, ctx.config.credentialsKey));
}

export async function linkPassport(ctx: ServiceContext, workspaceId: string, input: z.output<typeof linkInput>) {
  await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true, owner: workspaceId, what: "Workspace" });
  const { baseUrl, key } = configured(ctx);
  const workspace = required(await ctx.repos.table("workspaces").one({ id: workspaceId }), "Workspace");
  // The organization is proven here, not typed at sign-up: Passport answers for an organization's
  // funding sources only to a client that organization created, so a client that passes the check
  // below belongs to it. Until then the workspace carries no Passport organization at all.
  const orgId = input.passportOrgId ?? workspace.passport_org_id;
  if (!orgId) throw new ApiError(409, "passport_org_missing", "Enter your organization's Passport ID (shown in Passport's funder console) with the client id and secret");

  const passport = client(ctx, baseUrl, input.clientId, input.clientSecret);
  const check = await verify(passport, orgId);
  if (check.state === "unknown") throw new ApiError(503, "passport_unavailable", "Passport can't be reached right now, so the client could not be verified. Nothing was saved");
  if (check.state === "fail") throw new ApiError(422, "passport_client_rejected", `${check.reason}. Nothing was saved`);
  // The organization's name and EIN come from Passport, never from what the workspace typed: they
  // are published with the Passport id in every CommonGrants record (review NP-06). When Passport
  // does not answer for the record, a new link clears the typed ones rather than vouch for them.
  const org = await passport.getOrg(orgId).catch(() => null);
  const identity = org ? { legal_name: typeof org.name === "string" ? org.name : null, ein: einOf(org) } : workspace.passport_org_id !== orgId || workspace.profile_source !== "passport" ? { legal_name: null, ein: null } : {};

  const at = ctx.now().toISOString();
  if (workspace.passport_org_id !== orgId) {
    // One funder workspace per Passport organization. A holder whose own client was verified for
    // it keeps it; a holder with no verified client never proved anything, and gives it up.
    const holder = await ctx.repos.table("workspaces").one({ passport_org_id: orgId, kind: "funder" });
    if (holder && holder.id !== workspaceId) {
      if (await ctx.repos.table("passport_links").count({ workspace_id: holder.id, mode: "funder_client" })) throw new ApiError(409, "passport_org_linked_elsewhere", "This Passport organization is already linked to another workspace. Nothing was saved");
      await ctx.repos.table("workspaces").update({ id: holder.id }, { passport_org_id: null, profile_source: "none" });
      await audit(ctx, "workspace.passport_claim_released", "workspace", holder.id, { passportOrgId: orgId, reason: "no_passport_proof" }, holder.id);
    }
    // A self-declared profile gives way to Passport. The funder client reads no organization record
    // here, so every field it held is reported as replaced.
    const replaced = await replaceProfileWithPassport(ctx, workspace, {});
    const [moved] = await ctx.repos.table("workspaces").update({ id: workspaceId }, { passport_org_id: orgId, ...replaced, ...identity });
    if (!moved) throw new ApiError(409, "conflict", "This workspace changed while you were working. Reload and try again");
  } else if (Object.keys(identity).length) {
    await ctx.repos.table("workspaces").update({ id: workspaceId }, identity);
  }
  // One live link per workspace and mode: the previous one is revoked, never overwritten.
  await ctx.repos.table("passport_links").update({ workspace_id: workspaceId, mode: "funder_client", revoked_at: null }, { revoked_at: at });
  const link = await ctx.repos.table("passport_links").insert({
    workspace_id: workspaceId,
    mode: "funder_client",
    client_id: input.clientId,
    client_secret_enc: await encryptSecret(input.clientSecret, key),
    scopes: [...FUNDER_LINK_SCOPES],
    linked_by_user_id: ctx.actor.userId,
    linked_at: at,
    last_ok_at: at,
  });
  await audit(ctx, "passport.linked", "workspace", workspaceId, { mode: "funder_client", clientId: input.clientId, passportOrgId: orgId });
  return { linked: true, passportOrgId: orgId, ...linkView(link), check: { state: check.state, reason: check.reason }, canDebit: check.canDebit };
}

/** Link state plus a live check. `unknown` means Passport could not be reached; it is never folded into pass or fail. */
export async function passportStatus(ctx: ServiceContext, workspaceId: string) {
  await authorize(ctx, { scope: "workspace:admin", kind: "funder", owner: workspaceId, what: "Workspace" });
  const workspace = required(await ctx.repos.table("workspaces").one({ id: workspaceId }), "Workspace");
  const link = await ctx.repos.table("passport_links").one({ workspace_id: workspaceId, mode: "funder_client", revoked_at: null });
  if (!link) return { linked: false, passportOrgId: workspace.passport_org_id, check: { state: "fail" as CheckState, reason: "Connect Passport to pay. Awards still work without it" }, canDebit: null };
  const passport = await passportClientFor(ctx, workspaceId);
  if (!passport || !workspace.passport_org_id) return { linked: true, passportOrgId: workspace.passport_org_id, ...linkView(link), check: { state: "unknown" as CheckState, reason: "Passport is not configured on this server" }, canDebit: null };
  const check = await verify(passport, workspace.passport_org_id);
  let lastOkAt = link.last_ok_at;
  if (check.state === "pass") {
    lastOkAt = ctx.now().toISOString();
    await ctx.repos.table("passport_links").update({ id: link.id }, { last_ok_at: lastOkAt });
  }
  return { linked: true, passportOrgId: workspace.passport_org_id, ...linkView(link), lastOkAt, check: { state: check.state, reason: check.reason }, canDebit: check.canDebit };
}

export async function unlinkPassport(ctx: ServiceContext, workspaceId: string) {
  await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true, owner: workspaceId, what: "Workspace" });
  const revoked = await ctx.repos.table("passport_links").update({ workspace_id: workspaceId, mode: "funder_client", revoked_at: null }, { revoked_at: ctx.now().toISOString() });
  if (revoked.length) await audit(ctx, "passport.unlinked", "workspace", workspaceId, { mode: "funder_client" });
  return { linked: false };
}
