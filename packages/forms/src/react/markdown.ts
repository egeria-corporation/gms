// SPDX-License-Identifier: AGPL-3.0-only
// A deliberately small, safe Markdown subset for info blocks, attestation statements and
// "formatted text" answers: paragraphs, headings, bulleted and numbered lists, block quotes,
// **bold**, *italic*, `code` and [links](https://…). It parses to a tree that is rendered as React
// elements (never as HTML strings), so there is nothing to sanitize. Link URLs are allow-listed.
// Also holds the toolbar edits for the formatted-text editor. React-free.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'br' };

export type Block =
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; children: Inline[] };

const SAFE_URL = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

/** Only http(s), mailto, tel, site-relative and in-page links survive; everything else is dropped. */
export function safeHref(url: string): string | undefined {
  const u = url.trim();
  if (!u || /[\s<>"']/.test(u)) return undefined;
  return SAFE_URL.test(u) ? u : undefined;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'paragraph', children: parseInlineLines(para) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map((t) => parseInline(t)) });
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ kind: 'quote', children: parseInlineLines(quote) });
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, children: parseInline(heading[2]!) });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      flushPara();
      flushQuote();
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]!);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      // Continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    flushQuote();
    para.push(line);
  }
  flushAll();
  return blocks;
}

function parseInlineLines(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((l, i) => {
    if (i > 0) out.push({ kind: 'br' });
    out.push(...parseInline(l.trim()));
  });
  return out;
}

/** Parses inline markup. Unmatched markers are kept as plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const pushText = () => {
    if (buf) out.push({ kind: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length && /[\\`*_[\]()#>-]/.test(text[i + 1]!)) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        pushText();
        out.push({ kind: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && text[i + 1] === ch) {
      const marker = ch + ch;
      const end = text.indexOf(marker, i + 2);
      if (end > i + 2) {
        pushText();
        out.push({ kind: 'strong', children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const end = findSingle(text, ch, i + 1);
      const prev = i > 0 ? text[i - 1]! : ' ';
      // `_` inside words (snake_case) is not emphasis.
      if (end > i + 1 && !(ch === '_' && /[A-Za-z0-9]/.test(prev))) {
        pushText();
        out.push({ kind: 'em', children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const close = findClosingBracket(text, i);
      if (close > i && text[close + 1] === '(') {
        const endParen = text.indexOf(')', close + 2);
        if (endParen > close + 1) {
          const label = text.slice(i + 1, close);
          const href = safeHref(text.slice(close + 2, endParen));
          pushText();
          if (href) out.push({ kind: 'link', href, children: parseInline(label) });
          else out.push(...parseInline(label));
          i = endParen + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  pushText();
  return out;
}

function findSingle(text: string, ch: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') {
      j++;
      continue;
    }
    if (text[j] === ch && text[j + 1] !== ch && text[j - 1] !== ch) return j;
  }
  return -1;
}

function findClosingBracket(text: string, open: number): number {
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '[') depth++;
    else if (text[j] === ']') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Plain text of some Markdown (for word counts, labels and screen-reader summaries). */
export function markdownToPlainText(src: string): string {
  const inlineText = (nodes: Inline[]): string =>
    nodes.map((n) => (n.kind === 'text' || n.kind === 'code' ? n.text : n.kind === 'br' ? ' ' : inlineText(n.children))).join('');
  return parseMarkdown(src)
    .map((b) => (b.kind === 'list' ? b.items.map(inlineText).join('\n') : inlineText(b.children)))
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Toolbar edits
// ---------------------------------------------------------------------------

export type MarkdownFormat = 'bold' | 'italic' | 'bullets' | 'numbers' | 'link';

export interface TextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Applies a toolbar action to `text` with the given selection and returns the new text and
 * selection. Bold/italic wrap (or unwrap) the selection; lists prefix every selected line;
 * link wraps the selection as `[text](https://)` and selects the URL for typing.
 */
export function applyMarkdownFormat(text: string, start: number, end: number, format: MarkdownFormat): TextEdit {
  const s = Math.max(0, Math.min(start, end));
  const e = Math.min(text.length, Math.max(start, end));
  const selected = text.slice(s, e);
  if (format === 'bold' || format === 'italic') {
    const marker = format === 'bold' ? '**' : '*';
    const before = text.slice(s - marker.length, s);
    const after = text.slice(e, e + marker.length);
    const outerOk = format === 'bold' || (text[s - 2] !== '*' && text[e + 1] !== '*');
    if (before === marker && after === marker && outerOk) {
      const next = text.slice(0, s - marker.length) + selected + text.slice(e + marker.length);
      return { text: next, selectionStart: s - marker.length, selectionEnd: e - marker.length };
    }
    const inner = selected || (format === 'bold' ? 'bold text' : 'italic text');
    const next = text.slice(0, s) + marker + inner + marker + text.slice(e);
    return { text: next, selectionStart: s + marker.length, selectionEnd: s + marker.length + inner.length };
  }
  if (format === 'link') {
    const label = selected || 'link text';
    const url = 'https://';
    const next = `${text.slice(0, s)}[${label}](${url})${text.slice(e)}`;
    const urlStart = s + label.length + 3;
    return { text: next, selectionStart: urlStart, selectionEnd: urlStart + url.length };
  }
  // Lists: operate on whole lines touched by the selection.
  const lineStart = text.lastIndexOf('\n', s - 1) + 1;
  const nl = text.indexOf('\n', e > s && text[e - 1] === '\n' ? e - 1 : e);
  const lineEnd = nl === -1 ? text.length : nl;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const isBullet = (l: string) => /^\s*[-*+]\s+/.test(l);
  const isNumber = (l: string) => /^\s*\d{1,3}[.)]\s+/.test(l);
  const strip = (l: string) => l.replace(/^\s*([-*+]|\d{1,3}[.)])\s+/, '');
  const already = lines.filter((l) => l.trim()).every(format === 'bullets' ? isBullet : isNumber) && lines.some((l) => l.trim());
  let n = 0;
  const nextLines = lines.map((l) => {
    if (!l.trim()) return l;
    if (already) return strip(l);
    n++;
    return `${format === 'bullets' ? '-' : `${n}.`} ${strip(l)}`;
  });
  const nextBlock = nextLines.join('\n');
  const next = text.slice(0, lineStart) + nextBlock + text.slice(lineEnd);
  return { text: next, selectionStart: lineStart, selectionEnd: lineStart + nextBlock.length };
}
