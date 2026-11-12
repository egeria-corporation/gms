// SPDX-License-Identifier: AGPL-3.0-only
// Analytics, exports and imports (build spec §9.2, §10.13). Paid amounts are always the values
// last read from Passport (`funding.disbursedAmount`); the GMS never sums payments itself.
import { toMoney } from "@gms/protocol";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { project as projectApplication } from "./apply.ts";
import { currencyOf, fundingOf, keyDatesOf, listCgAwards, minorOf, type Award } from "./awards.ts";
import { audit, authorize, type ServiceContext } from "./context.ts";
import { toDefinition } from "./forms.ts";
import { projectOrThrow } from "./opportunities.ts";
import type { TableName } from "@gms/db";
import { orgFacts, profileSourceOf, selfDeclaredOf, verificationOf, verificationShared } from "./profile.ts";
import { RepoError, type Row } from "./repos/types.ts";

const COMMITTED = ["accepted", "active", "suspended", "completed"];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const awarded = (a: Award) => minorOf(fundingOf(a).awardedAmount) ?? 0;
const paid = (a: Award) => minorOf(fundingOf(a).disbursedAmount) ?? 0;

/** Committed and paid by program, with what is waiting on people. */
export async function portfolio(ctx: ServiceContext, f: { fiscalYear?: number | undefined } = {}) {
  const ws = await authorize(ctx, { scope: "analytics:read", kind: "funder" });
  const [programs, awards, apps, reqs, tranches] = await Promise.all([
    ctx.repos.table("programs").find({ workspace_id: ws.id }, { orderBy: "name" }),
    ctx.repos.table("awards").find({ workspace_id: ws.id }, { limit: 5000 }),
    ctx.repos.table("applications").find({ workspace_id: ws.id }, { limit: 5000 }),
    ctx.repos.table("requirements").find({ workspace_id: ws.id }, { limit: 5000 }),
    ctx.repos.table("tranches").find({ workspace_id: ws.id }, { limit: 5000 }),
  ]);
  const inYear = programs.filter((p) => f.fiscalYear === undefined || p.fiscal_year === f.fiscalYear);
  const row = (name: string, id: string | null, budget: number | null, currency: string, list: Award[]) => {
    const live = list.filter((a) => COMMITTED.includes(a.status));
    const committedMinor = sum(live.map(awarded));
    const paidMinor = sum(live.map(paid));
    return { programId: id, name, currency, budgetMinor: budget, committedMinor, paidMinor, committedNotPaidMinor: Math.max(0, committedMinor - paidMinor), awards: live.length, overBudgetMinor: budget !== null && committedMinor > budget ? committedMinor - budget : 0 };
  };
  const byProgram = inYear.map((p) => row(p.name, p.id, p.budget_amount_minor, p.currency, awards.filter((a) => a.program_id === p.id)));
  const unassigned = awards.filter((a) => !a.program_id || !programs.some((p) => p.id === a.program_id));
  if (f.fiscalYear === undefined && unassigned.length) byProgram.push(row("No program", null, null, "USD", unassigned));
  const submitted = apps.filter((a) => a.submitted_at);
  const open = submitted.filter((a) => !["accepted", "declined", "withdrawn", "waitlisted"].includes(a.status));
  const asOf = awards.map((a) => a.disbursed_at).filter((x): x is string => !!x).sort().pop() ?? null;
  return {
    asOf: ctx.now().toISOString(),
    /** When the paid figures were last read back from Passport. */
    paidAsOf: asOf,
    totals: { budgetMinor: sum(byProgram.map((p) => p.budgetMinor ?? 0)), committedMinor: sum(byProgram.map((p) => p.committedMinor)), paidMinor: sum(byProgram.map((p) => p.paidMinor)), awards: sum(byProgram.map((p) => p.awards)) },
    programs: byProgram,
    applications: { submitted: submitted.length, open: open.length, byStatus: Object.fromEntries([...new Set(submitted.map((a) => a.status))].map((s) => [s, submitted.filter((a) => a.status === s).length])) },
    reporting: { due: reqs.filter((r) => r.status === "due").length, overdue: reqs.filter((r) => r.status === "overdue").length, received: reqs.filter((r) => ["submitted", "under_review"].includes(r.status)).length, accepted: reqs.filter((r) => r.status === "accepted").length },
    payments: { dueMinor: sum(tranches.filter((t) => ["due", "ready"].includes(t.status)).map((t) => t.amount_minor)), heldMinor: sum(tranches.filter((t) => t.status === "held").map((t) => t.amount_minor)), inFlightMinor: sum(tranches.filter((t) => ["releasing", "initiated"].includes(t.status)).map((t) => t.amount_minor)), scheduledMinor: sum(tranches.filter((t) => t.status === "scheduled").map((t) => t.amount_minor)) },
  };
}

