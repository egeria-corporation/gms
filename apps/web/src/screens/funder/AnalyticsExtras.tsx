// SPDX-License-Identifier: AGPL-3.0-only
// Portfolio views built from records the funder can already read: awards by the recipient's state,
// each reviewer's load, and an equity lens comparing who applied with who was funded. Region comes
// from each organization's Passport record while its consent stands; organizations without one are
// counted as "Not shared". Groups smaller than five are not charted, so no single organization can
// be picked out of a breakdown.
import { useState } from "react";
import { ChartColumn } from "lucide-react";
import { useApiQuery } from "../../api/hooks.ts";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";
import { formatMinor } from "../../lib/format.ts";
import { US_STATES } from "../../lib/rules.ts";
import { usePeople } from "./shared.tsx";

const MIN_GROUP = 5;

interface OrgFacts {
  region: string;
  applications: number;
  awards: number;
  awardedMinor: number;
}

function regionOf(organization: Record<string, unknown> | null): string {
  const projection = (organization?.projection ?? organization) as { addresses?: { primary?: { stateOrProvince?: unknown } } } | null | undefined;
  const code = projection?.addresses?.primary?.stateOrProvince;
  return typeof code === "string" && code ? (US_STATES[code] ?? code) : "Not shared";
}

function Bars({ rows, total, format }: { rows: { label: string; value: number }[]; total: number; format: (n: number) => string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {rows.map((r) => (
        <div className="bar-h" key={r.label}>
          <span className="b">{r.label}</span>
          <div className="trk" role="img" aria-label={`${r.label}: ${format(r.value)}`}>
            <div className="f1" style={{ width: total ? `${Math.max(2, (r.value / total) * 100)}%` : "0%" }}></div>
          </div>
          <span className="num">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

const group = (facts: OrgFacts[], value: (f: OrgFacts) => number) => {
  const by = new Map<string, number>();
  for (const f of facts) if (value(f) > 0) by.set(f.region, (by.get(f.region) ?? 0) + value(f));
  return [...by.entries()].map(([label, v]) => ({ label, value: v })).sort((a, b) => b.value - a.value);
};

export function PortfolioExtras() {
  const { person } = usePeople();
  const [lens, setLens] = useState<"applicants" | "awards">("applicants");
  const orgs = useApiQuery(async (api): Promise<OrgFacts[]> => {
    const list = await api.listGrantees();
    const details = await Promise.all(list.slice(0, 100).map((g) => api.getGrantee(g.workspaceId).catch(() => null)));
    return details
      .filter((d) => d !== null)
      .map((d) => ({ region: regionOf(d.organization), applications: d.applications, awards: d.awards, awardedMinor: d.awardList.reduce((n, a) => n + (typeof a.awardedAmountMinor === "number" && a.status !== "cancelled" ? a.awardedAmountMinor : 0), 0) }));
  }, []);
  const assignments = useApiQuery((api) => api.listAssignments(), []);

  const facts = orgs.data ?? [];
  const byRegion = group(facts, (f) => f.awardedMinor);
  const awardedTotal = byRegion.reduce((n, r) => n + r.value, 0);
  const applicants = facts.filter((f) => f.applications > 0).length;
  const funded = facts.filter((f) => f.awards > 0).length;
  const lensRows = group(facts, lens === "applicants" ? (f) => (f.applications > 0 ? 1 : 0) : (f) => (f.awards > 0 ? 1 : 0));
  const lensTotal = lens === "applicants" ? applicants : funded;

  const load = new Map<string, { assigned: number; submitted: number }>();
  for (const a of assignments.data ?? []) {
    if (a.status === "recused") continue;
    const row = load.get(a.reviewerUserId) ?? { assigned: 0, submitted: 0 };
    row.assigned += 1;
    if (a.status === "submitted") row.submitted += 1;
    load.set(a.reviewerUserId, row);
  }
  const reviewers = [...load.entries()].sort((a, b) => b[1].assigned - a[1].assigned);
  const most = reviewers[0]?.[1].assigned ?? 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", alignItems: "start" }}>
      <section className="card" aria-labelledby="by-region-h">
        <div className="card-h">
          <h3 id="by-region-h">Awards by region</h3>
          <span className="small muted">By the recipient’s state in Passport</span>
        </div>
        <div className="card-b">
          {orgs.status === "loading" && <Loading label="Loading regions" />}
          {orgs.status === "error" && <ErrorBanner error={orgs.error} onRetry={orgs.reload} />}
          {orgs.status === "ready" && !byRegion.length && <p className="muted small">No awards yet.</p>}
          {byRegion.length > 0 && <Bars rows={byRegion} total={awardedTotal} format={(n) => formatMinor(n)} />}
        </div>
      </section>

      <section className="card" aria-labelledby="reviewer-load-h">
        <div className="card-h">
          <h3 id="reviewer-load-h">Reviewer load</h3>
          <span className="small muted">Assigned · submitted</span>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {assignments.status === "error" && <ErrorBanner error={assignments.error} onRetry={assignments.reload} />}
          {assignments.status === "ready" && !reviewers.length && <p className="muted small">No reviews have been assigned.</p>}
          {reviewers.map(([userId, r]) => (
            <div className="bar-h" key={userId}>
              <span className="b">{person(userId)?.name ?? "Reviewer"}</span>
              <div className="trk" role="img" aria-label={`${r.submitted} of ${r.assigned} submitted`}>
                <div className="f1" style={{ width: most ? `${(r.submitted / most) * 100}%` : "0%" }}></div>
                <div className="f2" style={{ width: most ? `${((r.assigned - r.submitted) / most) * 100}%` : "0%" }}></div>
              </div>
              <span className="num">
                {r.assigned} · {r.submitted}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="equity-h" style={{ gridColumn: "1 / -1" }}>
        <div className="card-h">
          <div>
            <h3 id="equity-h">Equity lens</h3>
            <p className="small muted">Who applied compared with who was funded, by region. Groups under {MIN_GROUP} organizations are not charted.</p>
          </div>
          <div className="seg" role="radiogroup" aria-label="Equity lens group">
            <button type="button" role="radio" aria-checked={lens === "applicants"} className={lens === "applicants" ? "on" : undefined} onClick={() => setLens("applicants")}>
              Applicants · {applicants}
            </button>
            <button type="button" role="radio" aria-checked={lens === "awards"} className={lens === "awards" ? "on" : undefined} onClick={() => setLens("awards")}>
              Awards · {funded}
            </button>
          </div>
        </div>
        <div className="card-b">
          {orgs.status === "ready" && lensTotal < MIN_GROUP ? (
            <EmptyState icon={ChartColumn} title={lens === "awards" ? "Not enough awards to chart" : "Not enough applicants to chart"}>
              A breakdown appears once there are at least {MIN_GROUP} organizations, so that no single one can be identified.
            </EmptyState>
          ) : (
            <Bars rows={lensRows} total={lensTotal} format={(n) => `${n} · ${lensTotal ? Math.round((n / lensTotal) * 100) : 0}%`} />
          )}
        </div>
      </section>
    </div>
  );
}
