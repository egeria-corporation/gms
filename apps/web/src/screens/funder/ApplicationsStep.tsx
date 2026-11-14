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

function madeSummary(r: QuickSetupResult): { title: string; detail: string } {
  const made = [r.created.competition && "a one-stage competition", r.created.form && "the application form", r.created.rubric && "the rubric"].filter((x): x is string => !!x);
  if (!made.length) return { title: "Already set up", detail: "Quick setup found the competition, form and rubric it made before and kept them as they are." };
  const list = made.length === 1 ? made[0]! : `${made.slice(0, -1).join(", ")} and ${made[made.length - 1]}`;
  return { title: "Quick setup is done", detail: `It made ${list}. Each is a draft you can edit until you open for applications.` };
}

export function ApplicationsStep({ opportunity, competition, base, publicPath, onChanged }: { opportunity: Opportunity | undefined; competition: Competition | undefined; base: string; publicPath: string | null; onChanged: () => void }) {
  const draft = competition?.status === "draft" ? competition : undefined;
  const check = useApiQuery(async (api) => (draft ? api.launchCheck(draft.id) : null), [draft?.id, draft?.updatedAt]);
  const setup = useApiMutation((api, id: string) => api.quickSetup(id));
  const open = useApiMutation((api, id: string) => api.openCompetition(id));
  const [result, setResult] = useState<QuickSetupResult | null>(null);

  if (!opportunity) {
    return (
      <Notice tone="neu" title="Save the opportunity first">
        Quick setup works from a saved opportunity: its title and its opening and closing dates.
      </Notice>
    );
  }
  if (opportunity.status === "closed") {
    return (
      <Notice tone="neu" title="This opportunity is closed">
        It no longer accepts applications.
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
          <div className="d">{competition.title} is open, but the opportunity is published as forecasted, so the public page does not offer Apply. Publish it as open to take applications.</div>
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
            <div className="t">Taking applications</div>
            <div className="d">{competition.title} is open. Applicants can apply from the public page and from Find funding.</div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: "8px" }}>
          {publicPath && opportunity.published && (
            <Link to={publicPath} className="btn btn-secondary">
              <Eye className="ic" aria-hidden="true" />
              Open public page
            </Link>
          )}
          <Link to={competitionPath} className="btn btn-secondary">
            <Layers className="ic" aria-hidden="true" />
            Competition &amp; stages
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
                ? "Applicants can see what is coming but cannot apply. Publish it as open and open a competition to take applications."
                : "Applicants can find this opportunity but cannot apply until a competition is open."}
            </div>
          </div>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Quick setup makes a one-stage competition using your opening and closing dates, a starter application form (project title, summary, amount requested, how the funds will be used, expected outcomes, a budget upload and a contact) and a starter rubric
        (alignment with the opportunity, feasibility, budget and community impact, each scored 1 to 5). It keeps anything you have already set. Everything stays a draft you can edit until you open for applications.
      </p>

      {setup.error !== null && <ErrorBanner error={setup.error} title="Quick setup could not finish" />}
      {open.error !== null && <ErrorBanner error={open.error} title="Applications could not be opened" />}
      {result && <Notice tone="ok" title={madeSummary(result).title}>{madeSummary(result).detail}</Notice>}

      {draft && (
        <section aria-labelledby="apps-launch-title" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h3 id="apps-launch-title" style={{ fontSize: "14px" }}>
            Launch checklist
          </h3>
          {check.status === "loading" && <Loading label="Checking what is ready" />}
          {check.status === "error" && <ErrorBanner error={check.error} onRetry={check.reload} title="The checklist could not be loaded" />}
          {check.status === "ready" && check.data && <ReadinessChecklist checklist={check.data} />}
        </section>
      )}

      <div className="row wrap" style={{ gap: "8px" }}>
        <button type="button" className={draft ? "btn btn-secondary" : "btn btn-primary"} disabled={setup.state === "saving"} onClick={runSetup}>
          <Wand className="ic" aria-hidden="true" />
          Quick setup
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
            Open for applications
          </button>
        )}
        {formId && (
          <Link to={`${base}/forms/${formId}/edit`} className="btn btn-ghost">
            <Pencil className="ic" aria-hidden="true" />
            Edit the application form
          </Link>
        )}
        {competition && (
          <Link to={competitionPath} className="btn btn-ghost">
            <Layers className="ic" aria-hidden="true" />
            Competition &amp; stages
          </Link>
        )}
      </div>
      {draft && !ready && check.status === "ready" && <p className="help">Opening is available when every line of the checklist passes.</p>}
    </>
  );
}
