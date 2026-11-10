// SPDX-License-Identifier: AGPL-3.0-only
// Opportunities: every opportunity in the workspace, with its status and where it leads next.
import { Link } from "react-router";
import { Layers, Plus } from "lucide-react";
import { useApiQuery } from "../../api/hooks.ts";
import type { Opportunity } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, ErrorBanner, Loading, PageHeader, type Column } from "../../components/ui.tsx";
import { formatAwardRange, formatDate } from "../../lib/format.ts";

export default function Opportunities() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const data = useApiQuery(async (api) => {
    const [opportunities, programs] = await Promise.all([api.listOpportunities(), api.listPrograms()]);
    return { opportunities, programs };
  }, [ws.id]);
  const programName = (o: Opportunity) => (data.status === "ready" ? (data.data.programs.find((p) => p.id === o.programId)?.name ?? "—") : "—");

  const columns: Column<Opportunity>[] = [
    { key: "title", header: "Opportunity", cell: (o) => <Link to={`${base}/opportunities/${o.id}/edit`} className="b" style={{ color: "#0D2A43" }}>{o.title}</Link>, sort: (o) => o.title },
    { key: "status", header: "Status", cell: (o) => <StatusBadge kind="opportunity" status={o.status} label={o.published ? undefined : "Draft"} />, sort: (o) => o.status },
    { key: "program", header: "Program", cell: programName, sort: programName },
    { key: "range", header: "Award range", cell: (o) => formatAwardRange(o.funding) },
    { key: "closes", header: "Closes", cell: (o) => formatDate(o.keyDates.closeDate?.date), sort: (o) => o.keyDates.closeDate?.date ?? null },
    {
      key: "go",
      header: "",
      numeric: true,
      cell: (o) => (
        <span className="row" style={{ justifyContent: "flex-end", gap: "6px" }}>
          <Link to={`${base}/opportunities/${o.id}/competition`} className="btn btn-sm btn-secondary" aria-label={`Competition for ${o.title}`}>
            Competition
          </Link>
          {o.published && (
            <Link to={`/f/${ws.handle}/o/${o.slug}`} className="btn btn-sm btn-ghost" aria-label={`Public page of ${o.title}`}>
              Public page
            </Link>
          )}
        </span>
      ),
    },
  ];

  const newButton = (
    <Link to={`${base}/opportunities/new`} className="btn btn-primary">
      <Plus className="ic" aria-hidden="true" />
      New opportunity
    </Link>
  );

  return (
    <FunderShell active="Opportunities">
      <title>{`Opportunities — ${ws.name}`}</title>
      <main className="main">
        <PageHeader
          crumbs={[{ label: ws.name, to: base }, { label: "Opportunities" }]}
          title="Opportunities"
          meta={data.status === "ready" && <span>{data.data.opportunities.length} in this workspace</span>}
          actions={
            <>
              <Link to={`${base}/forms`} className="btn btn-secondary">
                Forms
              </Link>
              {newButton}
            </>
          }
        />
        {data.status === "loading" && <Loading label="Loading opportunities" />}
        {data.status === "error" && <ErrorBanner error={data.error} onRetry={data.reload} title="Opportunities could not be loaded" />}
        {data.status === "ready" && (
          <DataTable
            label="Opportunities"
            rows={data.data.opportunities}
            rowKey={(o) => o.id}
            columns={columns}
            empty={
              <EmptyState icon={Layers} title="No opportunities yet" actions={newButton}>
                An opportunity is what applicants find and apply to: what you fund, how much, who can apply and when.
              </EmptyState>
            }
          />
        )}
      </main>
    </FunderShell>
  );
}
