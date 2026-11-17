// SPDX-License-Identifier: AGPL-3.0-only
// Budget actuals beside a report: the approved budget of the grant the report belongs to, against
// the actuals reported so far, with a link to where actuals are entered.
import { Link } from "react-router";
import { useMoreQuery } from "../../api/applicantMoreHooks.ts";
import { BudgetTable } from "./grant.tsx";
import { t } from "./i18n.ts";

export function ReportBudget({ awardId, base }: { awardId: string; base: string }) {
  const query = useMoreQuery((api) => api.budget(awardId), [awardId]);
  if (query.status !== "ready") return null;
  const book = query.data;
  return (
    <section className="card" aria-labelledby="report-budget-h">
      <div className="card-h">
        <div>
          <h3 id="report-budget-h">{t("reportBudget.budgetActuals")}</h3>
          <p className="small muted">{t("reportBudget.approvedAmountsAgainstWhatYouHave")}</p>
        </div>
        <Link to={`${base}/grants/${awardId}#budget`} className="small b">
          {t("reportBudget.reportActuals")}
        </Link>
      </div>
      {book.approved ? <BudgetTable book={book} compact /> : <p className="card-b muted">{t("reportBudget.theFunderHasNotRecordedAn")}</p>}
    </section>
  );
}
