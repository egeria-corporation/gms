// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { requireViewer } from '@/lib/auth';

/** Everything in the portal except sign-in needs a session. */
export default async function PortalAppLayout({ children }: { children: ReactNode }) {
  await requireViewer();
  return <>{children}</>;
}
