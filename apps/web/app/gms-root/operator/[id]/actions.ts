// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
// G-02 tenant controls: re-verifies the viewer is a platform operator, then runs operator.set_flags as the
// system actor and records which operator made the change in the tenant's audit log.
import { getRuntime, systemContext } from '@gms/actions';
import { isDomainError, toProblem } from '@gms/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getViewer } from '@/lib/auth';
import { config } from '@/lib/config';
import { requestMeta } from '@/lib/tenant';
import { workspaceRefById } from '../data';

export type ControlsResult = { ok: true } | { ok: false; message: string };

const Input = z.object({
  workspaceId: z.string().uuid(),
  flags: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/), z.boolean()).refine((f) => Object.keys(f).length <= 50, 'Too many flags.'),
  status: z.enum(['active', 'suspended', 'archived']),
  plan: z.enum(['self_hosted', 'free', 'standard', 'enterprise']),
});

export async function saveTenantControls(raw: unknown): Promise<ControlsResult> {
  if (config.mode !== 'multi') return { ok: false, message: 'The operator console is only available in multi-tenant mode.' };
  const viewer = await getViewer();
  if (!viewer?.isOperator) return { ok: false, message: 'Only platform operators can change workspace settings here.' };
  if (viewer.session.aal !== 'aal2') return { ok: false, message: 'Confirm it’s you with your authenticator app first (reload the page).' };
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: 'Some settings could not be read. Reload the page and try again.' };
  const input = parsed.data;
  const ws = await workspaceRefById(input.workspaceId);
  if (!ws) return { ok: false, message: 'That workspace no longer exists.' };
  const meta = await requestMeta();
  const rt = getRuntime();
  const ctx = { ...systemContext(null, 'ui'), ip: meta.ip, userAgent: meta.userAgent, requestId: meta.requestId };
  try {
    await rt.executor.execute('operator.set_flags', input, ctx);
    // operator.set_flags runs as the system actor; record who asked for it in the tenant's audit log.
    await rt.executor.execute(
      'operator.record_view',
      { operatorUserId: viewer.userId, operatorEmail: viewer.email, view: `operator.set_flags status=${input.status} plan=${input.plan}`, supportGrantId: null },
      { ...ctx, workspace: ws },
    );
    return { ok: true };
  } catch (err) {
    if (!isDomainError(err)) console.error('[operator] set_flags failed', err);
    const p = toProblem(err);
    return { ok: false, message: p.code === 'internal' ? 'We couldn’t save those settings. Please try again.' : p.detail };
  }
}

const DeploymentStatus = z.object({ requestId: z.string().uuid(), workspaceId: z.string().uuid(), status: z.enum(['new', 'in_review', 'closed']) });

/** Moves a custom deployment request along (form action). Operator + aal2 re-checked; audited in the tenant log. */
export async function setDeploymentRequestStatus(form: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!viewer?.isOperator || viewer.session.aal !== 'aal2') return;
  const parsed = DeploymentStatus.safeParse({ requestId: form.get('requestId'), workspaceId: form.get('workspaceId'), status: form.get('status') });
  if (!parsed.success) return;
  const ws = await workspaceRefById(parsed.data.workspaceId);
  if (!ws) return;
  const meta = await requestMeta();
  await getRuntime().executor.execute(
    'deployments.set_status',
    { requestId: parsed.data.requestId, status: parsed.data.status, operatorEmail: viewer.email },
    { ...systemContext(ws, 'ui'), ip: meta.ip, userAgent: meta.userAgent, requestId: meta.requestId },
  );
  revalidatePath(`/operator/${ws.id}`);
}
