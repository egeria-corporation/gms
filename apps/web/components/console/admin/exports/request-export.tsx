// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// S-09: "Request full export" (owners and admins only).
import { Alert, Button, toast } from '@gms/ui';
import { Archive } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { requestWorkspaceExportAction } from '@/app/console/(app)/settings/export/actions';

export function RequestWorkspaceExport({ disabledReason }: { disabledReason?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      {error ? (
        <Alert variant="danger" title="The export wasn’t started">
          {error}
        </Alert>
      ) : null}
      <Button
        className="justify-self-start"
        disabled={Boolean(disabledReason)}
        pending={pending}
        pendingLabel="Requesting…"
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await requestWorkspaceExportAction();
            if (r.ok) {
              toast.success('Export requested. We’ll notify you when it’s ready.');
              router.refresh();
            } else setError(r.problem.detail);
          })
        }
      >
        <Archive aria-hidden="true" /> Request full export
      </Button>
      {disabledReason ? <p className="text-sm text-muted-foreground">{disabledReason}</p> : null}
    </div>
  );
}
