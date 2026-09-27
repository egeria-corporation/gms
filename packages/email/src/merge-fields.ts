// SPDX-License-Identifier: AGPL-3.0-only
// Merge fields for staff-authored messages: {{applicant.first_name}}-style tokens.

import { escapeHtml } from './escape';
import { escapeMarkdown } from './markdown';

export interface MergeField {
  key: string;
  label: string;
  example: string;
}

/** Every merge field staff can use in messages. Unknown tokens are left as-is so typos are visible in preview. */
export const MERGE_FIELDS: readonly MergeField[] = [
  { key: 'applicant.first_name', label: 'Applicant first name', example: 'Maya' },
  { key: 'applicant.last_name', label: 'Applicant last name', example: 'Chen' },
  { key: 'applicant.full_name', label: 'Applicant full name', example: 'Maya Chen' },
  { key: 'applicant.email', label: 'Applicant email', example: 'maya@eastside-youth-music.example' },
  { key: 'organization.name', label: 'Organization name', example: 'Eastside Youth Music Collective' },
  { key: 'opportunity.name', label: 'Opportunity name', example: 'Youth Arts Fund 2027' },
  { key: 'opportunity.deadline', label: 'Opportunity deadline', example: 'Dec 5, 2026, 5:00 PM PST' },
  { key: 'application.title', label: 'Application title', example: 'After-School Strings Program' },
  { key: 'application.reference', label: 'Application reference number', example: 'YAF27-0042' },
  { key: 'application.status', label: 'Application status', example: 'Under review' },
  {
    key: 'application.url',
    label: 'Link to the application',
    example: 'https://halcyon.gms.example/portal/applications/YAF27-0042',
  },
  { key: 'award.reference', label: 'Award reference', example: 'HRF-2027-014' },
  { key: 'award.amount', label: 'Award amount', example: '$25,000.00' },
  { key: 'foundation.name', label: 'Foundation name', example: 'Halcyon Ridge Foundation' },
  { key: 'sender.name', label: 'Sender name', example: 'Priya Natarajan' },
  { key: 'portal.url', label: 'Applicant portal link', example: 'https://halcyon.gms.example/portal' },
] as const;

const KNOWN = new Set(MERGE_FIELDS.map((f) => f.key));
const TOKEN = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*\}\}/gi;

export interface MergeOptions {
  /**
   * How to escape substituted values:
   * - 'html' (default): values are HTML-escaped (the template itself is not touched).
   * - 'markdown': values are backslash-escaped so they can't add formatting or links.
   * - 'none': raw values (only for plain-text output).
   */
  escape?: 'html' | 'markdown' | 'none';
}

/**
 * Replaces {{field}} tokens with values. Known fields with no value become an empty string;
 * unknown tokens are left in place untouched.
 */
export function renderMergeFields(
  template: string,
  values: Record<string, string>,
  opts: MergeOptions = {},
): string {
  const mode = opts.escape ?? 'html';
  const esc = mode === 'html' ? escapeHtml : mode === 'markdown' ? escapeMarkdown : (v: string) => v;
  return template.replace(TOKEN, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
    if (value !== undefined) return esc(String(value));
    return KNOWN.has(key) ? '' : whole;
  });
}

/** Lists the merge tokens in a template, flagging ones that aren't supported. */
export function findMergeTokens(template: string): { key: string; known: boolean }[] {
  const seen = new Map<string, boolean>();
  for (const m of template.matchAll(TOKEN)) {
    const key = m[1]!.toLowerCase();
    seen.set(key, KNOWN.has(key));
  }
  return [...seen].map(([key, known]) => ({ key, known }));
}
