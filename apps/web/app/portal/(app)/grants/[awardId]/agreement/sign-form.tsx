// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Alert, Button, CheckboxField, Field, Input } from '@gms/ui';
import { CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { signAgreementAction } from '../../actions';

export function SignForm({ agreementId, awardId, documentHash, attestation, signerHint }: { agreementId: string; awardId: string; documentHash: string; attestation: string; signerHint: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (signedAt) {
    return (
      <Alert variant="success" title="Signed — thank you" icon={<CheckCircle2 aria-hidden="true" />}>
        <p>We recorded your signature. The foundation will countersign, and you’ll get an email with the final copy. Next, set up how you’ll receive payments.</p>
        <Button className="mt-3" onClick={() => router.push(`/portal/grants/${awardId}`)}>
          Back to your grant
        </Button>
      </Alert>
    );
  }
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length < 2) {
          setError('Type your full name to sign.');
          return;
        }
        if (!agreed) {
          setError('Check the box to confirm you agree.');
          return;
        }
        setError(null);
        start(async () => {
          const r = await signAgreementAction({ agreementId, awardId, typedName: name.trim(), documentHash });
          if (r.ok) setSignedAt(r.data.signedAt);
          else setError(r.problem.detail);
        });
      }}
    >
      {error ? <Alert variant="danger" title="Not signed yet">{error}</Alert> : null}
      <Field label="Type your full name to sign" htmlFor="sig-name" description={signerHint}>
        <Input id="sig-name" autoComplete="name" inputSize="lg" className="font-heading text-lg" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <CheckboxField id="sig-agree" size="lg" label={attestation} checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} />
      <p className="text-xs text-muted-foreground">
        We record the time, your IP address, and a fingerprint of the exact document (SHA-256 <code className="break-all">{documentHash.slice(0, 16)}…</code>) with your signature.
      </p>
      <div>
        <Button type="submit" size="lg" pending={pending} pendingLabel="Signing…">
          Sign agreement
        </Button>
      </div>
    </form>
  );
}
