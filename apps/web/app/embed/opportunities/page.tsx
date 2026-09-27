// SPDX-License-Identifier: AGPL-3.0-only
// A-06 Embeddable opportunity list (iframe route). Links open the foundation's site in the top window.
import { DeadlineChip, StatusChip } from '@gms/ui';
import { listOpportunities } from '@/lib/public-data';
import { requestMeta, requireTenant } from '@/lib/tenant';
import { EmbedResizer } from './resizer';

export default async function EmbedOpportunities() {
  const tenant = await requireTenant();
  const { nonce } = await requestMeta();
  const res = await listOpportunities(tenant, { status: ['open', 'forecasted'], pageSize: 20 });
  const items = res.items.filter((o) => o.distribution.embed !== false);
  return (
    <>
      <h1 className="font-heading text-lg font-semibold">Open funding from {tenant.brand.displayName}</h1>
      {items.length ? (
        <ul className="grid gap-2">
          {items.map((o) => (
            <li key={o.id} className="grid gap-1 rounded-lg border bg-card p-3">
              <a href={`${tenant.origin}/opportunities/${o.slug}`} target="_top" className="font-medium text-link underline underline-offset-2">
                {o.title}
              </a>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip kind="opportunity" value={o.status} size="sm" />
                {o.closesAt ? <DeadlineChip at={o.closesAt} timeZone={tenant.timezone} label="Closes" /> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No open opportunities right now.</p>
      )}
      <EmbedResizer nonce={nonce} />
    </>
  );
}
