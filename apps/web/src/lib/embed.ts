// SPDX-License-Identifier: AGPL-3.0-only
// The copy-paste snippet that puts an opportunity's apply widget on a funder's own site: an iframe
// with a fixed height, and an optional tiny script that resizes it to fit. The widget tells its
// parent page its height by postMessage; the script accepts only messages from the GMS origin and
// from that iframe. Everything that comes from the funder (titles, names) is escaped.

/** The message the widget posts to the page that frames it. It carries only a height. */
export const EMBED_MESSAGE = "opengrants-gms:embed-height";
/** The iframe's height when the resize script is not used, in pixels. */
export const EMBED_HEIGHT = 320;
/** Bounds the resize script keeps the iframe within, so a bad message cannot blow up the page. */
export const EMBED_MIN_HEIGHT = 120;
export const EMBED_MAX_HEIGHT = 1200;
/** The widget's width cap, in pixels; it shrinks to fit narrower spaces. */
export const EMBED_MAX_WIDTH = 480;
/**
 * What the framed widget may do: run its own scripts and read its own data (same-origin, which the
 * GMS origin is, never the host's), and open the opportunity page in a new tab that is not
 * sandboxed. It may not navigate or script the host page.
 */
export const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export const embedPath = (handle: string, slug: string): string => `/embed/f/${encodeURIComponent(handle)}/o/${encodeURIComponent(slug)}`;

/** Escapes text for an HTML attribute value in double quotes (and for element text). */
export function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A JavaScript string literal that is safe inside a <script> element. */
function scriptString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** The origin of an http(s) address; anything else is refused, so a snippet never points elsewhere. */
export function embedOrigin(origin: string): string {
  const u = new URL(origin);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("The widget is served over http(s) only");
  return u.origin;
}

/** An id for the iframe that is unique per opportunity and safe anywhere: lowercase letters, digits, hyphens. */
export const embedFrameId = (handle: string, slug: string): string => `opengrants-apply-${`${handle}-${slug}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}`;

export interface EmbedSnippetInput {
  /** Where the GMS web app is served, e.g. https://gms.opengrants.io */
  origin: string;
  handle: string;
  slug: string;
  title: string;
  funderName: string;
}

export function embedIframe(input: EmbedSnippetInput): string {
  const origin = embedOrigin(input.origin);
  const src = `${origin}${embedPath(input.handle, input.slug)}`;
  const label = `${input.title} from ${input.funderName}: apply`;
  return `<iframe id="${escapeHtmlAttr(embedFrameId(input.handle, input.slug))}" src="${escapeHtmlAttr(src)}" title="${escapeHtmlAttr(label)}" width="100%" height="${EMBED_HEIGHT}" style="border:0;width:100%;max-width:${EMBED_MAX_WIDTH}px" loading="lazy" sandbox="${EMBED_SANDBOX}"></iframe>`;
}

/** The optional resize script. It reads nothing from the message but a number. */
export function embedResizeScript(input: Pick<EmbedSnippetInput, "origin" | "handle" | "slug">): string {
  const origin = embedOrigin(input.origin);
  return [
    "<script>",
    "(function () {",
    `  var frame = document.getElementById(${scriptString(embedFrameId(input.handle, input.slug))});`,
    `  var origin = ${scriptString(origin)};`,
    '  window.addEventListener("message", function (event) {',
    "    if (!frame || event.origin !== origin || event.source !== frame.contentWindow) return;",
    "    var data = event.data;",
    `    if (!data || data.type !== ${scriptString(EMBED_MESSAGE)} || typeof data.height !== "number" || !isFinite(data.height)) return;`,
    `    frame.style.height = Math.max(${EMBED_MIN_HEIGHT}, Math.min(${EMBED_MAX_HEIGHT}, Math.ceil(data.height))) + "px";`,
    "  });",
    "})();",
    "</script>",
  ].join("\n");
}

/** The whole snippet: the iframe, then (when asked for) the resize script. */
export function embedSnippet(input: EmbedSnippetInput, opts: { resize: boolean }): string {
  return opts.resize ? `${embedIframe(input)}\n${embedResizeScript(input)}` : embedIframe(input);
}

/** What the widget posts to its parent page whenever its height changes. */
export function postEmbedHeight(target: Pick<Window, "postMessage">, height: number): void {
  // The height is not sensitive, and the widget cannot know which site frames it, so any origin
  // may receive it; the host's script checks that the message came from the GMS.
  target.postMessage({ type: EMBED_MESSAGE, height: Math.ceil(height) }, "*");
}
