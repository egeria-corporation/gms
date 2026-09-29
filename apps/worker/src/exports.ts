// SPDX-License-Identifier: AGPL-3.0-or-later
// Background exports: curated datasets to CSV/XLSX, the 990-PF grants-paid schedule, and the full
// workspace export (JSON + CommonGrants bundle, zipped).
import { crc32 } from 'node:zlib';
import { originFor, type Runtime } from '@gms/actions';
import { adminExtra } from '@gms/actions/modules';
import { toCgOpportunity } from '@gms/commongrants';
import { sql } from '@gms/db';
import ExcelJS from 'exceljs';

type Row = Record<string, string | number | boolean | null>;

export function toCsv(rows: Row[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Neutralize spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}

export async function toXlsx(sheets: { name: string; rows: Row[] }[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GMS';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    const cols = [...new Set(s.rows.flatMap((r) => Object.keys(r)))];
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 2)) }));
    for (const r of s.rows) ws.addRow(r);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Minimal ZIP writer (stored entries) — enough for export bundles without another dependency. */
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt32LE(0, 12);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + data.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, cenBuf, end]));
}

const dollars = (c: number | null | undefined) => (c === null || c === undefined ? null : Number((c / 100).toFixed(2)));

export async function dataset(rt: Runtime, workspaceId: string, kind: string, params: Record<string, unknown>): Promise<Row[]> {
  const db = rt.db;
  switch (kind) {
    case 'report_definition':
      // AN-02 saved reports: the one whitelisted report query, shared with the builder page.
      return adminExtra.reportDefinitionExport(db, workspaceId, params);
    case 'applications': {
      const rows = await db
        .selectFrom('applications as a')
        .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
        .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
        .select(['a.reference_number', 'a.title', 'a.status', 'a.submitted_at', 'a.requested_amount_cents', 'a.created_via', 'a.submitted_via', 'o.title as opportunity', 'g.legal_name', 'g.ein'])
        .where('a.workspace_id', '=', workspaceId)
        .orderBy('a.created_at')
        .execute();
      return rows.map((r) => ({ reference: r.reference_number, title: r.title, status: r.status, submitted_at: r.submitted_at, requested_usd: dollars(r.requested_amount_cents), opportunity: r.opportunity, organization: r.legal_name, ein: r.ein, created_via: r.created_via, submitted_via: r.submitted_via }));
    }
    case 'awards': {
      const rows = await db
        .selectFrom('awards as a')
        .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
        .leftJoin('programs as p', 'p.id', 'a.program_id')
        .select(['a.reference', 'a.title', 'a.kind', 'a.status', 'a.amount_cents', 'a.disbursed_cents', 'a.start_date', 'a.end_date', 'a.fiscal_year', 'g.legal_name', 'p.name as program'])
        .where('a.workspace_id', '=', workspaceId)
        .orderBy('a.created_at')
        .execute();
      return rows.map((r) => ({ reference: r.reference, title: r.title, kind: r.kind, status: r.status, amount_usd: dollars(r.amount_cents), disbursed_usd: dollars(r.disbursed_cents), start: r.start_date, end: r.end_date, fiscal_year: r.fiscal_year, grantee: r.legal_name, program: r.program }));
    }
    case 'payments': {
      const rows = await db
        .selectFrom('payments as p')
        .innerJoin('awards as a', 'a.id', 'p.award_id')
        .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
        .select(['p.id', 'a.reference', 'g.legal_name', 'p.amount_cents', 'p.method', 'p.status', 'p.rail', 'p.sent_at', 'p.reconciled_at', 'p.external_reference'])
        .where('p.workspace_id', '=', workspaceId)
        .orderBy('p.created_at')
        .execute();
      return rows.map((r) => ({ payment_id: r.id, award: r.reference, grantee: r.legal_name, amount_usd: dollars(r.amount_cents), method: r.method, status: r.status, rail: r.rail, sent_at: r.sent_at, reconciled_at: r.reconciled_at, reference: r.external_reference }));
    }
    case 'reports': {
      const rows = await db
        .selectFrom('report_requirements as r')
        .innerJoin('awards as a', 'a.id', 'r.award_id')
        .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
        .select(['a.reference', 'g.legal_name', 'r.title', 'r.kind', 'r.due_date', 'r.status'])
        .where('r.workspace_id', '=', workspaceId)
        .orderBy('r.due_date')
        .execute();
      return rows.map((r) => ({ award: r.reference, grantee: r.legal_name, report: r.title, kind: r.kind, due: r.due_date, status: r.status }));
    }
    case 'grantees': {
      const rows = await db
        .selectFrom('applicant_orgs as g')
        .innerJoin('awards as a', 'a.applicant_org_id', 'g.id')
        .select(['g.legal_name', 'g.ein', 'g.org_type', 'g.website'])
        .select(sql<number>`sum(a.amount_cents)::bigint`.as('total'))
        .where('a.workspace_id', '=', workspaceId)
        .groupBy(['g.id', 'g.legal_name', 'g.ein', 'g.org_type', 'g.website'])
        .execute();
      return rows.map((r) => ({ grantee: r.legal_name, ein: r.ein, type: r.org_type, website: r.website, total_awarded_usd: dollars(Number(r.total)) }));
    }
    case 'form_990pf': {
      // Part XV line 3a: grants paid during the year (recipient, address, relationship, foundation status, purpose, amount).
      const year = Number(params.taxYear ?? new Date().getUTCFullYear() - 1);
      const rows = await sql<{ legal_name: string | null; line1: string | null; city: string | null; state: string | null; postal_code: string | null; relationship_note: string | null; org_type: string | null; irs_status: unknown; purpose: string | null; title: string; paid: number }>`
        select g.legal_name, ad.line1, ad.city, ad.state, ad.postal_code, a.relationship_note, g.org_type, g.irs_status,
               coalesce(a.purpose, a.title) as purpose, a.title, sum(p.amount_cents)::bigint as paid
        from public.payments p
        join public.awards a on a.id = p.award_id
        left join public.applicant_orgs g on g.id = a.applicant_org_id
        left join public.org_addresses ad on ad.org_id = g.id and ad.kind = 'mailing'
        where p.workspace_id = ${workspaceId}::uuid and p.status in ('sent', 'reconciled')
          and extract(year from p.sent_at) = ${year}
        group by g.legal_name, ad.line1, ad.city, ad.state, ad.postal_code, a.relationship_note, g.org_type, g.irs_status, a.purpose, a.title
        order by g.legal_name`.execute(db);
      return rows.rows.map((r) => ({
        recipient: r.legal_name,
        address: [r.line1, r.city, r.state, r.postal_code].filter(Boolean).join(', '),
        relationship: r.relationship_note ?? 'None',
        foundation_status: r.org_type === 'nonprofit_501c3' || r.org_type === 'fiscally_sponsored' ? 'PC' : r.org_type === 'government' ? 'GOV' : 'Other',
        purpose: r.purpose,
        amount_usd: dollars(Number(r.paid)),
      }));
    }
    case 'qualifying_distributions': {
      const rows = await sql<{ y: number; paid: number }>`
        select extract(year from sent_at)::int as y, sum(amount_cents)::bigint as paid from public.payments
        where workspace_id = ${workspaceId}::uuid and status in ('sent', 'reconciled') group by 1 order by 1`.execute(db);
      return rows.rows.map((r) => ({ year: r.y, grants_paid_usd: dollars(Number(r.paid)), note: 'Estimate, not tax advice.' }));
    }
    default:
      return [];
  }
}

