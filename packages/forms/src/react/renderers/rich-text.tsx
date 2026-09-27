// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Button, cn, Field, SimpleTooltip, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, TooltipProvider } from '@gms/ui';
import { Bold, Italic, Link, List, ListOrdered, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { applyMarkdownFormat, type MarkdownFormat } from '../markdown';
import { Markdown } from '../markdown-view';
import { fieldProps } from './basic';
import type { FieldRendererProps } from './types';

const TOOLS: { format: MarkdownFormat; label: string; icon: LucideIcon; shortcut?: string }[] = [
  { format: 'bold', label: 'Bold', icon: Bold, shortcut: 'Ctrl+B' },
  { format: 'italic', label: 'Italic', icon: Italic, shortcut: 'Ctrl+I' },
  { format: 'bullets', label: 'Bulleted list', icon: List },
  { format: 'numbers', label: 'Numbered list', icon: ListOrdered },
  { format: 'link', label: 'Link', icon: Link, shortcut: 'Ctrl+K' },
];

export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  maxWords?: number;
  size?: 'default' | 'lg';
  disabled?: boolean;
  readOnly?: boolean;
  rows?: number;
  /** Accessible name of the toolbar, e.g. "Formatting for Project summary". */
  toolbarLabel: string;
  /** id for the textarea (defaults to the surrounding Field's id). */
  id?: string;
  className?: string;
}

/**
 * A simple, safe formatted-text editor: a textarea with a small Markdown toolbar (bold, italic,
 * lists, links) and a preview. The answer is stored as Markdown text and rendered as React
 * elements, never as HTML.
 */
export function MarkdownEditor({ value, onChange, maxWords, size = 'default', disabled, readOnly, rows = 6, toolbarLabel, id, className }: MarkdownEditorProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const pendingSelection = React.useRef<[number, number] | null>(null);
  const [tab, setTab] = React.useState<'write' | 'preview'>('write');
  const locked = disabled || readOnly;

  React.useLayoutEffect(() => {
    const sel = pendingSelection.current;
    if (!sel || !ref.current) return;
    pendingSelection.current = null;
    ref.current.focus();
    ref.current.setSelectionRange(sel[0], sel[1]);
  });

  const apply = (format: MarkdownFormat) => {
    const el = ref.current;
    if (!el || locked) return;
    const edit = applyMarkdownFormat(el.value, el.selectionStart, el.selectionEnd, format);
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    onChange(edit.text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const format: MarkdownFormat | undefined = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'k' ? 'link' : undefined;
    if (format) {
      e.preventDefault();
      apply(format);
    }
  };

  const btnSize = size === 'lg' ? 'icon-lg' : 'icon-sm';
  return (
    <TooltipProvider>
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'write' | 'preview')} className={cn('gap-2', className)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label={toolbarLabel}className="flex items-center gap-0.5 rounded-md border bg-card p-0.5">
            {TOOLS.map((t) => (
              <SimpleTooltip key={t.format} content={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}>
                <Button
                  type="button"
                  variant="ghost"
                  size={btnSize}
                  disabled={locked || tab !== 'write'}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply(t.format)}
                  aria-label={t.label}
                >
                  <t.icon aria-hidden="true" />
                </Button>
              </SimpleTooltip>
            ))}
          </div>
          <TabsList variant="pill" aria-label="Editor view">
            <TabsTrigger value="write" className={size === 'lg' ? 'min-h-10' : undefined}>
              Write
            </TabsTrigger>
            <TabsTrigger value="preview" className={size === 'lg' ? 'min-h-10' : undefined}>
              Preview
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="write" forceMount className="data-[state=inactive]:hidden">
          <Textarea
            ref={ref}
            id={id}
            rows={rows}
            textareaSize={size}
            maxWords={maxWords}
            showWordCount
            className="font-mono text-[0.95em]"
            value={value}
            disabled={disabled}
            readOnly={readOnly}
            onKeyDown={onKeyDown}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        </TabsContent>
        <TabsContent value="preview" className="min-h-24 rounded-md border bg-card p-3">
          {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}
        </TabsContent>
      </Tabs>
    </TooltipProvider>
  );
}

export function RichTextRenderer(p: FieldRendererProps) {
  const maxWords = p.meta.maxWords ?? p.schema.maxWords;
  const hintId = `${p.domId}-format-hint`;
  return (
    <Field {...fieldProps(p)} describedBy={[hintId]}>
      <p id={hintId} className="sr-only">
        You can use Markdown: two asterisks for bold, one for italics, a dash to start a list item.
      </p>
      <MarkdownEditor
        value={typeof p.value === 'string' ? p.value : ''}
        onChange={(t) => p.onChange(t === '' ? undefined : t)}
        maxWords={maxWords}
        size={p.ctx.density === 'applicant' ? 'lg' : 'default'}
        disabled={p.disabled}
        readOnly={p.readOnly}
        toolbarLabel={`Formatting for ${p.meta.label}`}
      />
    </Field>
  );
}
