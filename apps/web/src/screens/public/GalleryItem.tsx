// SPDX-License-Identifier: AGPL-3.0-only
// `/templates/:slug` — one gallery item: a read-only preview of its forms (in the form renderer),
// rubric criteria and email text, who shared it, its licence, and "Use this template". A signed-out
// visitor is sent to sign up and comes back here with the copy dialog open. Copying is for funder
// workspaces whose role can make forms; anyone else sees why not.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, ArrowRight, CircleCheck, Copy, LayoutTemplate } from "lucide-react";
import { ApiError, type MeWorkspace } from "../../api/client.ts";
import { KIND_LABEL, type GalleryCopyResult, type GalleryItem as Item } from "../../api/gallery.ts";
import { useGalleryMutation, useGalleryQuery } from "../../api/galleryHooks.ts";
import { useServices } from "../../app/services.tsx";
import { signInPath } from "../../auth/RequireAuth.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { ErrorBanner, Loading } from "../../components/ui.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { formatDate } from "../../lib/format.ts";
import { AuthorLine, GalleryFrame, KindBadge, LicenceNote, SnapshotPreview, TagList } from "./galleryParts.tsx";

import { getLocale, translator } from "../../i18n/index.tsx";
import { formatList } from "@gms/i18n";


const t = translator("public");
/** Roles that can make forms, rubrics and email templates in a funder workspace. */
export const COPY_ROLES = ["admin", "program_officer"];

function hrefOf(handle: string, c: GalleryCopyResult["created"][number]): { to: string; label: string } {
  if (c.type === "form") return { to: `/w/${handle}/forms/${c.id}/edit`, label: t("galleryItem.openTheDraftForm") };
  if (c.type === "rubric") return { to: `/w/${handle}/opportunities`, label: t("galleryItem.chooseItOnACompetition") };
  return { to: `/w/${handle}/communications`, label: t("galleryItem.openInCommunications") };
}

