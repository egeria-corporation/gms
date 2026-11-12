// SPDX-License-Identifier: AGPL-3.0-only
// supabase: create (or adopt) the project and wait until it is healthy. Only the ref and URL are stored.
import type { Ctx, Result } from "../core.ts";
import { confirmOrDry, flagStr, isResult, loadState, patchState, requireConfig, res } from "../core.ts";
import { apiMessage, isActiveProject, KEYS_MESSAGE, LOGIN_MESSAGE, projectRef, Supabase, supabaseToken, TERMINAL_STATUSES } from "../supabase-api.ts";

export { LOGIN_MESSAGE };
const FREE_PLAN_LIMIT = 2;

/** Wait for ACTIVE_HEALTHY. Returns the last status seen. */
export async function waitHealthy(ctx: Ctx, api: Supabase, ref: string, tries = 90): Promise<string> {
  let status = "UNKNOWN";
  for (let i = 0; i < tries; i++) {
    const r = await api.project(ref);
    status = r.status === 200 ? (r.body.status ?? "UNKNOWN") : `HTTP_${r.status}`;
    if (status === "ACTIVE_HEALTHY") return status;
    if (r.status === 404 || TERMINAL_STATUSES.has(status)) return status;
    ctx.log(`Supabase project ${ref} is ${status}; waiting.`);
    await ctx.sleep(5000);
  }
  return status;
}

