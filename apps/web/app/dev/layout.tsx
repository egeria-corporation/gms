// SPDX-License-Identifier: AGPL-3.0-or-later
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { config } from '@/lib/config';

/** Development-only tools. Never available in production deploys. */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (!config.devToolsEnabled) notFound();
  return <main id="main" className="mx-auto grid max-w-6xl gap-6 p-6">{children}</main>;
}
