// SPDX-License-Identifier: AGPL-3.0-only
// O-01 OAuth consent: which agent is asking, what it can do (plain-language scopes), and where you'll be sent
// back. Agents can never approve payments or change roles, whatever you allow here.
import { getPendingAuthorization } from '@gms/agents';
import { Alert, Button, PageHeader, Section } from '@gms/ui';
import type { Metadata } from 'next';
import { NextLink } from '@/components/next-link';
import { requireViewer } from '@/lib/auth';
import { agentEnv } from '@/lib/server/agent-env';
import { one } from '@/lib/site';
import { requestMeta } from '@/lib/tenant';
import { approveConsent, denyConsent } from './actions';

export const metadata: Metadata = { title: 'Allow an agent' };

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const requestId = one(sp.request) ?? '';
  const meta = await requestMeta();
  const viewer = await requireViewer(`${meta.pathname}?request=${encodeURIComponent(requestId)}`);
  const pending = await getPendingAuthorization(await agentEnv(), requestId);

  if (!pending) {
    return (
      <div className="mx-auto grid w-full max-w-xl gap-6 pb-16">
        <PageHeader density="spacious" title="This request has expired" description="Go back to your AI tool and connect again. Requests to connect last 10 minutes." />
        <p>
          <NextLink href="/portal/account/agents" className="underline underline-offset-4">
            See your connected agents
          </NextLink>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-xl gap-8 pb-16">
      <PageHeader
        density="spacious"
        title={`Allow ${pending.client.name} to work with your account?`}
        description={`Signed in as ${viewer.email}. You can pause or remove this agent at any time in Connected agents.`}
      />
      <form className="grid gap-8">
        <input type="hidden" name="requestId" value={pending.id} />
        <Section title="What this agent can do">
          <fieldset className="grid gap-3">
            <legend className="sr-only">Permissions</legend>
            {pending.scopes.map((s) => (
              <label key={s.scope} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                <input type="checkbox" name="scope" value={s.scope} defaultChecked className="mt-1 size-4 accent-[var(--primary)]" />
                <span className="grid gap-0.5">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-sm text-muted-foreground">
                    <code>{s.scope}</code>
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </Section>
        <Alert variant="info" title="You stay in charge">
          The agent asks you to confirm before it submits an application, sends a report, or does anything else that matters. It can never
          approve payments or change who has access.
        </Alert>
        <dl className="grid gap-1 text-sm text-muted-foreground">
          <div>
            <dt className="inline font-medium text-foreground">You’ll return to: </dt>
            <dd className="inline">{pending.redirectHost}</dd>
          </div>
          {pending.client.homepageUrl ? (
            <div>
              <dt className="inline font-medium text-foreground">About this agent: </dt>
              <dd className="inline">{pending.client.homepageUrl}</dd>
            </div>
          ) : null}
          <div>
            <dt className="inline font-medium text-foreground">Registered as: </dt>
            <dd className="inline">{pending.client.registration}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" formAction={approveConsent}>
            Allow
          </Button>
          <Button type="submit" variant="outline" formAction={denyConsent}>
            Don’t allow
          </Button>
        </div>
      </form>
    </div>
  );
}