/** One competition's cycle: volume by stage and status, eligibility, decisions and time to decision. */
export async function cycleMetrics(ctx: ServiceContext, competitionId: string) {
  const ws = await authorize(ctx, { scope: "analytics:read", kind: "funder" });
  const comp = await ctx.repos.table("competitions").one({ id: competitionId });
  if (!comp || comp.workspace_id !== ws.id) throw notFound("Competition");
  const [apps, decisions, assignments] = await Promise.all([ctx.repos.table("applications").find({ competition_id: comp.id }, { limit: 5000 }), ctx.repos.table("decisions").find({ competition_id: comp.id }, { limit: 5000 }), ctx.repos.table("review_assignments").find({ workspace_id: ws.id }, { limit: 10000 })]);
  const submitted = apps.filter((a) => a.submitted_at);
  const ids = new Set(apps.map((a) => a.id));
  const mine = assignments.filter((a) => ids.has(a.application_id));
  const committed = decisions.filter((d) => d.committed_at);
  const days = committed.map((d) => {
    const a = apps.find((x) => x.id === d.application_id);
    return a?.submitted_at ? (Date.parse(d.committed_at!) - Date.parse(a.submitted_at)) / 86_400_000 : null;
  }).filter((x): x is number => x !== null && x >= 0);
  const count = <T extends string>(values: T[]) => Object.fromEntries([...new Set(values)].map((v) => [v, values.filter((x) => x === v).length]));
  const stages = ((comp.stages as { key: string; label: string }[] | null) ?? []).map((s) => ({ key: s.key, label: s.label, applications: submitted.filter((a) => a.stage === s.key).length }));
  const approved = committed.filter((d) => d.outcome === "approve");
  return {
    competitionId: apiId("competition", comp.id),
    title: comp.title,
    status: comp.status,
    started: apps.length,
    submitted: submitted.length,
    submitRate: apps.length ? Math.round((submitted.length / apps.length) * 1000) / 10 : null,
    stages,
    byStatus: count(submitted.map((a) => a.status)),
    eligibility: count(submitted.map((a) => String((a.eligibility as { eligible?: unknown } | null)?.eligible ?? "not_run"))),
    byLevel: count(submitted.map((a) => a.verification_level_at_submit ?? "none")),
    reviews: { assigned: mine.length, submitted: mine.filter((a) => a.status === "submitted").length, recused: mine.filter((a) => a.status === "recused").length },
    decisions: { ...count(committed.map((d) => d.outcome)), pending: decisions.length - committed.length },
    requestedMinor: sum(submitted.map((a) => a.requested_amount_minor ?? 0)),
    awardedMinor: sum(approved.map((d) => d.amount_minor ?? 0)),
    medianDaysToDecision: median(days) === null ? null : Math.round(median(days)! * 10) / 10,
  };
}

// ------------------------------------------------------------------------------------ 990-PF

/** RFC 4180 field. A leading =, +, -, @ is prefixed with an apostrophe so a spreadsheet never runs it as a formula. */
export const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]): string => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

const dollars = (minor: number) => toMoney(minor, "USD").amount;

/**
 * The grant list for Form 990-PF Part XV line 3: grants paid during the year and grants approved
 * for future payment. "Paid" is Passport's disbursed amount as last read back; a row that has not
 * been read back yet says so instead of guessing.
 */
