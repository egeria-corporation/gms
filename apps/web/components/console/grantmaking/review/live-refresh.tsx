// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// R-04 live aggregates: re-renders the server page every 5 seconds while the tab is visible.
// Supabase Realtime isn't available in this environment (embedded Postgres / plain-Postgres tiers), so the
// panel polls with router.refresh(). Upgrade path: subscribe to Realtime changes on `reviews` and
// `review_scores` (and `panel_notes`) for the stage and refresh only when something changes.
import { Button } from '@gms/ui';
import { Pause, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function LiveRefresh({ renderedAt, timeZone, intervalMs = 5000 }: { renderedAt: string; timeZone: string; intervalMs?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (paused || hidden) return;
    const t = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(t);
  }, [paused, hidden, intervalMs, router]);

  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(renderedAt));
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground" suppressHydrationWarning>
        {paused ? 'Paused · ' : hidden ? 'Paused while this tab is hidden · ' : 'Live · '}Updated {time}
      </span>
      <Button variant="outline" size="sm" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        {paused ? 'Resume live updates' : 'Pause live updates'}
      </Button>
    </div>
  );
}
