// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// R-07 agreement actions: generate / regenerate the PDF (agreements.generate) and send it for signature
// (agreements.send, R2) after a confirmation naming the grantee organization admins who will be emailed.
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@gms/ui';
import { FileText, RefreshCw, Send } from 'lucide-react';
import { generateAgreementAction, sendAgreementAction } from '@/app/console/(app)/decisions/actions';
import { ConfirmActionButton, useRunAction } from '../run-action';

export function AgreementActions({
  applicationId,
  awardId,
  agreementId,
  status,
  canAct,
  recipients,
  organization,
}: {
  applicationId: string;
  awardId: string;
  agreementId: string | null;
  status: string;
  canAct: boolean;
  recipients: { name: string; email: string }[];
  organization: string | null;
}) {
  const { run, pending } = useRunAction();
  const canGenerate = status === 'none' || status === 'draft';
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-base">
          Next step
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {!canAct ? (
          <p className="text-muted-foreground">Program officers, admins and owners generate and send agreements.</p>
        ) : status === 'none' || status === 'draft' ? (
          <>
            <p className="text-muted-foreground">
              {status === 'none'
                ? 'Generate the award letter and grant agreement from the award’s current terms.'
                : 'Check the PDF. If the award terms changed, regenerate it. Then send it to the grantee to sign.'}
            </p>
            {canGenerate ? (
              <Button
                variant={status === 'none' ? 'default' : 'outline'}
                pending={pending}
                pendingLabel="Generating…"
                onClick={() => void run(() => generateAgreementAction(applicationId, awardId), { success: status === 'none' ? 'Agreement generated.' : 'Agreement regenerated.' })}
              >
                {status === 'none' ? <FileText aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                {status === 'none' ? 'Generate letter & agreement' : 'Regenerate PDF'}
              </Button>
            ) : null}
            {status === 'draft' && agreementId ? (
              <ConfirmActionButton
                label="Send for signature"
                icon={<Send aria-hidden="true" />}
                variant="default"
                size="default"
                disabled={recipients.length === 0}
                title="Send the agreement for signature?"
                description={
                  <>
                    {recipients.length ? (
                      <>
                        GMS emails {recipients.length === 1 ? 'the admin' : `the ${recipients.length} admins`} of {organization ?? 'the grantee organization'} a link to review and sign this exact PDF in
                        their portal:
                      </>
                    ) : (
                      'The grantee organization has no admins to email.'
                    )}
                  </>
                }
                confirmLabel="Send agreement"
                success="Agreement sent for signature."
                action={() => sendAgreementAction(applicationId, agreementId)}
              >
                {recipients.length ? (
                  <ul className="grid gap-1 rounded-md border p-3 text-sm">
                    {recipients.map((r) => (
                      <li key={r.email}>
                        <span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· {r.email}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-xs text-muted-foreground">After sending, the document is locked. To change it, void it on the award page and issue a new one.</p>
              </ConfirmActionButton>
            ) : null}
            {status === 'draft' && recipients.length === 0 ? (
              <Alert variant="warning" title="No one to send it to">
                The grantee organization has no admins in GMS. Ask the applicant to invite an admin to their organization first.
              </Alert>
            ) : null}
          </>
        ) : status === 'sent' ? (
          <p className="text-muted-foreground">Waiting for the grantee to sign. They were emailed a link to sign in their portal.</p>
        ) : status === 'signed' ? (
          <p className="text-muted-foreground">Signed by the grantee. Countersign on the award page.</p>
        ) : (
          <p className="text-muted-foreground">Fully executed. Payments can proceed once the payee is set up.</p>
        )}
      </CardContent>
    </Card>
  );
}
