// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Refreshes the page every 5 seconds while any export is queued or running (paused when the tab is hidden).
import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [active, intervalMs, router]);
  if (!active) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
      Exports in progress. This list updates by itself every few seconds; we’ll also notify you when they’re
      ready.
    </p>
  );
}
