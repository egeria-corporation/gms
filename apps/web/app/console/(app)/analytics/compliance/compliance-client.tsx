// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { formatMoney, parseMoneyToCents } from '@gms/domain';
import { Alert, Button, DescriptionList, Field, Input, toast } from '@gms/ui';
import { Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { export990Action } from './actions';

export function Export990Buttons({ taxYear }: { taxYear: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (format: 'csv' | 'xlsx') =>
    start(async () => {
      const r = await export990Action(taxYear, format);
      if (r.ok) toast.success(`Preparing the ${taxYear} schedule. We’ll notify you when it’s ready.`, { action: { label: 'Open exports', onClick: () => router.push('/console/exports') } });
      else toast.error(r.problem.detail);
    });
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => go('csv')}>
        <Download aria-hidden="true" /> CSV
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => go('xlsx')}>
        <Download aria-hidden="true" /> Excel
      </Button>
    </div>
  );
}

const money = (s: string) => {
  const c = parseMoneyToCents(s);
  return c === null || c < 0 ? 0 : c;
};

/** A back-of-the-envelope minimum distribution check. Inputs stay in the browser; nothing is saved. */
export function DistributionsTracker({ taxYear, grantsPaidCents }: { taxYear: number; grantsPaidCents: number }) {
  const [assets, setAssets] = useState('');
  const [admin, setAdmin] = useState('');
  const [setAside, setSetAside] = useState('');
  const [taxes, setTaxes] = useState('');
  const netAssets = Math.round(money(assets) * 0.985); // 1.5% of assets is treated as cash held for charitable use.
  const minimumReturn = Math.round(netAssets * 0.05);
  const distributable = Math.max(0, minimumReturn - money(taxes));
  const qualifying = grantsPaidCents + money(admin) + money(setAside);
  const gap = distributable - qualifying;
  const ready = money(assets) > 0;

  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4">
      <Alert variant="warning" title="Estimate, not tax advice.">
        This is a simplified check of the 5% minimum payout. It ignores carryovers, excess distributions from earlier years, and other adjustments. Your accountant or tax adviser decides what you report.
      </Alert>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={`Average net investment assets for ${taxYear}`} htmlFor="qd-assets" description="Average monthly fair market value of assets not used for charitable purposes, in dollars.">
          <Input id="qd-assets" inputMode="decimal" value={assets} onChange={(e) => setAssets(e.target.value)} placeholder="12,500,000" />
        </Field>
        <Field label="Excise and income taxes" htmlFor="qd-taxes" optional description="Reduces the distributable amount.">
          <Input id="qd-taxes" inputMode="decimal" value={taxes} onChange={(e) => setTaxes(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Charitable administrative expenses" htmlFor="qd-admin" optional description={`Paid in ${taxYear} to run your grantmaking (staff time, reviews, audits).`}>
          <Input id="qd-admin" inputMode="decimal" value={admin} onChange={(e) => setAdmin(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Approved set-asides" htmlFor="qd-setaside" optional>
          <Input id="qd-setaside" inputMode="decimal" value={setAside} onChange={(e) => setSetAside(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <DescriptionList
        items={[
          { term: `Grants paid in ${taxYear} (from GMS)`, detail: formatMoney(grantsPaidCents), numeric: true },
          { term: 'Qualifying distributions (estimate)', detail: formatMoney(qualifying), numeric: true },
          { term: 'Minimum investment return (5% of 98.5% of assets)', detail: ready ? formatMoney(minimumReturn) : 'Enter your assets', numeric: true },
          { term: `Distributable amount for ${taxYear} (estimate)`, detail: ready ? formatMoney(distributable) : '—', numeric: true },
          {
            term: `Still to distribute by December 31, ${taxYear + 1}`,
            detail: ready ? (gap > 0 ? <strong>{formatMoney(gap)}</strong> : `None — ${formatMoney(-gap)} above the estimate`) : '—',
            numeric: true,
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">Estimate, not tax advice. Figures entered here aren’t saved.</p>
    </div>
  );
}
