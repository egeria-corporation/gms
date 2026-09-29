// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// C-04 Distribution: where a published opportunity appears (site listing, embed widget, CommonGrants feed,
// OpenGrants). Saved with opportunities.update { distribution }.
import { Alert, Button, Label, Switch } from '@gms/ui';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { updateOpportunityAction } from '@/app/console/(app)/opportunities/actions';
import { useRunAction } from '../run-action';
import type { Distribution } from './types';

const CHANNELS: { key: keyof Distribution; label: string; description: string }[] = [
  { key: 'site', label: 'Your GMS site', description: 'Listed on the public opportunities page (public visibility only).' },
  { key: 'embed', label: 'Embed widget', description: 'Shown by the embeddable opportunities widget on your own website.' },
  { key: 'cgFeed', label: 'CommonGrants feed', description: 'Included in the CommonGrants API feed other platforms read.' },
  { key: 'openGrants', label: 'OpenGrants', description: 'Shared with the OpenGrants directory for wider reach.' },
];

export function DistributionForm({ opportunityId, initial, visibility, readOnly }: { opportunityId: string; initial: Distribution; visibility: string; readOnly: boolean }) {
  const { run, pending } = useRunAction();
  const [d, setD] = useState<Distribution>(initial);
  return (
    <div className="grid gap-4">
      {visibility === 'unlisted' ? (
        <Alert variant="info" title="This opportunity is unlisted">
          Unlisted opportunities are left out of your site listing and feeds even when a channel is on. Change visibility on the Details tab.
        </Alert>
      ) : null}
      <ul className="grid gap-3">
        {CHANNELS.map((c) => (
          <li key={c.key} className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <Label htmlFor={`dist-${c.key}`}>{c.label}</Label>
              <p id={`dist-${c.key}-desc`} className="text-xs text-muted-foreground">
                {c.description}
              </p>
            </div>
            <Switch id={`dist-${c.key}`} aria-describedby={`dist-${c.key}-desc`} checked={d[c.key]} disabled={readOnly} onCheckedChange={(v) => setD((p) => ({ ...p, [c.key]: v === true }))} />
          </li>
        ))}
      </ul>
      {!readOnly ? (
        <div>
          <Button type="button" size="sm" pending={pending} pendingLabel="Saving…" onClick={() => void run(() => updateOpportunityAction(opportunityId, { distribution: d }), { success: 'Saved distribution.' })}>
            <Save aria-hidden="true" /> Save distribution
          </Button>
        </div>
      ) : null}
    </div>
  );
}
