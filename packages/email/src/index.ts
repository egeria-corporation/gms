// SPDX-License-Identifier: AGPL-3.0-or-later
export { renderEmail, type RenderedEmail } from './render';
export { DEFAULT_SOURCE_URL, resolveBrand, type Brand, type ResolvedBrand } from './brand';
export { templates, previewProps, TEMPLATE_KEYS } from './templates';
export type * from './templates';
export type { Block, EmailContent, Inline, Rich } from './blocks';
export {
  MERGE_FIELDS,
  renderMergeFields,
  findMergeTokens,
  type MergeField,
  type MergeOptions,
} from './merge-fields';
export { markdownToHtml, markdownToText, parseMarkdown, escapeMarkdown } from './markdown';
export { escapeHtml, safeUrl } from './escape';
export { contrastRatio, parseHex } from './color';
