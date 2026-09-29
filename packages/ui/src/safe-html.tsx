// SPDX-License-Identifier: AGPL-3.0-or-later
// The ONLY place in GMS allowed to use dangerouslySetInnerHTML (enforced by eslint).
import DOMPurify from 'isomorphic-dompurify';
import * as React from 'react';
import { cn } from './lib/utils';

/** Tags allowed in rich text: formatting, lists, links, simple tables. No scripts, styles, forms, iframes or images by default. */
export const SAFE_HTML_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'h2', 'h3', 'h4', 'hr', 'i', 'li',
  'mark', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'u', 'ul',
] as const;

export const SAFE_HTML_ATTRS = ['href', 'title', 'target', 'rel', 'colspan', 'rowspan', 'scope', 'lang', 'dir'] as const;

let hooked = false;
function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  // Links open safely; javascript: and data: URLs are already stripped by DOMPurify.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    }
  });
}

export interface SanitizeOptions {
  /** Also allow <img> with https src (off by default). */
  allowImages?: boolean;
}

/** Sanitizes an HTML string for rendering. Usable on the server and in the browser. */
export function sanitizeHtml(html: string, opts: SanitizeOptions = {}): string {
  ensureHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...SAFE_HTML_TAGS, ...(opts.allowImages ? ['img'] : [])],
    ALLOWED_ATTR: [...SAFE_HTML_ATTRS, ...(opts.allowImages ? ['src', 'alt', 'width', 'height'] : [])],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/(?!\/))/i,
  });
}

export interface SafeHtmlProps extends Omit<React.ComponentProps<'div'>, 'children' | 'dangerouslySetInnerHTML'> {
  html: string | null | undefined;
  allowImages?: boolean;
  /** Element to render. Default "div". */
  as?: 'div' | 'section' | 'article' | 'span';
}

/** Renders untrusted rich text after DOMPurify sanitization, with readable prose styles. */
export function SafeHtml({ html, allowImages = false, as: Tag = 'div', className, ...props }: SafeHtmlProps) {
  const clean = sanitizeHtml(html ?? '', { allowImages });
  return (
    <Tag
      data-slot="safe-html"
      className={cn(
        'max-w-prose text-sm leading-relaxed [&_a]:text-link [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_table]:my-3 [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
      {...props}
    />
  );
}
