// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's pipeline (apply anywhere): one list of every grant the organization is working
// on. Built-in applications on this GMS, outside applications, and GMS opportunities it saved.
// Also the deadlines the calendar feed and the reminders read, from the same rows.
import { apiId } from "../lib/ids.ts";
import { stagesOf } from "./apply.ts";
import type { BaseContext, ServiceContext } from "./context.ts";
import { nextDeadlineOf, outsideWorkspace, stageLabel } from "./outside.ts";
import { toMoney } from "@gms/protocol";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted", screening: "Screening", under_review: "Under review", recommended: "Recommended", accepted: "Accepted", declined: "Declined", waitlisted: "Waitlisted", revision_requested: "Revision requested", interview: "Interview", withdrawn: "Withdrawn" };
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

export async function pipeline(ctx: ServiceContext) {
  const ws = await outsideWorkspace(ctx, "applications:read");
  const me = await ctx.repos.table("workspaces").one({ id: ws.id });
  const handle = me?.handle ?? "";
  const today = ctx.now().toISOString().slice(0, 10);
  const [apps, outside, saved] = await Promise.all([
    ctx.repos.table("applications").find({ applicant_workspace_id: ws.id }, { orderBy: "updated_at", ascending: false }),
    ctx.repos.table("outside_applications").find({ workspace_id: ws.id, archived_at: null }, { orderBy: "updated_at", ascending: false, limit: 5000 }),
    ctx.repos.table("discover_saved").find({ workspace_id: ws.id, source: "gms" }, { orderBy: "created_at", ascending: false }),
  ]);
  const competitions = apps.length ? await ctx.repos.table("competitions").find({ id: [...new Set(apps.map((a) => a.competition_id))] }) : [];
  const opps = saved.length ? await ctx.repos.table("opportunities").find({ id: saved.map((s) => s.gms_opportunity_id).filter((x): x is string => !!x) }) : [];
  const funderIds = [...new Set([...apps.map((a) => a.workspace_id), ...opps.map((o) => o.workspace_id)])];
  const funders = funderIds.length ? await ctx.repos.table("workspaces").find({ id: funderIds }) : [];
  const names = ctx.ports.directory ? await ctx.ports.directory.lookup([...new Set(outside.map((o) => o.owner_user_id).filter((x): x is string => !!x))]) : new Map();
  const funderName = (id: string) => funders.find((f) => f.id === id)?.display_name ?? null;

  const items = [
    ...apps.map((a) => {
      const comp = competitions.find((c) => c.id === a.competition_id);
      const closes = comp ? stagesOf(comp).find((s) => s.key === a.stage)?.closes : undefined;
      return { kind: "gms_application" as const, id: apiId("application", a.id), title: a.title, funderName: funderName(a.workspace_id), status: a.status, statusLabel: STATUS_LABEL[a.status] ?? a.status, stage: null, nextDeadline: day(closes), askAmount: a.requested_amount_minor === null ? null : toMoney(a.requested_amount_minor, a.currency), owner: null, url: `${ctx.config.webBaseUrl}/w/${handle}/applications/${apiId("application", a.id)}`, updatedAt: a.updated_at };
    }),
    ...outside.map((o) => {
      const owner = o.owner_user_id ? { userId: o.owner_user_id, name: names.get(o.owner_user_id)?.name ?? null } : null;
      return { kind: "outside_application" as const, id: o.id, title: o.title, funderName: o.funder_name, status: null, stage: o.stage, stageLabel: stageLabel(o.stage), nextDeadline: nextDeadlineOf(o, today)?.date ?? null, askAmount: o.ask_amount_minor === null ? null : toMoney(o.ask_amount_minor, o.currency), owner, url: `${ctx.config.webBaseUrl}/w/${handle}/outside/${o.id}`, updatedAt: o.updated_at };
    }),
    ...saved.flatMap((s) => {
      const opp = opps.find((o) => o.id === s.gms_opportunity_id);
      const funder = opp ? funders.find((f) => f.id === opp.workspace_id) : undefined;
      const close = (opp?.key_dates as { closeDate?: { date?: string } } | null)?.closeDate?.date ?? null;
      return [{ kind: "saved_gms" as const, id: s.id, title: s.title, funderName: funder?.display_name ?? null, status: "saved", statusLabel: "Saved", stage: null, nextDeadline: day(close), askAmount: null, owner: null, url: opp && funder ? `${ctx.config.webBaseUrl}/f/${funder.handle}/o/${opp.slug}` : s.url, updatedAt: s.updated_at }];
    }),
  ];
  return items.sort((a, b) => (a.nextDeadline ?? "9999") .localeCompare(b.nextDeadline ?? "9999") || b.updatedAt.localeCompare(a.updatedAt));
}

export interface DeadlineEvent {
  /** Stable per workspace, deadline and date. */
  key: string;
  date: string;
  label: string;
  title: string;
  funder: string | null;
}

/**
 * The dates the calendar feed lists for one applicant workspace: outside applications' letter of
 * inquiry, full and internal deadlines (archived ones left out), built-in applications' current
 * stage close, and reports due to funders. Titles, funders and dates only.
 */
export async function workspaceDeadlines(base: Pick<BaseContext, "repos">, workspaceId: string): Promise<DeadlineEvent[]> {
  const out: DeadlineEvent[] = [];
  const outside = await base.repos.table("outside_applications").find({ workspace_id: workspaceId, archived_at: null }, { limit: 5000 });
  for (const o of outside) {
    for (const [kind, label, date] of [["loi", "Letter of inquiry due", o.loi_due], ["full", "Application due", o.full_due], ["internal", "Internal deadline", o.internal_due]] as const) {
      if (date) out.push({ key: `oa:${o.id}:${kind}:${date}`, date, label, title: o.title, funder: o.funder_name });
    }
  }
  const apps = (await base.repos.table("applications").find({ applicant_workspace_id: workspaceId }, { limit: 5000 })).filter((a) => a.status === "draft" || a.status === "revision_requested");
  const competitions = apps.length ? await base.repos.table("competitions").find({ id: [...new Set(apps.map((a) => a.competition_id))] }) : [];
  const awards = await base.repos.table("awards").find({ recipient_workspace_id: workspaceId }, { limit: 5000 });
  const requirements = awards.length ? (await base.repos.table("requirements").find({ award_id: awards.map((a) => a.id) }, { limit: 5000 })).filter((r) => r.due_at && ["scheduled", "due", "overdue", "returned"].includes(r.status)) : [];
  const funderIds = [...new Set([...apps.map((a) => a.workspace_id), ...awards.map((a) => a.workspace_id)])];
  const funders = funderIds.length ? await base.repos.table("workspaces").find({ id: funderIds }) : [];
  const funderName = (id: string) => funders.find((f) => f.id === id)?.display_name ?? null;
  for (const a of apps) {
    const comp = competitions.find((c) => c.id === a.competition_id);
    const closes = day(comp ? stagesOf(comp).find((s) => s.key === a.stage)?.closes : null);
    if (closes) out.push({ key: `app:${a.id}:${a.stage}:${closes}`, date: closes, label: "Application stage closes", title: a.title, funder: funderName(a.workspace_id) });
  }
  for (const r of requirements) {
    const award = awards.find((a) => a.id === r.award_id)!;
    out.push({ key: `req:${r.id}:${day(r.due_at)}`, date: day(r.due_at)!, label: "Report due", title: `${r.title} (${award.title})`, funder: funderName(award.workspace_id) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2000);
}
