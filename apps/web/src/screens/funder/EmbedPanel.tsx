// SPDX-License-Identifier: AGPL-3.0-only
// Publish step of the opportunity builder: the snippet that puts the apply widget on the funder's
// own website, a copy button, and a live preview of the widget as visitors will see it (the same
// card, from the same public data, drawn here rather than framed: this app frames nothing).
import { useMemo, useState } from "react";
import { Code } from "lucide-react";
import { useApiQuery } from "../../api/hooks.ts";
import type { Opportunity } from "../../api/types.ts";
import { CopyButton } from "../../components/CopyButton.tsx";
import { ErrorBanner, Loading, Notice } from "../../components/ui.tsx";
import { EMBED_HEIGHT, embedSnippet } from "../../lib/embed.ts";
import { EmbedCard } from "../public/EmbedWidget.tsx";

export function EmbedPanel({ handle, funderName, opportunity, listed, taking }: { handle: string; funderName: string; opportunity: Opportunity | undefined; listed: boolean; taking: boolean }) {
  const [resize, setResize] = useState(false);
  const live = !!opportunity?.published && listed;
  const slug = opportunity?.slug ?? "";
  // Read again whenever what the widget shows may have changed.
  const preview = useApiQuery(async (api) => (live ? api.publicEmbed(handle, slug) : null), [live, handle, slug, opportunity?.status, opportunity?.updatedAt, taking]);
  const snippet = useMemo(() => (opportunity ? embedSnippet({ origin: window.location.origin, handle, slug, title: opportunity.title, funderName }, { resize }) : ""), [opportunity, handle, slug, funderName, resize]);

  return (
    <section className="card" aria-labelledby="embed-title" style={{ boxShadow: "none" }}>
      <div className="card-h">
        <div>
          <h3 id="embed-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Code className="ic" aria-hidden="true" />
            Embed on your website
          </h3>
          <p className="small muted">A small card with this call, its deadline or status, who can apply and an Apply button that opens your public page in a new tab. It needs no sign-in and sets no cookies.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {!live ? (
          <Notice tone="neu" title="Publish to embed">
            The widget shows what your public page shows, so it works once this opportunity is published with Public page on.
          </Notice>
        ) : (
          <>
            <label className="lbl" htmlFor="embed-code">
              Embed code
            </label>
            <textarea id="embed-code" className="ta embed-code" readOnly value={snippet} rows={resize ? 14 : 4} onFocus={(e) => e.currentTarget.select()} />
            <div className="row wrap" style={{ gap: "12px", alignItems: "center", justifyContent: "space-between" }}>
              <label className="cb" htmlFor="embed-resize">
                <input type="checkbox" id="embed-resize" checked={resize} onChange={(e) => setResize(e.target.checked)} style={{ marginTop: "3px" }} />
                <span>
                  <span className="b">Resize to fit</span>
                  <span className="help" style={{ display: "block" }}>
                    Adds a short script that sets the height from the widget. Without it the frame is {EMBED_HEIGHT} pixels tall.
                  </span>
                </span>
              </label>
              <CopyButton value={snippet} what="the embed code" label="Copy code" />
            </div>
            <div>
              <div className="lbl" style={{ marginBottom: "8px" }}>
                Preview
              </div>
              {preview.status === "loading" && <Loading label="Loading the preview" />}
              {preview.status === "error" && <ErrorBanner error={preview.error} onRetry={preview.reload} title="The preview could not be loaded" />}
              {preview.status === "ready" && preview.data && (
                <div className="embed" role="region" aria-label="Widget preview">
                  <EmbedCard data={preview.data} headingLevel={4} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
