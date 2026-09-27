// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import * as React from 'react';

/** Current time, refreshed every `intervalMs`. Pass `initial` from the server to avoid hydration drift. */
export function useNow(intervalMs = 60_000, initial?: Date): Date {
  const [now, setNow] = React.useState(() => initial ?? new Date());
  React.useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
