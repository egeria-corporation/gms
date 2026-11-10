// SPDX-License-Identifier: AGPL-3.0-only
// Map categories: which of the grantee's own ledger accounts roll up to each of the funder's
// budget categories, so actuals can be reported the same way each period.
import { useEffect, useState } from "react";
import type { BudgetCategoryMapping } from "../../api/launch.ts";
import { useLaunchMutation, useLaunchQuery } from "../../api/launchHooks.ts";
import { ErrorBanner, SaveNote } from "../../components/ui.tsx";

export function BudgetMappingForm({ awardId, categories }: { awardId: string; categories: string[] }) {
  const saved = useLaunchQuery((api) => api.budgetMapping(awardId), [awardId]);
  const save = useLaunchMutation((api, mapping: BudgetCategoryMapping[]) => api.putBudgetMapping(awardId, mapping));
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (saved.status === "ready") setDraft(Object.fromEntries(saved.data.map((m) => [m.category, m.ownCategory])));
  }, [saved.status, saved.data]);
  if (categories.length === 0) return null;

  return (
    <form
      className="card-b"
      style={{ borderTop: "1px solid #D6DEDE", display: "flex", flexDirection: "column", gap: "10px" }}
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await save.run(categories.map((category) => ({ category, ownCategory: draft[category] ?? "" })));
        if (result) saved.set(result);
      }}
    >
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>Map categories</h3>
        <span className="small muted">Your ledger account → budget category</span>
      </div>
      {saved.status === "error" && <ErrorBanner error={saved.error} onRetry={saved.reload} />}
      {save.error !== null && <ErrorBanner error={save.error} />}
      <div className="kv" style={{ gridTemplateColumns: "minmax(0, 1fr) 24px minmax(0, 1fr)", fontSize: "14px", alignItems: "center" }}>
        {categories.map((category) => {
          const id = `map-${awardId}-${category.replace(/[^a-z0-9]+/gi, "-")}`;
          return (
            <div key={category} style={{ display: "contents" }}>
              <div>
                <label className="sr" htmlFor={id}>
                  Your ledger account for {category}
                </label>
                <input id={id} className="inp mono" style={{ height: "36px", fontSize: "13px" }} value={draft[category] ?? ""} placeholder="e.g. 6100 Salaries & wages" onChange={(e) => setDraft((d) => ({ ...d, [category]: e.target.value }))} />
              </div>
              <div className="muted" style={{ textAlign: "center" }} aria-hidden="true">
                →
              </div>
              <div className="b">{category}</div>
            </div>
          );
        })}
      </div>
      <div className="row">
        <button type="submit" className="btn btn-sm btn-primary" disabled={save.state === "saving"}>
          Save mapping
        </button>
        <SaveNote state={save.state} />
      </div>
      <span className="help">Kept with this grant, for your team. Your funder sees amounts by budget category, not your account names.</span>
    </form>
  );
}
