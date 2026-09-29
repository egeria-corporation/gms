// SPDX-License-Identifier: AGPL-3.0-or-later
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

// Form builder (FB-01…FB-08)
export { FormBuilder, type FormBuilderProps } from './builder/form-builder';
export { BuilderCanvas, type BuilderCanvasProps } from './builder/canvas';
export { FieldPalette, type FieldPaletteProps, type PaletteKind } from './builder/palette';
export { PropertiesPanel, type PropertiesPanelProps, type BuilderSelection, type EditFn } from './builder/properties';
export { RuleEditor, type RuleEditorProps } from './builder/logic-editor';
export { OptionListEditor, type OptionListEditorProps } from './builder/options-editor';
export { QuestionBankPanel, type QuestionBankPanelProps, bankItemMatches, fieldFromBankItem } from './builder/question-bank';
export { TemplatesDialog, type TemplatesDialogProps, runImport } from './builder/templates-dialog';
export { FormPreview, type FormPreviewProps, isLoiModel, tryCompile } from './builder/preview';
export { LintPanel, type LintPanelProps } from './builder/lint-panel';
export { FormDiffView, type FormDiffViewProps } from './builder/diff-view';
export { VersionHistory, type VersionHistoryProps, VersionStatusChip, type FormVersionStatus, type FormVersionSummary } from './builder/version-history';
export { useBuilderHistory, type BuilderHistory } from './builder/use-builder-history';

// React-free helpers (also usable on the server).
export * from './form-state';
export * from './money';
export * from './markdown';
export * from './autosave-queue';
export * from './undo-stack';
export * from './builder-ops';
export * from './rule-draft';
