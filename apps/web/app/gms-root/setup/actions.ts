// SPDX-License-Identifier: AGPL-3.0-only
'use server';
// First-run setup: runs setup.initialize as the system actor (only while no workspace exists), then
// emails the new owner a magic link to their console.
import { getRuntime, originFor, systemContext } from '@gms/actions';
import { isDomainError, toProblem } from '@gms/domain';
import { kickOutbox } from '@/lib/server/outbox';
import { rateLimit } from '@/lib/server/rate-limit';
import { requestMeta } from '@/lib/tenant';
import { DraftSchema, pointerToField, stepForField, toInitializeInput, validateAll, type FieldErrors, type StepId } from './wizard-schema';

export type SetupResult =
  | { ok: true; email: string; origin: string; name: string; programCreated: boolean; opportunityCreated: boolean; invited: number; emailSent: boolean }
  | { ok: false; message: string; step?: StepId; fieldErrors?: FieldErrors; alreadySetUp?: boolean };

function isZodLike(err: unknown): err is { issues: { path: PropertyKey[]; message: string }[] } {
  const issues = typeof err === 'object' && err !== null ? (err as { issues?: unknown }).issues : undefined;
  return Array.isArray(issues) && issues.every((i) => typeof i === 'object' && i !== null && Array.isArray((i as { path?: unknown }).path));
}

async function workspaceExists(): Promise<boolean> {
  const row = await getRuntime().db.selectFrom('workspaces').select('id').limit(1).executeTakeFirst();
  return Boolean(row);
}

export async function initializeSetup(raw: unknown): Promise<SetupResult> {
  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: 'Some answers could not be read. Reload the page and try again.' };
  const draft = parsed.data;

  const invalid = validateAll(draft);
  if (invalid) return { ok: false, message: 'Fix the highlighted answers, then try again.', step: invalid.step, fieldErrors: invalid.errors };

  const meta = await requestMeta();
  const limit = await rateLimit(`setup:ip:${meta.ip ?? 'unknown'}`, 10, 3600);
  if (!limit.ok) return { ok: false, message: `Too many setup attempts from this network. Try again in ${Math.ceil(limit.resetSeconds / 60)} minutes.` };

  if (await workspaceExists()) {
    return { ok: false, alreadySetUp: true, message: 'This GMS is already set up. Sign in to your foundation’s console instead.' };
  }

  const { input, inviteIndexes } = toInitializeInput(draft);
  const rt = getRuntime();
  let result: { workspaceId: string; slug: string; programId: string | null; opportunityId: string | null; invited: number };
  try {
    const r = await rt.executor.execute<typeof result>('setup.initialize', input, { ...systemContext(null, 'ui'), ip: meta.ip, userAgent: meta.userAgent, requestId: meta.requestId });
    if (r.status !== 'ok') return { ok: false, message: 'Setup needs a confirmation step that isn’t available here. Try `pnpm run setup` instead.' };
    result = r.output;
    kickOutbox();
  } catch (err) {
    if (!isDomainError(err)) console.error('[setup] setup.initialize failed', err);
    const problem = toProblem(err);
    // A nested action's input check (zod) inside setup.initialize surfaces as a plain ZodError.
    const nested = !isDomainError(err) && isZodLike(err) ? err.issues.map((i) => ({ pointer: '/' + i.path.map(String).join('/'), message: i.message })) : [];
    const fieldErrors: FieldErrors = {};
    for (const issue of [...(problem.errors ?? []), ...nested]) {
      let key = pointerToField(issue.pointer);
      if (!key) continue;
      // Invite indexes in the action input skip blank rows; map back to the row the person sees.
      const m = /^invite-(\d+)-(email|role)$/.exec(key);
      if (m) key = `invite-${inviteIndexes[Number(m[1])] ?? Number(m[1])}-${m[2]}`;
      fieldErrors[key] = issue.pointer === '/slug' && problem.code === 'conflict' ? 'That web address is taken. Choose another.' : issue.message;
    }
    const keys = Object.keys(fieldErrors);
    if (keys.length) return { ok: false, message: problem.detail, step: stepForField(keys[0]!), fieldErrors };
    if (problem.code === 'conflict') return { ok: false, alreadySetUp: true, message: problem.detail };
    return { ok: false, message: problem.code === 'internal' ? 'We couldn’t finish setup just now. Nothing was saved — please try again.' : problem.detail };
  }

  const origin = originFor(result.slug);
  let emailSent = true;
  try {
    await rt.adapters.auth.sendMagicLink({ email: input.ownerEmail, redirectTo: `${origin}/console`, workspaceId: result.workspaceId, brandName: input.name });
  } catch (err) {
    emailSent = false;
    console.error('[setup] magic link failed', (err as Error).message);
  }
  return {
    ok: true,
    email: input.ownerEmail,
    origin,
    name: input.name,
    programCreated: Boolean(result.programId),
    opportunityCreated: Boolean(result.opportunityId),
    invited: result.invited,
    emailSent,
  };
}
