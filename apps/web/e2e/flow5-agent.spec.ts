// SPDX-License-Identifier: AGPL-3.0-only
// E2E flow 5 — Agent: Maya connects "Grant Writer Assistant" with a token (B-13) → the agent sets up her
// application over MCP → save_answers → request_submission returns approval_required → Maya confirms on B-14 →
// Submitted → the audit log shows "Grant Writer Assistant, acting for Maya Chen". A staff agent (acting for Priya,
// finance) proposes a payment batch as a draft, but approving it is refused.
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectAccessible, query, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

/** A tiny, valid one-page PDF (the budget attachment). */
const PDF = ['%PDF-1.4', '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj', '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj', '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj', 'trailer<</Root 1 0 R>>', '%%EOF'].join(String.fromCharCode(10));

const MAYA = 'maya@eastside-youth-music.example';
const PRIYA = 'priya@halcyonridge.example';

interface ToolResult {
  httpStatus: number;
  isError: boolean;
  structured: Record<string, unknown> | null;
  text: string;
  problem: Record<string, unknown> | null;
}

/** Calls an MCP tool from the page (same origin as the tenant, so no Origin allowlist is involved). */
async function callTool(page: Page, token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return page.evaluate(
    async ({ token, name, args }) => {
      const res = await fetch('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}`, 'mcp-protocol-version': '2026-07-28' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      });
      const body = (await res.json()) as { result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { type: string; text?: string }[] }; error?: { message: string } };
      const texts = (body.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '');
      let problem: Record<string, unknown> | null = null;
      if (body.result?.isError && texts[1]) {
        try {
          problem = JSON.parse(texts[1]) as Record<string, unknown>;
        } catch {
          problem = null;
        }
      }
      return { httpStatus: res.status, isError: Boolean(body.result?.isError ?? body.error), structured: body.result?.structuredContent ?? null, text: texts.join('\n') || body.error?.message || '', problem };
    },
    { token, name, args },
  );
}

