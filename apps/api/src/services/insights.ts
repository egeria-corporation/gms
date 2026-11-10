// SPDX-License-Identifier: AGPL-3.0-only
// Read models the workspace screens need beyond the core records: rollups, per-criterion scores,
// activity feeds, upcoming payments, breakdowns. Every function is a read that starts with
// `authorize`; nothing here writes except the bulk send, interview scheduling and funding alerts.
import { renderPdf, sha256Hex, type Block } from "@gms/documents";
import { scoreReview, type Scores } from "@gms/review";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { access, passportFacts, recordEvent, stagesOf } from "./apply.ts";
import { fundingOf, minorOf } from "./awards.ts";
import { audit, authorize, required, type ServiceContext } from "./context.ts";
import type { InboxFilter } from "./inbox.ts";
import { listApplications } from "./inbox.ts";
import { toRubric } from "./reviews.ts";
import type { Row } from "./repos/types.ts";
import { sendCommunication, type sendInput } from "./templates.ts";

type Award = Row<"awards">;
const DAY = 86_400_000;
const STAFF = ["admin", "program_officer", "finance", "observer", "auditor"] as const;
const awarded = (a: Award) => minorOf(fundingOf(a).awardedAmount) ?? 0;
const disbursed = (a: Award) => minorOf((fundingOf(a) as { disbursedAmount?: { amount: string; currency: string } }).disbursedAmount) ?? 0;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

// ------------------------------------------------------------------------------------ applications

/** Proposed budget rows and attached documents for one application (funder detail tabs). */
export async function applicationBudgetAndDocuments(ctx: ServiceContext, appId: string) {
  const { app } = await access(ctx, appId, "applications:read");
  const [budgets, docs] = await Promise.all([ctx.repos.table("budgets").find({ application_id: app.id }), ctx.repos.table("documents").find({ subject_type: "application", subject_id: app.id }, { orderBy: "created_at" })]);
  const proposed = budgets.find((b) => b.kind === "proposed") ?? null;
  const lines = (Array.isArray(proposed?.lines) ? proposed.lines : []) as { category?: string; label?: string; amount_minor?: number; amountMinor?: number; notes?: string }[];
  return {
    applicationId: apiId("application", app.id),
    requestedAmountMinor: app.requested_amount_minor,
    currency: app.currency,
    budget: proposed
      ? {
          currency: proposed.currency,
          categories: proposed.categories,
          lines: lines.map((l) => ({ category: l.category ?? null, label: l.label ?? null, amountMinor: l.amountMinor ?? l.amount_minor ?? 0, notes: l.notes ?? null })),
          totalMinor: lines.reduce((s, l) => s + (l.amountMinor ?? l.amount_minor ?? 0), 0),
        }
      : null,
    documents: docs.map(documentView),
  };
}

const documentView = (d: Row<"documents">) => ({
  id: d.id,
  name: d.name,
  mime: d.mime,
  size: d.size,
  sha256: d.sha256,
  // Where the bytes live: uploaded to the GMS, or referenced in the organization's Passport locker.
  source: d.passport_document_id ? "passport_locker" : d.storage,
  passportDocumentId: d.passport_document_id,
  scanStatus: d.scan_status,
  uploadedAt: d.created_at,
});

// ---------------------------------------------------------------------------------------- programs

/** What a program has committed and paid, by award status, against its budget. */
export async function programRollup(ctx: ServiceContext, programId: string) {
  const ws = await authorize(ctx, { scope: "programs:read", kind: "funder" });
  const program = required(await ctx.repos.table("programs").one({ id: programId, workspace_id: ws.id }), "Program");
  const [awards, opps] = await Promise.all([ctx.repos.table("awards").find({ workspace_id: ws.id, program_id: program.id }), ctx.repos.table("opportunities").find({ workspace_id: ws.id, program_id: program.id })]);
  const byStatus: Record<string, { count: number; awardedMinor: number }> = {};
  for (const a of awards) {
    const s = (byStatus[a.status] ??= { count: 0, awardedMinor: 0 });
    s.count += 1;
    s.awardedMinor += awarded(a);
  }
  const committed = awards.filter((a) => !["cancelled"].includes(a.status)).reduce((s, a) => s + awarded(a), 0);
  const defaults = (program.defaults ?? {}) as { ownerUserId?: string };
  return {
    programId: program.id,
    budgetMinor: program.budget_amount_minor,
    currency: program.currency,
    committedMinor: committed,
    paidMinor: awards.reduce((s, a) => s + disbursed(a), 0),
    remainingMinor: program.budget_amount_minor === null ? null : program.budget_amount_minor - committed,
    committedByStatus: byStatus,
    awards: awards.length,
    opportunities: opps.length,
    ownerUserId: defaults.ownerUserId ?? null,
  };
}

