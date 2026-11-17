// SPDX-License-Identifier: AGPL-3.0-only
// `/templates` — the public template gallery: application forms, rubrics, report forms, email
// templates and program kits any funder can copy into its own workspace. No sign-in to browse.
// Filters by kind and tag, and a search over titles, summaries and tags, kept in the address so a
// filtered view can be shared.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { LayoutTemplate, Search, ShieldCheck, Users } from "lucide-react";
import { GALLERY_KINDS, KIND_PLURAL, LICENCE, type GalleryKind, type GalleryList } from "../../api/gallery.ts";
import { useGalleryApi, useGalleryQuery } from "../../api/galleryHooks.ts";
import { useServices } from "../../app/services.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";
import { AuthorLine, GalleryFrame, KindBadge, TagList } from "./galleryParts.tsx";

const isKind = (v: string | null): v is GalleryKind => !!v && (GALLERY_KINDS as string[]).includes(v);

function ModeratorLink() {
  const { sessionState } = useServices();
  const api = useGalleryApi();
  const [moderator, setModerator] = useState(false);
  useEffect(() => {
    if (sessionState.status !== "signedIn") return;
    let live = true;
    api.isModerator().then(
      (m) => live && setModerator(m),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, sessionState.status]);
  if (!moderator) return null;
  return (
    <Link to="/gallery/moderation" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }}>
      <ShieldCheck className="ic" aria-hidden="true" />
      Review shared templates
    </Link>
  );
}

export default function Gallery() {
  const [params, setParams] = useSearchParams();
  const kindParam = params.get("kind");
  const kind = isKind(kindParam) ? kindParam : undefined;
  const tag = params.get("tag") ?? "";
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  const list = useGalleryQuery<GalleryList>((api) => api.list({ ...(kind ? { kind } : {}), ...(tag ? { tag } : {}), ...(q ? { q } : {}) }), [kind, tag, q]);

  const update = (key: "kind" | "tag" | "q", value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const vocabulary = list.data?.tags;

  return (
    <>
      <title>Template gallery — OpenGrants GMS</title>
      <meta name="description" content="Free, ready-to-use grant application forms, rubrics, report forms and email templates. Copy one into your workspace and start in minutes." />
      <GalleryFrame>
        <section style={{ background: "var(--grad-hero)", paddingTop: "40px", paddingBottom: "32px" }}>
          <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <span className="og-eyebrow" style={{ color: "var(--og-teal-dark)" }}>
              <LayoutTemplate className="ic" aria-hidden="true" />
              Template gallery
            </span>
            <h1 style={{ fontSize: "36px", maxWidth: "760px", color: "var(--og-navy-dark)" }}>Ready-to-use templates for running a grant program</h1>
            <p style={{ fontSize: "17px", maxWidth: "720px", lineHeight: 1.6 }}>
              Application forms, scoring rubrics, report forms and emails, written in plain and kind language. Preview any of them, then copy it into your workspace and change what you need. Every template is free under {LICENCE.name}.
            </p>
            <ModeratorLink />
          </div>
        </section>

        <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "18px", paddingTop: "24px", paddingBottom: "48px" }}>
          <form
            role="search"
            aria-label="Find a template"
            className="filterbar"
            onSubmit={(e) => {
              e.preventDefault();
              update("q", text.trim() || undefined);
            }}
          >
            <label className="sr" htmlFor="gallery-q">
              Search templates
            </label>
            <span className="search" style={{ flex: "1 1 280px", maxWidth: "420px" }}>
              <Search className="ic" aria-hidden="true" />
              <input id="gallery-q" type="search" placeholder="Search templates" value={text} onChange={(e) => setText(e.target.value)} />
            </span>
            <button type="submit" className="btn btn-secondary">
              Search
            </button>
            <label className="sr" htmlFor="gallery-tag">
              Tag
            </label>
            <select id="gallery-tag" className="sel" style={{ width: "auto" }} value={tag} onChange={(e) => update("tag", e.target.value || undefined)}>
              <option value="">Any tag</option>
              {vocabulary && (
                <>
                  <optgroup label="Field of work">
                    {vocabulary.fieldOfWork.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Grant size">
                    {vocabulary.grantSize.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Audience">
                    {vocabulary.audience.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </optgroup>
                </>
              )}
            </select>
          </form>
          <div className="filterbar" role="group" aria-label="Kind of template">
            <button type="button" className={kind ? "fchip" : "fchip on"} aria-pressed={!kind} onClick={() => update("kind", undefined)}>
              All
            </button>
            {GALLERY_KINDS.map((k) => (
              <button key={k} type="button" className={kind === k ? "fchip on" : "fchip"} aria-pressed={kind === k} onClick={() => update("kind", kind === k ? undefined : k)}>
                {KIND_PLURAL[k]}
              </button>
            ))}
          </div>

          {list.status === "loading" && <Loading label="Loading templates" />}
          {list.status === "error" && <ErrorBanner error={list.error} onRetry={list.reload} title="The gallery could not be loaded" />}
          {list.status === "ready" && (
            <>
              <p className="small muted" role="status">
                {list.data.total === 1 ? "1 template" : `${list.data.total} templates`}
              </p>
              {list.data.items.length === 0 ? (
                <EmptyState icon={LayoutTemplate} title="No templates match">
                  Try fewer words, or another kind or tag.
                </EmptyState>
              ) : (
                <ul aria-label="Templates" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "16px" }}>
                  {list.data.items.map((item) => (
                    <li key={item.slug} className="card" style={{ display: "flex", flexDirection: "column" }}>
                      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                        <KindBadge kind={item.kind} />
                        <h2 style={{ fontSize: "17px", margin: 0 }}>
                          <Link to={`/templates/${item.slug}`}>{item.title}</Link>
                        </h2>
                        <p className="small" style={{ lineHeight: 1.55, margin: 0 }}>
                          {item.summary}
                        </p>
                        <TagList tags={item.tags} />
                      </div>
                      <div className="card-f" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                        <AuthorLine author={item.author} />
                        <span className="row small muted" style={{ gap: "4px" }}>
                          <Users className="ic ic-sm" aria-hidden="true" />
                          {item.usesCount === 1 ? "Used once" : `Used ${item.usesCount} times`}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </GalleryFrame>
    </>
  );
}
