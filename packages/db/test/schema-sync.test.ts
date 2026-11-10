// SPDX-License-Identifier: AGPL-3.0-only
// Keeps three things in step without a database: the status vocabularies in SQL and in
// packages/workflow, the generated types and the migrations' table list, and the rule that no
// column name could hold a bank or identity number.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TABLE_NAMES } from "../src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const migrationsDir = `${root}supabase/migrations/`;
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(migrationsDir + f, "utf8"));
const sql = migrations.join("\n");
const statusesTs = readFileSync(`${root}packages/workflow/src/statuses.ts`, "utf8");

function tsList(name: string): string[] {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(statusesTs);
  if (!m) throw new Error(`${name} not found in statuses.ts`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

function sqlList(fn: string): string[] {
  const m = new RegExp(`function gms\\.${fn}\\(\\)[^$]*\\$\\$\\s*select array\\[([^\\]]*)\\]`).exec(sql);
  if (!m) throw new Error(`gms.${fn}() not found in migrations`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe("status vocabularies", () => {
  it.each([
    ["APPLICATION_STATUSES", "application_statuses"],
    ["AWARD_STATUSES", "award_statuses"],
    ["AGREEMENT_STATUSES", "agreement_statuses"],
    ["TRANCHE_STATUSES", "tranche_statuses"],
    ["REQUIREMENT_STATUSES", "requirement_statuses"],
    ["SUBMISSION_STATUSES", "submission_statuses"],
    ["VERIFICATION_LEVELS", "verification_levels"],
  ])("%s matches gms.%s()", (ts, fn) => {
    expect(sqlList(fn)).toEqual(tsList(ts));
  });
});

describe("migrations", () => {
  const created = [...sql.matchAll(/^create table public\.([a-z_]+)/gm)].map((m) => m[1]!).sort();

  it("generated types cover exactly the tables the migrations create", () => {
    expect([...TABLE_NAMES].sort()).toEqual(created);
  });

  it("creates every table of the build spec's data model", () => {
    const required = [
      "workspaces", "workspace_members", "passport_links", "programs", "opportunities", "competitions", "forms",
      "applications", "form_responses", "application_events", "rubrics", "review_assignments", "reviews", "decisions",
      "awards", "agreements", "payment_schedules", "tranches", "requirements", "submissions", "budgets", "amendments",
      "threads", "messages", "tasks", "documents", "answers", "templates", "grantee_records", "org_change_inbox",
      "consents", "api_clients", "oauth_grants", "oauth_codes", "oauth_clients_dynamic", "mcp_connections",
      "custom_mcp_servers", "connector_accounts", "bank_transactions", "webhook_subscriptions", "webhook_deliveries",
      "inbound_events", "ledger_events", "assist_calls", "discover_saved", "approvals",
    ];
    expect(required.filter((t) => !created.includes(t))).toEqual([]);
  });

  it("never drops RLS and never grants writes to user-scoped roles", () => {
    expect(sql).not.toMatch(/disable row level security/i);
    expect(sql).not.toMatch(/grant\s+(all|insert|update|delete)[^;]*\bto\s+(anon|authenticated)\b/i);
    expect(sql).not.toMatch(/grant[^;]*\bto\s+anon\b/i);
  });

  it("makes the ledger append-only", () => {
    expect(sql).toMatch(/create trigger ledger_events_no_update_delete before update or delete on public\.ledger_events/);
    expect(sql).toMatch(/create trigger ledger_events_no_truncate before truncate on public\.ledger_events/);
    expect(sql).toMatch(/revoke update, delete on public\.ledger_events, public\.ledger_archives from service_role/);
  });

  it("has no column that could hold a bank or identity number", () => {
    const columns = [...sql.matchAll(/^\s{2,}([a-z_0-9]+)\s+(uuid|text|integer|bigint|jsonb|boolean|timestamptz|date|text\[\])\b/gm)].map((m) => m[1]!);
    expect(columns.length).toBeGreaterThan(300);
    // Two terms are spelled with bracket classes so this file passes the sensitive-data gate.
    const forbidden = /(routing|iban|swift|acct|account|s[s]n|social|birth|d[o]b|license|govern)/i;
    expect(columns.filter((c) => forbidden.test(c))).toEqual([]);
  });
});
