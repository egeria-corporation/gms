// SPDX-License-Identifier: AGPL-3.0-only
// The people who can review a competition and how much each already has: staff reviewers and
// program officers from the workspace, plus external reviewers invited to this competition.
import { Link } from "react-router";
import { useApiQuery } from "../../api/hooks.ts";
import type { Stage } from "../../api/types.ts";
import { ErrorBanner } from "../../components/ui.tsx";
import { usePeople } from "./shared.tsx";
import { t } from "./i18n.ts";

const REVIEWING_ROLES = ["reviewer", "external_reviewer", "program_officer", "admin"];
const ROLE_LABEL: Record<string, string> = { reviewer: "Staff reviewer", external_reviewer: "External", program_officer: "Program officer", admin: "Admin" };

export function ReviewerPool({ competitionId, stages, base }: { competitionId: string; stages: Stage[]; base: string }) {
  const { people } = usePeople();
  const assignments = useApiQuery((api) => api.listAssignments({ competitionId }), [competitionId]);
  const assigned = (userId: string) => (assignments.data ?? []).filter((a) => a.reviewerUserId === userId && a.status !== "recused");
  const pool = people.filter((p) => REVIEWING_ROLES.includes(p.role) && (p.role !== "admin" || assigned(p.userId).length > 0));
  return (
    <section className="card" aria-labelledby="comp-pool-title">
      <div className="card-h" style={{ padding: "12px 16px" }}>
        <h3 id="comp-pool-title" style={{ fontSize: "14px" }}>
          {t("reviewerPool.reviewerPool")}
        </h3>
        <Link to={`${base}/reviews/assign`} className="small b">
          {t("reviewerPool.assign")}
        </Link>
      </div>
      <div className="card-b" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
        {assignments.status === "error" && <ErrorBanner error={assignments.error} onRetry={assignments.reload} />}
        {!pool.length && <span className="muted">{t("reviewerPool.noReviewersYetAdd")}</span>}
        {pool.map((p) => {
          const mine = assigned(p.userId);
          const open = mine.filter((a) => a.status !== "submitted").length;
          return (
            <div key={p.userId} className="row" style={{ gap: "8px" }}>
              <span className={p.role === "external_reviewer" ? "av av-sm av-g" : "av av-sm av-t"} aria-hidden="true">
                {p.initials}
              </span>
              <div>
                <div className="b" style={{ color: "var(--og-navy-dark)" }}>
                  {p.name} {p.role === "external_reviewer" && <span className="tag">{t("reviewerPool.external")}</span>}
                </div>
                <div className="muted xs">
                  {t("reviewerPool.assigned", { ROLE_LABEL: ROLE_LABEL[p.role] ?? p.role, count: mine.length })}{mine.length ? t("reviewerPool.stillToScore", { open }) : ""}
                </div>
              </div>
            </div>
          );
        })}
        <div className="divider"></div>
        <div>
          <div className="b" style={{ color: "var(--og-navy-dark)" }}>
            {t("reviewerPool.entryRules")}
          </div>
          {stages.length <= 1 ? (
            <div className="muted xs">{t("reviewerPool.oneStageEverySubmitted")}</div>
          ) : (
            stages.slice(1).map((s) => (
              <div key={s.key} className="muted xs">
                {t("reviewerPool.aProgramOfficerAdvances", { label: s.label })} {s.entryFrom.map((k) => stages.find((x) => x.key === k)?.label ?? k).join(" or ") || t("reviewerPool.thePreviousStage")}
                {s.requiresSubmission ? t("reviewerPool.theApplicantThenSubmits") : "."}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