export async function grantList990pf(ctx: ServiceContext, year: number) {
  const ws = await authorize(ctx, { scope: "analytics:read", kind: "funder", roles: ["admin", "finance", "auditor", "program_officer"] });
  const awards = (await ctx.repos.table("awards").find({ workspace_id: ws.id, status: COMMITTED }, { limit: 5000 })).filter((a) => {
    const date = keyDatesOf(a).awardDate?.date ?? a.created_at;
    return Number(date.slice(0, 4)) <= year;
  });
  const recipients = awards.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))] }) : [];
  const consents = await ctx.repos.table("consents").find({ funder_workspace_id: ws.id, revoked_at: null });
  const items = awards.map((a) => {
    const w = recipients.find((r) => r.id === a.recipient_workspace_id);
    const canRead = !!w && consents.some((c) => c.applicant_workspace_id === w.id);
    // The Passport record's address, or the one a self-declared profile gives (marked by `recipientVerification`).
    const addr = canRead ? (((orgFacts(w!).org as { addresses?: { primary?: Record<string, string> } }).addresses?.primary) ?? null) : null;
    const individual = a.recipient_individual as { name?: string } | null;
    const awardedMinor = awarded(a);
    const paidMinor = paid(a);
    return {
      awardId: apiId("award", a.id),
      recipientName: w?.legal_name ?? w?.display_name ?? individual?.name ?? "Unknown recipient",
      recipientAddress: addr ? [addr.street1, addr.city, addr.stateOrProvince, addr.postalCode].filter(Boolean).join(", ") : null,
      recipientVerification: verificationShared(w, canRead),
      relationship: "None",
      foundationStatus: w ? "PC" : "I",
      purpose: a.title,
      currency: currencyOf(a),
      awardedMinor,
      paidMinor,
      approvedForFuturePaymentMinor: Math.max(0, awardedMinor - paidMinor),
      paidAsOf: a.disbursed_at,
    };
  });
  await audit(ctx, "export.grant_list_990pf", "workspace", ws.id, { year, awards: items.length });
  const csv = toCsv(["Recipient", "Address", "Relationship", "Foundation status", "Purpose of grant", "Paid (per Passport)", "Approved for future payment", "Paid figure read from Passport at"], items.map((i) => [i.recipientName, i.recipientAddress ?? "", i.relationship, i.foundationStatus, i.purpose, dollars(i.paidMinor), dollars(i.approvedForFuturePaymentMinor), i.paidAsOf ?? "not read back yet"]));
  return { year, items, totals: { paidMinor: sum(items.map((i) => i.paidMinor)), approvedForFuturePaymentMinor: sum(items.map((i) => i.approvedForFuturePaymentMinor)) }, csv };
}

// ------------------------------------------------------------------------------------ bundle export

/**
 * `gms export`: a CommonGrants JSON bundle, the GMS-specific records, and an attachments manifest
 * (name, size, SHA-256 and storage path for every file; bytes are fetched separately). Written to
 * the EXPORTS bucket when one is configured, and always summarized in the response.
 */