// ------------------------------------------------------------------------------------ competitions

/** The reviewer pool: members who review, with how much each is carrying in this competition. */
export async function competitionReviewers(ctx: ServiceContext, competitionId: string) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: STAFF });
  const competition = required(await ctx.repos.table("competitions").one({ id: competitionId, workspace_id: ws.id }), "Competition");
  const apps = await ctx.repos.table("applications").find({ workspace_id: ws.id, competition_id: competition.id }, { limit: 5000 });
  const [members, assignments] = await Promise.all([
    ctx.repos.table("workspace_members").find({ workspace_id: ws.id }),
    apps.length ? ctx.repos.table("review_assignments").find({ workspace_id: ws.id, application_id: apps.map((a) => a.id) }) : Promise.resolve([]),
  ]);
  const pool = members.filter((m) => ["reviewer", "external_reviewer", "program_officer", "admin"].includes(m.role) || assignments.some((a) => a.reviewer_user_id === m.user_id));
  const people = (await ctx.ports.directory?.lookup(pool.map((m) => m.user_id))) ?? new Map<string, { email: string | null; name: string | null }>();
  return {
    competitionId: apiId("competition", competition.id),
    reviewers: pool.map((m) => {
      const mine = assignments.filter((a) => a.reviewer_user_id === m.user_id);
      const scope = (m.scope ?? {}) as { tags?: string[]; capacity?: number };
      return {
        userId: m.user_id,
        name: people.get(m.user_id)?.name ?? null,
        email: people.get(m.user_id)?.email ?? null,
        role: m.role,
        external: m.role === "external_reviewer",
        expertiseTags: Array.isArray(scope.tags) ? scope.tags : [],
        capacity: typeof scope.capacity === "number" ? scope.capacity : null,
        assigned: mine.length,
        submitted: mine.filter((a) => a.status === "submitted").length,
        recused: mine.filter((a) => a.status === "recused").length,
        expiresAt: m.expires_at,
      };
    }),
  };
}

/** Per-criterion means for each application in a stage, and where the stage's decisions stand. */
export async function panelSummary(ctx: ServiceContext, competitionId: string, stageKey?: string) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: ["admin", "program_officer", "observer", "auditor"] });
  const competition = required(await ctx.repos.table("competitions").one({ id: competitionId, workspace_id: ws.id }), "Competition");
  const stage = stageKey ?? stagesOf(competition)[0]?.key ?? "application";
  const apps = await ctx.repos.table("applications").find({ workspace_id: ws.id, competition_id: competition.id }, { notNull: ["submitted_at"], limit: 5000 });
  const assignments = apps.length ? (await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, stage, application_id: apps.map((a) => a.id) })).filter((a) => a.status !== "recused") : [];
  const reviews = assignments.length ? (await ctx.repos.table("reviews").find({ assignment_id: assignments.map((a) => a.id) })).filter((r) => r.submitted_at) : [];
  const rubrics = new Map<string, ReturnType<typeof toRubric>>();
  for (const a of assignments) {
    const key = `${a.rubric_id}:${a.rubric_version}`;
    if (!rubrics.has(key)) {
      const row = await ctx.repos.table("rubrics").one({ id: a.rubric_id, version: a.rubric_version });
      if (row) rubrics.set(key, toRubric(row));
    }
  }
  const criteria = [...rubrics.values()][0]?.criteria.map((c) => ({ key: c.key, label: c.label, weight: c.weight })) ?? [];
  const items = apps
    .filter((a) => a.stage === stage || assignments.some((x) => x.application_id === a.id))
    .map((app) => {
      const perCriterion: Record<string, number[]> = {};
      for (const a of assignments.filter((x) => x.application_id === app.id)) {
        const review = reviews.find((r) => r.assignment_id === a.id);
        const rubric = rubrics.get(`${a.rubric_id}:${a.rubric_version}`);
        if (!review || !rubric) continue;
        const scored = scoreReview(rubric, review.scores as Scores);
        for (const [k, v] of Object.entries(scored.normalized)) (perCriterion[k] ??= []).push(v * 100);
      }
      return { applicationId: apiId("application", app.id), criteria: Object.fromEntries(criteria.map((c) => [c.key, round1(mean(perCriterion[c.key] ?? []))])) };
    });
  const decisions = await ctx.repos.table("decisions").find({ workspace_id: ws.id, competition_id: competition.id });
  const latest = new Map<string, Row<"decisions">>();
  for (const d of decisions.filter((x) => (x.stage ?? stage) === stage).sort((x, y) => (x.created_at < y.created_at ? -1 : 1))) latest.set(d.application_id, d);
  const summary = { approve: 0, decline: 0, waitlist: 0, defer: 0, undecided: 0, committed: 0, proposedMinor: 0 };
  for (const it of items) {
    const d = latest.get(it.applicationId.replace(/^app_/, ""));
    if (!d) summary.undecided += 1;
    else {
      summary[d.outcome as "approve" | "decline" | "waitlist" | "defer"] += 1;
      if (d.committed_at) summary.committed += 1;
      if (d.outcome === "approve") summary.proposedMinor += d.amount_minor ?? 0;
    }
  }
  return { competitionId: apiId("competition", competition.id), stage, criteria, items, decisions: summary };
}

