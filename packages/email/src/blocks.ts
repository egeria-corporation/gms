// SPDX-License-Identifier: AGPL-3.0-only
// The content model every template produces. One model renders to both HTML and plain text,
// so the text/plain part can never drift from the HTML part.

import type { ResolvedBrand } from './brand';
import { markdownToText } from './markdown';

export type Inline = string | { text: string; bold: true } | { text: string; href: string };
export type Rich = string | Inline[];

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; content: Rich }
  | { type: 'button'; label: string; href: string }
  | { type: 'details'; rows: { label: string; value: string }[] }
  | { type: 'callout'; tone: 'info' | 'success' | 'warning'; title?: string; content: Rich }
  | { type: 'list'; ordered?: boolean; title?: string; items: Rich[] }
  | { type: 'quote'; attribution: string; text: string }
  | { type: 'markdown'; source: string }
  | { type: 'fineprint'; content: Rich };

export interface EmailContent {
  subject: string;
  /** Inbox preview line (shown after the subject in most clients). */
  preheader: string;
  blocks: Block[];
  /** Completes "You're getting this email because …". */
  reason: string;
}

export interface BuildContext {
  brand: ResolvedBrand;
}

export function richToText(r: Rich): string {
  if (typeof r === 'string') return r;
  return r
    .map((i) => {
      if (typeof i === 'string') return i;
      if ('href' in i) return i.text === i.href ? i.href : `${i.text} (${i.href})`;
      return i.text;
    })
    .join('');
}

function wrap(text: string, width = 76, indent = ''): string {
  return text
    .split('\n')
    .map((line) => {
      const words = line.split(/ +/);
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        if (cur && (cur + ' ' + w).length > width) {
          lines.push(cur);
          cur = w;
        } else cur = cur ? `${cur} ${w}` : w;
      }
      lines.push(cur);
      return lines.map((l) => indent + l).join('\n');
    })
    .join('\n');
}

export function blocksToText(content: EmailContent, brand: ResolvedBrand): string {
  const parts: string[] = [brand.displayName.toUpperCase(), ''];
  for (const b of content.blocks) {
    switch (b.type) {
      case 'heading':
        parts.push(b.text, '='.repeat(Math.min(b.text.length, 60)));
        break;
      case 'paragraph':
        parts.push(wrap(richToText(b.content)));
        break;
      case 'button':
        parts.push(`${b.label}:`, b.href);
        break;
      case 'details':
        parts.push(b.rows.map((r) => `${r.label}: ${r.value}`).join('\n'));
        break;
      case 'callout':
        parts.push(
          [b.title ? `** ${b.title} **` : null, wrap(richToText(b.content))].filter(Boolean).join('\n'),
        );
        break;
      case 'list':
        parts.push(
          [
            b.title ?? null,
            ...b.items.map(
              (it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${wrap(richToText(it), 72, '  ').trimStart()}`,
            ),
          ]
            .filter((x) => x !== null)
            .join('\n'),
        );
        break;
      case 'quote':
        parts.push(`${b.attribution}:`, wrap(b.text, 74, '> '));
        break;
      case 'markdown':
        parts.push(markdownToText(b.source));
        break;
      case 'fineprint':
        parts.push(wrap(richToText(b.content)));
        break;
    }
    parts.push('');
  }
  parts.push(
    '--',
    `${brand.displayName}`,
    wrap(`You're getting this email because ${content.reason}`),
    ...(brand.replyTo ? [`Questions? Reply to this email or write to ${brand.replyTo}.`] : []),
    '',
    `Powered by GMS · Source code: ${brand.sourceUrl}`,
  );
  return (
    parts
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
