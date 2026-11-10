// SPDX-License-Identifier: AGPL-3.0-only
// Every application this workspace has started, newest change first.
import { Link } from "react-router";
import { FileText, Search } from "lucide-react";
import type { MyApplication } from "../../api/applicant.ts";
import { useApplicantQuery } from "../../api/applicantHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, closesPhrase, FunderChip, Loaded } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, type Column } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

export default function Applications() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useApplicantQuery((api) => api.applications(), [ws.id]);
  const editable = (a: MyApplication) => a.status === "draft" || a.status === "revision_requested";

  const columns: Column<MyApplication>[] = [
    {
      key: "title",
      header: "Application",
      cell: (a) => (
        <div className="ent">
          <Link to={`${base}/applications/${a.id}${editable(a) ? "/edit" : ""}`} className="nm">
            {a.title}
          </Link>
          <span className="small muted">{a.opportunity.title}</span>
        </div>
      ),
    },
    { key: "funder", header: "Funder", cell: (a) => <FunderChip name={a.funder.name} accent={accentOf(a.funder.brand)} /> },
    { key: "stage", header: "Stage", cell: (a) => a.stage.label },
    { key: "status", header: "Status", cell: (a) => <StatusBadge kind="application" status={a.status} /> },
    {
      key: "when",
      header: "Next date",
      cell: (a) => (editable(a) ? (closesPhrase(a.stage.closes)?.text ?? "—") : a.submittedAt ? `Submitted ${formatDate(a.submittedAt)}` : "—"),
    },
  ];

  return (
    <>
      <title>{`Applications — ${ws.name}`}</title>
      <ApplicantShell active="Applications">
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>Applications</h1>
              </div>
            </div>
            <div className="actions">
              <Link to={`${base}/find`} className="btn btn-primary">
                <Search className="ic" aria-hidden="true" />
                Find funding
              </Link>
            </div>
          </div>
          <Loaded query={query} label="Loading applications">
            {(apps) => (
              <DataTable
                label="Applications"
                columns={columns}
                rows={apps}
                rowKey={(a) => a.id}
                empty={
                  <EmptyState
                    icon={FileText}
                    title="No applications yet"
                    actions={
                      <Link to={`${base}/find`} className="btn btn-primary">
                        Find funding
                      </Link>
                    }
                  >
                    Start one from Find funding; your Passport record fills in what it can.
                  </EmptyState>
                }
              />
            )}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
