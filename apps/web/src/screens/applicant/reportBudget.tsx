// SPDX-License-Identifier: AGPL-3.0-only
// Budget actuals beside a report: the approved budget of the grant the report belongs to, against
// the actuals reported so far, with a link to where actuals are entered.
import { Link } from "react-router";
import { useMoreQuery } from "../../api/applicantMoreHooks.ts";
import { BudgetTable } from "./grant.tsx";

export function ReportBudget({ awardId, base }: { awardId: string; base: string }) {
  const query = useMoreQuery((api) => api.budget(awardId), [awardId]);
  if (query.status !== "ready") return null;
  const book = query.data;
  return (
    <section className="card" aria-labelledby="report-budget-h">
      <div className="card-h">
        <div>
          <h3 id="report-budget-h">Budget actuals</h3>
          <p className="small muted">Approved amounts against what you have reported spending on this grant.</p>
        </div>
        <Link to={`${base}/grants/${awardId}#budget`} className="small b">
          Report actuals
        </Link>
      </div>
      {book.approved ? <BudgetTable book={book} compact /> : <p className="card-b muted">The funder has not recorded an approved budget for this grant.</p>}
    </section>
  );
}
