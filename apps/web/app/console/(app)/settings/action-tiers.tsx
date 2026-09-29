// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { RISK_TIER_LABELS, TIER_ORDER, type RiskTier } from '@gms/domain';
import { Badge, CheckboxField, Input, RiskChip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from '@gms/ui';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { useStepUp } from '@/components/console/step-up';
import { setActionTierAction } from './actions';

export interface ActionTierRow {
  id: string;
  title: string;
  tier: RiskTier;
  override: RiskTier | null;
  audience: 'applicant' | 'staff' | 'public' | 'system';
}

const TIERS: RiskTier[] = ['R0', 'R1', 'R2', 'R3'];
const AUDIENCE: Record<ActionTierRow['audience'], string> = { applicant: 'Applicants', staff: 'Staff', public: 'Public', system: 'System' };

export function ActionTiers({ actions, canEdit }: { actions: ActionTierRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [onlyRaised, setOnlyRaised] = useState(false);
  const [pending, start] = useTransition();
  const { withStepUp, dialog } = useStepUp({ reason: 'Changing how much confirmation an action needs is a people-only setting, so we check your authenticator app first.', actionLabel: 'Save tier' });
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return actions.filter((a) => (!onlyRaised || a.override) && (!term || a.id.includes(term) || a.title.toLowerCase().includes(term)));
  }, [actions, q, onlyRaised]);
  const groups = useMemo(() => {
    const m = new Map<string, ActionTierRow[]>();
    for (const r of rows) {
      const g = r.id.split('.')[0]!;
      m.set(g, [...(m.get(g) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);
  const raisedCount = actions.filter((a) => a.override).length;

  const change = (a: ActionTierRow, value: string) =>
    start(async () => {
      const tier = value === a.tier ? null : (value as RiskTier);
      const r = await withStepUp(() => setActionTierAction(a.id, tier));
      if (r.ok) {
        toast.success(tier ? `“${a.title}” now needs ${RISK_TIER_LABELS[tier].toLowerCase()}.` : `“${a.title}” is back to its default tier.`);
        router.refresh();
      } else if (r.problem.code !== 'step_up_required') toast.error(r.problem.detail);
    });

  return (
    <div className="grid gap-3">
      {dialog}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Filter actions" placeholder="Filter actions" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <CheckboxField id="tiers-only-raised" label={`Only raised (${raisedCount})`} checked={onlyRaised} onCheckedChange={(c) => setOnlyRaised(c === true)} />
        <p className="text-xs text-muted-foreground">
          R0 read · R1 reversible change · R2 a person confirms agent requests · R3 people only (agents can never do these)
        </p>
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-lg border" role="region" aria-label="Action risk tiers" tabIndex={0}>
        <table className="w-full text-sm">
          <caption className="sr-only">Every action with its default and effective risk tier</caption>
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Action</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Used by</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Default</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">This workspace</th>
            </tr>
          </thead>
          {groups.map(([group, list]) => (
            <tbody key={group} className="divide-y border-t">
              <tr className="bg-muted/40">
                <th scope="rowgroup" colSpan={4} className="px-3 py-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.replace(/_/g, ' ')}
                </th>
              </tr>
              {list.map((a) => {
                const effective = a.override ?? a.tier;
                return (
                  <tr key={a.id}>
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      <span className="block font-medium">{a.title}</span>
                      <code className="text-xs text-muted-foreground">{a.id}</code>
                    </th>
                    <td className="px-3 py-1.5 text-muted-foreground">{AUDIENCE[a.audience]}</td>
                    <td className="px-3 py-1.5">
                      <RiskChip tier={a.tier} compact size="sm" />
                    </td>
                    <td className="px-3 py-1.5">
                      {canEdit && a.tier !== 'R3' ? (
                        <div className="flex items-center gap-2">
                          <Select value={effective} disabled={pending} onValueChange={(v) => v !== effective && change(a, v)}>
                            <SelectTrigger size="sm" className="w-56" aria-label={`Tier for ${a.title}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIERS.filter((t) => TIER_ORDER[t] >= TIER_ORDER[a.tier]).map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t} · {RISK_TIER_LABELS[t]}
                                  {t === a.tier ? ' (default)' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {a.override ? <Badge variant="warning">Raised</Badge> : null}
                        </div>
                      ) : (
                        <span className="flex items-center gap-2">
                          <RiskChip tier={effective} compact size="sm" />
                          {a.override ? <Badge variant="warning">Raised</Badge> : a.tier === 'R3' ? <span className="text-xs text-muted-foreground">Highest tier</span> : null}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
        {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No actions match “{q}”.</p> : null}
      </div>
    </div>
  );
}
