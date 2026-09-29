// SPDX-License-Identifier: AGPL-3.0-or-later
// The complete GMS renderer set: one renderer per field type, chosen by `fieldMeta[id].type`
// (the same value as the compiled schema's `x-fieldType` and the UI schema's `options.fieldType`).
import type { FieldType } from '../../model';
import { CurrencyRenderer, DateRenderer, EinRenderer, EmailRenderer, LongTextRenderer, NumberRenderer, PhoneRenderer, TextRenderer, UeiRenderer } from './basic';
import { CheckboxListRenderer, SelectRenderer, YesNoRenderer } from './choice';
import { AddressRenderer, AttestationRenderer, NameRenderer } from './composite';
import { FileUploadRenderer } from './file-upload';
import { LikertMatrixRenderer } from './likert';
import { RepeaterTableRenderer } from './repeater-table';
import { RichTextRenderer } from './rich-text';
import type { FieldRenderer, RendererSet } from './types';

export const GMS_RENDERERS: RendererSet = {
  text: TextRenderer,
  long_text: LongTextRenderer,
  rich_text: RichTextRenderer,
  number: NumberRenderer,
  currency: CurrencyRenderer,
  date: DateRenderer,
  select: SelectRenderer,
  multi_select: CheckboxListRenderer,
  checkbox_group: CheckboxListRenderer,
  yes_no: YesNoRenderer,
  name: NameRenderer,
  address: AddressRenderer,
  email: EmailRenderer,
  phone: PhoneRenderer,
  ein: EinRenderer,
  uei: UeiRenderer,
  file_upload: FileUploadRenderer,
  repeater_table: RepeaterTableRenderer,
  likert_matrix: LikertMatrixRenderer,
  attestation: AttestationRenderer,
};

/**
 * Field types whose renderers place part-level errors (a name's first/last, a table cell, a file)
 * next to the part. For every other type the first error is shown under the whole question.
 */
export const PART_AWARE_TYPES: ReadonlySet<FieldType> = new Set(['name', 'address', 'attestation', 'likert_matrix', 'repeater_table', 'file_upload']);

/** Picks the renderer for a field type (the "tester"), with optional per-type overrides. */
export function rendererFor(type: FieldType, overrides?: Partial<RendererSet>): FieldRenderer {
  return overrides?.[type] ?? GMS_RENDERERS[type];
}

export type { FieldRenderer, FieldRendererProps, FormDensity, RendererContext, RendererSet } from './types';
export { MoneyInput } from './basic';
export { MarkdownEditor, type MarkdownEditorProps } from './rich-text';
export { acceptLabel } from './file-upload';
export { sumHint } from './repeater-table';
export { NotAnswered, ReviewValue, type ReviewValueProps } from './review';
