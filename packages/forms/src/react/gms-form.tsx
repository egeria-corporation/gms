// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// <GmsForm> renders a compiled GMS form.
//
// Rendering choice: GMS walks the compiled JSON Forms UI schema (Categorization → Category per page
// → Group / Control / Label) with its own small renderer instead of mounting @jsonforms/react.
// Reasons: (1) visibility and requiredness must match the server exactly, so they come from
// `visibleFields` / `requiredFields` (hidden chains, flag folding) rather than JSON Forms' own
// rule engine; (2) every control is a @gms/ui component with GMS copy, stable `field-<id>` ids and
// part-level error placement, which JSON Forms' control props don't model; (3) no dependency on
// the vanilla/material renderer sets at all. The renderer set is still pluggable: renderers are
// chosen per `fieldMeta[id].type` (identical to the schema's `x-fieldType` and the UI schema's
// `options.fieldType`), and `renderers` overrides any of them.
import type { Categorization, Category, GroupLayout, LabelElement, UISchemaElement } from '@jsonforms/core';
import { Alert, Button, cn, DescriptionList, type FileScanStatus, ValidationSummary } from '@gms/ui';
import { EyeOff } from 'lucide-react';
import * as React from 'react';
import type { CompiledForm, FieldMeta } from '../compile';
import type { Flags } from '../conditions';
import type { ResponseData } from '../util';
import { computeTotals, type ResponseError } from '../validate';
import {
  computeFormView,
  controlFieldId,
  domIdForPointer,
  effectiveData,
  errorsByField,
  fieldDomId,
  fieldLevelError,
  type FileRef,
  type FormView,
  ruleHolds,
  setAnswer,
} from './form-state';
import { Markdown } from './markdown-view';
import { PART_AWARE_TYPES, rendererFor, ReviewValue } from './renderers';
import type { FormDensity, RendererContext, RendererSet } from './renderers/types';

export type GmsFormMode = 'edit' | 'review' | 'blind';

export interface GmsFormProps {
  compiled: CompiledForm;
  /** Answers keyed by field id. */
  data: ResponseData;
  /** Called with the full next answers and the ids that changed. Omit for read-only use. */
  onChange?: (data: ResponseData, changedFieldIds: string[]) => void;
  /** `edit`: one page at a time. `review`: every answer, read-only. `blind`: review with blind-flagged answers hidden. */
  mode?: GmsFormMode;
  /** Errors from validateResponses (or the server). Shown inline and in a summary at the top of the page. */
  errors?: readonly ResponseError[];
  /** Controlled current page. Uncontrolled (starts on the first page) when omitted. */
  currentPageId?: string;
  onPageChange?: (pageId: string) => void;
  /** Uploads a file and returns the stored reference. */
  onUpload?: (fieldId: string, file: File) => Promise<FileRef>;
  onRemoveFile?: (fieldId: string, file: FileRef) => void | Promise<void>;
  /** Link to download a stored file (review modes and file lists). */
  fileHref?: (file: FileRef) => string | undefined;
  /** Virus-scan state per fileId. Uploaded files are treated as clean when missing. */
  fileStatus?: Readonly<Record<string, FileScanStatus>>;
  /** Fields shown but locked (e.g. prefilled from a verified profile). */
  readOnlyFields?: readonly string[];
  density?: FormDensity;
  /** Form-level flags for any unresolved flag conditions (compiled forms normally have none). */
  flags?: Flags;
  /** Override renderers per field type. */
  renderers?: Partial<RendererSet>;
  /** Prefix for DOM ids when two forms share a page (default none: ids are `field-<id>`). */
  idPrefix?: string;
  /** Change this value (e.g. a submit-attempt counter) to move focus to the error summary. */
  summaryFocusKey?: string | number;
  /** Heading level for page titles (default 2). */
  headingLevel?: 2 | 3;
  className?: string;
}

function isCategory(el: UISchemaElement): el is Category {
  return el.type === 'Category';
}

