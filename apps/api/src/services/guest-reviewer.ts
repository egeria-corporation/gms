// SPDX-License-Identifier: AGPL-3.0-only
// The guest reviewer loop (C4). An external reviewer is invited per competition (reviews.ts,
// `inviteExternalReviewer`) and joins with the emailed code: no workspace or organization setup.
//   - The welcome: one screen with the funder, the competition, how many applications, the due
//     date, the conflict-of-interest note and "Start reviewing".
//   - The done screen, after their last assigned review is submitted: thanks, and once a
//     "Run a review panel for your own organization, free" offer that starts a funder workspace
//     through the same creation as funder setup, with their email domain as a suggestion only.
//     Dismissible, never shown again after dismissal, and no email follows it.
// The offer's shown, clicked, dismissed and created events go to the ledger (the GMS's own
// events; no tracking vendor) with no workspace, so no funder reads them, and the offer's state is
// read back from them. Everything here is the reviewer's own, in person: no MCP tool.
import { record } from "@gms/ledger";
import { z } from "zod";
import { forbidden } from "../auth/verify.ts";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";

/** The role an invitation to review one competition gives (reviews.ts). */
export const GUEST_ROLE = "external_reviewer";
/** How many times the done screen may show the offer to one person, across every funder. One place to relax. */
export const PANEL_OFFER_SHOWS = 1;
export const PANEL_OFFER_EVENTS = ["shown", "clicked", "dismissed", "created"] as const;
export type PanelOfferEvent = (typeof PANEL_OFFER_EVENTS)[number];
/** A "created" event counts only for a funder workspace the person made this recently. */
const CREATED_WITHIN_MS = 60 * 60 * 1000;
/** Roles of a person who already runs a funder's review: they are not offered a panel of their own. */
const RUNS_A_PANEL = ["admin", "program_officer"];

const OPEN = ["assigned", "coi_declared", "in_progress"];

/** Addresses at these providers say nothing about an organization: no suggestion is made from them. */
const SHARED_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "fastmail.com", "hey.com", "comcast.net", "verizon.net", "att.net", "sbcglobal.net",
]);
/** Second-level labels under a country code ("example.org.uk"), so the organization's own label is the one before. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/** A name and handle suggested from an email address's domain, or null for a shared mail provider. Only ever a suggestion. */
export function suggestionFromEmail(email: string | null | undefined): { domain: string; name: string; handle: string } | null {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || SHARED_MAIL_DOMAINS.has(domain)) return null;
  const labels = domain.split(".").filter(Boolean);
  const own = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? labels.at(-3)! : labels.at(-2)!;
  if (!own || own.length < 2) return null;
  const name = own
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
  const handle = own.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 40);
  return { domain, name, handle: handle.length >= 3 ? handle : `${handle}-reviews` };
}

/** A guest reviewer, in person, in the funder workspace that invited them. Anyone else is refused. */
async function guestWorkspace(ctx: ServiceContext): Promise<ServiceWorkspace> {
  if (ctx.actor.kind !== "user") throw forbidden("person_required", "This is for the invited reviewer, in the GMS");
  return authorize(ctx, { scope: "reviews:read", kind: "funder", roles: [GUEST_ROLE] });
}

async function myAssignments(ctx: ServiceContext, ws: ServiceWorkspace) {
  const rows = await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, reviewer_user_id: ctx.actor.userId! }, { orderBy: "created_at", limit: 5000 });
  const apps = rows.length ? await ctx.repos.table("applications").find({ id: [...new Set(rows.map((a) => a.application_id))] }) : [];
  return rows.map((a) => ({ ...a, competitionId: apps.find((x) => x.id === a.application_id)?.competition_id ?? null }));
}

const countsOf = (rows: { status: string; due_at: string | null }[]) => {
  const live = rows.filter((a) => a.status !== "recused");
  const open = live.filter((a) => OPEN.includes(a.status));
  const dues = (open.length ? open : live).map((a) => a.due_at).filter((d): d is string => !!d).sort();
  return { assigned: live.length, submitted: live.filter((a) => a.status === "submitted").length, open: open.length, dueAt: dues[0] ?? null };
};

/** The welcome: who invited them, to review what, how many, by when, and where to start. */
export async function guestWelcome(ctx: ServiceContext) {
  const ws = await guestWorkspace(ctx);
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const scoped = ((ws.memberScope?.competitionIds as unknown[] | undefined) ?? []).filter((x): x is string => typeof x === "string");
  const assignments = await myAssignments(ctx, ws);
  const ids = [...new Set([...scoped, ...assignments.map((a) => a.competitionId).filter((x): x is string => !!x)])];
  const comps = ids.length ? await ctx.repos.table("competitions").find({ workspace_id: ws.id, id: ids }) : [];
  const opps = comps.length ? await ctx.repos.table("opportunities").find({ workspace_id: ws.id, id: [...new Set(comps.map((c) => c.opportunity_id))] }) : [];
  const competitions = ids.flatMap((id) => {
    const c = comps.find((x) => x.id === id);
    if (!c) return [];
    return [{ id: apiId("competition", c.id), title: c.title, opportunityTitle: opps.find((o) => o.id === c.opportunity_id)?.title ?? null, ...countsOf(assignments.filter((a) => a.competitionId === c.id)) }];
  });
  const totals = countsOf(assignments);
  const start = `/review/assignments?ws=${encodeURIComponent(funder.handle)}`;
  return {
    funder: { name: funder.display_name, handle: funder.handle },
    competitions,
    ...totals,
    coi: {
      note: "Before an application opens, you are asked whether you have a conflict of interest with the organization. If you do, you step aside from it and it never opens for you.",
      link: start,
    },
    startUrl: start,
    done: totals.assigned > 0 && totals.open === 0 && totals.submitted > 0,
  };
}