export const noteInput = z.object({ body: z.string().trim().min(1).max(10_000) }).strict();

async function panelThread(ctx: ServiceContext, wsId: string, competitionId: string, create: boolean) {
  const found = await ctx.repos.table("threads").one({ workspace_id: wsId, subject_type: "competition", subject_id: competitionId, visibility: "funder_internal" });
  if (found || !create) return found;
  return ctx.repos.table("threads").insert({ workspace_id: wsId, subject_type: "competition", subject_id: competitionId, visibility: "funder_internal", funder_workspace_id: wsId, title: "Panel discussion" });
}

/** Panel discussion notes: an internal thread on the competition. Never visible to applicants. */
export async function listPanelNotes(ctx: ServiceContext, competitionId: string) {
  const ws = await authorize(ctx, { scope: "reviews:read", kind: "funder", roles: ["admin", "program_officer", "observer", "auditor"] });
  required(await ctx.repos.table("competitions").one({ id: competitionId, workspace_id: ws.id }), "Competition");
  const thread = await panelThread(ctx, ws.id, competitionId, false);
  const messages = thread ? await ctx.repos.table("messages").find({ thread_id: thread.id }, { orderBy: "created_at" }) : [];
  return messages.map((m) => ({ id: m.id, body: m.body, author: m.author, authorUserId: m.author_user_id, at: m.created_at }));
}

export async function addPanelNote(ctx: ServiceContext, competitionId: string, input: z.output<typeof noteInput>) {
  const ws = await authorize(ctx, { scope: "reviews:write", kind: "funder", roles: ["admin", "program_officer"], person: true });
  required(await ctx.repos.table("competitions").one({ id: competitionId, workspace_id: ws.id }), "Competition");
  const thread = (await panelThread(ctx, ws.id, competitionId, true))!;
  const m = await ctx.repos.table("messages").insert({ thread_id: thread.id, author: ctx.actor.id, author_user_id: ctx.actor.userId, body: input.body });
  await audit(ctx, "panel.note_added", "competition", competitionId, { messageId: m.id });
  return { id: m.id, body: m.body, author: m.author, authorUserId: m.author_user_id, at: m.created_at };
}

// ------------------------------------------------------------------------------------------ awards

async function funderAward(ctx: ServiceContext, awardId: string) {
  const ws = await authorize(ctx, { scope: "awards:read", kind: "funder" });
  return { ws, award: required(await ctx.repos.table("awards").one({ id: awardId, workspace_id: ws.id }), "Award") };
}

