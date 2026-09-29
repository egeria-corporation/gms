// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Button, toast } from '@gms/ui';
import { Bell, BellOff } from 'lucide-react';
import { useState, useTransition } from 'react';
import { subscribeAction } from '@/app/(public)/opportunities/[slug]/actions';

export function NotifyMe({ opportunityId, signedIn, subscribed: initial, signInHref }: { opportunityId: string; signedIn: boolean; subscribed: boolean; signInHref: string }) {
  const [subscribed, setSubscribed] = useState(initial);
  const [pending, start] = useTransition();
  if (!signedIn) {
    return (
      <Button asChild size="lg">
        <a href={signInHref}>
          <Bell aria-hidden="true" /> Sign in to get notified
        </a>
      </Button>
    );
  }
  return (
    <Button
      size="lg"
      variant={subscribed ? 'secondary' : 'default'}
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await subscribeAction(opportunityId, !subscribed);
          if (r.ok) {
            setSubscribed(!subscribed);
            toast.success(subscribed ? 'You won’t get an email for this one.' : 'We’ll email you when applications open.');
          } else toast.error(r.problem.detail);
        })
      }
    >
      {subscribed ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
      {subscribed ? 'Stop notifications' : 'Notify me when it opens'}
    </Button>
  );
}