export async function exportBundle(ctx: ServiceContext, opts: { inline?: boolean } = {}) {
  if (ctx.workspace?.kind === "applicant") return exportApplicantBundle(ctx, opts);
  // A workspace admin in person, or the operator's `gms export` (a system actor built by the CLI).
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], ...(ctx.actor.kind === "system" ? {} : { person: true }) });
  const funder = (await ctx.repos.table("workspaces").one({ id: ws.id }))!;
  const t = <N extends Parameters<typeof ctx.repos.table>[0]>(name: N) => ctx.repos.table(name).find({ workspace_id: ws.id } as never, { limit: 10000 });
  const [opps, comps, forms, apps, awards, programs, rubrics, decisions, agreements, tranches, requirements, submissions, budgets, amendments, templates, documents, assignments, paymentSchedules] = await Promise.all([t("opportunities"), t("competitions"), t("forms"), t("applications"), t("awards"), t("programs"), t("rubrics"), t("decisions"), t("agreements"), t("tranches"), t("requirements"), t("submissions"), t("budgets"), t("amendments"), t("templates"), t("documents"), t("review_assignments"), t("payment_schedules")]);
  const reviews = assignments.length ? await ctx.repos.table("reviews").find({ assignment_id: assignments.map((a) => a.id) }, { limit: 10000 }) : [];
  const responses = await t("form_responses");
  const applicantIds = [...new Set([...apps.map((a) => a.applicant_workspace_id), ...awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x)])];
  const consents = await ctx.repos.table("consents").find({ funder_workspace_id: ws.id, revoked_at: null });
  const applicants = applicantIds.length ? await ctx.repos.table("workspaces").find({ id: applicantIds }) : [];

  const safe = <T>(fn: () => T): T | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  const cgAwards = (await listCgAwards(ctx, { page: 1, pageSize: 10000, offset: 0 })).items;
  const cgApplications = [];
  for (const a of apps.filter((x) => x.submitted_at)) cgApplications.push(await projectApplication(ctx, a).catch(() => ({ id: a.id, title: a.title })));
  const commonGrants = {
    protocol: "CommonGrants v0.5.0",
    opportunities: opps.map((o) => safe(() => projectOrThrow(ctx, o, funder)) ?? { id: o.id, title: o.title, status: { value: o.status } }),
    competitions: comps.map((c) => c.cg ?? { id: c.id, opportunityId: c.opportunity_id, title: c.title, status: { value: c.status } }),
    forms: forms.map((f) => ({ ...toDefinition(f), version: f.version })),
    applications: cgApplications,
    awards: cgAwards,
    // Organizations are references into Passport, plus the cached projection where the organization consented.
    orgs: applicants.map((w) => {
      const shared = consents.some((c) => c.applicant_workspace_id === w.id);
      return { passportOrgId: w.passport_org_id, name: w.display_name, verification: verificationShared(w, shared), projection: shared && profileSourceOf(w) === "passport" ? w.org_projection : null, selfDeclared: shared ? selfDeclaredOf(w) : null };
    }),
  };
  const strip = <R extends { workspace_id?: string }>(rows: R[]) => rows;
  const gms = { exportedAt: ctx.now().toISOString(), workspace: { id: funder.id, handle: funder.handle, displayName: funder.display_name, brand: funder.brand }, programs, rubrics, formResponses: responses, reviewAssignments: assignments, reviews, decisions, agreements: strip(agreements), paymentSchedules, tranches, requirements, submissions, budgets, amendments, templates,
    // The workspace's own rows behind the CommonGrants projections, so `gms import` restores them exactly.
    records: { opportunities: opps, competitions: comps, forms, applications: apps, awards } };
  const attachments = documents.map((d) => ({ id: d.id, name: d.name, mime: d.mime, size: d.size, sha256: d.sha256, storage: d.storage, path: d.path, subjectType: d.subject_type, subjectId: d.subject_id, passportDocumentId: d.passport_document_id }));
  const prefix = `exports/${ws.id}/${ctx.now().toISOString().replace(/[:.]/g, "-")}`;
  const files = { "commongrants.json": commonGrants, "gms.json": gms, "attachments/manifest.json": attachments };
  let written = false;
  if (ctx.ports.exports) {
    for (const [name, body] of Object.entries(files)) await ctx.ports.exports.put(`${prefix}/${name}`, JSON.stringify(body), "application/json");
    written = true;
  }
  const counts = { opportunities: opps.length, competitions: comps.length, forms: forms.length, applications: cgApplications.length, awards: cgAwards.length, orgs: applicants.length, attachments: attachments.length };
  await audit(ctx, "export.bundle", "workspace", ws.id, { ...counts, written });
  return { prefix: written ? prefix : null, written, files: Object.keys(files), counts, ...(opts.inline || !written ? { bundle: files } : {}) };
}

/**
 * The applicant's own bundle: everything the organization entered here. Its applications as
 * CommonGrants records with their answers, the grants it received, its reports, its answer
 * library, and its organization as a reference into Passport (the GMS's cached copy is included,
 * Passport stays the source). Reviews, scores and funder-internal notes are never part of it.
 */
