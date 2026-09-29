// SPDX-License-Identifier: AGPL-3.0-or-later
import { markdownToHtml } from '@gms/email';
import { SafeHtml } from '@gms/ui';

/** Staff-authored markdown (a safe subset) rendered through DOMPurify. */
export function Markdown({ source, className }: { source: string | null | undefined; className?: string }) {
  if (!source?.trim()) return null;
  return <SafeHtml html={markdownToHtml(source)} className={className} />;
}