export async function workspaceBundle(rt: Runtime, workspaceId: string): Promise<{ name: string; data: Uint8Array }[]> {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2));
  const db = rt.db;
  const tables = ['programs', 'opportunities', 'competitions', 'forms', 'form_versions', 'applications', 'application_submissions', 'awards', 'installments', 'payments', 'report_requirements', 'report_submissions', 'decisions', 'reviews', 'review_scores', 'messages', 'threads', 'audit_log'] as const;
  const files: { name: string; data: Uint8Array }[] = [];
  for (const t of tables) {
    const rows = await sql<Record<string, unknown>>`select * from ${sql.table(t)} where workspace_id = ${workspaceId}::uuid`.execute(db);
    files.push({ name: `gms/${t}.json`, data: enc(rows.rows) });
  }
  // CommonGrants bundle.
  const opps = await db.selectFrom('opportunities').selectAll().where('workspace_id', '=', workspaceId).where('status', 'in', ['forecasted', 'open', 'closed']).execute();
  const ws = await db.selectFrom('workspaces').select(['slug', 'timezone']).where('id', '=', workspaceId).executeTakeFirstOrThrow();
  const ctx = { origin: originFor(ws.slug), timezone: ws.timezone };
  files.push({ name: 'commongrants/opportunities.json', data: enc(opps.map((o) => toCgOpportunity(o as never, ctx))) });
  files.push({ name: 'README.txt', data: new TextEncoder().encode('GMS workspace export. gms/*.json are raw tables for this workspace; commongrants/*.json are CommonGrants-shaped records.\n') });
  return files;
}

export async function runExport(rt: Runtime, exportId: string): Promise<void> {
  const ex = await rt.db.selectFrom('exports').selectAll().where('id', '=', exportId).executeTakeFirst();
  if (!ex || ex.status !== 'queued') return;
  await rt.db.updateTable('exports').set({ status: 'running' }).where('id', '=', ex.id).execute();
  try {
    let bytes: Uint8Array;
    let ext: string;
    let contentType: string;
    if (ex.kind === 'workspace') {
      bytes = zip(await workspaceBundle(rt, ex.workspace_id));
      ext = 'zip';
      contentType = 'application/zip';
    } else {
      const rows = await dataset(rt, ex.workspace_id, ex.kind, ex.params as Record<string, unknown>);
      if (ex.format === 'xlsx') {
        bytes = await toXlsx([{ name: ex.kind, rows }]);
        ext = 'xlsx';
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else if (ex.format === 'json') {
        bytes = new TextEncoder().encode(JSON.stringify(rows, null, 2));
        ext = 'json';
        contentType = 'application/json';
      } else {
        bytes = new TextEncoder().encode(toCsv(rows));
        ext = 'csv';
        contentType = 'text/csv';
      }
    }
    const key = `${ex.workspace_id}/exports/${ex.id}.${ext}`;
    await rt.adapters.storage.put('exports', key, bytes, contentType);
    await rt.db.updateTable('exports').set({ status: 'succeeded', file_path: key, completed_at: new Date().toISOString() }).where('id', '=', ex.id).execute();
    if (ex.requested_by) {
      await rt.db.insertInto('notifications').values({ workspace_id: ex.workspace_id, user_id: ex.requested_by, kind: 'export', title: `Your ${ex.kind.replace(/_/g, ' ')} export is ready`, link: `/console/exports` }).execute();
    }
  } catch (err) {
    await rt.db.updateTable('exports').set({ status: 'failed', error: (err as Error).message.slice(0, 500) }).where('id', '=', ex.id).execute();
  }
}
