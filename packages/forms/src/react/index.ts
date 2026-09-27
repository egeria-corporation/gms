// SPDX-License-Identifier: AGPL-3.0-only
// @gms/forms/react — client components for GMS forms, built on @gms/ui:
// the form renderer (<GmsForm>, pager, progress rail), autosave and conflict handling, and the
// form builder. Everything here is framework-agnostic React (no next/* imports).
export { GmsForm, type GmsFormMode, type GmsFormProps } from './gms-form';
export { FormProgressRail, type FormProgressRailProps, GmsFormPager, type GmsFormPagerProps } from './navigation';
export { useAutosave, pickChanged, type UseAutosaveOptions, type UseAutosaveResult } from './use-autosave';
export { ConflictNotice, type ConflictNoticeProps } from './conflict-notice';
export { Markdown, type MarkdownProps } from './markdown-view';
export {
  GMS_RENDERERS,
  PART_AWARE_TYPES,
  rendererFor,
  MarkdownEditor,
  MoneyInput,
  ReviewValue,
  NotAnswered,
  acceptLabel,
  sumHint,
  type FieldRenderer,
  type FieldRendererProps,
  type FormDensity,
  type MarkdownEditorProps,
  type RendererContext,
  type RendererSet,
  type ReviewValueProps,
} from './renderers';

// React-free helpers (also usable on the server).
export * from './form-state';
export * from './money';
export * from './markdown';
export * from './autosave-queue';
export * from './undo-stack';
export * from './builder-ops';
