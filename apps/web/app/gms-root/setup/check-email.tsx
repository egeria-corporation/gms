// SPDX-License-Identifier: AGPL-3.0-only
// "Check your email" after setup (state: check-email). Server-safe (no hooks), rendered by the wizard or the page.
import { Alert, Card, CardContent, CardHeader, DescriptionList } from '@gms/ui';
import { MailCheck } from 'lucide-react';
import { PAYMENT_LABELS, type PaymentChoice } from './wizard-schema';

export interface SetupDone {
  email: string;
  origin: string;
  name: string;
  programCreated: boolean;
  opportunityCreated: boolean;
  invited: number;
  payments: PaymentChoice;
  emailSent: boolean;
}

export function CheckEmailPanel({ done }: { done: SetupDone }) {
  const host = done.origin.replace(/^https?:\/\//, '');
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <h2 className="font-heading text-2xl font-semibold leading-tight">{done.name} is ready</h2>
      </CardHeader>
      <CardContent className="grid gap-6">
        {done.emailSent ? (
          <Alert variant="success" title="Check your email" icon={<MailCheck aria-hidden="true" />} role="status">
            <p>
              We sent a sign-in link to <strong>{done.email}</strong>. It works once and expires in 15 minutes, and opens your console at{' '}
              <span className="font-mono">{host}/console</span>.
            </p>
            <p className="mt-2 text-sm">Don’t see it? Check your spam folder. You can always request a new link from your site’s sign-in page.</p>
          </Alert>
        ) : (
          <Alert variant="warning" title="Your workspace is ready, but the email didn’t send">
            <p>
              Go to <a className="text-link underline underline-offset-2" href={`${done.origin}/portal/sign-in?next=/console`}>{host}/portal/sign-in</a> and enter{' '}
              <strong>{done.email}</strong> to get a new sign-in link.
            </p>
          </Alert>
        )}
        <section aria-labelledby="setup-done-title" className="grid gap-3">
          <h3 id="setup-done-title" className="text-sm font-semibold">
            What we set up
          </h3>
          <DescriptionList
            items={[
              { term: 'Public site', detail: <a className="font-mono text-link underline underline-offset-2" href={done.origin}>{host}</a> },
              { term: 'Owner', detail: done.email },
              { term: 'First program', detail: done.programCreated ? (done.opportunityCreated ? 'Created, with a draft opportunity and form' : 'Created') : 'Skipped' },
              { term: 'Invitations', detail: done.invited ? `${done.invited} sent` : 'None yet' },
              { term: 'Payments', detail: PAYMENT_LABELS[done.payments].label },
            ]}
          />
        </section>
        <section aria-labelledby="setup-next-title" className="grid gap-2">
          <h3 id="setup-next-title" className="text-sm font-semibold">
            Next, after you sign in
          </h3>
          <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
            <li>Set up two-factor sign-in with an authenticator app (required for staff).</li>
            <li>Add a logo in Settings → Branding, and your email domain in Settings → Integrations.</li>
            <li>Finish your draft opportunity — dates, amounts, eligibility — and publish it.</li>
          </ol>
        </section>
      </CardContent>
    </Card>
  );
}
