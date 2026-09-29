// SPDX-License-Identifier: AGPL-3.0-or-later
// Awards from the awarded applications: 38 active + 4 completed at Halcyon (plus an amendment and a supplement),
// two at Marigold. Payment schedules, conditions, agreements with placeholder PDFs, and signatures whose hash
// equals the agreement's document hash.
import { referenceNumber, workspacePrefix } from '@gms/domain';
import type { Row, SeedContext } from '../context';
import { placeholderPdf, sha256 } from '../pdf';
import { dateOnly } from '../time';
import type { AppRec, Apps } from './applications';

export type InstallmentPlan = 'reconciled' | 'sent' | 'awaiting_bank_approval' | 'awaiting_approval' | 'in_batch' | 'scheduled' | 'held' | 'failed' | 'exception' | 'cancelled' | 'none';

export interface InstallmentRec {
  id: string;
  position: number;
  dueDate: string;
  amount: number;
  plan: InstallmentPlan;
}

export interface AwardRec {
  id: string;
  ws: string;
  app: AppRec;
  group: 'yaf' | 'nfs' | 'marigold';
  index: number;
  ref: string;
  amount: number;
  status: 'active' | 'completed';
  startDate: string;
  endDate: string;
  createdAt: string;
  installments: InstallmentRec[];
  payee: 'ready' | 'invite_sent' | 'invite_expired';
  agreement: 'sent' | 'signed' | 'countersigned';
  onHold: string | null;
  reportOverdue: boolean;
}

export interface Awards {
  all: AwardRec[];
  yaf: AwardRec[];
  nfs: AwardRec[];
  maya: AwardRec;
  children: { id: string; parent: AwardRec; kind: 'amendment' | 'supplement'; amount: number }[];
}

/** Second-installment plan per YAF index (0 = Maya). */
function yafPlan(i: number): InstallmentPlan {
  if (i <= 4) return 'sent';
  if (i <= 7) return 'awaiting_bank_approval';
  if (i <= 9) return 'failed';
  return 'none';
}

function nfsPlans(i: number): [InstallmentPlan, InstallmentPlan] {
  if (i === 0) return ['none', 'none']; // sanctions near-match under review blocks payment
  if (i <= 4) return ['reconciled', 'awaiting_approval'];
  if (i <= 7) return ['reconciled', 'in_batch'];
  if (i <= 10) return ['reconciled', 'scheduled'];
  if (i <= 12) return ['reconciled', 'held'];
  if (i <= 14) return ['exception', 'none'];
  if (i <= 18) return ['cancelled', 'none'];
  return ['none', 'none'];
}

/** Award amounts for the batch awaiting approval, so its total stays under the second-approval threshold. */
const PRIYA_BATCH_AMOUNTS = [1_200_000, 1_600_000, 1_800_000, 2_400_000];

