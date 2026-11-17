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
import { t } from "./i18n.ts";
import { usePublicMessages } from "../../i18n/index.tsx";

export function EmbedPanel({ handle, funderName, opportunity, listed, taking }: { handle: string; funderName: string; opportunity: Opportunity | undefined; listed: boolean; taking: boolean }) {
  // The preview is the public widget's card (screens/public/EmbedWidget.tsx); OpportunityBuilder loads its messages with the screen.
  usePublicMessages();
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
            {t("embedPanel.embedOnYourWebsite")}
          </h3>
          <p className="small muted">{t("embedPanel.aSmallCardWith")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {!live ? (
          <Notice tone="neu" title={t("embedPanel.publishToEmbed")}>
            {t("embedPanel.theWidgetShowsWhat")}
          </Notice>
        ) : (
          <>
            <label className="lbl" htmlFor="embed-code">
              {t("embedPanel.embedCode")}
            </label>
            <textarea id="embed-code" className="ta embed-code" readOnly value={snippet} rows={resize ? 14 : 4} onFocus={(e) => e.currentTarget.select()} />
            <div className="row wrap" style={{ gap: "12px", alignItems: "center", justifyContent: "space-between" }}>
              <label className="cb" htmlFor="embed-resize">
                <input type="checkbox" id="embed-resize" checked={resize} onChange={(e) => setResize(e.target.checked)} style={{ marginTop: "3px" }} />
                <span>
                  <span className="b">{t("embedPanel.resizeToFit")}</span>
                  <span className="help" style={{ display: "block" }}>
                    {t("embedPanel.addsAShortScript", { EMBED_HEIGHT })}
                  </span>
                </span>
              </label>
              <CopyButton value={snippet} what={t("embedPanel.theEmbedCode")} label={t("embedPanel.copyEmbedCode")} />
            </div>
            <div>
              <div className="lbl" style={{ marginBottom: "8px" }}>
                {t("embedPanel.preview")}
              </div>
              {preview.status === "loading" && <Loading label={t("embedPanel.loadingThePreview")} />}
              {preview.status === "error" && <ErrorBanner error={preview.error} onRetry={preview.reload} title={t("embedPanel.thePreviewCouldNot")} />}
              {preview.status === "ready" && preview.data && (
                <div className="embed" role="region" aria-label={t("embedPanel.widgetPreview")}>
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