const humanize = (eventType: string) => {
  const s = eventType.replace(/[._]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const activityView = (e: { eventType: string; actor: unknown; subjectType: string; subjectId: string; occurredAt?: string; data?: Record<string, unknown> }) => ({
  eventType: e.eventType,
  label: humanize(e.eventType),
  actor: typeof e.actor === "string" ? e.actor : JSON.stringify(e.actor),
  subjectType: e.subjectType,
  subjectId: e.subjectId,
  at: e.occurredAt ?? null,
  data: e.data ?? {},
});

/** Everything the ledger holds about one award and its agreements, tranches and requirements, newest first. */
export async function awardActivity(ctx: ServiceContext, awardId: string) {
  const { ws, award } = await funderAward(ctx, awardId);
  const [agreements, tranches, requirements] = await Promise.all([ctx.repos.table("agreements").find({ award_id: award.id }), ctx.repos.table("tranches").find({ award_id: award.id }), ctx.repos.table("requirements").find({ award_id: award.id })]);
  const subjects: [string, string][] = [["award", award.id], ...agreements.map((a): [string, string] => ["agreement", a.id]), ...tranches.map((t): [string, string] => ["tranche", t.id]), ...requirements.map((r): [string, string] => ["requirement", r.id])];
  const events = (await Promise.all(subjects.map(([subjectType, subjectId]) => ctx.ledger.list({ workspaceId: ws.id, subjectType, subjectId, limit: 500 })))).flat();
  return events.sort((a, b) => ((a.occurredAt ?? "") < (b.occurredAt ?? "") ? 1 : -1)).map(activityView);
}

/** Who signed each agreement version, when, and against which document hash. */
export async function awardSignatures(ctx: ServiceContext, awardId: string) {
  const { award } = await funderAward(ctx, awardId);
  const agreements = await ctx.repos.table("agreements").find({ award_id: award.id }, { orderBy: "version" });
  type Sig = { name?: string; user_id?: string; userId?: string; ip?: string; at?: string; hash?: string } | null;
  const sig = (s: Sig, party: string, agreementId: string, version: number, documentSha256: string | null) => (s ? [{ agreementId: apiId("agreement", agreementId), version, party, name: s.name ?? null, userId: s.userId ?? s.user_id ?? null, ip: s.ip ?? null, at: s.at ?? null, documentSha256: s.hash ?? documentSha256 }] : []);
  return agreements.flatMap((a) => [...sig(a.grantee_signature as Sig, "grantee", a.id, a.version, a.document_sha256), ...sig(a.funder_signature as Sig, "funder", a.id, a.version, a.document_sha256)]);
}

/** What stands between an award and closing it out, each line with its state. */
export async function awardCloseout(ctx: ServiceContext, awardId: string) {
  const { award } = await funderAward(ctx, awardId);
  const [tranches, requirements, amendments] = await Promise.all([ctx.repos.table("tranches").find({ award_id: award.id }), ctx.repos.table("requirements").find({ award_id: award.id }), ctx.repos.table("amendments").find({ award_id: award.id })]);
  const openTranches = tranches.filter((t) => !["settled", "cancelled"].includes(t.status));
  const openReqs = requirements.filter((r) => !["accepted", "waived"].includes(r.status));
  const end = ((award.key_dates ?? {}) as { periodOfPerformance?: { endDate?: string } }).periodOfPerformance?.endDate ?? null;
  const checks = [
    { key: "payments", label: "All payments settled or cancelled", state: openTranches.length ? "fail" : "pass", reason: openTranches.length ? `${openTranches.length} tranche(s) still open` : "Nothing outstanding" },
    { key: "requirements", label: "All requirements accepted or waived", state: openReqs.length ? "fail" : "pass", reason: openReqs.length ? `${openReqs.length} requirement(s) still open` : "Nothing outstanding" },
    { key: "amendments", label: "No amendment awaiting a decision", state: amendments.some((a) => a.status === "requested") ? "fail" : "pass", reason: amendments.some((a) => a.status === "requested") ? "An amendment request is waiting" : "None pending" },
    { key: "period", label: "Period of performance has ended", state: end === null ? "unknown" : end <= ctx.now().toISOString().slice(0, 10) ? "pass" : "fail", reason: end === null ? "No end date on the award" : `Ends ${end}` },
  ];
  return {
    awardId: apiId("award", award.id),
    status: award.status,
    awardedMinor: awarded(award),
    disbursedMinor: disbursed(award),
    disbursedAsOf: award.disbursed_at,
    checks,
    ready: checks.every((c) => c.state === "pass"),
  };
}

/** The closeout summary as a PDF: amounts, the checklist and the signatures on record. */
export async function awardCloseoutPdf(ctx: ServiceContext, awardId: string): Promise<{ bytes: Uint8Array; sha256: string; filename: string }> {
  const { ws, award } = await funderAward(ctx, awardId);
  const [summary, signatures, funder, recipient] = await Promise.all([awardCloseout(ctx, awardId), awardSignatures(ctx, awardId), ctx.repos.table("workspaces").one({ id: ws.id }), award.recipient_workspace_id ? ctx.repos.table("workspaces").one({ id: award.recipient_workspace_id }) : Promise.resolve(null)]);
  const currency = fundingOf(award).awardedAmount?.currency ?? "USD";
  const money = (minor: number) => `${currency} ${(minor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  const blocks: Block[] = [
    { type: "heading", level: 1, text: "Closeout summary" },
    { type: "fields", rows: [["Award", award.title], ["Reference", apiId("award", award.id)], ["Recipient", recipient?.display_name ?? "—"], ["Status", award.status], ["Awarded", money(summary.awardedMinor)], ["Disbursed (from Passport)", `${money(summary.disbursedMinor)}${summary.disbursedAsOf ? ` as of ${summary.disbursedAsOf.slice(0, 10)}` : ""}`]] },
    { type: "heading", level: 2, text: "Checklist" },
    { type: "list", ordered: false, items: summary.checks.map((c) => `${c.state === "pass" ? "Done" : c.state === "fail" ? "Open" : "Unknown"}: ${c.label}. ${c.reason}`) },
    { type: "heading", level: 2, text: "Signatures on record" },
    signatures.length ? { type: "list", ordered: false, items: signatures.map((s) => `${s.party}: ${s.name ?? "—"}, ${s.at?.slice(0, 10) ?? "—"}, document ${s.documentSha256?.slice(0, 12) ?? "—"}`) } : { type: "paragraph", text: "No signatures recorded." },
  ];
  const brand = (funder?.brand ?? {}) as { accent?: string };
  // Dated by the award's last change, not the clock, so the same record prints the same bytes.
  const bytes = await renderPdf({ title: `Closeout summary: ${award.title}`, header: funder?.display_name ?? "", footer: apiId("award", award.id), ...(brand.accent ? { accent: brand.accent } : {}), blocks, createdAt: award.updated_at });
  return { bytes, sha256: await sha256Hex(bytes), filename: `closeout-${apiId("award", award.id)}.pdf` };
}

// ---------------------------------------------------------------------------------------- payments

/** Tranches that fall due in the next `days` days (default 30), soonest first. */
export async function upcomingPayments(ctx: ServiceContext, days = 30) {
  const ws = await authorize(ctx, { scope: "payments:read", kind: "funder", roles: ["admin", "finance", "program_officer", "auditor"] });
  const until = new Date(ctx.now().getTime() + days * DAY).toISOString();
  const tranches = (await ctx.repos.table("tranches").find({ workspace_id: ws.id, status: ["scheduled", "due", "ready", "held"] }, { limit: 2000 })).filter((t) => t.due_at !== null && t.due_at <= until);
  const awards = tranches.length ? await ctx.repos.table("awards").find({ id: [...new Set(tranches.map((t) => t.award_id))] }) : [];
  const names = awards.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))] }) : [];
  const items = tranches
    .sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1))
    .map((t) => {
      const award = awards.find((a) => a.id === t.award_id);
      return { trancheId: apiId("tranche", t.id), awardId: apiId("award", t.award_id), awardTitle: award?.title ?? null, recipient: names.find((n) => n.id === award?.recipient_workspace_id)?.display_name ?? null, seq: t.seq, amountMinor: t.amount_minor, currency: t.currency, status: t.status, dueAt: t.due_at, holdReason: t.hold_reason };
    });
  return { days, totalMinor: items.reduce((s, i) => s + i.amountMinor, 0), items };
}

/** The money ledger: every ledger event about a tranche in this workspace, newest first. */
export async function paymentsLedger(ctx: ServiceContext, page: { offset: number; pageSize: number }) {
  const ws = await authorize(ctx, { scope: "payments:read", kind: "funder", roles: ["admin", "finance", "auditor"] });
  const events = (await ctx.ledger.list({ workspaceId: ws.id, subjectType: "tranche", limit: 5000 })).sort((a, b) => ((a.occurredAt ?? "") < (b.occurredAt ?? "") ? 1 : -1));
  return { items: events.slice(page.offset, page.offset + page.pageSize).map(activityView), total: events.length };
}

// ---------------------------------------------------------------------------------------- grantees

/** Reports one grantee has sent this funder, across awards. */
export async function granteeReports(ctx: ServiceContext, applicantId: string) {
  const ws = await authorize(ctx, { scope: "grantees:read", kind: "funder" });
  const awards = await ctx.repos.table("awards").find({ workspace_id: ws.id, recipient_workspace_id: applicantId });
  if (!awards.length) return [];
  const [requirements, submissions] = await Promise.all([ctx.repos.table("requirements").find({ award_id: awards.map((a) => a.id) }), ctx.repos.table("submissions").find({ workspace_id: ws.id, award_id: awards.map((a) => a.id) })]);
  return requirements
    .sort((a, b) => ((a.due_at ?? "") < (b.due_at ?? "") ? -1 : 1))
    .map((r) => {
      const s = submissions.filter((x) => x.requirement_id === r.id && x.status !== "draft").sort((x, y) => ((x.submitted_at ?? "") < (y.submitted_at ?? "") ? 1 : -1))[0];
      return { requirementId: apiId("requirement", r.id), awardId: apiId("award", r.award_id), awardTitle: awards.find((a) => a.id === r.award_id)?.title ?? null, title: r.title, type: r.type, status: r.status, dueAt: r.due_at, submissionId: s ? apiId("submission", s.id) : null, submittedAt: s?.submitted_at ?? null };
    });
}

// --------------------------------------------------------------------------------------- analytics

const BANDS: [string, number][] = [["Under $250k", 25_000_000], ["$250k – $1M", 100_000_000], ["$1M – $5M", 500_000_000], ["Over $5M", Infinity]];

/**
 * Awards by region, reviewer load, and an equity lens built only from what organizations shared
 * through Passport by applying: tax status, state and budget band. Organizations whose consent no
 * longer stands, or whose record lacks the field, are counted as "Not shared".
 */
export async function breakdowns(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "analytics:read", kind: "funder" });
  const [awards, assignments, consents] = await Promise.all([ctx.repos.table("awards").find({ workspace_id: ws.id }, { limit: 5000 }), ctx.repos.table("review_assignments").find({ workspace_id: ws.id }, { limit: 5000 }), ctx.repos.table("consents").find({ funder_workspace_id: ws.id, revoked_at: null })]);
  const live = awards.filter((a) => !["cancelled", "offered"].includes(a.status) && a.recipient_workspace_id);
  const orgs = live.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(live.map((a) => a.recipient_workspace_id as string))] }) : [];
  const shared = new Set(consents.map((c) => c.applicant_workspace_id));
  const tally = () => new Map<string, { awards: number; awardedMinor: number }>();
  const region = tally();
  const taxStatus = tally();
  const budgetBand = tally();
  const add = (m: ReturnType<typeof tally>, k: string, a: Award) => {
    const row = m.get(k) ?? { awards: 0, awardedMinor: 0 };
    row.awards += 1;
    row.awardedMinor += awarded(a);
    m.set(k, row);
  };
  for (const a of live) {
    const org = orgs.find((o) => o.id === a.recipient_workspace_id);
    const facts = org && shared.has(org.id) ? passportFacts(org) : null;
    const o = (facts?.org ?? {}) as { addresses?: { primary?: { stateOrProvince?: string } } };
    const p = (facts?.profile ?? {}) as { commonApp?: { irs?: { subsection?: string }; financials?: { budget?: number } } };
    add(region, o.addresses?.primary?.stateOrProvince ?? "Not shared", a);
    add(taxStatus, p.commonApp?.irs?.subsection ? `501(c)(${Number(p.commonApp.irs.subsection)})` : "Not shared", a);
    const budget = p.commonApp?.financials?.budget;
    add(budgetBand, typeof budget === "number" ? BANDS.find(([, max]) => budget * 100 < max)![0] : "Not shared", a);
  }
  const rows = (m: ReturnType<typeof tally>) => [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.awardedMinor - a.awardedMinor);
  const byReviewer = new Map<string, { assigned: number; submitted: number; recused: number }>();
  for (const a of assignments) {
    const r = byReviewer.get(a.reviewer_user_id) ?? { assigned: 0, submitted: 0, recused: 0 };
    r.assigned += 1;
    if (a.status === "submitted") r.submitted += 1;
    if (a.status === "recused") r.recused += 1;
    byReviewer.set(a.reviewer_user_id, r);
  }
  const people = (await ctx.ports.directory?.lookup([...byReviewer.keys()])) ?? new Map<string, { email: string | null; name: string | null }>();
  return {
    awardsByRegion: rows(region),
    equity: { basis: "Tax status, state and budget band from records organizations shared through Passport by applying", byTaxStatus: rows(taxStatus), byBudgetBand: rows(budgetBand) },
    reviewerLoad: [...byReviewer.entries()].map(([userId, v]) => ({ userId, name: people.get(userId)?.name ?? null, ...v })).sort((a, b) => b.assigned - a.assigned),
  };
}

// ---------------------------------------------------------------------------------- communications

export const bulkSendInput = z
  .object({
    templateId: z.string().min(1).max(100),
    /** A saved applications view: the same filters as `GET /gms/applications`. */
    view: z.object({ competitionId: z.uuid().optional(), stage: z.string().optional(), status: z.string().optional(), eligibility: z.string().optional(), level: z.string().optional(), tag: z.string().optional(), assignee: z.string().optional(), view: z.string().optional() }).strict(),
    subjectOverride: z.string().trim().min(1).max(200).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    /** Preview only: who would receive it, nothing sent. */
    dryRun: z.boolean().optional(),
  })
  .strict();

/** Send one template to every application in a view. Human-only: an agent's bulk send needs approval. */
export async function bulkSend(ctx: ServiceContext, input: z.output<typeof bulkSendInput>) {
  const { items, total } = await listApplications(ctx, { offset: 0, pageSize: 500, page: 1 } as never, input.view as InboxFilter);
  if (total > 500) throw new ApiError(422, "too_many_recipients", "This view has more than 500 applications; narrow it before sending");
  const recipients = items.map((a) => ({ applicationUuid: a.id.replace(/^app_/, "") }));
  if (input.dryRun) return { dryRun: true, requested: recipients.length, recipients: items.map((a) => ({ applicationId: a.id, title: a.title, applicant: a.applicant.name })) };
  if (!recipients.length) throw new ApiError(422, "no_recipients", "No applications match this view");
  const send: z.output<typeof sendInput> = { templateId: input.templateId, recipients: items.map((a) => ({ applicationId: a.id })), ...(input.subjectOverride ? { subjectOverride: input.subjectOverride } : {}), ...(input.fields ? { fields: input.fields } : {}) };
  return sendCommunication(ctx, send, recipients);
}

/** When each template was last sent, and how often, from the send log. */
export async function templateUsage(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "communications:write", kind: "funder" });
  const sent = await ctx.ledger.list({ workspaceId: ws.id, eventType: "communication.sent", limit: 5000 });
  const out = new Map<string, { templateId: string; sent: number; lastUsedAt: string | null; channel: string }>();
  for (const e of sent) {
    const id = e.data?.template as string | undefined;
    if (!id) continue;
    const row = out.get(id) ?? { templateId: id, sent: 0, lastUsedAt: null, channel: "email" };
    row.sent += 1;
    if ((e.occurredAt ?? "") > (row.lastUsedAt ?? "")) row.lastUsedAt = e.occurredAt ?? null;
    out.set(id, row);
  }
  return [...out.values()];
}

// --------------------------------------------------------------------------------------- dashboard

/** The workspace's recent activity, newest first, for the dashboard. Staff only. */
export async function recentActivity(ctx: ServiceContext, limit = 20) {
  const ws = await authorize(ctx, { scope: "applications:read", kind: "funder", roles: STAFF });
  const total = await ctx.ledger.count({ workspaceId: ws.id });
  const events = await ctx.ledger.list({ workspaceId: ws.id, limit: Math.min(limit, 100), offset: Math.max(0, total - Math.min(limit, 100)) });
  return events.sort((a, b) => ((a.occurredAt ?? "") < (b.occurredAt ?? "") ? 1 : -1)).map(activityView);
}

// -------------------------------------------------------------------------------------- interviews

export const interviewInput = z.object({ slots: z.array(z.iso.datetime({ offset: true })).min(1).max(10), note: z.string().trim().max(2000).optional(), location: z.string().trim().max(500).optional() }).strict();
export const interviewConfirmInput = z.object({ slot: z.iso.datetime({ offset: true }) }).strict();

/** The funder proposes interview times; they appear on the applicant's status page. */
export async function proposeInterview(ctx: ServiceContext, appId: string, input: z.output<typeof interviewInput>) {
  const { app, side } = await access(ctx, appId, "applications:write");
  if (side !== "funder") throw new ApiError(403, "wrong_workspace_kind", "Interview times are proposed by the funder");
  await recordEvent(ctx, app, "interview_proposed", { payload: { slots: input.slots, note: input.note ?? null, location: input.location ?? null } });
  await audit(ctx, "application.interview_proposed", "application", app.id, { slots: input.slots.length }, app.workspace_id);
  return interviewState(ctx, app.id);
}

/** The applicant picks one of the proposed times. */
export async function confirmInterview(ctx: ServiceContext, appId: string, input: z.output<typeof interviewConfirmInput>) {
  const { app, side } = await access(ctx, appId, "applications:write");
  if (side !== "applicant") throw new ApiError(403, "wrong_workspace_kind", "The applicant confirms the interview time");
  const state = await interviewState(ctx, app.id);
  if (!state.proposed || !state.proposed.slots.includes(input.slot)) throw new ApiError(422, "slot_not_offered", "Choose one of the times the funder offered");
  await recordEvent(ctx, app, "interview_confirmed", { payload: { slot: input.slot } });
  await audit(ctx, "application.interview_confirmed", "application", app.id, { slot: input.slot }, app.workspace_id);
  return interviewState(ctx, app.id);
}

async function interviewState(ctx: ServiceContext, applicationId: string) {
  const events = await ctx.repos.table("application_events").find({ application_id: applicationId }, { orderBy: "created_at" });
  const proposed = [...events].reverse().find((e) => e.type === "interview_proposed");
  const confirmed = proposed ? [...events].reverse().find((e) => e.type === "interview_confirmed" && e.created_at >= proposed.created_at) : undefined;
  const p = (proposed?.payload ?? {}) as { slots?: string[]; note?: string | null; location?: string | null };
  return {
    proposed: proposed ? { slots: p.slots ?? [], note: p.note ?? null, location: p.location ?? null, at: proposed.created_at } : null,
    confirmed: confirmed ? { slot: (confirmed.payload as { slot?: string }).slot ?? null, at: confirmed.created_at } : null,
  };
}

/** Revision requests, the interview and the decision for one application, as the caller's side may see them. */
export async function applicationFollowUps(ctx: ServiceContext, appId: string) {
  const { app, side } = await access(ctx, appId, "applications:read");
  const events = await ctx.repos.table("application_events").find({ application_id: app.id }, { orderBy: "created_at" });
  const requests = events.filter((e) => e.type === "request_revision");
  const decision = app.decision_id ? await ctx.repos.table("decisions").one({ id: app.decision_id }) : null;
  const award = decision?.outcome === "approve" ? await ctx.repos.table("awards").one({ application_id: app.id }) : null;
  return {
    applicationId: apiId("application", app.id),
    revisionRequests: requests.map((e) => {
      const p = (e.payload ?? {}) as { message?: string; fields?: unknown; dueAt?: string };
      const answered = events.find((x) => x.type === "submit" && x.created_at > e.created_at);
      return { id: e.id, message: p.message ?? null, fields: Array.isArray(p.fields) ? p.fields : [], dueAt: p.dueAt ?? null, requestedAt: e.created_at, answeredAt: answered?.created_at ?? null };
    }),
    interview: await interviewState(ctx, app.id),
    // A decision is shown once it is committed; the funder's rationale stays on the funder's side.
    decision: decision?.committed_at
      ? { outcome: decision.outcome, decidedAt: decision.committed_at, amountMinor: decision.outcome === "approve" ? decision.amount_minor : null, currency: decision.currency, conditions: decision.conditions, awardId: award ? apiId("award", award.id) : null, ...(side === "funder" ? { rationale: decision.rationale } : {}) }
      : null,
  };
}
