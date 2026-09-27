// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer workspace guard: a reviewer (or program staff) in this tenant, signed in with TOTP (aal2) because
// reviewers see applicant personal information.
import 'server-only';
import { redirect } from 'next/navigation';
import { requireMember, type Viewer } from '@/lib/auth';
import { requestMeta } from '@/lib/tenant';

export const REVIEWER_ROLES = ['reviewer', 'program_officer', 'admin', 'owner'] as const;

export async function requireReviewer(): Promise<Viewer> {
  const viewer = await requireMember(REVIEWER_ROLES);
  if (viewer.session.aal !== 'aal2') {
    const { pathname } = await requestMeta();
    redirect(`/console/mfa?next=${encodeURIComponent(pathname)}`);
  }
  return viewer;
}

/** One row of gms.reviewer_queue(): the signed-in reviewer's own assignment with minimal context. */
export interface QueueRow {
  assignment_id: string;
  application_id: string;
  stage_id: string;
  stage_name: string;
  blind: boolean;
  stage_status: string;
  opportunity_title: string;
  competition_name: string;
  reference_number: string;
  application_title: string | null;
  organization_name: string | null;
  status: string;
  due_at: string | null;
  coi_declared: boolean;
  has_conflict: boolean;
  review_status: string | null;
  weighted_score: number | null;
  rubric_id: string | null;
  assigned_at: string;
}
