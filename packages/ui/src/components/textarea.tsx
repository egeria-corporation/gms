// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import * as React from 'react';
import { cn, countWords } from '../lib/utils';
import { useFieldControl } from './field';
import { controlClasses } from './input';

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** Show a live word count under the box. */
  showWordCount?: boolean;
  /** Word limit. Implies showWordCount. Over the limit is shown, not blocked, so people can paste then trim. */
  maxWords?: number;
  /** Larger text and padding for applicant forms. */
  textareaSize?: 'default' | 'lg';
}

type Band = 'ok' | 'near' | 'over';

export function Textarea({
  className,
  showWordCount = false,
  maxWords,
  textareaSize = 'default',
  onChange,
  ...props
}: TextareaProps) {
  const auto = React.useId();
  const counting = showWordCount || maxWords !== undefined;
  const countId = `${props.id ?? auto}-count`;
  const initial = typeof props.value === 'string' ? props.value : typeof props.defaultValue === 'string' ? props.defaultValue : '';
  const [uncontrolledText, setText] = React.useState(initial);
  const text = typeof props.value === 'string' ? props.value : uncontrolledText;
  const words = counting ? countWords(text) : 0;
  const band: Band =
    maxWords === undefined ? 'ok' : words > maxWords ? 'over' : words >= Math.floor(maxWords * 0.9) ? 'near' : 'ok';

  // Announce only when crossing into a new band, not on every keystroke.
  const [announcement, setAnnouncement] = React.useState('');
  const lastBand = React.useRef<Band>(band);
  React.useEffect(() => {
    if (band === lastBand.current || maxWords === undefined) return;
    lastBand.current = band;
    if (band === 'over') setAnnouncement(`Over the limit: ${words} of ${maxWords} words.`);
    else if (band === 'near') setAnnouncement(`${maxWords - words} words left.`);
    else setAnnouncement('');
  }, [band, words, maxWords]);

  const wired = useFieldControl({
    ...props,
    'aria-describedby': [props['aria-describedby'], counting ? countId : undefined].filter(Boolean).join(' ') || undefined,
  });

  const textarea = (
    <textarea
      data-slot="textarea"
      className={cn(
        controlClasses,
        'field-sizing-content min-h-20 resize-y',
        textareaSize === 'lg' ? 'px-3.5 py-3 text-base leading-relaxed' : 'px-3 py-2 text-sm',
        className,
      )}
      onChange={(e) => {
        setText(e.currentTarget.value);
        onChange?.(e);
      }}
      {...wired}
    />
  );

  if (!counting) return textarea;
  return (
    <div data-slot="textarea-wrapper" className="grid gap-1.5">
      {textarea}
      <p
        id={countId}
        className={cn(
          'text-right text-xs tabular-nums text-muted-foreground',
          band === 'near' && 'text-status-warning-fg',
          band === 'over' && 'font-medium text-status-danger-fg',
        )}
      >
        {maxWords === undefined ? `${words.toLocaleString('en-US')} words` : `${words.toLocaleString('en-US')} of ${maxWords.toLocaleString('en-US')} words`}
        {band === 'over' ? ` (${(words - maxWords!).toLocaleString('en-US')} over)` : null}
      </p>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
