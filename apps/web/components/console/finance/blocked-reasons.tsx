// SPDX-License-Identifier: AGPL-3.0-only
// Why an installment can't be paid yet: icon + text + color, with the next step.
import { ToneChip } from '@gms/ui';
import { AlarmClock, CircleAlert, CircleSlash, FileSignature, PauseCircle, PiggyBank, ShieldAlert, ShieldX, UserX, type LucideIcon } from 'lucide-react';

interface ReasonView {
  icon: LucideIcon;
  tone: 'danger' | 'warning';
  next: string;
}

export function reasonView(reason: string): ReasonView {
  const r = reason.toLowerCase();
  if (r.includes('confirmed sanctions')) return { icon: ShieldX, tone: 'danger', next: 'Payments stay blocked. Talk to counsel.' };
  if (r.includes('ofac') || r.includes('sanctions')) return { icon: ShieldAlert, tone: 'warning', next: 'Review the match in Diligence.' };
  if (r.includes('payee')) return { icon: UserX, tone: 'warning', next: 'Invite or re-invite the grantee in Payee onboarding.' };
  if (r.includes('report')) return { icon: AlarmClock, tone: 'danger', next: 'Follow up on the overdue report; payments resume once it is in.' };
  if (r.includes('hold')) return { icon: PauseCircle, tone: 'danger', next: 'Release the hold on the award when it’s resolved.' };
  if (r.includes('agreement')) return { icon: FileSignature, tone: 'warning', next: 'Get the agreement signed and countersigned.' };
  if (r.includes('budget') || r.includes('ceiling')) return { icon: PiggyBank, tone: 'danger', next: 'Amend the award or adjust the schedule.' };
  if (r.includes('not active')) return { icon: CircleSlash, tone: 'warning', next: 'Activate the award first.' };
  return { icon: CircleAlert, tone: 'warning', next: 'Open the award to fix this.' };
}

export function BlockedReasons({ reasons }: { reasons: string[] }) {
  return (
    <ul className="grid gap-1.5">
      {reasons.map((r) => {
        const v = reasonView(r);
        return (
          <li key={r} className="grid gap-0.5">
            <ToneChip tone={v.tone} icon={v.icon} label={r} size="sm" />
            <span className="text-xs text-muted-foreground">{v.next}</span>
          </li>
        );
      })}
    </ul>
  );
}