async function exportApplicantBundle(ctx: ServiceContext, opts: { inline?: boolean }) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "applicant", roles: ["admin"], ...(ctx.actor.kind === "system" ? {} : { person: true }) });
  const me = (await ctx.repos.table("workspaces").one({ id: ws.id }))!;
  const [apps, awards, answers, documents] = await Promise.all([
    ctx.repos.table("applications").find({ applicant_workspace_id: ws.id }, { limit: 10000 }),
    ctx.repos.table("awards").find({ recipient_workspace_id: ws.id }, { limit: 10000 }),
    ctx.repos.table("answers").find({ workspace_id: ws.id }, { limit: 10000 }),
    ctx.repos.table("documents").find({ owner_workspace_id: ws.id }, { limit: 10000 }),
  ]);
  const awardIds = awards.map((a) => a.id);
  const [requirements, allSubmissions, budgets] = awardIds.length
    ? await Promise.all([ctx.repos.table("requirements").find({ award_id: awardIds }, { limit: 10000 }), ctx.repos.table("submissions").find({ award_id: awardIds }, { limit: 10000 }), ctx.repos.table("budgets").find({ award_id: awardIds }, { limit: 10000 })])
    : [[], [], []];
  // A copy shared with another funder belongs to that funder's workspace; the original is the applicant's.
  const submissions = allSubmissions.filter((s) => !s.shared_from_submission_id);
  const appIds = apps.map((a) => a.id);
  const subIds = submissions.map((s) => s.id);
  const responses = [
    ...(appIds.length ? await ctx.repos.table("form_responses").find({ application_id: appIds }, { limit: 10000 }) : []),
    ...(subIds.length ? await ctx.repos.table("form_responses").find({ submission_id: subIds }, { limit: 10000 }) : []),
  ];
  const funderIds = [...new Set([...apps.map((a) => a.workspace_id), ...awards.map((a) => a.workspace_id)])];
  const funders = funderIds.length ? await ctx.repos.table("workspaces").find({ id: funderIds }) : [];
  const cgApplications = [];
  for (const a of apps) cgApplications.push(await projectApplication(ctx, a).catch(() => ({ id: a.id, title: a.title, status: { value: a.cg_status } })));
  const commonGrants = {
    protocol: "CommonGrants v0.5.0",
    applications: cgApplications,
    awards: awards.map((a) => a.cg ?? { id: a.id, title: a.title, status: { value: a.cg_status } }),
    // The organization is a reference into Passport; the cached projection is a convenience copy.
    orgs: [{ passportOrgId: me.passport_org_id, name: me.display_name, verificationLevel: me.verification_level, verification: verificationOf(me), projection: me.org_projection, projectionAt: me.org_projection_at, selfDeclared: selfDeclaredOf(me) }],
  };
  const gms = {
    exportedAt: ctx.now().toISOString(),
    workspace: { id: me.id, handle: me.handle, displayName: me.display_name, kind: "applicant" },
    funders: funders.map((f) => ({ id: f.id, handle: f.handle, name: f.display_name })),
    applications: apps.map((a) => ({ id: a.id, title: a.title, status: a.status, stage: a.stage, funderWorkspaceId: a.workspace_id, submittedAt: a.submitted_at, requestedAmountMinor: a.requested_amount_minor, currency: a.currency })),
    formResponses: responses.map((r) => ({ id: r.id, applicationId: r.application_id, submissionId: r.submission_id, formId: r.form_id, formVersion: r.form_version, status: r.status, response: r.response, provenance: r.provenance })),
    awards: awards.map((a) => ({ id: a.id, title: a.title, status: a.status, funderWorkspaceId: a.workspace_id, funding: a.funding, keyDates: a.key_dates })),
    requirements: requirements.map((r) => ({ id: r.id, awardId: r.award_id, type: r.type, title: r.title, dueAt: r.due_at, status: r.status })),
    submissions: submissions.map((s) => ({ id: s.id, requirementId: s.requirement_id, awardId: s.award_id, status: s.status, submittedAt: s.submitted_at })),
    budgets: budgets.map((b) => ({ id: b.id, awardId: b.award_id, kind: b.kind, lines: b.lines, source: b.source })),
    answers: answers.map((a) => ({ id: a.id, key: a.key, title: a.title, body: a.body, version: a.version })),
  };
  const attachments = documents.map((d) => ({ id: d.id, name: d.name, mime: d.mime, size: d.size, sha256: d.sha256, subjectType: d.subject_type, subjectId: d.subject_id, passportDocumentId: d.passport_document_id }));
  const prefix = `exports/${ws.id}/${ctx.now().toISOString().replace(/[:.]/g, "-")}`;
  const files = { "commongrants.json": commonGrants, "gms.json": gms, "attachments/manifest.json": attachments };
  let written = false;
  if (ctx.ports.exports) {
    for (const [name, body] of Object.entries(files)) await ctx.ports.exports.put(`${prefix}/${name}`, JSON.stringify(body), "application/json");
    written = true;
  }
  const counts = { applications: apps.length, awards: awards.length, reports: submissions.length, answers: answers.length, orgs: 1, attachments: attachments.length };
  await audit(ctx, "export.bundle", "workspace", ws.id, { ...counts, written });
  return { prefix: written ? prefix : null, written, files: Object.keys(files), counts, ...(opts.inline || !written ? { bundle: files } : {}) };
}

