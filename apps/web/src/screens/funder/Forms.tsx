// SPDX-License-Identifier: AGPL-3.0-only
// Forms: the workspace's forms and the shared library to start from. A library form is copied
// into the workspace; it is never edited in place.
import { useNavigate, Link } from "react-router";
import { FileText, LayoutTemplate, Plus } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { FormInput, FormPurpose, FormSummary } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { DataTable, EmptyState, ErrorBanner, Loading, PageHeader, type Column } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { GallerySubmissionsPanel } from "./ShareToGallery.tsx";
import { PURPOSE_LABEL } from "./shared.tsx";
import { t, useFunderMessages } from "./i18n.ts";

const purposeLabel = (purpose: string) => PURPOSE_LABEL[purpose as FormPurpose]?.() ?? purpose;

export default function Forms() {
  useFunderMessages();
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
    { key: "title", header: t("funderForms.form"), cell: (f) => <Link to={`${base}/forms/${f.id}/edit`} className="b" style={{ color: "#0D2A43" }}>{f.title}</Link>, sort: (f) => f.title },
    { key: "purpose", header: t("funderForms.usedFor"), cell: (f) => purposeLabel(f.purpose), sort: (f) => f.purpose },
    { key: "version", header: t("funderForms.latestVersion"), cell: (f) => <span className="tag">{t("funderForms.v", { version: f.version })}</span>, sort: (f) => f.version },
    { key: "status", header: t("funderForms.status"), cell: (f) => <StatusBadge kind="form" status={f.status} /> },
    { key: "updated", header: t("funderForms.updated"), cell: (f) => formatDate(f.updatedAt), sort: (f) => f.updatedAt },
  ];
  const library: Column<FormSummary>[] = [
    { key: "title", header: t("funderForms.libraryForm"), cell: (f) => <span className="b" style={{ color: "#0D2A43" }}>{f.title}</span>, sort: (f) => f.title },
    { key: "about", header: t("funderForms.whatItCovers"), cell: (f) => <span style={{ whiteSpace: "normal" }}>{f.description ?? "—"}</span> },
    { key: "purpose", header: t("funderForms.usedFor"), cell: (f) => purposeLabel(f.purpose) },
    {
      key: "use",
      header: "",
      numeric: true,
      cell: (f) => (
        <button type="button" className="btn btn-sm btn-secondary" disabled={create.state === "saving"} onClick={() => start({ title: f.title, purpose: f.purpose, description: f.description, copyFrom: { id: f.id, version: f.version } })}>
          {t.rich("funderForms.startFromThis", { title: f.title, span: (chunks) => <span className="sr">{chunks}</span> })}
        </button>
      ),
    },
  ];
  const blank = (
    <button type="button" className="btn btn-primary" disabled={create.state === "saving"} onClick={() => start({ title: t("funderForms.untitledForm") })}>
      <Plus className="ic" aria-hidden="true" />
      {t("funderForms.newBlankForm")}
    </button>
  );
  // More ready-made forms, rubrics and emails to start from: the public template gallery.
  const gallery = (
    <Link to="/templates" className="btn btn-secondary">
      <LayoutTemplate className="ic" aria-hidden="true" />
      {t("funderForms.templateGallery")}
    </Link>
  );

  return (
    <FunderShell active="Opportunities">
      <title>{t("funderForms.forms", { name: ws.name })}</title>
      <main className="main">
        <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("funderForms.opportunities"), to: `${base}/opportunities` }, { label: t("funderForms.forms2") }]} title={t("funderForms.forms2")} meta={<span>{t("funderForms.applicationReportAndLetter")}</span>} actions={<>{gallery}{blank}</>} />
        {create.error !== null && <ErrorBanner error={create.error} title={t("funderForms.theFormCouldNot")} />}
        {data.status === "loading" && <Loading label={t("funderForms.loadingForms")} />}
        {data.status === "error" && <ErrorBanner error={data.error} onRetry={data.reload} title={t("funderForms.formsCouldNotBe")} />}
        {data.status === "ready" && (
          <>
            <DataTable
              label={t("funderForms.yourForms")}
              rows={data.data.forms}
              rowKey={(f) => f.id}
              columns={own}
              empty={
                <EmptyState icon={FileText} title={t("funderForms.noFormsYet")} actions={blank}>
                  {t("funderForms.buildAFormFrom")}
                </EmptyState>
              }
            />
            <h2 style={{ marginTop: "8px" }}>{t("funderForms.sharedLibrary")}</h2>
            <DataTable label={t("funderForms.sharedLibraryForms")} rows={data.data.library} rowKey={(f) => f.id} columns={library} empty={<EmptyState icon={FileText} title={t("funderForms.theSharedLibraryIs")} />} />
            <GallerySubmissionsPanel />
          </>
        )}
      </main>
    </FunderShell>
  );
}