export async function supabase(ctx: Ctx): Promise<Result> {
  const config = requireConfig(ctx);
  if (isResult(config)) return config;
  const token = supabaseToken(ctx);
  if (!token) return res("needs_login", LOGIN_MESSAGE, {}, null);
  const api = new Supabase(ctx, token);
  const state = loadState(ctx);
  const adopt = flagStr(ctx, "adopt");

  // Already created (or adopted) earlier: check it is still there and healthy.
  const known = state.supabase?.ref as string | undefined;
  if (known && (!adopt || adopt === known)) {
    const r = await api.project(known);
    if (r.status === 401 || r.status === 403) return res("needs_login", LOGIN_MESSAGE, {}, null);
    if (r.status === 404) return res("error", `The recorded Supabase project ${known} no longer exists. Remove "supabase" from deploy/state.json to start again, or adopt another project with --adopt <ref>.`, {}, null);
    if (r.body.status === "ACTIVE_HEALTHY") return res("skipped", "The Supabase project already exists and is healthy.", { ref: known, url: state.supabase.url }, "migrate");
    if (ctx.dryRun) return res("ok", `Dry run. Would wait for project ${known} (currently ${r.body.status}) to become healthy.`, { dryRun: true }, "migrate");
    const status = await waitHealthy(ctx, api, known);
    if (status !== "ACTIVE_HEALTHY") return res("error", `The Supabase project is still ${status}. Re-run this step in a few minutes.`, { ref: known, status }, "supabase");
    return res("ok", "The Supabase project is now healthy.", { ref: known, url: state.supabase.url }, "migrate");
  }

  if (adopt) {
    if (known && adopt !== known) {
      const gate = confirmOrDry(ctx, "supabase", [`switch this instance from Supabase project ${known} to ${adopt}. Workers keep using the old project until their SUPABASE_* secrets are refreshed (secrets --rotate SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_ANON_KEY)`]);
      if (gate) return gate;
    }
    const r = await api.project(adopt);
    if (r.status === 401 || r.status === 403) return res("needs_login", LOGIN_MESSAGE, {}, null);
    if (r.status !== 200) return res("error", `Could not find the Supabase project ${adopt} (${apiMessage(r.body)}).`, {}, null);
    if (ctx.dryRun) return res("ok", `Dry run. Would adopt project ${adopt} and record its address.`, { dryRun: true }, "migrate");
    const status = r.body.status === "ACTIVE_HEALTHY" ? r.body.status : await waitHealthy(ctx, api, adopt);
    if (status !== "ACTIVE_HEALTHY") return res("error", `The project is ${status}, not healthy yet. Re-run in a few minutes.`, {}, "supabase");
    if (!(await api.keys(adopt))) return res("error", KEYS_MESSAGE, {}, null);
    patchState(ctx, { supabase: { ref: adopt, url: `https://${adopt}.supabase.co`, region: config.region, adopted: true } });
    return res("ok", `Adopted the existing Supabase project ${adopt}.`, { ref: adopt, url: `https://${adopt}.supabase.co` }, "migrate");
  }

  // Which organization?
  // The API takes the organization's slug; an id is translated when the organizations can be listed.
  const wanted = flagStr(ctx, "org") ?? config.org;
  const orgs = await api.organizations();
  if (orgs.status === 401) return res("needs_login", LOGIN_MESSAGE, {}, null);
  const orgList = orgs.status === 200 && Array.isArray(orgs.body) ? orgs.body : [];
  let org = wanted ?? undefined;
  let orgId: string | undefined;
  if (wanted) {
    const hit = orgList.find((o) => o.slug === wanted || o.id === wanted);
    if (hit) {
      org = hit.slug ?? hit.id;
      orgId = hit.id;
    }
  } else {
    if (orgList.length === 0) return res("needs_input", "The Supabase token cannot list organizations. Pass --org <organization slug> (to init or this step).", {}, null);
    if (orgList.length > 1) return res("needs_input", "There are several Supabase organizations. Pass --org <slug> for the one to use.", { organizations: orgList.map((o) => ({ slug: o.slug ?? o.id, name: o.name })) }, null);
    org = orgList[0]!.slug ?? orgList[0]!.id;
    orgId = orgList[0]!.id;
  }
  if (!org) return res("needs_input", "Pass --org <organization slug>.", {}, null);
  const inOrg = (p: { organization_id?: string; organization_slug?: string }) => p.organization_slug === org || (!!orgId && p.organization_id === orgId) || p.organization_id === org;

  const list = await api.projects();
  if (list.status === 401) return res("needs_login", LOGIN_MESSAGE, {}, null);
  const all = list.status === 200 && Array.isArray(list.body) ? list.body : [];
  const sameName = all.find((p) => p.name === config.name && isActiveProject(p) && (inOrg(p) || (!p.organization_id && !p.organization_slug)));
  if (sameName) return res("needs_input", `A Supabase project named "${config.name}" already exists (${projectRef(sameName)}). To use it, re-run with --adopt ${projectRef(sameName)}; otherwise choose another name with init --name.`, { existing: projectRef(sameName) }, null);
  const active = all.filter((p) => isActiveProject(p) && inOrg(p)).length;

  const plan = [`create the Supabase project "${config.name}" in region ${config.region}`];
  if (active >= FREE_PLAN_LIMIT) plan.push(`note: the organization already has ${active} active projects; the free plan allows ${FREE_PLAN_LIMIT}, so this may be refused or add a cost`);
  const gate = confirmOrDry(ctx, "supabase", plan, { organization: org, activeProjects: active });
  if (gate) return gate;

  // The database password is used once, here, and not stored: the Workers use API keys, not this login.
  const dbPass = ctx.random(24).toString("base64url");
  ctx.secrets.add(dbPass);
  const created = await api.call<{ ref?: string; id?: string; message?: string }>("POST", "/projects", {
    name: config.name,
    organization_slug: org,
    db_pass: dbPass,
    region_selection: { type: "specific", code: config.region },
  });
  if (created.status === 401 || created.status === 403) return res("needs_login", `Supabase refused the request (${apiMessage(created.body)}). Check the token can create projects in this organization.`, {}, null);
  const msg = apiMessage(created.body);
  if (created.status === 402 || (created.status !== 429 && /free (plan|project)|upgrade|maximum.*project|project.*limit|quota/i.test(msg))) return res("plan_limit", `Supabase will not create another project on this plan (${msg}). Free a project, upgrade the plan, or adopt an existing project with --adopt <ref>.`, { active }, null);
  if (created.status >= 300 || !created.body || typeof created.body !== "object" || !(created.body.ref ?? created.body.id)) return res("error", `Supabase could not create the project: ${msg}.`, { status: created.status }, null);
  const ref = (created.body.ref ?? created.body.id)!;
  patchState(ctx, { supabase: { ref, url: `https://${ref}.supabase.co`, region: config.region } });

  const status = await waitHealthy(ctx, api, ref);
  if (status !== "ACTIVE_HEALTHY") return res("error", `The project was created (${ref}) but is still ${status}. Re-run this step to keep waiting.`, { ref }, "supabase");
  if (!(await api.keys(ref))) return res("error", KEYS_MESSAGE, { ref }, null);
  return res("ok", `Created the Supabase project ${ref} and it is healthy.`, { ref, url: `https://${ref}.supabase.co` }, "migrate");
}