// ------------------------------------------------------------------------------------ CSV import

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

const TARGETS = ["recipientName", "recipientEin", "title", "awardedAmount", "awardDate", "startDate", "endDate", "status", "programName"] as const;
export const importInput = z
  .object({
    csv: z.string().min(1).max(5_000_000),
    /** Which CSV column feeds each field. `recipientName`, `title` and `awardedAmount` are required. */
    mapping: z.partialRecord(z.enum(TARGETS), z.string().min(1)),
    dryRun: z.boolean().optional(),
  })
  .strict();

const amountOf = (v: string): number | null => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const dateOf = (v: string | undefined): string | null => {
  if (!v?.trim()) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
};

/**
 * Import historical awards from a CSV with a column mapping (generic mapper). A recipient is
 * matched to an applicant workspace by EIN, then by exact name; an unmatched recipient is kept on
 * the award as a named recipient without a workspace. Imported awards are `completed` or `active`
 * records with no payment schedule: nothing imported can be paid from here.
 */
export async function importAwardsCsv(ctx: ServiceContext, input: z.output<typeof importInput>) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
  const rows = parseCsv(input.csv);
  const header = rows[0];
  if (!header || rows.length < 2) throw new ApiError(422, "empty_csv", "The file has no data rows");
  const col = (name: (typeof TARGETS)[number]) => (input.mapping[name] ? header.indexOf(input.mapping[name]!) : -1);
  const missing = (["recipientName", "title", "awardedAmount"] as const).filter((n) => col(n) < 0);
  if (missing.length) throw new ApiError(422, "mapping_incomplete", `Map a column for: ${missing.join(", ")}`, missing.map((m) => ({ code: "unmapped", field: m })));
  const [applicants, programs] = await Promise.all([ctx.repos.table("workspaces").find({ kind: "applicant" }, { limit: 10000 }), ctx.repos.table("programs").find({ workspace_id: ws.id })]);
  const results: { row: number; ok: boolean; awardId?: string; matchedRecipient?: boolean; error?: string }[] = [];
  let created = 0;
  for (const [i, r] of rows.slice(1).entries()) {
    const get = (n: (typeof TARGETS)[number]) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
    const name = get("recipientName");
    const title = get("title");
    const amount = amountOf(get("awardedAmount"));
    if (!name || !title || amount === null) {
      results.push({ row: i + 2, ok: false, error: !name ? "No recipient name" : !title ? "No title" : "The amount is not a positive number" });
      continue;
    }
    const ein = get("recipientEin").replace(/\D/g, "");
    const match = (ein ? applicants.find((w) => (w.ein ?? "").replace(/\D/g, "") === ein) : undefined) ?? applicants.find((w) => [w.display_name, w.legal_name].some((n) => n?.toLowerCase() === name.toLowerCase()));
    const program = programs.find((p) => p.name.toLowerCase() === get("programName").toLowerCase());
    const status = /closed|complete/i.test(get("status")) ? "completed" : "active";
    const start = dateOf(get("startDate"));
    const end = dateOf(get("endDate"));
    const awardDate = dateOf(get("awardDate"));
    if (input.dryRun) {
      results.push({ row: i + 2, ok: true, matchedRecipient: !!match });
      continue;
    }
    const a = await ctx.repos.table("awards").insert({
      workspace_id: ws.id,
      recipient_workspace_id: match?.id ?? null,
      recipient_individual: (match ? null : { name, imported: true }) as Award["recipient_individual"],
      program_id: program?.id ?? null,
      title,
      status,
      cg_status: status === "completed" ? "completed" : "awarded",
      conditions: ["imported"],
      funding: { awardedAmount: toMoney(amount, "USD") } as unknown as Award["funding"],
      key_dates: { ...(awardDate ? { awardDate: { name: "Award date", eventType: "singleDate", date: awardDate } } : {}), ...(start && end ? { periodOfPerformance: { name: "Period of performance", eventType: "dateRange", startDate: start, endDate: end } } : {}) } as Award["key_dates"],
    });
    created++;
    results.push({ row: i + 2, ok: true, awardId: apiId("award", a.id), matchedRecipient: !!match });
  }
  if (!input.dryRun) await audit(ctx, "import.csv", "workspace", ws.id, { rows: rows.length - 1, created });
  return { dryRun: input.dryRun === true, rows: rows.length - 1, created, failed: results.filter((r) => !r.ok).length, unmatchedRecipients: results.filter((r) => r.ok && r.matchedRecipient === false).length, results };
}