async function createToken(page: Page, agentName: string): Promise<string> {
  await page.goto('/portal/account/agents');
  await expect(page.getByRole('heading', { level: 1, name: 'Connected agents' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: /connect an agent with a token/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Agent name').fill(agentName);
  // Everything an application assistant needs, including asking to submit.
  for (const cb of await dialog.getByRole('checkbox').all()) if (!(await cb.isChecked())) await cb.click();
  await dialog.getByRole('button', { name: 'Create token' }).click();
  await expect(dialog.getByRole('heading', { name: /copy your token now/i })).toBeVisible();
  const token = (await dialog.locator('code').innerText()).trim();
  expect(token).toMatch(/^gms_pat_/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(agentName).first()).toBeVisible();
  return token;
}

test('an applicant agent prepares an application and Maya confirms the submission', async ({ page }) => {
  const [opp] = await query<{ id: string; competition_id: string; form_id: string }>(
    `select o.id, c.id as competition_id, cf.form_id
       from public.opportunities o
       join public.competitions c on c.opportunity_id = o.id
       join public.competition_forms cf on cf.competition_id = c.id
      where o.slug = 'e2e-youth-arts-loi' limit 1`,
  );
  expect(opp, 'created by e2e/global-setup.ts').toBeTruthy();

  await signIn(page, MAYA, '/portal/account/agents');
  const agentName = 'Grant Writer Assistant';
  const token = await createToken(page, agentName);

  // A fresh organization for this run, created by the agent (profile:write), so the flow can be re-run.
  const suffix = String(Date.now() % 10_000_000).padStart(7, '0');
  const ein = `46-${suffix}`;
  // The fictional IRS exempt-org record the BMF importer would load, so the agent-created org verifies its EIN
  // (agent submissions require a verified EIN).
  const legalName = `Eastside Strings Collective ${suffix.slice(-4)}`;
  await query(`insert into public.irs_exempt_orgs (ein, name, city, state, subsection, status, pub78, source) values ($1, $2, 'ALDER', 'CA', '03', 'active', true, 'fixture') on conflict do nothing`, [ein, legalName.toUpperCase()]);
  const org = await callTool(page, token, 'orgs_create', { legalName, ein, orgType: 'nonprofit_501c3', annualBudgetCents: 48_000_000, counties: ['Alder'] });
  expect(org.isError, org.text).toBe(false);
  const orgId = String((org.structured!.result as { id: string }).id);

  const started = await callTool(page, token, 'start_application', { competitionId: opp!.competition_id, applicantOrgId: orgId });
  expect(started.isError, started.text).toBe(false);
  const applicationId = String((started.structured!.result as { applicationId: string }).applicationId);

  const form = await callTool(page, token, 'get_application_form', { applicationId });
  expect(form.isError, form.text).toBe(false);
  const f0 = (form.structured!.forms as { formId: string; etag: string }[])[0]!;

  const { LOI_VALID_RESPONSE } = await import('@gms/forms');
  const { budget_file: _file, attestation: _att, ...answers } = LOI_VALID_RESPONSE as Record<string, unknown>;
  const saved = await callTool(page, token, 'save_answers', { applicationId, formId: f0.formId, etag: f0.etag, answers: { ...answers, org_legal_name: legalName, org_ein: ein } });
  expect(saved.isError, saved.text).toBe(false);

  // Asking to submit an incomplete application fails straight away — Maya is never asked to confirm it.
  const early = await callTool(page, token, 'request_submission', { applicationId, attestation: { typedName: 'Maya Chen', agreed: true }, aiDisclosure: 'Drafted with Grant Writer Assistant.' });
  expect(early.isError).toBe(true);
  expect(early.problem?.code).toBe('validation_failed');

  // The budget spreadsheet: signed upload URL → PUT the bytes → confirm.
  const upload = await callTool(page, token, 'upload_attachment', { applicationId, formId: f0.formId, fieldId: 'budget_file', fileName: 'strings-budget.pdf', contentType: 'application/pdf', sizeBytes: PDF.length });
  expect(upload.isError, upload.text).toBe(false);
  const up = upload.structured!.result as { attachmentId: string; uploadUrl: string; method: string; headers: Record<string, string> };
  const putStatus = await page.evaluate(async ({ u, pdf }) => {
    const r = await fetch(u.uploadUrl, { method: u.method, headers: u.headers, body: pdf });
    return r.status;
  }, { u: up, pdf: PDF });
  expect(putStatus).toBeLessThan(300);
  const confirmed = await callTool(page, token, 'applications_confirm_upload', { attachmentId: up.attachmentId });
  expect(confirmed.isError, confirmed.text).toBe(false);
  const refreshed = await callTool(page, token, 'get_application_form', { applicationId });
  const etag2 = (refreshed.structured!.forms as { etag: string }[])[0]!.etag;
  const saved2 = await callTool(page, token, 'save_answers', { applicationId, formId: f0.formId, etag: etag2, answers: { attestation: { agreed: true, name: 'Maya Chen' } } });
  expect(saved2.isError, saved2.text).toBe(false);
  const valid = await callTool(page, token, 'validate_application', { applicationId });
  expect((valid.structured!.result as { ready: boolean }).ready, JSON.stringify(valid.structured)).toBe(true);

  const submit = await callTool(page, token, 'request_submission', {
    applicationId,
    attestation: { typedName: 'Maya Chen', agreed: true },
    aiDisclosure: 'Drafted with Grant Writer Assistant; Maya reviewed every answer.',
  });
  expect(submit.isError, submit.text).toBe(false);
  expect(submit.structured!.status, JSON.stringify(submit.structured)).toBe('approval_required');
  const confirmUrl = String(submit.structured!.confirmUrl);
  expect(confirmUrl).toMatch(/\/portal\/confirm\/[0-9a-f-]+/);
  const [before] = await query<{ status: string }>('select status from public.applications where id = $1', [applicationId]);
  expect(before!.status).toBe('in_progress');

  // Maya confirms inside GMS (B-14).
  await page.goto(new URL(confirmUrl).pathname + new URL(confirmUrl).search);
  await expect(page.getByText(agentName).first()).toBeVisible();
  await expect(page.getByText(/acting for Maya Chen/i).first()).toBeVisible();
  await expectAccessible(page);
  const attest = page.getByRole('checkbox');
  if (await attest.count()) await attest.first().check();
  await page.getByRole('button', { name: /^confirm/i }).click();
  await expect(page.getByText(/confirmed/i).first()).toBeVisible();

  const [after] = await query<{ status: string }>('select status from public.applications where id = $1', [applicationId]);
  expect(after!.status).toBe('submitted');
  await page.goto(`/portal/applications/${applicationId}`);
  await expect(page.getByText('Submitted').first()).toBeVisible();

  // The audit log attributes the submission to the agent acting for Maya.
  const audit = await query<{ actor_type: string; actor_name: string; on_behalf_of_name: string }>(
    `select actor_type, actor_name, on_behalf_of_name from public.audit_log where entity_id = $1 and action = 'applications.submit' order by occurred_at desc limit 1`,
    [applicationId],
  );
  expect(audit[0]).toMatchObject({ actor_type: 'agent', actor_name: agentName, on_behalf_of_name: 'Maya Chen' });
  const [history] = await query<{ actor_name: string }>(`select actor_name from public.status_history where application_id = $1 and to_status = 'submitted'`, [applicationId]);
  expect(history!.actor_name).toBe('Grant Writer Assistant, acting for Maya Chen');
});

test('a staff agent proposes a payment batch as a draft but cannot approve it', async ({ page }) => {
  // Priya (finance) connects an agent. Tokens are people-only (R3), so this runs as Priya with a fresh step-up —
  // exactly what her TOTP-confirmed click in the console does.
  const { getRuntime } = await import('@gms/actions');
  const rt = getRuntime();
  const ws = await rt.db.selectFrom('workspaces').select(['id', 'slug', 'name', 'timezone']).where('slug', '=', 'halcyon').executeTakeFirstOrThrow();
  const priya = await rt.db.selectFrom('profiles').select(['id', 'email', 'full_name']).where('email', '=', PRIYA).executeTakeFirstOrThrow();
  const nowIso = new Date().toISOString();
  const created = await rt.executor.run<{ token: string }>(
    'agents.create_token',
    { agentName: 'Finance Assistant', scopes: ['payments:read', 'payments:propose'], expiresInDays: 7, workspaceBound: true },
    {
      workspace: ws,
      actor: { type: 'human', id: priya.id, name: priya.full_name ?? 'Priya Natarajan' },
      roles: ['finance'],
      scopes: '*',
      claims: { role: 'authenticated', sub: priya.id, email: priya.email, aal: 'aal2' },
      aal: 'aal2',
      stepUpAt: nowIso,
      requestId: randomUUID(),
      channel: 'test',
    },
  );
  const token = created.token;

  await page.goto('/opportunities');
  const proposed = await callTool(page, token, 'propose_payment_batch', { name: `E2E agent batch ${Date.now()}` });
  expect(proposed.isError, proposed.text).toBe(false);
  expect(proposed.structured!.status).toBe('ok');
  const out = proposed.structured!.result as { batchId: string | null; included: number; blocked: unknown[] };
  if (out.batchId) {
    const [batch] = await query<{ status: string; created_by_agent_client_id: string | null }>('select status, created_by_agent_client_id from public.payment_batches where id = $1', [out.batchId]);
    expect(batch!.status).toBe('draft');
    expect(batch!.created_by_agent_client_id).not.toBeNull();
  }
  const batchId = out.batchId ?? randomUUID();

  // Approving is people-only on every surface.
  const tools = await page.evaluate(async (token) => {
    const r = await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    return ((await r.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  }, token);
  expect(tools).toContain('propose_payment_batch');
  expect(tools.some((n) => /approve/.test(n))).toBe(false);
  const viaMcp = await callTool(page, token, 'payments_approve_batch', { batchId });
  expect(viaMcp.isError).toBe(true);
  expect(viaMcp.problem?.code).toBe('human_only');
  const viaApi = await page.evaluate(
    async ({ token, batchId }) => {
      const r = await fetch('/api/v1/actions/payments.approve_batch', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ batchId }) });
      return { status: r.status, body: (await r.json()) as { code?: string } };
    },
    { token, batchId },
  );
  expect(viaApi.status).toBe(403);
  expect(viaApi.body.code).toBe('human_only');
  if (out.batchId) {
    const [still] = await query<{ status: string }>('select status from public.payment_batches where id = $1', [out.batchId]);
    expect(still!.status).toBe('draft');
  }
});

test('an agent connects with OAuth: Maya reviews and narrows the permissions on the consent screen (O-01)', async ({ page }) => {
  const REDIRECT = 'http://127.0.0.1:43110/callback';
  // The agent's local callback server.
  await page.route('http://127.0.0.1:43110/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'You can close this window.' }));

  await signIn(page, MAYA, '/portal');
  const reg = await page.evaluate(async (redirect) => {
    const r = await fetch('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Desk Research Agent', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) });
    return { status: r.status, body: (await r.json()) as { client_id: string } };
  }, REDIRECT);
  expect(reg.status).toBe(201);

  const verifier = randomUUID() + randomUUID();
  const { createHash } = await import('node:crypto');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const origin = new URL(page.url()).origin;
  const authorize = new URL('/oauth/authorize', origin);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: reg.body.client_id,
    redirect_uri: REDIRECT,
    scope: 'opportunities:read applications:read applications:write',
    state: 'e2e-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${origin}/mcp`,
  }))
    authorize.searchParams.set(k, v);
  await page.goto(authorize.toString());

  // O-01: who is asking, what it can do, where it goes back to.
  await expect(page).toHaveURL(/\/oauth\/consent\?request=/);
  await expect(page.getByRole('heading', { level: 1, name: /allow desk research agent/i })).toBeVisible();
  await expect(page.getByText('127.0.0.1:43110')).toBeVisible();
  await expectAccessible(page);
  const boxes = page.locator('input[name="scope"]');
  await expect(boxes).toHaveCount(3);
  await page.locator('input[name="scope"][value="applications:write"]').uncheck();
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await page.waitForURL(/127\.0\.0\.1:43110\/callback/);
  const back = new URL(page.url());
  expect(back.searchParams.get('state')).toBe('e2e-state');
  const code = back.searchParams.get('code')!;
  expect(code).toMatch(/^gms_ac_/);

  await page.goto(`${origin}/portal`);
  const tok = await page.evaluate(
    async ({ code, clientId, redirect, verifier, resource }) => {
      const r = await fetch('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier, resource }).toString(),
      });
      return { status: r.status, body: (await r.json()) as { access_token?: string; scope?: string } };
    },
    { code, clientId: reg.body.client_id, redirect: REDIRECT, verifier, resource: `${origin}/mcp` },
  );
  expect(tok.status, JSON.stringify(tok.body)).toBe(200);
  expect(tok.body.access_token).toMatch(/^gms_oat_/);
  expect(tok.body.scope?.split(' ').sort()).toEqual(['applications:read', 'opportunities:read']);

  // The narrowed grant: reads work, writes are not offered.
  const names = await page.evaluate(async (token) => {
    const r = await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    return ((await r.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  }, tok.body.access_token!);
  expect(names).toContain('get_status');
  expect(names).not.toContain('save_answers');

  // The connection shows up in Connected agents.
  await page.goto('/portal/account/agents');
  await expect(page.getByText('Desk Research Agent').first()).toBeVisible();
});
