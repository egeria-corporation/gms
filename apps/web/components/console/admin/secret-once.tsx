// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Shows a newly created secret (API key, signing secret) exactly once, with a copy button.
import { Alert, Button, toast } from '@gms/ui';
import { Copy } from 'lucide-react';

export function SecretOnce({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid gap-3">
      <Alert variant="warning" title="Copy it now — we only show it once">
        {note ?? 'GMS stores only a hash. If you lose it, revoke it and create a new one.'}
      </Alert>
      <div className="grid gap-1">
        <span className="text-sm font-medium">{label}</span>
        <code data-testid="secret-once" className="block break-all rounded-md bg-muted p-3 font-mono text-sm">
          {value}
        </code>
      </div>
      <Button
        variant="secondary"
        className="justify-self-start"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => toast.success('Copied.'),
            () => toast.error('Couldn’t copy. Select the text and copy it yourself.'),
          );
        }}
      >
        <Copy aria-hidden="true" /> Copy
      </Button>
    </div>
  );
}
