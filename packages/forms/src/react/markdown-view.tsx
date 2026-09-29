// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { cn } from '@gms/ui';
import * as React from 'react';
import { type Block, type Inline, parseMarkdown } from './markdown';

function renderInline(nodes: Inline[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.kind) {
      case 'text':
        return <React.Fragment key={key}>{n.text}</React.Fragment>;
      case 'br':
        return <br key={key} />;
      case 'code':
        return (
          <code key={key} className="rounded-sm bg-muted px-1 text-[0.9em]">
            {n.text}
          </code>
        );
      case 'strong':
        return <strong key={key}>{renderInline(n.children, key)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(n.children, key)}</em>;
      case 'link': {
        const external = /^https?:\/\//i.test(n.href);
        return (
          <a
            key={key}
            href={n.href}
            className="text-link underline underline-offset-2 hover:decoration-2"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
          >
            {renderInline(n.children, key)}
            {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
          </a>
        );
      }
    }
  });
}

function renderBlock(b: Block, i: number, headingBase: 2 | 3 | 4): React.ReactNode {
  const key = `b${i}`;
  switch (b.kind) {
    case 'paragraph':
      return <p key={key}>{renderInline(b.children, key)}</p>;
    case 'heading': {
      const level = Math.min(6, headingBase + b.level - 1);
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag key={key} className="font-semibold text-foreground">
          {renderInline(b.children, key)}
        </Tag>
      );
    }
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key} className={cn('pl-5', b.ordered ? 'list-decimal' : 'list-disc')}>
          {b.items.map((item, j) => (
            <li key={j} className="my-0.5">
              {renderInline(item, `${key}-${j}`)}
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 pl-3 text-muted-foreground">
          {renderInline(b.children, key)}
        </blockquote>
      );
  }
}

export interface MarkdownProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  /** Markdown source (a small safe subset; see markdown.ts). */
  source: string;
  /** Heading level used for `#` (default 3, so `#` never competes with the page heading). */
  headingBase?: 2 | 3 | 4;
}

/** Renders the safe Markdown subset as React elements. Never uses HTML strings. */
export function Markdown({ source, headingBase = 3, className, ...props }: MarkdownProps) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  return (
    <div data-slot="markdown" className={cn('grid max-w-prose gap-2 text-sm leading-relaxed', className)} {...props}>
      {blocks.map((b, i) => renderBlock(b, i, headingBase))}
    </div>
  );
}
