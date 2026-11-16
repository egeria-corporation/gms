// SPDX-License-Identifier: AGPL-3.0-only
// The builder's Applications step: what stands between a published opportunity and applicants.
// It shows the launch checklist inline, offers quick setup (a one-stage competition, a starter
// form and a starter rubric, all editable drafts) and opens the competition through the same
// workflow-guarded call as the Competition screen. Nothing here relaxes the checklist.
import { Link } from "react-router";
import { CircleCheck, CirclePause, Eye, Layers, Pencil, Wand } from "lucide-react";
import { useState } from "react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { Competition, Opportunity, QuickSetupResult } from "../../api/types.ts";
import { ErrorBanner, Loading, Notice, ReadinessChecklist } from "../../components/ui.tsx";
import { FORECASTED_LABEL, NOT_TAKING_LABEL } from "./applicationsStatus.tsx";
import { t } from "./i18n.ts";

function madeSummary(r: QuickSetupResult): { title: string; detail: string } {
  const made = [r.created.competition && "a one-stage competition", r.created.form && "the application form", r.created.rubric && "the rubric"].filter((x): x is string => !!x);
  if (!made.length) return { title: t("applicationsStep.alreadySetUp"), detail: "Quick setup found the competition, form and rubric it made before and kept them as they are." };
  const list = made.length === 1 ? made[0]! : `${made.slice(0, -1).join(", ")} and ${made[made.length - 1]}`;
  return { title: t("applicationsStep.quickSetupIsDone"), detail: `It made ${list}. Each is a draft you can edit until you open for applications.` };
}

export function ApplicationsStep({ opportunity, competition, base, publicPath, onChanged }: { opportunity: Opportunity | undefined; competition: Competition | undefined; base: string; publicPath: string | null; onChanged: () => void }) {
  const draft = competition?.status === "draft" ? competition : undefined;
  const check = useApiQuery(async (api) => (draft ? api.launchCheck(draft.id) : null), [draft?.id, draft?.updatedAt]);
  const setup = useApiMutation((api, id: string) => api.quickSetup(id));
  const open = useApiMutation((api, id: string) => api.openCompetition(id));
  const [result, setResult] = useState<QuickSetupResult | null>(null);

  if (!opportunity) {
    return (
      <Notice tone="neu" title={t("applicationsStep.saveTheOpportunityFirst")}>
        {t("applicationsStep.quickSetupWorksFrom")}
      </Notice>
    );
  }
  if (opportunity.status === "closed") {
    return (
      <Notice tone="neu" title={t("applicationsStep.thisOpportunityIsClosed")}>
        {t("applicationsStep.itNoLongerAccepts")}
      </Notice>
    );
  }

  const competitionPath = `${base}/opportunities/${opportunity.id}/competition`;
  const formId = (result?.competition.id === competition?.id ? result?.form?.id : undefined) ?? Object.keys(competition?.stages[0]?.forms ?? {})[0];
  const ready = check.status === "ready" && check.data?.ready === true;
  const runSetup = async () => {
    const out = await setup.run(opportunity.id);
    if (out) {
      setResult(out);
      onChanged();
    }
  };

  if (competition?.status === "open" && opportunity.status === "forecasted") {
    return (
      <div className="bnr bnr-warn" role="status">
        <CirclePause className="ic" aria-hidden="true" />
        <div>
          <div className="t">{FORECASTED_LABEL}</div>
          <div className="d">{t("applicationsStep.isOpenButThe", { title: competition.title })}</div>
        </div>
      </div>
    );
  }
  if (competition?.status === "open") {
    return (
      <>
        <div className="bnr bnr-ok" role="status">
          <CircleCheck className="ic" aria-hidden="true" />
          <div className="grow">
            <div className="t">{t("applicationsStep.takingApplications")}</div>
            <div className="d">{t("applicationsStep.isOpenApplicantsCan", { title: competition.title })}</div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: "8px" }}>
          {publicPath && opportunity.published && (
            <Link to={publicPath} className="btn btn-secondary">
              <Eye className="ic" aria-hidden="true" />
              {t("applicationsStep.openPublicPage")}
            </Link>
          )}
          <Link to={competitionPath} className="btn btn-secondary">
            <Layers className="ic" aria-hidden="true" />
            {t("applicationsStep.competitionStages")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {opportunity.published && (
        <div className="bnr bnr-warn" role="status">
          <CirclePause className="ic" aria-hidden="true" />
          <div>
            <div className="t">{opportunity.status === "forecasted" ? FORECASTED_LABEL : NOT_TAKING_LABEL}</div>
            <div className="d">
              {opportunity.status === "forecasted"
                ? t("applicationsStep.applicantsCanSeeWhat")
                : t("applicationsStep.applicantsCanFindThis")}
            </div>
          </div>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {t("applicationsStep.quickSetupMakesA")}
      </p>

      {setup.error !== null && <ErrorBanner error={setup.error} title={t("applicationsStep.quickSetupCouldNot")} />}
      {open.error !== null && <ErrorBanner error={open.error} title={t("applicationsStep.applicationsCouldNotBe")} />}
      {result && <Notice tone="ok" title={madeSummary(result).title}>{madeSummary(result).detail}</Notice>}

      {draft && (
        <section aria-labelledby="apps-launch-title" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h3 id="apps-launch-title" style={{ fontSize: "14px" }}>
            {t("applicationsStep.launchChecklist")}
          </h3>
          {check.status === "loading" && <Loading label={t("applicationsStep.checkingWhatIsReady")} />}
          {check.status === "error" && <ErrorBanner error={check.error} onRetry={check.reload} title={t("applicationsStep.theChecklistCouldNot")} />}
          {check.status === "ready" && check.data && <ReadinessChecklist checklist={check.data} />}
        </section>
      )}

      <div className="row wrap" style={{ gap: "8px" }}>
        <button type="button" className={draft ? "btn btn-secondary" : "btn btn-primary"} disabled={setup.state === "saving"} onClick={runSetup}>
          <Wand className="ic" aria-hidden="true" />
          {t("applicationsStep.quickSetup")}
        </button>
        {draft && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || open.state === "saving"}
            aria-describedby="apps-launch-title"
            onClick={async () => {
              if (await open.run(draft.id)) onChanged();
            }}
          >
            {t("applicationsStep.openForApplications")}
          </button>
        )}
        {formId && (
          <Link to={`${base}/forms/${formId}/edit`} className="btn btn-ghost">
            <Pencil className="ic" aria-hidden="true" />
            {t("applicationsStep.editTheApplicationForm")}
          </Link>
        )}
        {competition && (
          <Link to={competitionPath} className="btn btn-ghost">
            <Layers className="ic" aria-hidden="true" />
            {t("applicationsStep.competitionStages")}
          </Link>
        )}
      </div>
      {draft && !ready && check.status === "ready" && <p className="help">{t("applicationsStep.openingIsAvailableWhen")}</p>}
    </>
  );
}
