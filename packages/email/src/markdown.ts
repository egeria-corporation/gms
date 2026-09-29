// SPDX-License-Identifier: AGPL-3.0-or-later
// A deliberately tiny, safe markdown subset for staff-authored bulk messages.
// Supported: paragraphs (single newlines become line breaks), **bold** / __bold__, *italic* / _italic_,
// [links](https://…) with http/https/mailto only, "- " / "* " bullet lists and "1. " numbered lists,
// and backslash escapes. Everything else — including raw HTML — is escaped and shown as text.

import { escapeHtml, safeUrl } from './escape';

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'link'; href: string; children: MdInline[] };

export type MdBlock =
  { type: 'paragraph'; lines: MdInline[][] } | { type: 'list'; ordered: boolean; items: MdInline[][] };

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!<>|~'.split(''));
const MAX_INPUT = 50_000;
const MAX_DEPTH = 8;

/** Finds the next unescaped occurrence of `delim` at or after `from`. */
function findClosing(src: string, delim: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (src.startsWith(delim, j)) {
      // A single emphasis delimiter must not be the first half of a double one (e.g. "*" inside "**").
      if ((delim === '*' || delim === '_') && src[j + 1] === delim) {
        j++;
        continue;
      }
      return j;
    }
  }
  return -1;
}

/** Finds the ')' that closes a link destination starting at `from`, allowing balanced parentheses inside. */
function findUrlEnd(src: string, from: number): number {
  let depth = 0;
  for (let j = from; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      j++;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      if (depth === 0) return j;
      depth--;
    } else if (c === '\n') {
      return -1;
    }
  }
  return -1;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

export function parseInline(src: string, depth = 0): MdInline[] {
  const out: MdInline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  if (depth > MAX_DEPTH) return [{ type: 'text', text: src }];

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.has(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      const delim = ch + ch;
      const close = findClosing(src, delim, i + 2);
      if (close > i + 2 && !/^\s/.test(src.slice(i + 2))) {
        flush();
        out.push({ type: 'strong', children: parseInline(src.slice(i + 2, close), depth + 1) });
        i = close + 2;
        continue;
      }
    } else if (ch === '*' || ch === '_') {
      // Underscores inside words (snake_case) are literal.
      const intraword = ch === '_' && isWordChar(src[i - 1]);
      const close = intraword ? -1 : findClosing(src, ch, i + 1);
      if (close > i + 1 && !/^\s/.test(src.slice(i + 1)) && !(ch === '_' && isWordChar(src[close + 1]))) {
        flush();
        out.push({ type: 'em', children: parseInline(src.slice(i + 1, close), depth + 1) });
        i = close + 1;
        continue;
      }
    } else if (ch === '[') {
      const closeText = findClosing(src, ']', i + 1);
      if (closeText > i && src[closeText + 1] === '(') {
        const closeUrl = findUrlEnd(src, closeText + 2);
        if (closeUrl > closeText) {
          const text = src.slice(i + 1, closeText);
          const rawUrl = src.slice(closeText + 2, closeUrl).trim();
          const href = safeUrl(rawUrl);
          flush();
          const children = parseInline(text, depth + 1);
          // Unsafe schemes (javascript:, data:, …) keep their text but lose the link.
          if (href) out.push({ type: 'link', href, children });
          else out.push(...children);
          i = closeUrl + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;

export function parseMarkdown(src: string): MdBlock[] {
  const text = src.slice(0, MAX_INPUT).replace(/\r\n?/g, '\n');
  const blocks: MdBlock[] = [];
  let para: MdInline[][] = [];
  let list: { ordered: boolean; items: MdInline[][] } | null = null;

  const endPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', lines: para });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    const m = bullet ?? ordered;
    if (m) {
      endPara();
      const isOrdered = !!ordered;
      if (list && list.ordered !== isOrdered) endList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(parseInline(m[1]!.trim()));
      continue;
    }
    if (list && /^\s{2,}\S/.test(rawLine) && list.items.length) {
      // Indented continuation of the previous list item.
      const last = list.items[list.items.length - 1]!;
      last.push({ type: 'text', text: ' ' }, ...parseInline(line.trim()));
      continue;
    }
    endList();
    para.push(parseInline(line.trim()));
  }
  endPara();
  endList();
  return blocks;
}

export interface MarkdownHtmlOptions {
  linkColor?: string;
  textColor?: string;
  /** Extra class on links so dark-mode CSS can recolor them. */
  linkClass?: string;
  textClass?: string;
  fontFamily?: string;
}

function inlineToHtml(nodes: MdInline[], o: MarkdownHtmlOptions): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return escapeHtml(n.text);
        case 'strong':
          return `<strong>${inlineToHtml(n.children, o)}</strong>`;
        case 'em':
          return `<em>${inlineToHtml(n.children, o)}</em>`;
        case 'link': {
          const style = o.linkColor
            ? ` style="color:${escapeHtml(o.linkColor)};text-decoration:underline"`
            : '';
          const cls = o.linkClass ? ` class="${escapeHtml(o.linkClass)}"` : '';
          return `<a href="${escapeHtml(n.href)}"${cls}${style} target="_blank" rel="noopener noreferrer">${inlineToHtml(n.children, o)}</a>`;
        }
      }
    })
    .join('');
}

/** Renders the markdown subset to email-safe HTML with inline styles. All text is escaped. */
export function markdownToHtml(src: string, o: MarkdownHtmlOptions = {}): string {
  const color = o.textColor ? `color:${escapeHtml(o.textColor)};` : '';
  const font = o.fontFamily ? `font-family:${escapeHtml(o.fontFamily)};` : '';
  const cls = o.textClass ? ` class="${escapeHtml(o.textClass)}"` : '';
  const pStyle = `margin:0 0 16px 0;font-size:16px;line-height:26px;${color}${font}`;
  return parseMarkdown(src)
    .map((b) => {
      if (b.type === 'paragraph') {
        return `<p${cls} style="${pStyle}">${b.lines.map((l) => inlineToHtml(l, o)).join('<br />')}</p>`;
      }
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items
        .map(
          (it) =>
            `<li${cls} style="margin:0 0 6px 0;font-size:16px;line-height:26px;${color}${font}">${inlineToHtml(it, o)}</li>`,
        )
        .join('');
      return `<${tag}${cls} style="margin:0 0 16px 0;padding:0 0 0 24px;${color}${font}">${items}</${tag}>`;
    })
    .join('\n');
}

function inlineToText(nodes: MdInline[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return n.text;
      const inner = inlineToText(n.children);
      if (n.type === 'link') {
        const shown = n.href.replace(/^mailto:/, '');
        return inner === n.href || inner === shown ? n.href : `${inner} (${n.href})`;
      }
      return inner;
    })
    .join('');
}

/** Plain-text rendering of the same markdown subset (for the text/plain part). */
export function markdownToText(src: string): string {
  return parseMarkdown(src)
    .map((b) => {
      if (b.type === 'paragraph') return b.lines.map(inlineToText).join('\n');
      return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${inlineToText(it)}`).join('\n');
    })
    .join('\n\n');
}

/** Backslash-escapes markdown syntax so untrusted values inserted into markdown stay literal text. */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, (c) => `\\${c}`);
}
