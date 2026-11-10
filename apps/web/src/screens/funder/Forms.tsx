// SPDX-License-Identifier: AGPL-3.0-only
// Forms: the workspace's forms and the shared library to start from. A library form is copied
// into the workspace; it is never edited in place.
import { useNavigate, Link } from "react-router";
import { FileText, Plus } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { FormInput, FormSummary } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, ErrorBanner, Loading, PageHeader, type Column } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

const PURPOSE: Record<string, string> = { application: "Application", loi: "Letter of intent", report: "Report", amendment: "Amendment", site_visit: "Site visit", other: "Other" };

export default function Forms() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const navigate = useNavigate();
  const data = useApiQuery(async (api) => {
    const [forms, library] = await Promise.all([api.listForms(), api.listFormLibrary()]);
    return { forms, library };
  }, [ws.id]);
  const create = useApiMutation((api, input: FormInput) => api.createForm(input));
  const start = async (input: FormInput) => {
    const form = await create.run(input);
    if (form) navigate(`${base}/forms/${form.id}/edit`);
  };

  const own: Column<FormSummary>[] = [
    { key: "title", header: "Form", cell: (f) => <Link to={`${base}/forms/${f.id}/edit`} className="b" style={{ color: "#0D2A43" }}>{f.title}</Link>, sort: (f) => f.title },
    { key: "purpose", header: "Used for", cell: (f) => PURPOSE[f.purpose] ?? f.purpose, sort: (f) => f.purpose },
    { key: "version", header: "Latest version", cell: (f) => <span className="tag">v{f.version}</span>, sort: (f) => f.version },
    { key: "status", header: "Status", cell: (f) => <StatusBadge kind="form" status={f.status} /> },
    { key: "updated", header: "Updated", cell: (f) => formatDate(f.updatedAt), sort: (f) => f.updatedAt },
  ];
  const library: Column<FormSummary>[] = [
    { key: "title", header: "Library form", cell: (f) => <span className="b" style={{ color: "#0D2A43" }}>{f.title}</span>, sort: (f) => f.title },
    { key: "about", header: "What it covers", cell: (f) => <span style={{ whiteSpace: "normal" }}>{f.description ?? "—"}</span> },
    { key: "purpose", header: "Used for", cell: (f) => PURPOSE[f.purpose] ?? f.purpose },
    {
      key: "use",
      header: "",
      numeric: true,
      cell: (f) => (
        <button type="button" className="btn btn-sm btn-secondary" disabled={create.state === "saving"} onClick={() => start({ title: f.title, purpose: f.purpose, description: f.description, copyFrom: { id: f.id, version: f.version } })}>
          Start from this<span className="sr">: {f.title}</span>
        </button>
      ),
    },
  ];
  const blank = (
    <button type="button" className="btn btn-primary" disabled={create.state === "saving"} onClick={() => start({ title: "Untitled form" })}>
      <Plus className="ic" aria-hidden="true" />
      New blank form
    </button>
  );

  return (
    <FunderShell active="Opportunities">
      <title>{`Forms — ${ws.name}`}</title>
      <main className="main">
        <PageHeader crumbs={[{ label: ws.name, to: base }, { label: "Opportunities", to: `${base}/opportunities` }, { label: "Forms" }]} title="Forms" meta={<span>Application, report and letter-of-intent forms. Competitions pin a published version.</span>} actions={blank} />
        {create.error !== null && <ErrorBanner error={create.error} title="The form could not be created" />}
        {data.status === "loading" && <Loading label="Loading forms" />}
        {data.status === "error" && <ErrorBanner error={data.error} onRetry={data.reload} title="Forms could not be loaded" />}
        {data.status === "ready" && (
          <>
            <DataTable
              label="Your forms"
              rows={data.data.forms}
              rowKey={(f) => f.id}
              columns={own}
              empty={
                <EmptyState icon={FileText} title="No forms yet" actions={blank}>
                  Build a form from scratch, or start from a library form below and change what you need.
                </EmptyState>
              }
            />
            <h2 style={{ marginTop: "8px" }}>Shared library</h2>
            <DataTable label="Shared library forms" rows={data.data.library} rowKey={(f) => f.id} columns={library} empty={<EmptyState icon={FileText} title="The shared library is empty" />} />
          </>
        )}
      </main>
    </FunderShell>
  );
}