export async function awards(ctx: SeedContext, apps: Apps, opts: { documents: boolean }): Promise<Awards> {
  const c = ctx.clock;
  const rng = ctx.stream('awards');
  const recs: AwardRec[] = [];
  const counters = new Map<string, number>();
  const nextRef = (ws: string, created: string) => {
    const w = ctx.ws(ws);
    const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: w.timezone, year: 'numeric' }).format(new Date(created)));
    const k = `${ws}:${year}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    return referenceNumber(workspacePrefix(w.name) + 'A', year, n);
  };
  const half = (amount: number, share: number) => Math.round((amount * share) / 5_000) * 5_000;

  // Youth Arts Fund 2025: 16 two-year grants (active) + 4 one-year grants (completed).
  const yafApps = apps.byOpp.yaf2025.filter((a) => a.status === 'awarded');
  yafApps.forEach((app, i) => {
    const completed = i >= 16;
    const amount = i === 0 ? 2_500_000 : Math.max(500_000, Math.min(2_500_000, Math.round((app.requested * rng.pick([0.8, 0.9, 1, 1, 1])) / 50_000) * 50_000));
    const first = half(amount, 0.6);
    const created = app.decisionAt ?? '2025-05-16T17:00:00.000Z';
    const id = ctx.id(`award:${app.id}`);
    const secondDue = completed ? '2025-12-15' : i <= 4 ? c.date(-10) : i <= 7 ? c.date(-5) : i <= 9 ? c.date(-25) : c.date(20 + (i - 10) * 8);
    recs.push({
      id,
      ws: 'halcyon',
      app,
      group: 'yaf',
      index: i,
      ref: nextRef('halcyon', created),
      amount,
      status: completed ? 'completed' : 'active',
      startDate: '2025-06-01',
      endDate: completed ? '2026-05-31' : '2027-05-31',
      createdAt: created,
      installments: [
        { id: ctx.id(`installment:${id}:1`), position: 1, dueDate: '2025-06-15', amount: first, plan: 'reconciled' },
        { id: ctx.id(`installment:${id}:2`), position: 2, dueDate: secondDue, amount: amount - first, plan: completed ? 'reconciled' : yafPlan(i) },
      ],
      payee: 'ready',
      agreement: 'countersigned',
      onHold: null,
      reportOverdue: i === 14 || i === 15,
    });
  });

  // Neighborhood Food Security 2026: 22 one-year grants (active).
  const nfsApps = apps.byOpp.nfs2026.filter((a) => a.status === 'awarded');
  nfsApps.forEach((app, i) => {
    const amount = i >= 1 && i <= 4 ? PRIYA_BATCH_AMOUNTS[i - 1]! : Math.max(1_000_000, Math.min(4_000_000, Math.round((app.requested * rng.pick([0.75, 0.9, 1, 1])) / 50_000) * 50_000));
    const first = half(amount, 0.5);
    const [p1, p2] = nfsPlans(i);
    const created = app.decisionAt ?? '2026-03-20T17:00:00.000Z';
    const id = ctx.id(`award:${app.id}`);
    const secondDue = p2 === 'awaiting_approval' ? c.date(5 + i) : p2 === 'in_batch' ? c.date(8 + i) : p2 === 'scheduled' ? c.date(12 + i) : p2 === 'held' ? c.date(i - 13) : c.date(25 + i);
    recs.push({
      id,
      ws: 'halcyon',
      app,
      group: 'nfs',
      index: i,
      ref: nextRef('halcyon', created),
      amount,
      status: 'active',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      createdAt: created,
      installments: [
        { id: ctx.id(`installment:${id}:1`), position: 1, dueDate: '2026-04-15', amount: first, plan: p1 },
        { id: ctx.id(`installment:${id}:2`), position: 2, dueDate: secondDue, amount: amount - first, plan: p2 },
      ],
      payee: i === 19 || i === 20 ? 'invite_sent' : i === 21 ? 'invite_expired' : 'ready',
      agreement: i === 19 ? 'sent' : i === 20 ? 'signed' : 'countersigned',
      onHold: i === 11 ? 'Waiting for an updated project budget after the program changed sites.' : i === 12 ? 'Interim report overdue' : null,
      reportOverdue: i === 12,
    });
  });

  // Marigold: two small organizing grants from its open opportunity.
  apps.byOpp.marigold
    .filter((a) => a.status === 'awarded')
    .forEach((app, i) => {
      const id = ctx.id(`award:${app.id}`);
      const created = app.decisionAt ?? c.iso(-2);
      const amount = Math.min(500_000, app.requested);
      recs.push({
        id,
        ws: 'marigold',
        app,
        group: 'marigold',
        index: i,
        ref: nextRef('marigold', created),
        amount,
        status: 'active',
        startDate: c.date(-2),
        endDate: c.date(363),
        createdAt: created,
        installments: [{ id: ctx.id(`installment:${id}:1`), position: 1, dueDate: c.date(14), amount, plan: 'none' }],
        payee: 'ready',
        agreement: i === 0 ? 'sent' : 'signed',
        onHold: null,
        reportOverdue: false,
      });
    });

  const yaf = recs.filter((r) => r.group === 'yaf');
  const nfs = recs.filter((r) => r.group === 'nfs');

  // Amendment (+$5,000, approved) and supplement (+$2,500, approved), each with an added installment.
  const amended = nfs[8]!;
  const supplemented = yaf[12]!;
  const children = [
    { id: ctx.id(`award-child:${amended.id}:amendment`), parent: amended, kind: 'amendment' as const, amount: 500_000 },
    { id: ctx.id(`award-child:${supplemented.id}:supplement`), parent: supplemented, kind: 'supplement' as const, amount: 250_000 },
  ];
  for (const ch of children) {
    ch.parent.installments.push({ id: ctx.id(`installment:${ch.parent.id}:3`), position: 3, dueDate: c.date(95), amount: ch.amount, plan: 'none' });
  }

  // Rows ---------------------------------------------------------------------------------------------------
  const awardRows: Row<'awards'>[] = [];
  const schedules: Row<'payment_schedules'>[] = [];
  const installments: Row<'installments'>[] = [];
  const conditions: Row<'award_conditions'>[] = [];
  const agreements: Row<'agreements'>[] = [];
  const signatures: Row<'signatures'>[] = [];
  const program = (r: AwardRec) => r.app.opp.programId;

  for (const r of recs) {
    const w = ctx.ws(r.ws);
    const officer = r.ws === 'marigold' ? ctx.human('kwame') : ctx.human('jordan');
    const signer = r.ws === 'marigold' ? ctx.human('rosa') : ctx.human('helen');
    awardRows.push({
      id: r.id,
      workspace_id: w.id,
      application_id: r.app.id,
      program_id: program(r),
      opportunity_id: r.app.opp.id,
      applicant_org_id: r.app.org.id,
      kind: 'original',
      reference: r.ref,
      title: r.app.title,
      purpose: `To support ${r.app.title}, as described in the application.`,
      amount_cents: r.amount,
      start_date: r.startDate,
      end_date: r.endDate,
      fiscal_year: Number(r.startDate.slice(0, 4)),
      status: r.status,
      agreement_pending: r.agreement !== 'countersigned',
      on_hold: Boolean(r.onHold),
      hold_reason: r.onHold,
      report_overdue: r.reportOverdue,
      created_by: officer.id,
      created_at: r.createdAt,
      last_modified_at: r.createdAt,
    });
    schedules.push({ id: ctx.id(`schedule:${r.id}`), workspace_id: w.id, award_id: r.id, created_by: officer.id, created_at: r.createdAt });
    for (const i of r.installments) {
      installments.push({
        id: i.id,
        workspace_id: w.id,
        schedule_id: ctx.id(`schedule:${r.id}`),
        award_id: r.id,
        position: i.position,
        due_date: i.dueDate,
        amount_cents: i.amount,
        condition: i.position === 1 ? 'On signed agreement' : i.position === 2 ? 'After the interim report is accepted' : 'Added by amendment',
        status: ['reconciled', 'sent', 'exception'].includes(i.plan) ? 'paid' : 'scheduled',
        created_at: r.createdAt,
      });
    }
    if (rng.chance(0.3)) {
      conditions.push({ id: ctx.id(`condition:${r.id}`), workspace_id: w.id, award_id: r.id, body: 'Share photos or a short video from the final showcase.', due_date: r.endDate, status: r.status === 'completed' ? 'met' : 'open', created_at: r.createdAt });
    }
    ctx.audit({ workspace: r.ws, at: r.createdAt, actor: officer, action: 'awards.draft', entityType: 'award', entityId: r.id, after: { amountCents: r.amount, draft: true } });
    ctx.audit({ workspace: r.ws, at: r.createdAt, actor: officer, action: 'awards.activate', entityType: 'award', entityId: r.id, before: { status: 'draft' }, after: { status: 'active' }, riskTier: 'R3' });

    // Agreement: a small placeholder PDF; its SHA-256 is what both signatures bind to.
    const agreementId = ctx.id(`agreement:${r.id}`);
    const bytes = placeholderPdf(`Grant agreement ${r.ref}`, [
      `${w.name} and ${r.app.org.name}`,
      `Grant: ${r.app.title}`,
      `Amount: $${(r.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`,
      `Grant period: ${r.startDate} to ${r.endDate}`,
      'Payments follow the schedule in GMS. Reports are due as listed in the grantee portal.',
      'DEMO DOCUMENT - fictional data generated by the GMS seed.',
    ]);
    const hash = sha256(bytes);
    const path = `${w.id}/agreements/${r.id}/${hash.slice(0, 16)}.pdf`;
    if (opts.documents) await ctx.runtime.adapters.storage.put('agreements', path, bytes, 'application/pdf');
    const sentAt = new Date(Date.parse(r.createdAt) + 2 * 86_400_000).toISOString();
    const signedAt = new Date(Date.parse(r.createdAt) + 6 * 86_400_000).toISOString();
    const counterAt = new Date(Date.parse(r.createdAt) + 8 * 86_400_000).toISOString();
    agreements.push({
      id: agreementId,
      workspace_id: w.id,
      award_id: r.id,
      status: r.agreement,
      document_path: path,
      document_hash: hash,
      body_md: `Grant agreement between **${w.name}** and **${r.app.org.name}** for ${r.app.title} (${r.ref}).`,
      sent_at: sentAt,
      created_by: officer.id,
      created_at: r.createdAt,
      last_modified_at: r.agreement === 'countersigned' ? counterAt : r.agreement === 'signed' ? signedAt : sentAt,
    });
    ctx.audit({ workspace: r.ws, at: r.createdAt, actor: officer, action: 'agreements.generate', entityType: 'agreement', entityId: agreementId, after: { documentHash: hash } });
    ctx.audit({ workspace: r.ws, at: sentAt, actor: officer, action: 'agreements.send', entityType: 'agreement', entityId: agreementId, before: { status: 'draft' }, after: { status: 'sent' }, riskTier: 'R2' });
    if (r.agreement === 'signed' || r.agreement === 'countersigned') {
      signatures.push({
        id: ctx.id(`signature:${agreementId}:grantee`),
        workspace_id: w.id,
        agreement_id: agreementId,
        signer_id: r.app.org.admin.id,
        signer_role: 'grantee',
        typed_name: r.app.org.admin.name,
        attestation: 'I am authorized to sign for this organization. By typing my name, I agree to the terms of this grant agreement, and I understand this is a legally binding electronic signature.',
        signed_at: signedAt,
        ip: '203.0.113.10',
        user_agent: 'Mozilla/5.0 (demo seed)',
        document_hash: hash,
      });
      ctx.audit({ workspace: r.ws, at: signedAt, actor: { type: 'human', id: r.app.org.admin.id, name: r.app.org.admin.name }, action: 'agreements.sign', entityType: 'agreement', entityId: agreementId, before: { status: 'sent' }, after: { status: 'signed', documentHash: hash }, riskTier: 'R3' });
    }
    if (r.agreement === 'countersigned') {
      signatures.push({
        id: ctx.id(`signature:${agreementId}:foundation`),
        workspace_id: w.id,
        agreement_id: agreementId,
        signer_id: signer.id,
        signer_role: 'foundation',
        typed_name: signer.name,
        attestation: 'Countersigned for the foundation.',
        signed_at: counterAt,
        ip: '198.51.100.7',
        user_agent: 'Mozilla/5.0 (demo seed)',
        document_hash: hash,
      });
      ctx.audit({ workspace: r.ws, at: counterAt, actor: signer, action: 'agreements.countersign', entityType: 'agreement', entityId: agreementId, before: { status: 'signed' }, after: { status: 'countersigned' }, riskTier: 'R3' });
    }
    if (r.status === 'completed') {
      ctx.audit({ workspace: r.ws, at: '2026-07-15T17:00:00.000Z', actor: officer, action: 'awards.close', entityType: 'award', entityId: r.id, before: { status: 'active' }, after: { status: 'completed' } });
    }
  }
  for (const ch of children) {
    const p = ch.parent;
    const at = ctx.clock.iso(-18);
    awardRows.push({
      id: ch.id,
      workspace_id: ctx.ws(p.ws).id,
      application_id: p.app.id,
      program_id: p.app.opp.programId,
      opportunity_id: p.app.opp.id,
      applicant_org_id: p.app.org.id,
      parent_award_id: p.id,
      kind: ch.kind,
      amendment_status: 'approved',
      reference: `${p.ref}-${ch.kind === 'amendment' ? 'M1' : 'S1'}`,
      title: ch.kind === 'amendment' ? `${p.app.title} (amendment 1)` : `${p.app.title} (supplement)`,
      purpose: ch.kind === 'amendment' ? 'Adds funds and three months to cover a second distribution site.' : 'Additional funds for the end-of-year youth showcase.',
      amount_cents: ch.amount,
      start_date: p.startDate,
      end_date: ch.kind === 'amendment' ? '2027-06-30' : p.endDate,
      fiscal_year: Number(dateOnly(at).slice(0, 4)),
      status: 'active',
      agreement_pending: false,
      created_by: ctx.person('jordan').id,
      created_at: at,
      last_modified_at: at,
    });
    ctx.audit({ workspace: p.ws, at, actor: ctx.human('jordan'), action: 'awards.amend', entityType: 'award', entityId: ch.id, after: { kind: ch.kind, amountCents: ch.amount, parent: p.ref } });
    ctx.audit({ workspace: p.ws, at: ctx.clock.iso(-16), actor: ctx.human('helen'), action: 'awards.approve_amendment', entityType: 'award', entityId: ch.id, before: { amendmentStatus: 'draft' }, after: { amendmentStatus: 'approved' }, riskTier: 'R3' });
  }

  await ctx.insert('awards', awardRows.filter((a) => !a.parent_award_id));
  await ctx.insert('awards', awardRows.filter((a) => a.parent_award_id));
  await ctx.insert('payment_schedules', schedules);
  await ctx.insert('installments', installments);
  await ctx.insert('award_conditions', conditions);
  await ctx.insert('agreements', agreements);
  await ctx.insert('signatures', signatures);
  for (const [k, n] of counters) {
    const [ws, year] = k.split(':');
    ctx.refCounters.push({ ws: ws!, kind: 'award', year: Number(year), value: n });
  }

  const maya = yaf[0]!;
  if (maya.app.org.admin.key !== 'maya') throw new Error('expected Maya’s award first');
  return { all: recs, yaf, nfs, maya, children };
}