export type { Row };

// ------------------------------------------------------------------------------------ bundle import

type AnyRow = Record<string, unknown> & { id?: unknown };
const rowsOf = (v: unknown): AnyRow[] => (Array.isArray(v) ? v.filter((r): r is AnyRow => typeof r === "object" && r !== null && typeof (r as AnyRow).id === "string") : []);

/**
 * What a column of an imported row may point at:
 * - `own`: a row of that table in the target workspace (already there, or inserted by this run);
 * - `library`: the same, or a shared-library row (`workspace_id` null);
 * - `applicant`: an applicant workspace on this instance.
 */
type Ref = { table: TableName; kind: "own" | "library" | "applicant" };
const own = (table: TableName): Ref => ({ table, kind: "own" });
const library = (table: TableName): Ref => ({ table, kind: "library" });

/** Why a tenant cannot call the import. One message for the route and the service. */
export const IMPORT_NOT_AVAILABLE = "Restoring a bundle is done by the server's operator with `gms import`. It is not available from a workspace";

/**
 * `gms import`: restore a bundle written by `gms export` into a funder workspace (a move between
 * instances, or a restore). **Operator only**: the rows are inserted as they were exported, with
 * the service role, so this is never reachable from a workspace's own session (it was, and any
 * signed-in person could write rows into other tenants with it; red team 2026-11).
 *
 * Even for the operator, an import cannot write outside the workspace it was given:
 * - every row's `workspace_id` is set to the target workspace, never left null (a null on forms,
 *   rubrics or templates is the shared library) and never taken from the row;
 * - every reference a row carries must be to a row of the target workspace, or one inserted by
 *   this run; a row that names another workspace's record is skipped with what hangs off it;
 * - a row whose id already exists in another workspace is skipped, not adopted.
 * Rows keep their ids and are inserted in dependency order; a row already in the target workspace
 * is left alone, so an import can be re-run. Applications and awards need their applicant
 * workspace on this instance. Nothing imported can be paid without the readiness checks.
 */
