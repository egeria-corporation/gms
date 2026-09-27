// SPDX-License-Identifier: AGPL-3.0-only
// F-01…F-05 First-run setup (states: already-set-up, contrast-autofix, check-email).
// Root host only (/setup is rewritten here). Available only while no workspace exists.
import { getRuntime, originFor } from '@gms/actions';
import { FORM_TEMPLATES } from '@gms/forms';
import { Alert, Button, Card, CardContent, CardHeader, PageHeader } from '@gms/ui';
import { CircleCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { config } from '@/lib/config';
import { forcedState, one } from '@/lib/site';
import { CheckEmailPanel, type SetupDone } from './check-email';
import { SetupWizard, type TemplateOption } from './setup-wizard';
import { emptyDraft, isStep, previewDraft, type SetupDraft, type StepId } from './wizard-schema';

export const metadata: Metadata = { title: 'Set up GMS' };

export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const state = forcedState(sp);
  const stepParam = one(sp.step);
  const rows = await getRuntime().db.selectFrom('workspaces').select(['slug', 'name', 'status']).orderBy('created_at').limit(2).execute();
  const anyWorkspace = rows.length > 0;
  const existing = rows.filter((w) => w.status === 'active');

  // Outside production, a set-up GMS still shows the wizard as a preview (submit is off) so every step can be reviewed.
  const preview = anyWorkspace && config.devToolsEnabled && state !== 'already-set-up';
  if (state === 'already-set-up' || (anyWorkspace && !preview)) {
    return <AlreadySetUp workspaces={existing} />;
  }

  const initialStep: StepId = isStep(stepParam) ? stepParam : state === 'contrast-autofix' ? 'brand' : 'owner';
  let draft: SetupDraft = preview || state ? previewDraft() : emptyDraft();
  if (state === 'contrast-autofix') draft = { ...draft, primary: '#F2D74B', accent: '#FFE8A3' };

  const done: SetupDone | null =
    state === 'check-email'
      ? { email: draft.ownerEmail, origin: originFor(draft.slug), name: draft.name, programCreated: true, opportunityCreated: true, invited: draft.invites.length, payments: draft.payments, emailSent: true }
      : null;

  const templates: TemplateOption[] = FORM_TEMPLATES.filter((t) => t.kind !== 'report').map((t) => ({ key: t.key, name: t.name, description: t.description }));

  return (
    <div className="grid gap-6 py-8">
      <PageHeader title="Set up GMS" description="About five minutes. You can change every answer later in Settings." density="spacious" />
      {preview && !done ? (
        <Alert variant="info" title="Preview only">
          This GMS already has a workspace, so creating another from here is turned off. You’re seeing the setup wizard because developer tools are on.
        </Alert>
      ) : null}
      {done ? (
        <CheckEmailPanel done={done} />
      ) : (
        <SetupWizard initialStep={initialStep} initialDraft={draft} templates={templates} rootDomain={config.rootDomain} multi={config.mode === 'multi'} previewOnly={preview} />
      )}
    </div>
  );
}

function AlreadySetUp({ workspaces }: { workspaces: { slug: string; name: string }[] }) {
  const only = workspaces.length === 1 ? workspaces[0]! : null;
  const signInHref = only ? `${originFor(only.slug)}/portal/sign-in?next=/console` : config.mode === 'single' ? '/portal/sign-in?next=/console' : '/';
  return (
    <div className="mx-auto grid w-full max-w-xl gap-6 py-12">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-status-success-fg">
            <CircleCheck className="size-5" aria-hidden="true" />
            <span className="text-sm font-medium">Already set up</span>
          </div>
          <h1 className="font-heading text-2xl font-semibold leading-tight">This GMS is already set up</h1>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-muted-foreground">
            {only ? (
              <>
                <strong className="text-foreground">{only.name}</strong> is using this GMS. Staff sign in to the console from the foundation’s own site.
              </>
            ) : (
              'Staff sign in to the console from their foundation’s own site. Setup only runs once, on a brand-new installation.'
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href={signInHref}>{only || config.mode === 'single' ? 'Sign in to the console' : 'Find your foundation'}</a>
            </Button>
            {config.mode === 'multi' ? (
              <Button asChild size="lg" variant="secondary">
                <Link href="/sign-in">Platform operator sign in</Link>
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Running your own server and need another workspace? Use <code className="font-mono">pnpm run setup --allow-existing</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