// ------------------------------------------------------------------------------------ the done screen and the offer

const offerEventType = (e: PanelOfferEvent) => `guest_reviewer.panel_offer_${e}`;

async function offerHistory(ctx: ServiceContext) {
  const q = { subjectType: "user", subjectId: ctx.actor.userId! };
  const count = (e: PanelOfferEvent) => ctx.ledger.count({ ...q, eventType: offerEventType(e) });
  const [shown, clicked, dismissed, created] = await Promise.all(PANEL_OFFER_EVENTS.map(count));
  return { shown: shown!, clicked: clicked!, dismissed: dismissed!, created: created! };
}

async function runsAPanel(ctx: ServiceContext): Promise<boolean> {
  const mine = (await ctx.repos.table("workspace_members").find({ user_id: ctx.actor.userId! })).filter((m) => RUNS_A_PANEL.includes(m.role));
  if (!mine.length) return false;
  return (await ctx.repos.table("workspaces").find({ id: mine.map((m) => m.workspace_id), kind: "funder" })).length > 0;
}

async function myEmail(ctx: ServiceContext, ws: ServiceWorkspace): Promise<string | null> {
  const who = ctx.ports.directory ? (await ctx.ports.directory.lookup([ctx.actor.userId!])).get(ctx.actor.userId!) : undefined;
  const invited = typeof ws.memberScope?.email === "string" ? ws.memberScope.email : null;
  return who?.email ?? invited;
}

/** The done screen: thanks once every assigned review is in, and (once) the offer. */
export async function guestDone(ctx: ServiceContext) {
  const ws = await guestWorkspace(ctx);
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const totals = countsOf(await myAssignments(ctx, ws));
  const done = totals.assigned > 0 && totals.open === 0 && totals.submitted > 0;
  const history = await offerHistory(ctx);
  const spent = history.dismissed > 0 || history.clicked > 0 || history.created > 0 || history.shown >= PANEL_OFFER_SHOWS;
  const show = done && !spent && !(await runsAPanel(ctx));
  return {
    funder: { name: funder.display_name, handle: funder.handle },
    done,
    submitted: totals.submitted,
    assigned: totals.assigned,
    open: totals.open,
    offer: show ? { show: true, suggestion: suggestionFromEmail(await myEmail(ctx, ws)) } : { show: false, suggestion: null },
  };
}

export const offerEventInput = z.discriminatedUnion("event", [
  z.object({ event: z.enum(["shown", "clicked", "dismissed"]) }).strict(),
  z.object({ event: z.literal("created"), workspaceId: z.uuid() }).strict(),
]);

/**
 * Count one offer event. `created` names the funder workspace the person just made with funder
 * setup (`POST /gms/workspaces`) and is counted only for a funder workspace they admin, made in
 * the last hour; each event is counted once per person.
 */
export async function recordOfferEvent(ctx: ServiceContext, input: z.output<typeof offerEventInput>) {
  await guestWorkspace(ctx);
  const history = await offerHistory(ctx);
  // Each event counts once per person; "shown" as many times as the offer may be shown.
  if (history[input.event] >= (input.event === "shown" ? PANEL_OFFER_SHOWS : 1)) return { event: input.event, counted: false };
  const data: Record<string, unknown> = { from: "guest_review" };
  if (input.event === "created") {
    const made = await ctx.repos.table("workspaces").one({ id: input.workspaceId, kind: "funder" });
    const admin = made ? await ctx.repos.table("workspace_members").one({ workspace_id: made.id, user_id: ctx.actor.userId!, role: "admin" }) : null;
    if (!made || !admin || ctx.now().getTime() - Date.parse(made.created_at) > CREATED_WITHIN_MS) throw new ApiError(422, "not_your_new_workspace", "That is not a funder workspace you just set up");
    data.workspaceId = made.id;
  } else if (input.event === "shown") {
    data.shows = history.shown + 1;
  }
  // No workspace: the funder whose panel they reviewed never reads it.
  await record(ctx.ledger, { workspaceId: null, actor: ctx.actor.ledger, eventType: offerEventType(input.event), subjectType: "user", subjectId: ctx.actor.userId!, data }, { now: ctx.now });
  return { event: input.event, counted: true };
}