export async function importBundle(ctx: ServiceContext, bundle: { gms?: unknown }) {
  if (ctx.actor.kind !== "system") throw new ApiError(410, "import_not_available", IMPORT_NOT_AVAILABLE);
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"] });
  const g = (bundle.gms ?? {}) as Record<string, unknown>;
  const records = (g.records ?? {}) as Record<string, unknown>;
  if (!g.workspace || !g.records) throw new ApiError(422, "not_a_bundle", "This is not a GMS export bundle (gms.json with `workspace` and `records` is required)");
  const counts: Record<string, { inserted: number; existing: number; skipped: number }> = {};
  const kept = new Map<string, Set<string>>();
  const responses = rowsOf(g.formResponses);
  // Each step: table, rows, and what each reference column may point at. Order follows the foreign keys.
  const steps: { table: TableName; rows: AnyRow[]; refs?: Record<string, Ref> }[] = [
    { table: "programs", rows: rowsOf(g.programs) },
    { table: "rubrics", rows: rowsOf(g.rubrics) },
    { table: "templates", rows: rowsOf(g.templates) },
    { table: "forms", rows: rowsOf(records.forms) },
    { table: "opportunities", rows: rowsOf(records.opportunities), refs: { program_id: own("programs") } },
    { table: "competitions", rows: rowsOf(records.competitions), refs: { opportunity_id: own("opportunities") } },
    { table: "applications", rows: rowsOf(records.applications), refs: { competition_id: own("competitions"), opportunity_id: own("opportunities"), applicant_workspace_id: { table: "workspaces", kind: "applicant" } } },
    { table: "form_responses", rows: responses.filter((r) => !r.submission_id), refs: { application_id: own("applications") } },
    { table: "review_assignments", rows: rowsOf(g.reviewAssignments), refs: { application_id: own("applications") } },
    { table: "reviews", rows: rowsOf(g.reviews), refs: { assignment_id: own("review_assignments") } },
    { table: "decisions", rows: rowsOf(g.decisions), refs: { application_id: own("applications"), competition_id: own("competitions"), letter_template_id: library("templates") } },
    { table: "awards", rows: rowsOf(records.awards), refs: { recipient_workspace_id: { table: "workspaces", kind: "applicant" }, application_id: own("applications"), opportunity_id: own("opportunities"), program_id: own("programs"), parent_award_id: own("awards") } },
    { table: "agreements", rows: rowsOf(g.agreements), refs: { award_id: own("awards"), template_id: library("templates") } },
    { table: "payment_schedules", rows: rowsOf(g.paymentSchedules), refs: { award_id: own("awards") } },
    { table: "tranches", rows: rowsOf(g.tranches), refs: { award_id: own("awards"), schedule_id: own("payment_schedules") } },
    { table: "requirements", rows: rowsOf(g.requirements), refs: { award_id: own("awards"), releases_tranche_id: own("tranches") } },
    { table: "submissions", rows: rowsOf(g.submissions), refs: { requirement_id: own("requirements"), award_id: own("awards") } },
    { table: "form_responses", rows: responses.filter((r) => !!r.submission_id), refs: { submission_id: own("submissions") } },
    { table: "budgets", rows: rowsOf(g.budgets), refs: { award_id: own("awards"), application_id: own("applications") } },
    { table: "amendments", rows: rowsOf(g.amendments), refs: { award_id: own("awards"), child_award_id: own("awards") } },
  ];
  const allowed = async (ref: Ref, id: unknown): Promise<boolean> => {
    if (id === null || id === undefined) return true;
    if (typeof id !== "string") return false;
    if (ref.kind === "applicant") return !!(await ctx.repos.table("workspaces").one({ id, kind: "applicant" }));
    if (kept.get(ref.table)?.has(id)) return true;
    const rows = (await ctx.repos.table(ref.table).find({ id } as never, { limit: 50 })) as { workspace_id?: string | null }[];
    return rows.some((r) => r.workspace_id === ws.id || (ref.kind === "library" && (r.workspace_id ?? null) === null));
  };
  for (const step of steps) {
    const c = (counts[step.table] ??= { inserted: 0, existing: 0, skipped: 0 });
    const ids = kept.get(step.table) ?? new Set<string>();
    kept.set(step.table, ids);
    for (const row of step.rows) {
      const id = row.id as string;
      // Form versions share an id; the pair (id, version) is the key.
      const where = step.table === "forms" ? { id, version: row.version } : { id };
      const there = (await ctx.repos.table(step.table).one(where as never)) as { workspace_id?: string | null } | null;
      // Forms and rubrics are versioned under one id. A new version under an id that another
      // workspace or the shared library already uses would supersede theirs: skipped.
      const versioned = step.table === "forms" || step.table === "rubrics";
      const foreign = versioned && !there ? ((await ctx.repos.table(step.table).find({ id } as never, { limit: 50 })) as { workspace_id?: string | null }[]).some((r) => r.workspace_id !== ws.id) : false;
      if (foreign) {
        c.skipped++;
        continue;
      }
      if (there) {
        // Already in the target workspace: an earlier run. In any other workspace (or the shared
        // library): somebody else's row, which this import neither changes nor builds on.
        if (there.workspace_id === ws.id) {
          c.existing++;
          ids.add(id);
        } else c.skipped++;
        continue;
      }
      let ok = true;
      for (const [column, ref] of Object.entries(step.refs ?? {})) if (!(await allowed(ref, row[column]))) ok = false;
      if (!ok) {
        c.skipped++;
        continue;
      }
      // A shared report keeps its pointer to the original only when that original is on this instance.
      const shared = step.table === "submissions" && typeof row.shared_from_submission_id === "string" && !(await ctx.repos.table("submissions").one({ id: row.shared_from_submission_id }));
      const insert = { ...row, ...(shared ? { shared_from_submission_id: null } : {}), workspace_id: ws.id };
      try {
        await ctx.repos.table(step.table).insert(insert as never);
        c.inserted++;
        ids.add(id);
      } catch (e) {
        if (!(e instanceof RepoError)) throw e;
        c.skipped++;
      }
    }
  }
  const totals = Object.values(counts).reduce((a, c) => ({ inserted: a.inserted + c.inserted, existing: a.existing + c.existing, skipped: a.skipped + c.skipped }), { inserted: 0, existing: 0, skipped: 0 });
  await audit(ctx, "import.bundle", "workspace", ws.id, { from: (g.workspace as { handle?: unknown }).handle ?? null, ...totals });
  return { counts, ...totals };
}
