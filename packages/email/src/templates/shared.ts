// SPDX-License-Identifier: AGPL-3.0-only
import type { BuildContext, EmailContent } from '../blocks';

export interface EmailTemplate<P> {
  /** Human name for preview routes. */
  name: string;
  description: string;
  audience: 'applicant' | 'staff' | 'anyone';
  build(props: P, ctx: BuildContext): EmailContent;
  /** Fictional sample props for previews and tests. */
  previewProps: P;
}

export function defineTemplate<P>(t: EmailTemplate<P>): EmailTemplate<P> {
  return t;
}

/** "Hi Maya," — or "Hi there," when we don't know the name. */
export function greeting(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi there,';
}

// Shared fixture values (fictional).
export const FIX = {
  tz: 'America/Los_Angeles',
  portal: 'https://halcyon.gms.example/portal',
  staff: 'https://halcyon.gms.example',
  applicant: 'Maya Chen',
  applicantEmail: 'maya@eastside-youth-music.example',
  org: 'Eastside Youth Music Collective',
  opportunity: 'Youth Arts Fund 2027',
  appTitle: 'After-School Strings Program',
  appRef: 'YAF27-0042',
  awardRef: 'HRF-2027-014',
  officer: 'Priya Natarajan',
  finance: 'Daniel Okafor',
  owner: 'Helen Ortiz',
} as const;
