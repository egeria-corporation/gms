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
import type { Row } from "./repos/types.ts";

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
    const addr = canRead ? ((w!.org_projection as { addresses?: { primary?: Record<string, string> } } | null)?.addresses?.primary ?? null) : null;
    const individual = a.recipient_individual as { name?: string } | null;
    const awardedMinor = awarded(a);
    const paidMinor = paid(a);
    return {
      awardId: apiId("award", a.id),
      recipientName: w?.legal_name ?? w?.display_name ?? individual?.name ?? "Unknown recipient",
      recipientAddress: addr ? [addr.street1, addr.city, addr.stateOrProvince, addr.postalCode].filter(Boolean).join(", ") : null,
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
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
  const funder = (await ctx.repos.table("workspaces").one({ id: ws.id }))!;
  const t = <N extends Parameters<typeof ctx.repos.table>[0]>(name: N) => ctx.repos.table(name).find({ workspace_id: ws.id } as never, { limit: 10000 });
  const [opps, comps, forms, apps, awards, programs, rubrics, decisions, agreements, tranches, requirements, submissions, budgets, amendments, templates, documents, assignments] = await Promise.all([t("opportunities"), t("competitions"), t("forms"), t("applications"), t("awards"), t("programs"), t("rubrics"), t("decisions"), t("agreements"), t("tranches"), t("requirements"), t("submissions"), t("budgets"), t("amendments"), t("templates"), t("documents"), t("review_assignments")]);
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
    orgs: applicants.map((w) => ({ passportOrgId: w.passport_org_id, name: w.display_name, projection: consents.some((c) => c.applicant_workspace_id === w.id) ? w.org_projection : null })),
  };
  const strip = <R extends { workspace_id?: string }>(rows: R[]) => rows;
  const gms = { exportedAt: ctx.now().toISOString(), workspace: { id: funder.id, handle: funder.handle, displayName: funder.display_name, brand: funder.brand }, programs, rubrics, formResponses: responses, reviewAssignments: assignments, reviews, decisions, agreements: strip(agreements), tranches, requirements, submissions, budgets, amendments, templates };
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
