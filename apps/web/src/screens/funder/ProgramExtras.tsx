// SPDX-License-Identifier: AGPL-3.0-only
// Program extras: the owner, the outcomes rollup with totals added up from accepted reports, and
// the budget categories applicants and grantees budget against.
import { useState } from "react";
import { Link } from "react-router";
import { Plus, X } from "lucide-react";
import type { Member } from "../../api/types.ts";
import type { ProgramOwner } from "../../api/launch.ts";
import { useLaunchMutation, useLaunchQuery } from "../../api/launchHooks.ts";
import { ErrorBanner, SaveNote } from "../../components/ui.tsx";

const number = new Intl.NumberFormat("en-US");

/** Owner per program id, for the list's Owner column and the detail header. */
export function useProgramOwners() {
  return useLaunchQuery((api) => api.programOwners(), []);
}

/** The owner picker on a program: any member of the funder workspace, or nobody. */
export function ProgramOwnerField({ programId, owner, members, onChanged }: { programId: string; owner: ProgramOwner | null; members: Member[]; onChanged: () => void }) {
  const save = useLaunchMutation((api, userId: string | null) => api.setProgramOwner(programId, userId));
  const id = `owner-${programId}`;
  // The current owner stays selectable even if the member list has not loaded or no longer has them.
  const options = owner && !members.some((m) => m.userId === owner.userId) ? [{ userId: owner.userId, label: owner.name }] : [];
  return (
    <div className="fld">
      <label className="lbl" htmlFor={id}>
        Owner
      </label>
      <div className="row wrap">
        <select
          id={id}
          className="sel"
          style={{ maxWidth: "260px" }}
          value={owner?.userId ?? ""}
          disabled={save.state === "saving"}
          onChange={async (e) => {
            await save.run(e.target.value || null);
            onChanged();
          }}
        >
          <option value="">No owner</option>
          {options.map((o) => (
            <option key={o.userId} value={o.userId}>
              {o.label}
            </option>
          ))}
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {(m as Member & { name?: string | null }).name ?? m.email ?? "Team member"}
            </option>
          ))}
        </select>
        <SaveNote state={save.state} />
      </div>
      <span className="help">The person answerable for this program. Shown in the programs list.</span>
      {save.error !== null && <ErrorBanner error={save.error} />}
    </div>
  );
}

/** Outcome figures added up across the program's accepted reports. */
export function ProgramOutcomes({ programId, reportsTotal, reportsAccepted, base }: { programId: string; reportsTotal: number; reportsAccepted: number; base: string }) {
  const outcomes = useLaunchQuery((api) => api.programOutcomes(programId), [programId]);
  const totals = outcomes.data?.totals ?? [];
  return (
    <>
      <div className="card-h" style={{ padding: "12px 16px", borderTop: "1px solid var(--og-gray-200)" }}>
        <h3 style={{ fontSize: "14px" }}>Outcomes rollup</h3>
        <span className="small muted">
          {reportsAccepted} of {reportsTotal} reports accepted
        </span>
      </div>
      <div className="card-b" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {outcomes.status === "error" && <ErrorBanner error={outcomes.error} onRetry={outcomes.reload} />}
        {totals.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
            {totals.map((t) => (
              <div className="stat" key={t.key}>
                <span className="stat-l">{t.label} (reported)</span>
                <span className="stat-v">
                  {number.format(t.total)}
                  {t.unit ? <span className="small muted"> {t.unit}</span> : null}
                </span>
                <span className="stat-d">
                  From {outcomes.data?.reportsAccepted ?? reportsAccepted} accepted report{(outcomes.data?.reportsAccepted ?? reportsAccepted) === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        )}
        {outcomes.status === "ready" && totals.length === 0 && (
          <p className="small muted">{reportsTotal ? "No outcome figures to add up yet. Totals appear when accepted reports carry numeric outcome fields." : "Outcomes appear once grantees in this program report."}</p>
        )}
        <Link to={`${base}/reporting`} className="small b">
          Open reporting
        </Link>
      </div>
    </>
  );
}

/** The categories a budget in this program is broken into. Grantees map their own ledger to these. */
export function BudgetCategoriesEditor({ programId }: { programId: string }) {
  const saved = useLaunchQuery((api) => api.budgetCategories(programId), [programId]);
  const save = useLaunchMutation((api, categories: string[]) => api.putBudgetCategories(programId, categories));
  const [draft, setDraft] = useState("");
  const categories = saved.data ?? [];

  async function put(next: string[]) {
    const result = await save.run(next);
    if (result) saved.set(result);
  }
  async function add() {
    const name = draft.trim();
    if (!name || categories.some((c) => c.toLowerCase() === name.toLowerCase())) return;
    setDraft("");
    await put([...categories, name]);
  }

  return (
    <>
      <div className="card-h" style={{ padding: "12px 16px", borderTop: "1px solid var(--og-gray-200)" }}>
        <h3 style={{ fontSize: "14px" }}>Budget categories</h3>
        <SaveNote state={save.state} />
      </div>
      <div className="card-b" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {saved.status === "error" && <ErrorBanner error={saved.error} onRetry={saved.reload} />}
        {save.error !== null && <ErrorBanner error={save.error} />}
        {categories.length === 0 && saved.status === "ready" && <p className="small muted">No categories yet. Budgets in this program use the form’s own rows until you add some.</p>}
        {categories.length > 0 && (
          <ul className="row wrap" aria-label="Budget categories" style={{ gap: "6px" }}>
            {categories.map((c) => (
              <li key={c} className="chip">
                {c}
                <button type="button" className="iconbtn" style={{ width: "24px", height: "24px" }} aria-label={`Remove ${c}`} disabled={save.state === "saving"} onClick={() => put(categories.filter((x) => x !== c))}>
                  <X className="ic ic-sm" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="sr" htmlFor={`cat-${programId}`}>
            New budget category
          </label>
          <input id={`cat-${programId}`} className="inp" style={{ maxWidth: "220px" }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Personnel" />
          <button type="submit" className="btn btn-sm btn-secondary" disabled={!draft.trim() || save.state === "saving"}>
            <Plus className="ic" aria-hidden="true" />
            Add
          </button>
        </form>
      </div>
    </>
  );
}
