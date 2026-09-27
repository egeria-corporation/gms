// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth';

export default async function OrgIndex() {
  const v = await requireViewer();
  redirect(v.orgs[0] ? `/portal/org/${v.orgs[0].orgId}` : '/portal/org/new');
}
