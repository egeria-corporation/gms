// SPDX-License-Identifier: AGPL-3.0-only
import type { FileScanStatus } from '@gms/ui';
import type * as React from 'react';
import type { CompiledForm, FieldMeta, JsonSchema } from '../../compile';
import type { FieldType } from '../../model';
import type { ResponseData } from '../../util';
import type { ResponseError } from '../../validate';
import type { FileRef } from '../form-state';

/** `applicant`: 44px targets and larger text. `staff`: compact controls for console screens. */
export type FormDensity = 'applicant' | 'staff';

/** What every renderer can reach besides its own answer. */
export interface RendererContext {
  compiled: CompiledForm;
  data: ResponseData;
  density: FormDensity;
  idPrefix: string;
  /** Column totals for repeater tables (computeTotals). */
  totals: Record<string, Record<string, number>>;
  onUpload?: (fieldId: string, file: File) => Promise<FileRef>;
  onRemoveFile?: (fieldId: string, file: FileRef) => void | Promise<void>;
  fileHref?: (file: FileRef) => string | undefined;
  /** Virus-scan state per fileId (default "clean" once uploaded). */
  fileStatus?: Readonly<Record<string, FileScanStatus>>;
}

export interface FieldRendererProps {
  fieldId: string;
  meta: FieldMeta;
  /** The field's JSON Schema property (limits, formats, `x-` keywords). */
  schema: JsonSchema;
  /** The UI-schema control options (`fieldType`, `unit`, `format`, …). */
  options: Readonly<Record<string, unknown>>;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Every error for this field (including row/part errors). */
  errors: ResponseError[];
  /** The message to show under the whole question. */
  error?: string;
  /** Required right now (always required, or its requiredWhen holds). */
  required: boolean;
  /** Can't be edited right now (enabledWhen is false, or a flag turned it off). */
  disabled: boolean;
  /** Shown but locked by the host app (e.g. prefilled from a verified profile). */
  readOnly: boolean;
  /** Stable id of the control (or fieldset) — `field-<fieldId>`. */
  domId: string;
  ctx: RendererContext;
}

export type FieldRenderer = React.ComponentType<FieldRendererProps>;

/** One renderer per field type. GmsForm accepts a partial override. */
export type RendererSet = Record<FieldType, FieldRenderer>;