function categories(compiled: CompiledForm): Category[] {
  const ui = compiled.uiSchema as Categorization;
  return (ui.elements ?? []).filter(isCategory);
}

function categoryFor(compiled: CompiledForm, pageId: string): Category | undefined {
  return categories(compiled).find((c) => (c.options as { pageId?: string } | undefined)?.pageId === pageId);
}

/** Every field id under a UI element (for deciding whether a section has anything to show). */
function fieldIdsUnder(el: UISchemaElement): string[] {
  const id = controlFieldId(el);
  if (id) return [id];
  const kids = (el as { elements?: UISchemaElement[] }).elements;
  return kids ? kids.flatMap(fieldIdsUnder) : [];
}

export function GmsForm(props: GmsFormProps) {
  const { compiled, data, mode = 'edit', errors = [], density = 'applicant', flags, idPrefix = '', headingLevel = 2, className } = props;
  const view = React.useMemo(() => computeFormView(compiled, data, flags), [compiled, data, flags]);
  const effective = React.useMemo(() => effectiveData(compiled, data, view.visible), [compiled, data, view.visible]);
  const totals = React.useMemo(() => computeTotals(compiled, data), [compiled, data]);
  const visibleErrors = React.useMemo(() => errors.filter((e) => view.visible.has(e.fieldId)), [errors, view.visible]);
  const errMap = React.useMemo(() => errorsByField(visibleErrors), [visibleErrors]);
  const readOnly = React.useMemo(() => new Set(props.readOnlyFields ?? []), [props.readOnlyFields]);

  // Latest answers, so async work (uploads) never writes over newer edits.
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const onChangeRef = React.useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const handleChange = React.useCallback((fieldId: string, value: unknown) => {
    const next = setAnswer(dataRef.current, fieldId, value);
    dataRef.current = next;
    onChangeRef.current?.(next, [fieldId]);
  }, []);

  const [innerPage, setInnerPage] = React.useState(() => compiled.pages[0]?.id ?? '');
  const pageId = props.currentPageId ?? innerPage;
  const setPage = (id: string) => {
    if (props.currentPageId === undefined) setInnerPage(id);
    props.onPageChange?.(id);
  };

  const ctx: RendererContext = {
    compiled,
    data,
    density,
    idPrefix,
    totals,
    onUpload: props.onUpload,
    onRemoveFile: props.onRemoveFile,
    fileHref: props.fileHref,
    fileStatus: props.fileStatus,
  };

  const rootRef = React.useRef<HTMLDivElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const firstPage = React.useRef(true);
  React.useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    if (mode === 'edit') headingRef.current?.focus({ preventScroll: false });
  }, [pageId, mode]);

  const lastFocusKey = React.useRef(props.summaryFocusKey);
  React.useEffect(() => {
    if (props.summaryFocusKey === lastFocusKey.current) return;
    lastFocusKey.current = props.summaryFocusKey;
    const h = rootRef.current?.querySelector<HTMLElement>('[data-slot="validation-summary"] h2');
    h?.focus();
  }, [props.summaryFocusKey]);

  if (mode !== 'edit') {
    return (
      <div ref={rootRef} data-slot="gms-form" data-mode={mode} className={cn('grid gap-8', className)}>
        {compiled.pages.map((page) => {
          const cat = categoryFor(compiled, page.id);
          if (!cat) return null;
          return (
            <ReviewPage
              key={page.id}
              title={page.title}
              category={cat}
              compiled={compiled}
              data={data}
              view={view}
              effective={effective}
              blind={mode === 'blind'}
              fileHref={props.fileHref}
              totals={totals}
              headingLevel={headingLevel}
              showNotes={density === 'staff'}
            />
          );
        })}
      </div>
    );
  }

  const page = compiled.pages.find((p) => p.id === pageId) ?? compiled.pages[0];
  const cat = page ? categoryFor(compiled, page.id) : undefined;
  if (!page || !cat) return null;

  const pageErrors = visibleErrors.filter((e) => e.pageId === page.id);
  const otherPages = compiled.pages
    .filter((p) => p.id !== page.id)
    .map((p) => ({ page: p, count: visibleErrors.filter((e) => e.pageId === p.id).length }))
    .filter((x) => x.count > 0);
  const labelOf = (id: string) => compiled.fieldMeta[id]?.label ?? id;
  const H = `h${headingLevel}` as 'h2' | 'h3';

  const renderElement = (el: UISchemaElement, key: string): React.ReactNode => {
    const fieldId = controlFieldId(el);
    if (el.type === 'Control' && fieldId) {
      const meta = compiled.fieldMeta[fieldId];
      if (!meta || !view.visible.has(fieldId)) return null;
      const Renderer = rendererFor(meta.type, props.renderers);
      const fieldErrors = errMap.get(fieldId) ?? [];
      const top = fieldLevelError(fieldErrors, fieldId) ?? (PART_AWARE_TYPES.has(meta.type) ? undefined : fieldErrors[0]?.message);
      const options = ((el as { options?: Record<string, unknown> }).options ?? {}) as Record<string, unknown>;
      return (
        <div key={key} data-field-id={fieldId} className="min-w-0 scroll-mt-24">
          <Renderer
            fieldId={fieldId}
            meta={meta}
            schema={compiled.jsonSchema.properties?.[fieldId] ?? {}}
            options={options}
            value={data[fieldId]}
            onChange={(v) => handleChange(fieldId, v)}
            errors={fieldErrors}
            error={top}
            required={view.required.has(fieldId)}
            disabled={view.disabled.has(fieldId) || !props.onChange}
            readOnly={readOnly.has(fieldId)}
            domId={fieldDomId(fieldId, idPrefix)}
            ctx={ctx}
          />
        </div>
      );
    }
    if (el.type === 'Label') {
      const label = el as LabelElement;
      if (!ruleHolds(label.rule, effective)) return null;
      const opts = (label.options ?? {}) as { title?: string; blockId?: string };
      return (
        <div key={key} data-block-id={opts.blockId} className="grid gap-1.5 rounded-lg border-l-4 border-primary/40 bg-muted/40 px-4 py-3">
          {opts.title ? <h3 className="font-heading text-base font-semibold">{opts.title}</h3> : null}
          <Markdown source={label.text} headingBase={4} />
        </div>
      );
    }
    if (el.type === 'Group') {
      const group = el as GroupLayout;
      if (!ruleHolds(group.rule, effective)) return null;
      const ids = fieldIdsUnder(group);
      if (ids.length && !ids.some((id) => view.visible.has(id))) return null;
      const opts = (group.options ?? {}) as { sectionId?: string; description?: string };
      const headingId = `${idPrefix}section-${opts.sectionId ?? key}`;
      return (
        <section key={key} aria-labelledby={headingId} className={cn('grid', density === 'applicant' ? 'gap-6' : 'gap-4')}>
          <div className="grid gap-1 border-b pb-2">
            <h3 id={headingId} className="font-heading text-lg font-semibold">
              {group.label}
            </h3>
            {opts.description ? <p className="text-sm text-muted-foreground">{opts.description}</p> : null}
          </div>
          {group.elements.map((c, i) => renderElement(c, `${key}-${i}`))}
        </section>
      );
    }
    const kids = (el as { elements?: UISchemaElement[] }).elements;
    return kids ? <React.Fragment key={key}>{kids.map((c, i) => renderElement(c, `${key}-${i}`))}</React.Fragment> : null;
  };

  return (
    <div ref={rootRef} data-slot="gms-form" data-mode="edit" data-density={density} className={cn('grid', density === 'applicant' ? 'gap-8' : 'gap-5', className)}>
      {pageErrors.length > 0 ? (
        <ValidationSummary
          autoFocus={false}
          errors={pageErrors.map((e) => ({ fieldId: domIdForPointer(e.pointer, idPrefix), message: `${labelOf(e.fieldId)} — ${e.message}` }))}
        />
      ) : null}
      {otherPages.length > 0 ? (
        <Alert
          variant="warning"
          title={otherPages.length === 1 ? 'Another page needs attention' : 'Other pages need attention'}
          actions={otherPages.map(({ page: p, count }) => (
            <Button key={p.id} type="button" variant="outline" size={density === 'applicant' ? 'lg' : 'sm'} onClick={() => setPage(p.id)}>
              Go to “{p.title}” ({count} {count === 1 ? 'problem' : 'problems'})
            </Button>
          ))}
        />
      ) : null}
      <header className="grid gap-1.5">
        <H ref={headingRef} tabIndex={-1} className="font-heading text-2xl font-semibold outline-offset-4">
          {page.title}
        </H>
        {page.description ? <p className="max-w-prose text-muted-foreground">{page.description}</p> : null}
      </header>
      {cat.elements.map((el, i) => renderElement(el, `${page.id}-${i}`))}
    </div>
  );
}

