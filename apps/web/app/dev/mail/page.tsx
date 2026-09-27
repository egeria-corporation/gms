// SPDX-License-Identifier: AGPL-3.0-only
// Dev outbox viewer: every email the dev mailer captured (never delivered).
import { getRuntime } from '@gms/actions';
import { Badge, PageHeader, SafeHtml } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { one } from '@/lib/site';

export const metadata: Metadata = { title: 'Dev mail' };
export const dynamic = 'force-dynamic';

export default async function DevMail({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const to = one(sp.to);
  const id = one(sp.id);
  let q = getRuntime().db.selectFrom('dev_outbox').select(['id', 'to_email', 'from_email', 'subject', 'created_at', 'tags']).orderBy('created_at', 'desc').limit(100);
  if (to) q = q.where('to_email', 'ilike', `%${to}%`);
  const rows = await q.execute();
  const selected = id ? await getRuntime().db.selectFrom('dev_outbox').selectAll().where('id', '=', id).executeTakeFirst() : null;
  return (
    <>
      <PageHeader title="Dev mail" description="Messages captured by the dev outbox. Nothing here was delivered." />
      <form className="flex gap-2" method="get">
        <label className="sr-only" htmlFor="to">
          Filter by recipient
        </label>
        <input id="to" name="to" defaultValue={to} className="rounded-md border px-3 py-2" />
        <button className="rounded-md border px-3 py-2" type="submit">
          Filter
        </button>
      </form>
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <ul className="grid content-start gap-1" data-testid="mail-list">
          {rows.map((m) => (
            <li key={m.id}>
              <Link href={`/dev/mail?id=${m.id}${to ? `&to=${encodeURIComponent(to)}` : ''}`} className={`block rounded-md border p-2 text-sm hover:bg-muted ${m.id === id ? 'bg-muted' : ''}`}>
                <span className="block font-medium">{m.subject}</span>
                <span className="block text-xs text-muted-foreground">
                  to {m.to_email} · {new Date(m.created_at).toLocaleString()}
                </span>
                {(m.tags as Record<string, string>).redirected ? <Badge variant="warning">Redirected</Badge> : null}
              </Link>
            </li>
          ))}
        </ul>
        {selected ? (
          <article className="grid gap-3 rounded-xl border p-4" data-testid="mail-view">
            <h2 className="font-semibold">{selected.subject}</h2>
            <p className="text-sm text-muted-foreground">
              From {selected.from_email} to {selected.to_email}
            </p>
            <SafeHtml html={selected.html} className="max-w-none" />
            <details>
              <summary className="cursor-pointer text-sm">Plain text</summary>
              <pre className="whitespace-pre-wrap text-sm" data-testid="mail-text">{selected.text}</pre>
            </details>
          </article>
        ) : null}
      </div>
    </>
  );
}
