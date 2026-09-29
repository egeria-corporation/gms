// SPDX-License-Identifier: AGPL-3.0-or-later
// Reviewer workspace guard (every page also calls requireReviewer()). Each page renders its own ReviewerShell.
import type { ReactNode } from 'react';
import { requireTenant } from '@/lib/tenant';
import { requireReviewer } from './guard';

export default async function ReviewerLayout({ children }: { children: ReactNode }) {
  await requireTenant();
  await requireReviewer();
  return <>{children}</>;
}
