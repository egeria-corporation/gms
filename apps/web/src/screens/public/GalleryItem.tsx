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

/** Roles that can make forms, rubrics and email templates in a funder workspace. */
export const COPY_ROLES = ["admin", "program_officer"];

function hrefOf(handle: string, c: GalleryCopyResult["created"][number]): { to: string; label: string } {
  if (c.type === "form") return { to: `/w/${handle}/forms/${c.id}/edit`, label: "Open the draft form" };
  if (c.type === "rubric") return { to: `/w/${handle}/opportunities`, label: "Choose it on a competition stage" };
  return { to: `/w/${handle}/communications`, label: "Open in Communications" };
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
        <h2 id="gallery-copy-title">{done ? "Copied to your workspace" : "Use this template"}</h2>
      </div>
      <div className="bd" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {copy.error !== null && <ErrorBanner error={copy.error} title="The template could not be copied" />}
        {done ? (
          <>
            <p className="row" style={{ gap: "8px" }}>
              <CircleCheck className="ic" aria-hidden="true" />
              {done.result.created.length === 1 ? "It is now yours to change" : `${done.result.created.length} new records are now yours to change`} in {done.ws.name}. Nothing you change reaches the gallery.
            </p>
            <ul aria-label="What was copied" style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {done.result.created.map((c) => {
                const link = hrefOf(done.ws.handle, c);
                return (
                  <li key={`${c.type}-${c.id}`}>
                    <span className="b">{c.title}</span> <span className="muted">({c.type === "form" ? (c.purpose === "report" ? "draft report form" : "draft application form") : c.type === "rubric" ? "rubric" : "email template"})</span> · <Link to={link.to}>{link.label}</Link>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <p>
              We will add a copy of <span className="b">{item.title}</span> to your workspace{item.snapshot.forms.length ? " as a draft" : ""}. You can change anything before you use it.
            </p>
            {workspaces.length > 1 ? (
              <div className="fld">
                <label className="lbl" htmlFor="gallery-copy-ws">
                  Workspace
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
              <p className="small muted">Workspace: {target.name}</p>
            )}
            <LicenceNote author={item.author} />
          </>
        )}
      </div>
      <div className="ft">
        {done ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={go} disabled={copy.state === "saving"}>
              <Copy className="ic" aria-hidden="true" />
              Copy to {target.name}
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
          Use this template
          <ArrowRight className="ic" aria-hidden="true" />
        </button>
        <p className="small muted">Free. Sign up or sign in with your email, and you will come back here to copy it.</p>
      </>
    );
  } else if (sessionState.status === "loading" || meState.status !== "ready") {
    action = <Loading label="Checking your workspaces" />;
  } else if (copyable.length) {
    action = (
      <button type="button" className="btn btn-primary btn-block" onClick={() => setOpen(true)}>
        <Copy className="ic" aria-hidden="true" />
        Use this template
      </button>
    );
  } else if (funders.length) {
    action = <p className="small">Your role in {funders.map((f) => f.name).join(" and ")} cannot add templates. An admin or a program officer can copy it.</p>;
  } else {
    // An applicant workspace has no forms, rubrics or email templates of its own: no button.
    action = (
      <p className="small">
        Templates are copied into a funder workspace. <Link to="/onboarding/funder/organization">Set up a funder workspace</Link> to use them.
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
        <div className="wrap-c" style={{ padding: "32px 0" }}>
          <Loading label="Loading the template" />
        </div>
      )}
      {item.status === "error" && (
        <div className="wrap-c" style={{ padding: "32px 0" }}>
          <ErrorBanner error={item.error} onRetry={item.reload} title="The template could not be loaded" />
        </div>
      )}
      {item.status === "ready" && <ItemPage item={item.data} />}
    </GalleryFrame>
  );
}

function ItemPage({ item }: { item: Item }) {
  const c = item.contents;
  const parts = [c.forms ? `${c.forms} form${c.forms === 1 ? "" : "s"}${c.questions ? ` (${c.questions} questions)` : ""}` : null, c.rubrics ? "a rubric" : null, c.emails ? `${c.emails} email${c.emails === 1 ? "" : "s"}` : null].filter(Boolean);
  return (
    <>
      <title>{`${item.title} — Template gallery — OpenGrants GMS`}</title>
      <meta name="description" content={item.summary} />
      <section style={{ background: "var(--grad-hero)", padding: "28px 0 24px" }}>
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <nav aria-label="Breadcrumb" className="crumbs">
            <Link to="/templates" className="row" style={{ gap: "4px" }}>
              <ArrowLeft className="ic ic-sm" aria-hidden="true" />
              Template gallery
            </Link>
          </nav>
          <KindBadge kind={item.kind} />
          <h1 style={{ fontSize: "32px", maxWidth: "780px", color: "var(--og-navy-dark)" }}>{item.title}</h1>
          <p style={{ fontSize: "17px", maxWidth: "720px", lineHeight: 1.6 }}>{item.summary}</p>
          <AuthorLine author={item.author} />
        </div>
      </section>
      {/* wrap-reverse: on a narrow screen the panel with "Use this template" comes first. */}
      <div className="wrap-c" style={{ display: "flex", flexWrap: "wrap-reverse", gap: "24px", alignItems: "flex-start", padding: "24px 0 48px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, flex: "1 1 520px" }}>
          <h2 style={{ fontSize: "18px" }}>Preview</h2>
          <p className="small muted">This is exactly what you get. Nothing here can be filled in; copy it to make it yours.</p>
          <SnapshotPreview snapshot={item.snapshot} />
        </div>
        <aside className="card" aria-label="About this template" style={{ flex: "1 1 260px", maxWidth: "360px" }}>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <UsePanel item={item} />
            <dl className="kv small" style={{ margin: 0, gridTemplateColumns: "88px minmax(0, 1fr)" }}>
              <dt>Kind</dt>
              <dd>{KIND_LABEL[item.kind]}</dd>
              <dt>Includes</dt>
              <dd>{parts.join(", ")}</dd>
              <dt>Version</dt>
              <dd>v{item.version}</dd>
              <dt>Published</dt>
              <dd>{formatDate(item.publishedAt)}</dd>
              <dt>Used</dt>
              <dd>{item.usesCount === 1 ? "once" : `${item.usesCount} times`}</dd>
            </dl>
            <TagList tags={item.tags} />
            <LicenceNote author={item.author} />
            <p className="small muted row" style={{ gap: "6px" }}>
              <LayoutTemplate className="ic ic-sm" aria-hidden="true" />A copy is yours: later changes to this template never change it.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
