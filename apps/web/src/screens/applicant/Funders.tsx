// SPDX-License-Identifier: AGPL-3.0-only
// Funders this organization has a relationship with on the GMS: anyone it has applied to.
import { Link } from "react-router";
import { ExternalLink, Landmark, Search } from "lucide-react";
import type { ApplicantApi, MyFunder } from "../../api/applicant.ts";
import { useApplicantQuery } from "../../api/applicantHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, FunderChip, Loaded } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, type Column } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

const load = async (api: ApplicantApi) => {
  const [funders, applications, awards, consents] = await Promise.all([api.funders(), api.applications(), api.awards(), api.consents()]);
  return { funders, applications, awards, consents };
};

export default function Funders() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useApplicantQuery(load, [ws.id]);

  return (
    <>
      <title>{`Funders — ${ws.name}`}</title>
      <ApplicantShell active="Funders">
        <main className="main">
          <div className="crumbs">
            <Link to={base}>Dashboard</Link>
            <span>›</span>
            <span>Funders</span>
          </div>
          <Loaded query={query} label="Loading funders">
            {({ funders, applications, awards, consents }) => {
              const columns: Column<MyFunder>[] = [
                { key: "name", header: "Funder", cell: (f) => <FunderChip name={f.name} accent={accentOf(f.brand)} />, sort: (f) => f.name },
                { key: "since", header: "Relationship since", cell: (f) => (f.since ? new Date(f.since).getUTCFullYear() : "—"), sort: (f) => f.since },
                { key: "apps", header: "Applications", numeric: true, cell: (f) => f.applications, sort: (f) => f.applications },
                { key: "awards", header: "Awards", numeric: true, cell: (f) => f.awards, sort: (f) => f.awards },
                {
                  key: "access",
                  header: "Reads your Passport record",
                  cell: (f) => (consents.some((c) => c.funder.workspaceId === f.workspaceId && !c.revokedAt) ? <span>Yes · <Link to={`${base}/team`}>manage</Link></span> : <span className="muted">No</span>),
                },
                {
                  key: "page",
                  header: "",
                  cell: (f) => (
                    <Link to={`/f/${f.handle}`} className="small b">
                      Public page <ExternalLink className="ic ic-sm" aria-hidden="true" />
                    </Link>
                  ),
                },
              ];
              return (
                <>
                  <div className="ph">
                    <div>
                      <div className="title">
                        <h1>Funders</h1>
                      </div>
                      <div className="meta">
                        <span>
                          {funders.length} funder{funders.length === 1 ? "" : "s"} you have applied to on the GMS
                        </span>
                      </div>
                    </div>
                    <div className="actions">
                      <Link to={`${base}/find`} className="btn btn-secondary">
                        <Search className="ic" aria-hidden="true" />
                        Find more funding
                      </Link>
                    </div>
                  </div>
                  <DataTable
                    label="Funders"
                    columns={columns}
                    rows={funders}
                    rowKey={(f) => f.workspaceId}
                    empty={
                      <EmptyState icon={Landmark} title="No funders yet">
                        A funder appears here once you start an application with it.
                      </EmptyState>
                    }
                  />
                  {funders.map((f) => {
                    const apps = applications.filter((a) => a.funder.workspaceId === f.workspaceId);
                    const mine = awards.filter((w) => w.funder.workspaceId === f.workspaceId);
                    return (
                      <section className="card" key={f.workspaceId} aria-label={f.name}>
                        <div className="card-h">
                          <div className="row" style={{ gap: "12px" }}>
                            <FunderChip name={f.name} accent={accentOf(f.brand)} />
                            <h2 style={{ fontSize: "18px" }}>History</h2>
                          </div>
                        </div>
                        <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          {apps.map((a) => (
                            <li key={a.id} className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                              <StatusBadge kind="application" status={a.status} />
                              <Link to={`${base}/applications/${a.id}`} className="b">
                                {a.title}
                              </Link>
                              <span className="small muted">
                                {a.stage.label}
                                {a.submittedAt ? ` · submitted ${formatDate(a.submittedAt)}` : ""}
                              </span>
                            </li>
                          ))}
                          {mine.map((w) => (
                            <li key={w.id} className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                              <StatusBadge kind="award" status={w.status} />
                              <Link to={`${base}/grants/${w.id}/offer`} className="b">
                                {w.title}
                              </Link>
                              <span className="small muted">Award</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
