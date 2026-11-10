// SPDX-License-Identifier: AGPL-3.0-only
// Template rendering: markdown with {{merge.fields}} → subject, text and HTML. Field values are
// untrusted (applicant-supplied names, titles), so they are escaped and can never add markup.

export type MergeFields = { [key: string]: string | number | boolean | null | undefined | MergeFields };

export class MissingFieldError extends Error {
  constructor(readonly fields: string[]) {
    super(`Missing merge field(s): ${fields.join(", ")}`);
    this.name = "MissingFieldError";
  }
}

const FIELD = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Merge-field names a template body uses, in order of first appearance. */
export function templateFields(body: string): string[] {
  return [...new Set([...body.matchAll(FIELD)].map((m) => m[1]!))];
}

function lookup(fields: MergeFields, path: string): string | undefined {
  let current: unknown = fields;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined || typeof current === "object") return undefined;
  const text = String(current);
  return text === "" ? undefined : text;
}

/** Substitutes fields. Throws MissingFieldError naming every absent field: a letter with a blank
 * where the amount should be must never go out. */
export function merge(body: string, fields: MergeFields, transform: (value: string) => string = (v) => v): string {
  const missing: string[] = [];
  const out = body.replace(FIELD, (_m, path: string) => {
    const value = lookup(fields, path);
    if (value === undefined) {
      if (!missing.includes(path)) missing.push(path);
      return "";
    }
    return transform(value);
  });
  if (missing.length) throw new MissingFieldError(missing);
  return out;
}

const SAFE_URL = /^(https:\/\/|mailto:)[^\s"'<>]+$/i;

/** Escapes a merged value for the HTML pass in one step: HTML metacharacters and the characters
 * that carry meaning in the markdown subset all become numeric entities, so a value can add
 * neither markup nor formatting. */
function escapeValue(value: string): string {
  return value.replace(/[&<>"'\\*_[\]()#`]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\r?\n/g, " ");
}

function inline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => (SAFE_URL.test(url.replace(/&amp;/g, "&")) ? `<a href="${url}">${label}</a>` : label))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

/** A deliberately small markdown subset: headings, paragraphs, bullet lists, bold, italic, links. */
export function markdownToHtml(escapedMarkdown: string): string {
  const blocks: string[] = [];
  for (const block of escapedMarkdown.split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0]!);
    if (heading && lines.length === 1) {
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
    } else if (lines.every((l) => /^[-*]\s+/.test(l))) {
      blocks.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`);
    } else {
      blocks.push(`<p>${lines.map(inline).join("<br>")}</p>`);
    }
  }
  return blocks.join("\n");
}

function markdownToText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .trim();
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderTemplate(template: { subject: string; body: string }, fields: MergeFields): RenderedEmail {
  const missing = [...templateFields(template.subject), ...templateFields(template.body)].filter((f) => lookup(fields, f) === undefined);
  if (missing.length) throw new MissingFieldError([...new Set(missing)]);
  // Subject and text are plain: strip line breaks from values so a field cannot inject headers.
  const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ");
  const subject = merge(template.subject, fields, oneLine).trim();
  const text = markdownToText(merge(template.body, fields, oneLine));
  // HTML: escape the author's markdown, merge values escaped and markdown-neutral, then format.
  const html = markdownToHtml(merge(escapeHtml(template.body), fields, escapeValue));
  return { subject, text, html };
}
