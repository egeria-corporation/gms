// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Alert, Button, RadioGroup, RadioOption } from '@gms/ui';
import { useState, useTransition } from 'react';
import { startApplicationAction } from './actions';

export function StartForm({ competitionId, orgs }: { competitionId: string; orgs: { id: string; name: string; verified: boolean }[] }) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await startApplicationAction(competitionId, orgId || null);
          if (r && !r.ok) setError(r.problem.detail);
        });
      }}
    >
      {error ? <Alert variant="danger" title="We couldn’t start your application">{error}</Alert> : null}
      {orgs.length > 1 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium">Which organization is applying?</legend>
          <RadioGroup value={orgId} onValueChange={setOrgId} className="grid gap-2">
            {orgs.map((o) => (
              <RadioOption key={o.id} value={o.id} id={`org-${o.id}`} label={o.name} description={o.verified ? 'EIN verified' : undefined} />
            ))}
          </RadioGroup>
        </fieldset>
      ) : orgs[0] ? (
        <p>
          Applying as <strong>{orgs[0].name}</strong>.
        </p>
      ) : null}
      <div>
        <Button type="submit" size="lg" pending={pending} pendingLabel="Starting…">
          Start my application
        </Button>
      </div>
    </form>
  );
}
