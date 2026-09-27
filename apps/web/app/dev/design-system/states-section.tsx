// SPDX-License-Identifier: AGPL-3.0-only
// DS-06 System states.
import {
  AutosaveIndicator,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DeniedState,
  EmptyState,
  ErrorState,
  NotFoundState,
  OfflineState,
  Section,
  Skeleton,
} from '@gms/ui';
import type { ReactNode } from 'react';

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="h-full">
      <CardHeader className="border-b py-2">
        <p className="font-mono text-xs text-muted-foreground">{label}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function StatesSection() {
  const savedAt = new Date(Date.now() - 45_000).toISOString();
  return (
    <Section
      id="ds-06"
      title="DS-06 System states"
      description="Say what happened, reassure about data, and offer the next step."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Frame label="EmptyState">
          <EmptyState
            level={3}
            title="No applications yet"
            description="Applications appear here as soon as someone submits. Share the opportunity link to get started."
            action={<Button size="sm">Copy opportunity link</Button>}
          />
        </Frame>
        <Frame label="ErrorState">
          <ErrorState
            level={3}
            description="We couldn't load the payment batch. Nothing was sent or changed."
            action={
              <Button size="sm" variant="outline">
                Try again
              </Button>
            }
          />
        </Frame>
        <Frame label="DeniedState">
          <DeniedState
            level={3}
            description="Payments are visible to finance staff and admins. Ask Helen Ortiz (owner) if you need access."
            action={
              <Button size="sm" variant="outline">
                Back to console home
              </Button>
            }
          />
        </Frame>
        <Frame label="NotFoundState">
          <NotFoundState
            level={3}
            description="This application may have been withdrawn or the link is mistyped."
            action={
              <Button size="sm" variant="outline">
                Go to the pipeline
              </Button>
            }
          />
        </Frame>
        <Frame label="OfflineState">
          <OfflineState
            level={3}
            description="Your answers are saved on this device and will sync when you're back online."
          />
        </Frame>
        <Frame label="Skeleton (loading)">
          <div role="status" aria-live="polite" className="grid gap-3 py-4">
            <span className="sr-only">Loading applications…</span>
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
            <Skeleton className="h-4 w-2/3" />
          </div>
        </Frame>
      </div>

      <Section
        level={3}
        title="Page variant"
        description="The same states fill a page body when a whole screen can't render."
      >
        <div className="rounded-lg border bg-card">
          <NotFoundState
            level={3}
            variant="page"
            title="We couldn't find that opportunity"
            description="It may have closed or moved. Browse the opportunities that are open now."
            action={<Button>See open opportunities</Button>}
          />
        </div>
      </Section>

      <Card>
        <CardHeader>
          <CardTitle as="h3">Autosave</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2">
          <AutosaveIndicator status="saving" />
          <AutosaveIndicator status="saved" savedAt={savedAt} />
          <AutosaveIndicator status="offline" />
          <AutosaveIndicator status="error" errorMessage="Couldn’t save" />
        </CardContent>
      </Card>
    </Section>
  );
}
