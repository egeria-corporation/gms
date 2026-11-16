// SPDX-License-Identifier: AGPL-3.0-only
// Opportunities: every opportunity in the workspace, with its status and where it leads next. A
// published opportunity with no open competition says so: applicants can find it but not apply.
import { Link } from "react-router";
import { Layers, Plus } from "lucide-react";
import { useApiQuery } from "../../api/hooks.ts";
import type { Opportunity } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { DataTable, EmptyState, ErrorBanner, Loading, PageHeader, type Column } from "../../components/ui.tsx";
import { formatAwardRange, formatDate } from "../../lib/format.ts";
import { OpportunityStatusBadge, publishedNotTaking } from "./applicationsStatus.tsx";
import { t } from "./i18n.ts";

export default function Opportunities() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const data = useApiQuery(async (api) => {
    const [opportunities, programs, competitions] = await Promise.all([api.listOpportunities(), api.listPrograms(), api.listCompetitions()]);
    return { opportunities, programs, competitions };
  }, [ws.id]);
  const programName = (o: Opportunity) => (data.status === "ready" ? (data.data.programs.find((p) => p.id === o.programId)?.name ?? "—") : "—");

  const columns: Column<Opportunity>[] = [
    { key: "title", header: t("funderOpportunities.opportunity"), cell: (o) => <Link to={`${base}/opportunities/${o.id}/edit`} className="b" style={{ color: "#0D2A43" }}>{o.title}</Link>, sort: (o) => o.title },
    { key: "status", header: t("funderOpportunities.status"), cell: (o) => <OpportunityStatusBadge opportunity={o} competitions={data.status === "ready" ? data.data.competitions : undefined} />, sort: (o) => o.status },
    { key: "program", header: t("funderOpportunities.program"), cell: programName, sort: programName },
    { key: "range", header: t("funderOpportunities.awardRange"), cell: (o) => formatAwardRange(o.funding) },
    { key: "closes", header: t("funderOpportunities.closes"), cell: (o) => formatDate(o.keyDates.closeDate?.date), sort: (o) => o.keyDates.closeDate?.date ?? null },
    {
      key: "go",
      header: "",
      numeric: true,
      cell: (o) => (
        <span className="row" style={{ justifyContent: "flex-end", gap: "6px" }}>
          {data.status === "ready" && publishedNotTaking(o, data.data.competitions) && (
            <Link to={`${base}/opportunities/${o.id}/edit#applications`} className="btn btn-sm btn-primary" aria-label={t("funderOpportunities.setUpApplicationsFor", { title: o.title })}>
              {t("funderOpportunities.setUpApplications")}
            </Link>
          )}
          <Link to={`${base}/opportunities/${o.id}/competition`} className="btn btn-sm btn-secondary" aria-label={t("funderOpportunities.competitionFor", { title: o.title })}>
            {t("funderOpportunities.competition")}
          </Link>
          {o.published && (
            <Link to={`/f/${ws.handle}/o/${o.slug}`} className="btn btn-sm btn-ghost" aria-label={t("funderOpportunities.publicPageOf", { title: o.title })}>
              {t("funderOpportunities.publicPage")}
            </Link>
          )}
        </span>
      ),
    },
  ];

  const newButton = (
    <Link to={`${base}/opportunities/new`} className="btn btn-primary">
      <Plus className="ic" aria-hidden="true" />
      {t("funderOpportunities.newOpportunity")}
    </Link>
  );

  return (
    <FunderShell active="Opportunities">
      <title>{t("funderOpportunities.opportunities", { name: ws.name })}</title>
      <main className="main">
        <PageHeader
          crumbs={[{ label: ws.name, to: base }, { label: t("funderOpportunities.opportunities2") }]}
          title={t("funderOpportunities.opportunities2")}
          meta={data.status === "ready" && <span>{t("funderOpportunities.inThisWorkspace", { count: data.data.opportunities.length })}</span>}
          actions={
            <>
              <Link to={`${base}/forms`} className="btn btn-secondary">
                {t("funderOpportunities.forms")}
              </Link>
              {newButton}
            </>
          }
        />
        {data.status === "loading" && <Loading label={t("funderOpportunities.loadingOpportunities")} />}
        {data.status === "error" && <ErrorBanner error={data.error} onRetry={data.reload} title={t("funderOpportunities.opportunitiesCouldNotBe")} />}
        {data.status === "ready" && (
          <DataTable
            label={t("funderOpportunities.opportunities2")}
            rows={data.data.opportunities}
            rowKey={(o) => o.id}
            columns={columns}
            empty={
              <EmptyState icon={Layers} title={t("funderOpportunities.noOpportunitiesYet")} actions={newButton}>
                {t("funderOpportunities.anOpportunityIsWhat")}
              </EmptyState>
            }
          />
        )}
      </main>
    </FunderShell>
  );
}