function ReviewPage({
  title,
  category,
  compiled,
  data,
  view,
  effective,
  blind,
  fileHref,
  totals,
  headingLevel,
  showNotes,
}: {
  title: string;
  category: Category;
  compiled: CompiledForm;
  data: ResponseData;
  view: FormView;
  effective: ResponseData;
  blind: boolean;
  fileHref?: (f: FileRef) => string | undefined;
  totals: Record<string, Record<string, number>>;
  headingLevel: 2 | 3;
  showNotes: boolean;
}) {
  const H = `h${headingLevel}` as 'h2' | 'h3';
  const item = (fieldId: string, meta: FieldMeta) => ({
    term: meta.label,
    wide: true,
    numeric: meta.type === 'currency' || meta.type === 'number',
    detail:
      blind && meta.blind ? (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <EyeOff className="size-4" aria-hidden="true" />
          Hidden for blind review
        </span>
      ) : (
        <div className="grid gap-1.5">
          <ReviewValue meta={meta} value={data[fieldId]} fileHref={fileHref} totals={totals[fieldId]} />
          {showNotes && meta.reviewerNotes ? <p className="text-xs text-muted-foreground">Reviewer note: {meta.reviewerNotes}</p> : null}
        </div>
      ),
  });

  // Group consecutive top-level fields into one list; sections get their own heading and list.
  const blocks: React.ReactNode[] = [];
  let run: { id: string; meta: FieldMeta }[] = [];
  const flush = (key: string) => {
    if (run.length) blocks.push(<DescriptionList key={key} items={run.map((r) => item(r.id, r.meta))} />);
    run = [];
  };
  const collect = (el: UISchemaElement, into: { id: string; meta: FieldMeta }[]) => {
    const id = controlFieldId(el);
    if (el.type === 'Control' && id) {
      const meta = compiled.fieldMeta[id];
      if (meta && view.visible.has(id)) into.push({ id, meta });
      return;
    }
    if (el.type === 'Group' || el.type === 'Label') return;
    for (const c of (el as { elements?: UISchemaElement[] }).elements ?? []) collect(c, into);
  };
  category.elements.forEach((el, i) => {
    if (el.type === 'Group') {
      flush(`run-${i}`);
      const group = el as GroupLayout;
      if (!ruleHolds(group.rule, effective)) return;
      const inner: { id: string; meta: FieldMeta }[] = [];
      for (const c of group.elements) collect(c, inner);
      if (!inner.length) return;
      blocks.push(
        <section key={`group-${i}`} className="grid gap-1">
          <h3 className="text-sm font-semibold">{group.label}</h3>
          <DescriptionList items={inner.map((r) => item(r.id, r.meta))} />
        </section>,
      );
      return;
    }
    collect(el, run);
  });
  flush('run-end');
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <H id={headingId} className="font-heading text-xl font-semibold">
        {title}
      </H>
      {blocks.length ? blocks : <p className="text-sm text-muted-foreground">No questions on this page apply to these answers.</p>}
    </section>
  );
}
