// SPDX-License-Identifier: AGPL-3.0-or-later
// E-02 board portal: a branded, focused surface for board members (not the staff console). Each page renders
// BoardShell itself (it needs page data for the item section nav); this layout only guards and brands.
// Decision: TOTP is NOT required for the board role. Board members only read dockets and cast votes (R3
// actions are people-only and every vote is recorded with voter + time); the MFA requirement stays on staff
// roles (see MFA_REQUIRED_ROLES), which is why we use requireMember instead of requireStaff here.
import type { ReactNode } from 'react';
import { requireMember } from '@/lib/auth';
import { BrandStyle } from '@/lib/brand-style';
import { requireTenant } from '@/lib/tenant';

export default async function BoardLayout({ children }: { children: ReactNode }) {
  const tenant = await requireTenant();
  await requireMember(['board']);
  return (
    <>
      <BrandStyle tenant={tenant} scope="branded" />
      {children}
    </>
  );
}