function CopyDialog({ item, workspaces, onClose }: { item: Item; workspaces: MeWorkspace[]; onClose: () => void }) {
  const [wsId, setWsId] = useState(workspaces[0]!.id);
  const copy = useGalleryMutation((api, workspaceId: string) => api.copy(workspaceId, item.slug));
  const [done, setDone] = useState<{ result: GalleryCopyResult; ws: MeWorkspace } | null>(null);
  const target = workspaces.find((w) => w.id === wsId) ?? workspaces[0]!;
  const go = async () => {
    const result = await copy.run(target.id);
    if (result) setDone({ result, ws: target });
  };
  return (
    <Dialog open onClose={onClose} labelledBy="gallery-copy-title">
      <div className="hd">
        <h2 id="gallery-copy-title">{done ? t("galleryItem.copiedToYourWorkspace") : t("galleryItem.useThisTemplate")}</h2>
      </div>
      <div className="bd" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {copy.error !== null && <ErrorBanner error={copy.error} title={t("galleryItem.theTemplateCouldNotBe")} />}
        {done ? (
          <>
            <p className="row" style={{ gap: "8px" }}>
              <CircleCheck className="ic" aria-hidden="true" />
              {t("galleryItem.nowYours", { count: done.result.created.length, workspace: done.ws.name })}
            </p>
            <ul aria-label={t("galleryItem.whatWasCopied")} style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {done.result.created.map((c) => {
                const link = hrefOf(done.ws.handle, c);
                return (
                  <li key={`${c.type}-${c.id}`}>
                    <span className="b">{c.title}</span> <span className="muted">{t("galleryItem.copiedKind", { kind: c.type === "form" ? (c.purpose === "report" ? t("galleryItem.draftReportForm") : t("galleryItem.draftApplicationForm")) : c.type === "rubric" ? t("galleryItem.rubric") : t("galleryItem.emailTemplate") })}</span> · <Link to={link.to}>{link.label}</Link>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <p>
              {t.rich(item.snapshot.forms.length ? "galleryItem.weWillAddADraftCopy" : "galleryItem.weWillAddACopy", { title: item.title, b: (chunks) => <span className="b">{chunks}</span> })}
            </p>
            {workspaces.length > 1 ? (
              <div className="fld">
                <label className="lbl" htmlFor="gallery-copy-ws">
                  {t("galleryItem.workspace")}
                </label>
                <select id="gallery-copy-ws" className="sel" value={wsId} onChange={(e) => setWsId(e.target.value)}>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="small muted">{t("galleryItem.workspace2", { name: target.name })}</p>
            )}
            <LicenceNote author={item.author} />
          </>
        )}
      </div>
      <div className="ft">
        {done ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("galleryItem.done")}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("galleryItem.cancel")}
            </button>
            <button type="button" className="btn btn-primary" onClick={go} disabled={copy.state === "saving"}>
              <Copy className="ic" aria-hidden="true" />
              {t("galleryItem.copyTo", { name: target.name })}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

function UsePanel({ item }: { item: Item }) {
  const { sessionState, meState } = useServices();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const here = `/templates/${item.slug}`;
  const funders = meState.status === "ready" ? meState.me.workspaces.filter((w) => w.kind === "funder") : [];
  const copyable = funders.filter((w) => COPY_ROLES.includes(w.role));
  const wantsToUse = params.get("use") === "1";

  // Back from sign-up with "use" in the address: open the dialog once, then forget the flag.
  useEffect(() => {
    if (!wantsToUse || sessionState.status !== "signedIn" || meState.status !== "ready") return;
    if (copyable.length) setOpen(true);
    const next = new URLSearchParams(params);
    next.delete("use");
    setParams(next, { replace: true });
  }, [wantsToUse, sessionState.status, meState.status, copyable.length, params, setParams]);

  let action: ReactNode;
  if (sessionState.status === "signedOut") {
    action = (
      <>
        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(signInPath(`${here}?use=1`))}>
          {t("galleryItem.useThisTemplate")}
          <ArrowRight className="ic" aria-hidden="true" />
        </button>
        <p className="small muted">{t("galleryItem.freeSignUpOrSign")}</p>
      </>
    );
  } else if (sessionState.status === "loading" || meState.status !== "ready") {
    action = <Loading label={t("galleryItem.checkingYourWorkspaces")} />;
  } else if (copyable.length) {
    action = (
      <button type="button" className="btn btn-primary btn-block" onClick={() => setOpen(true)}>
        <Copy className="ic" aria-hidden="true" />
        {t("galleryItem.useThisTemplate")}
      </button>
    );
  } else if (funders.length) {
    action = <p className="small">{t("galleryItem.yourRoleInCannotAdd", { join: formatList(getLocale(), funders.map((f) => f.name)) })}</p>;
  } else {
    // An applicant workspace has no forms, rubrics or email templates of its own: no button.
    action = (
      <p className="small">
        {t.rich("galleryItem.templatesAreCopiedIntoA", { link: (chunks) => <Link to="/onboarding/funder/organization">{chunks}</Link> })}
      </p>
    );
  }
  return (
    <>
      {action}
      {open && copyable.length > 0 && <CopyDialog item={item} workspaces={copyable} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function GalleryItem() {
  const { slug = "" } = useParams();
  const item = useGalleryQuery((api) => api.item(slug), [slug]);
  if (item.status === "error" && item.error instanceof ApiError && item.error.status === 404) return <NotFound />;
  return (
    <GalleryFrame>
      {item.status === "loading" && (
        <div className="wrap-c" style={{ paddingTop: "32px", paddingBottom: "32px" }}>
          <Loading label={t("galleryItem.loadingTheTemplate")} />
        </div>
      )}
      {item.status === "error" && (
        <div className="wrap-c" style={{ paddingTop: "32px", paddingBottom: "32px" }}>
          <ErrorBanner error={item.error} onRetry={item.reload} title={t("galleryItem.theTemplateCouldNotBe2")} />
        </div>
      )}
      {item.status === "ready" && <ItemPage item={item.data} />}
    </GalleryFrame>
  );
}

function ItemPage({ item }: { item: Item }) {
  const c = item.contents;
  const parts = [
    c.forms ? (c.questions ? t("galleryItem.formsWithQuestions", { count: c.forms, questions: c.questions }) : t("galleryItem.forms", { count: c.forms })) : null,
    c.rubrics ? t("galleryItem.aRubric") : null,
    c.emails ? t("galleryItem.emails", { count: c.emails }) : null,
  ].filter((p): p is string => !!p);
  return (
    <>
      <title>{t("galleryItem.templateGalleryOpengrantsGms", { title: item.title })}</title>
      <meta name="description" content={item.summary} />
      <section style={{ background: "var(--grad-hero)", paddingTop: "28px", paddingBottom: "24px" }}>
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <nav aria-label={t("galleryItem.breadcrumb")} className="crumbs">
            <Link to="/templates" className="row" style={{ gap: "4px" }}>
              <ArrowLeft className="ic ic-sm" aria-hidden="true" />
              {t("galleryItem.templateGallery")}
            </Link>
          </nav>
          <KindBadge kind={item.kind} />
          <h1 style={{ fontSize: "32px", maxWidth: "780px", color: "var(--og-navy-dark)" }}>{item.title}</h1>
          <p style={{ fontSize: "17px", maxWidth: "720px", lineHeight: 1.6 }}>{item.summary}</p>
          <AuthorLine author={item.author} />
        </div>
      </section>
      {/* wrap-reverse: on a narrow screen the panel with "Use this template" comes first. */}
      <div className="wrap-c" style={{ display: "flex", flexWrap: "wrap-reverse", gap: "24px", alignItems: "start", paddingTop: "24px", paddingBottom: "48px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, flex: "1 1 520px" }}>
          <h2 style={{ fontSize: "18px" }}>{t("galleryItem.preview")}</h2>
          <p className="small muted">{t("galleryItem.thisIsExactlyWhatYou")}</p>
          <SnapshotPreview snapshot={item.snapshot} />
        </div>
        <aside className="card" aria-label={t("galleryItem.aboutThisTemplate")} style={{ flex: "1 1 260px", maxWidth: "360px" }}>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <UsePanel item={item} />
            <dl className="kv small" style={{ margin: 0, gridTemplateColumns: "88px minmax(0, 1fr)" }}>
              <dt>{t("galleryItem.kind")}</dt>
              <dd>{KIND_LABEL[item.kind]}</dd>
              <dt>{t("galleryItem.includes")}</dt>
              <dd>{formatList(getLocale(), parts)}</dd>
              <dt>{t("galleryItem.version")}</dt>
              <dd>{t("galleryItem.v", { version: item.version })}</dd>
              <dt>{t("galleryItem.published")}</dt>
              <dd>{formatDate(item.publishedAt)}</dd>
              <dt>{t("galleryItem.used")}</dt>
              <dd>{t("galleryItem.uses", { count: item.usesCount })}</dd>
            </dl>
            <TagList tags={item.tags} />
            <LicenceNote author={item.author} />
            <p className="small muted row" style={{ gap: "6px" }}>
              <LayoutTemplate className="ic ic-sm" aria-hidden="true" />{t("galleryItem.aCopyIsYoursLater")}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
