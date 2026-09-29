// SPDX-License-Identifier: AGPL-3.0-or-later
import { FilePenLine } from 'lucide-react';
import * as React from 'react';
import { ToneChip } from './status-chip';

/**
 * Marks text drafted by AI that a person has not yet accepted. Neutral on purpose:
 * no sparkles or "magic" styling; a draft is a draft.
 */
export function AiDraftChip({
  label = 'AI draft',
  size,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & { label?: string; size?: 'sm' | 'default' }) {
  return <ToneChip tone="neutral" icon={FilePenLine} label={label} size={size} title="Drafted by AI. Review before using." {...props} />;
}
