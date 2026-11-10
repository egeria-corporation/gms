// SPDX-License-Identifier: AGPL-3.0-only
// Dry-run eligibility rules against an organization or supplied facts (build spec §10.3).
// `unknown` is a result in its own right: it flags for a person and never declines.
import { evaluate, parseRules } from "@gms/rules";
import { z } from "zod";
import { unprocessable } from "../lib/input.ts";
import { authorize, required, type ServiceContext } from "./context.ts";

const json = z.record(z.string(), z.unknown());

export const evaluateInput = z
  .object({
    /** Rules to evaluate; when omitted, the opportunity's stored rules are used. */
    rules: z.unknown().optional(),
    opportunityId: z.string().optional(),
    /** Read the cached Passport projection of this applicant workspace (needs their consent). */
    applicantWorkspaceId: z.uuid().optional(),
    org: json.optional(),
    profile: json.optional(),
    form: z.record(z.string(), json).optional(),
    applicant: z.object({ type: z.string().optional() }).loose().optional(),
  })
  .strict()
  .refine((i) => i.rules !== undefined || i.opportunityId !== undefined, "Send rules or an opportunityId");

export async function evaluateEligibility(ctx: ServiceContext, input: z.output<typeof evaluateInput>, opportunityUuid?: string) {
  const ws = await authorize(ctx, { scope: "applications:read" });
  let rules = input.rules;
  if (rules === undefined && opportunityUuid) {
    const opp = required(await ctx.repos.table("opportunities").one({ id: opportunityUuid }), "Opportunity");
    // An applicant may dry-run a published opportunity's rules; drafts are the owning funder's only.
    if (opp.workspace_id !== ws.id && !opp.published_at) required(null, "Opportunity");
    rules = opp.eligibility_rules;
  }
  const parsed = parseRules(rules);
  if (!parsed.ok) throw unprocessable("These eligibility rules are not valid", parsed.errors.map((e) => ({ path: `rules${e.at}`, message: e.message })));

  let org: unknown = input.org;
  if (input.applicantWorkspaceId && org === undefined) {
    const id = input.applicantWorkspaceId;
    if (id !== ws.id) await authorize(ctx, { scope: "applications:read", owner: id, consent: { applicantWorkspaceId: id, funderWorkspaceId: ws.id }, what: "Applicant" });
    org = required(await ctx.repos.table("workspaces").one({ id, kind: "applicant" }), "Applicant").org_projection ?? undefined;
  }
  return evaluate(parsed.rules, { org, profile: input.profile, form: input.form, applicant: input.applicant });
}
