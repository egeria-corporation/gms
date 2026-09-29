// SPDX-License-Identifier: AGPL-3.0-or-later
// B-15 "Download my data": everything this person can see about themselves, read under RLS.
import { getSession } from '@/lib/auth';
import { rls } from '@/lib/server/db';

export async function GET() {
  const session = await getSession();
  if (!session) return new Response('Sign in first.', { status: 401 });
  const data = await rls(async (trx) => {
    const profile = await trx.selectFrom('profiles').selectAll().where('id', '=', session.userId).executeTakeFirst();
    const orgs = await trx.selectFrom('applicant_org_members as m').innerJoin('applicant_orgs as o', 'o.id', 'm.org_id').selectAll('o').select('m.role').where('m.user_id', '=', session.userId).execute();
    const applications = await trx.selectFrom('applications').selectAll().where('applicant_user_id', '=', session.userId).execute();
    const appIds = applications.map((a) => a.id);
    const responses = appIds.length ? await trx.selectFrom('form_responses').select(['application_id', 'form_id', 'data', 'last_modified_at']).where('application_id', 'in', appIds).execute() : [];
    const submissions = appIds.length ? await trx.selectFrom('application_submissions').selectAll().where('application_id', 'in', appIds).execute() : [];
    const messages = await trx.selectFrom('messages').select(['id', 'thread_id', 'body', 'created_at', 'author_side']).where('author_id', '=', session.userId).execute();
    const tokens = await trx.selectFrom('personal_access_tokens').select(['id', 'name', 'prefix', 'scopes', 'created_at', 'expires_at', 'revoked_at']).where('user_id', '=', session.userId).execute();
    const notifications = await trx.selectFrom('notifications').select(['kind', 'title', 'created_at', 'read_at']).where('user_id', '=', session.userId).execute();
    return { exportedAt: new Date().toISOString(), profile, organizations: orgs, applications, responses, submissions, messages, agentTokens: tokens, notifications };
  });
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="my-gms-data.json"', 'cache-control': 'no-store' },
  });
}
