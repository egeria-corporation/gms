// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AutosaveIndicator,
  Badge,
  Button,
  cn,
  Field,
  Kbd,
  SimpleTooltip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  TooltipProvider,
} from '@gms/ui';
import { LayoutTemplate, Redo2, Rocket, Save, Undo2 } from 'lucide-react';
import * as React from 'react';
import { type MigrationNotice, migrationNotice } from '../../diff';
import type { FormTemplate, QuestionBankItem } from '../../library';
import { canPublish, lintForm } from '../../lint';
import { type FormModel, isField, listFields } from '../../model';
import { detectRuleCycles } from '../../rules';
import {
  addPage,
  type AnyElement,
  type ContainerId,
  containerOf,
  createField,
  createInfoBlock,
  createSection,
  duplicateElement,
  elementLabel,
  getElement,
  insertElement,
  locateElement,
  mappingConflicts,
  moveElement,
  moveElementBy,
  moveElementToPage,
  movePage,
  pageContainer,
  referencesTo,
  removeElement,
  removePage,
  restoreElement,
} from '../builder-ops';
import { BuilderCanvas, CONTAINER_PREFIX } from './canvas';
import { FormDiffView } from './diff-view';
import { LintPanel } from './lint-panel';
import { FieldPalette, PALETTE_PREFIX, type PaletteKind, paletteLabel } from './palette';
import { FormPreview } from './preview';
import { type BuilderSelection, PropertiesPanel } from './properties';
import { fieldFromBankItem, QuestionBankPanel } from './question-bank';
import { ElementIcon, useAnnouncer } from './shared';
import { TemplatesDialog } from './templates-dialog';
import { useBuilderHistory } from './use-builder-history';
import { type FormVersionSummary, VersionHistory } from './version-history';

export interface FormBuilderProps {
  /** The builder model (controlled). */
  model: FormModel;
  onChange: (model: FormModel) => void;
  /** Save the draft. The builder blocks saving while rules are circular. */
  onSave?: () => void | Promise<void>;
  saving?: boolean;
  lastSavedAt?: Date | string | null;
  /** Shown next to the save status when the last save failed. */
  saveError?: string;
  /** View only: no editing, dragging or publishing. */
  readOnly?: boolean;
  /** Workspace question-bank items, listed before the built-in bank. */
  questionBank?: readonly QuestionBankItem[];
  /** Workspace templates, listed before the built-in templates. */
  templates?: readonly FormTemplate[];
  /** Version history (FB-08). */
  versions?: readonly FormVersionSummary[];
  currentVersionId?: string;
  onLoadVersion?: (versionId: string) => Promise<FormModel>;
  onStartNewVersion?: () => void;
  /** The currently published model, used for the publish confirmation (what happens to applications in progress). */
  publishedModel?: FormModel;
  /** Publish this draft. Receives the model, the migration notice (when there is a published version) and the change note. */
  onPublish?: (args: { model: FormModel; notice?: MigrationNotice; changeNote: string }) => void | Promise<void>;
  publishing?: boolean;
  /** Friendly names for form flags, e.g. `{ aiDisclosure: 'AI-use disclosure' }`. */
  flagLabels?: Readonly<Record<string, string>>;
  className?: string;
}

type Mode = 'build' | 'preview' | 'check' | 'versions';
type Pane = 'add' | 'form' | 'settings';

function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type);
  return false;
}

/**
 * The form builder (FB-01…FB-08): palette / canvas / properties (tabs under 1024px), preview,
 * checks, version history, templates and import. Controlled: every edit calls `onChange` with the
 * next model; Ctrl+Z / Ctrl+Shift+Z undo and redo builder edits.
 */
export function FormBuilder(props: FormBuilderProps) {
  const { model, readOnly = false } = props;
  const history = useBuilderHistory(model, props.onChange);
  const modelRef = React.useRef(model);
  modelRef.current = model;
  const [mode, setMode] = React.useState<Mode>('build');
  const [pane, setPane] = React.useState<Pane>('form');
  const [leftTab, setLeftTab] = React.useState<'fields' | 'bank'>('fields');
  const [selection, setSelection] = React.useState<BuilderSelection>({ kind: 'form' });
  const [templatesOpen, setTemplatesOpen] = React.useState<false | 'templates' | 'import'>(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [changeNote, setChangeNote] = React.useState('');
  const [addPageId, setAddPageId] = React.useState<string | null>(null);
  const [liveRegion, announce] = useAnnouncer();
  const [activeDrag, setActiveDrag] = React.useState<string | null>(null);

  const issues = React.useMemo(() => lintForm(model), [model]);
  const cycles = React.useMemo(() => detectRuleCycles(model), [model]);
  const conflicts = React.useMemo(() => mappingConflicts(model), [model]);
  const conflictIds = React.useMemo(() => new Set([...conflicts.values()].flat()), [conflicts]);
  const errorCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) {
      if (i.level !== 'error') continue;
      const k = i.fieldId ?? i.pageId;
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [issues]);
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const rulesBroken = cycles.cycles.length > 0 || cycles.unknownReferences.length > 0 || cycles.nonQuestionReferences.length > 0;
  const publishable = canPublish(issues) && !rulesBroken;

  const edit = React.useCallback(
    (fn: (m: FormModel) => FormModel, key?: string) => {
      if (readOnly) return;
      const next = fn(modelRef.current);
      if (next !== modelRef.current) {
        modelRef.current = next;
        history.apply(next, key);
      }
    },
    [history, readOnly],
  );

  // ---- selection helpers -------------------------------------------------
  const selectedId = selection.kind === 'element' ? selection.id : null;
  const selectedLoc = selectedId ? locateElement(model, selectedId) : undefined;
  const selectedPageId = selection.kind === 'page' ? selection.id : (selectedLoc?.pageId ?? null);

  /** Where palette and question-bank items go. */
  const insertTarget = (): { container: ContainerId; index?: number; pageTitle: string; after?: string } | null => {
    const m = modelRef.current;
    if (addPageId) {
      const p = m.pages.find((x) => x.id === addPageId);
      if (p) return { container: pageContainer(p.id), pageTitle: p.title };
    }
    if (selectedId) {
      const loc = locateElement(m, selectedId);
      const el = getElement(m, selectedId);
      if (loc && el) {
        const page = m.pages[loc.pageIndex]!;
        if (el.type === 'section') return { container: `section:${el.id}`, pageTitle: page.title, after: `inside “${elementLabel(el)}”` };
        return { container: containerOf(loc), index: loc.index + 1, pageTitle: page.title, after: `after “${elementLabel(el)}”` };
      }
    }
    const pageId = selectedPageId ?? m.pages[m.pages.length - 1]?.id;
    const page = m.pages.find((p) => p.id === pageId);
    return page ? { container: pageContainer(page.id), pageTitle: page.title } : null;
  };
  const target = insertTarget();
  const targetLabel = target ? `“${target.pageTitle || 'Untitled page'}”${target.after ? `, ${target.after}` : ''}` : 'a new page';

  const select = (id: string) => {
    setSelection({ kind: 'element', id });
    setAddPageId(null);
  };
  /** Selecting from the canvas on a narrow screen opens the Settings pane (the panes are tabs there). */
  const selectFromCanvas = (next: BuilderSelection) => {
    setSelection(next);
    setAddPageId(null);
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023.98px)').matches) setPane('settings');
  };
  const jumpTo = (id: string) => {
    const m = modelRef.current;
    if (m.pages.some((p) => p.id === id)) setSelection({ kind: 'page', id });
    else setSelection({ kind: 'element', id });
    setMode('build');
    setPane('settings');
    setAddPageId(null);
    globalThis.setTimeout(() => document.getElementById(`builder-el-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  };

  // ---- element operations ------------------------------------------------
  const newElement = (m: FormModel, kind: PaletteKind): AnyElement => (kind === 'section' ? createSection(m) : kind === 'info_block' ? createInfoBlock(m) : createField(m, kind));

  const addAt = (element: AnyElement, container: ContainerId | null, index?: number) => {
    let m = modelRef.current;
    let c = container;
    if (!c) {
      const r = addPage(m, 'Page 1');
      m = r.model;
      c = pageContainer(r.pageId);
    }
    if (element.type === 'section' && c.startsWith('section:')) {
      const loc = locateElement(m, c.slice('section:'.length));
      if (loc) {
        c = pageContainer(loc.pageId);
        index = loc.index + 1;
      }
    }
    const next = insertElement(m, element, c, index);
    edit(() => next);
    select(element.id);
    const loc = locateElement(next, element.id);
    const pageTitle = loc ? next.pages[loc.pageIndex]!.title : '';
    announce(`Added “${elementLabel(element)}” to “${pageTitle}”.`);
  };
  const addFromPalette = (kind: PaletteKind) => {
    if (readOnly) return;
    const el = newElement(modelRef.current, kind);
    const t = insertTarget();
    addAt(el, t?.container ?? null, t?.index);
    setPane('settings');
  };
  const addFromBank = (item: QuestionBankItem) => {
    if (readOnly) return;
    const field = fieldFromBankItem(modelRef.current, item);
    const t = insertTarget();
    addAt(field, t?.container ?? null, t?.index);
  };

  const onMoveBy = (id: string, delta: -1 | 1) => {
    edit((m) => moveElementBy(m, id, delta));
    const m = modelRef.current;
    const loc = locateElement(m, id);
    const el = getElement(m, id);
    if (loc && el) announce(`Moved “${elementLabel(el)}” to position ${loc.index + 1} on “${m.pages[loc.pageIndex]!.title}”.`);
    globalThis.setTimeout(() => document.getElementById(`builder-el-${id}`)?.scrollIntoView({ block: 'nearest' }), 30);
  };
  const onMoveToPage = (id: string, pageId: string) => {
    edit((m) => moveElementToPage(m, id, pageId));
    const el = getElement(modelRef.current, id);
    const page = modelRef.current.pages.find((p) => p.id === pageId);
    if (el && page) announce(`Moved “${elementLabel(el)}” to the end of “${page.title}”.`);
  };
  const onDuplicate = (id: string) => {
    const r = duplicateElement(modelRef.current, id);
    if (!r.newId) return;
    edit(() => r.model);
    select(r.newId);
    announce(`Duplicated. The copy is selected.`);
  };
  const onDelete = (id: string) => {
    const before = modelRef.current;
    const el = getElement(before, id);
    if (!el) return;
    const refs = referencesTo(before, id);
    const fieldIds = el.type === 'section' ? el.elements.filter(isField).map((f) => f.id) : isField(el) ? [el.id] : [];
    const r = removeElement(before, id);
    if (!r.removed) return;
    const removed = r.removed;
    edit(() => r.model);
    if (selectedId === id) setSelection(removed.container.startsWith('page:') ? { kind: 'page', id: removed.container.slice(5) } : { kind: 'form' });
    const label = elementLabel(el);
    announce(`Deleted “${label}”.`);
    toast(`Deleted “${label}”`, {
      description: refs.length ? `${refs.length} ${refs.length === 1 ? 'rule points' : 'rules point'} to it. Undo, or update ${refs.length === 1 ? 'that rule' : 'those rules'}.` : fieldIds.length ? 'Answers to it will no longer be collected.' : undefined,
      action: {
        label: 'Undo',
        onClick: () => {
          edit((m) => restoreElement(m, removed));
          select(removed.element.id);
          announce(`Restored “${label}”.`);
        },
      },
    });
  };

  const onAddPage = () => {
    const r = addPage(modelRef.current);
    edit(() => r.model);
    setSelection({ kind: 'page', id: r.pageId });
    announce('Added a page. Its settings are open.');
  };
  const onMovePage = (pageId: string, delta: -1 | 1) => {
    edit((m) => movePage(m, pageId, delta));
    const i = modelRef.current.pages.findIndex((p) => p.id === pageId);
    announce(`Page moved to position ${i + 1}.`);
  };
  const onDeletePage = (pageId: string) => {
    const page = modelRef.current.pages.find((p) => p.id === pageId);
    if (!page) return;
    edit((m) => removePage(m, pageId));
    setSelection({ kind: 'form' });
    toast(`Deleted page “${page.title || 'Untitled page'}”`, {
      description: page.elements.length ? `It had ${page.elements.length} ${page.elements.length === 1 ? 'item' : 'items'}.` : undefined,
      action: { label: 'Undo', onClick: () => history.undo() },
    });
  };

  // ---- drag and drop -----------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const labelForDrag = (id: UniqueIdentifier): string => {
    const s = String(id);
    if (s.startsWith(PALETTE_PREFIX)) return `new ${paletteLabel(s.slice(PALETTE_PREFIX.length) as PaletteKind).toLowerCase()}`;
    const el = getElement(modelRef.current, s);
    return el ? `“${elementLabel(el)}”` : 'item';
  };
  const describeOver = (id: UniqueIdentifier | undefined): string => {
    if (id === undefined) return 'nowhere';
    const s = String(id);
    const m = modelRef.current;
    if (s.startsWith(CONTAINER_PREFIX)) {
      const c = s.slice(CONTAINER_PREFIX.length);
      if (c.startsWith('page:')) return `the end of page “${m.pages.find((p) => p.id === c.slice(5))?.title ?? ''}”`;
      const el = getElement(m, c.slice(8));
      return el ? `the end of section “${elementLabel(el)}”` : 'a section';
    }
    const loc = locateElement(m, s);
    const el = getElement(m, s);
    return loc && el ? `position ${loc.index + 1} on “${m.pages[loc.pageIndex]!.title}”, at “${elementLabel(el)}”` : 'the form';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${labelForDrag(active.id)}.`,
    onDragOver: ({ active, over }) => `${labelForDrag(active.id)} is over ${describeOver(over?.id)}.`,
    onDragEnd: ({ active, over }) => (over ? `Dropped ${labelForDrag(active.id)} at ${describeOver(over.id)}.` : `Dropped ${labelForDrag(active.id)}. Nothing moved.`),
    onDragCancel: ({ active }) => `Cancelled. ${labelForDrag(active.id)} did not move.`,
  };

  const resolveDrop = (overId: string, activeId: string): { container: ContainerId; index: number } | null => {
    const m = modelRef.current;
    if (overId.startsWith(CONTAINER_PREFIX)) {
      const c = overId.slice(CONTAINER_PREFIX.length) as ContainerId;
      const loc = locateElement(m, activeId);
      const sameContainer = loc && containerOf(loc) === c;
      const count = c.startsWith('page:') ? (m.pages.find((p) => p.id === c.slice(5))?.elements.length ?? 0) : (getElement(m, c.slice(8)) as { elements?: unknown[] } | undefined)?.elements?.length ?? 0;
      return { container: c, index: sameContainer ? count - 1 : count };
    }
    const loc = locateElement(m, overId);
    if (!loc) return null;
    return { container: containerOf(loc), index: loc.index };
  };

  const onDragStart = ({ active }: DragStartEvent) => setActiveDrag(String(active.id));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveDrag(null);
    if (!over || readOnly) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    const drop = resolveDrop(overId, activeId);
    if (!drop) return;
    if (activeId.startsWith(PALETTE_PREFIX)) {
      const kind = activeId.slice(PALETTE_PREFIX.length) as PaletteKind;
      addAt(newElement(modelRef.current, kind), drop.container, drop.index);
      return;
    }
    const before = modelRef.current;
    const next = moveElement(before, activeId, drop.container, drop.index);
    if (next === before) {
      const el = getElement(before, activeId);
      if (el?.type === 'section' && drop.container.startsWith('section:')) announce('Sections can’t go inside other sections.');
      return;
    }
    edit(() => next);
  };

  // ---- keyboard shortcuts --------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextEntry(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (history.canUndo) {
        history.undo();
        announce('Undone.');
      }
    } else if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault();
      if (history.canRedo) {
        history.redo();
        announce('Redone.');
      }
    }
  };

  // ---- save / publish ------------------------------------------------------
  const notice = props.publishedModel ? migrationNotice(props.publishedModel, model) : undefined;
  const save = () => {
    if (rulesBroken) {
      toast.error('Fix the circular or broken rules before saving.');
      setMode('check');
      return;
    }
    void props.onSave?.();
  };
  const publish = async () => {
    await props.onPublish?.({ model, ...(notice ? { notice } : {}), changeNote: changeNote.trim() });
    setPublishOpen(false);
    setChangeNote('');
  };

  const dragKind = activeDrag?.startsWith(PALETTE_PREFIX) ? (activeDrag.slice(PALETTE_PREFIX.length) as PaletteKind) : undefined;
  const dragEl = activeDrag && !dragKind ? getElement(model, activeDrag) : undefined;
  const hasContent = listFields(model).length > 0 || model.pages.some((p) => p.elements.length > 0);

  return (
    <TooltipProvider>
      <div data-slot="form-builder" className={cn('grid gap-4', props.className)} onKeyDown={onKeyDown}>
        {liveRegion}
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div className="grid min-w-0 gap-0.5">
            <h2 className="truncate font-heading text-xl font-semibold">{model.title || 'Untitled form'}</h2>
            <p className="text-xs text-muted-foreground">
              {model.pages.length} {model.pages.length === 1 ? 'page' : 'pages'} · {listFields(model).length} questions
              {readOnly ? ' · View only' : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly ? (
              <>
                <SimpleTooltip content={<span>Undo <Kbd>Ctrl Z</Kbd></span>}>
                  <Button type="button" variant="ghost" size="icon" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" aria-keyshortcuts="Control+Z">
                    <Undo2 aria-hidden="true" />
                  </Button>
                </SimpleTooltip>
                <SimpleTooltip content={<span>Redo <Kbd>Ctrl Shift Z</Kbd></span>}>
                  <Button type="button" variant="ghost" size="icon" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" aria-keyshortcuts="Control+Shift+Z">
                    <Redo2 aria-hidden="true" />
                  </Button>
                </SimpleTooltip>
                <Button type="button" variant="outline" size="sm" onClick={() => setTemplatesOpen('templates')}>
                  <LayoutTemplate aria-hidden="true" />
                  Templates & import
                </Button>
              </>
            ) : null}
            {props.onSave ? (
              <>
                <AutosaveIndicator
                  status={props.saveError ? 'error' : props.saving ? 'saving' : props.lastSavedAt ? 'saved' : 'idle'}
                  savedAt={props.lastSavedAt ? new Date(props.lastSavedAt) : null}
                  errorMessage={props.saveError}
                  onRetry={save}
                />
                {!readOnly ? (
                  <Button type="button" variant="outline" size="sm" onClick={save} pending={props.saving} pendingLabel="Saving…">
                    <Save aria-hidden="true" />
                    Save draft
                  </Button>
                ) : null}
              </>
            ) : null}
            {props.onPublish && !readOnly ? (
              <Button type="button" size="sm" onClick={() => (publishable ? setPublishOpen(true) : setMode('check'))} pending={props.publishing} pendingLabel="Publishing…">
                <Rocket aria-hidden="true" />
                Publish
              </Button>
            ) : null}
          </div>
        </div>

        {rulesBroken ? (
          <Alert variant="danger" title="Some rules can’t work" actions={<Button type="button" size="sm" variant="outline" onClick={() => setMode('check')}>Review problems</Button>}>
            {cycles.cycles.length ? 'At least one rule is circular, so those questions could never appear. ' : ''}
            {cycles.unknownReferences.length || cycles.nonQuestionReferences.length ? 'Some rules point at questions that are no longer in the form. ' : ''}
            Saving is blocked until they are fixed.
          </Alert>
        ) : null}

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList aria-label="Builder views">
            <TabsTrigger value="build">Build</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="check">
              Check
              {errorCount ? (
                <Badge variant="danger" className="ml-1">
                  {errorCount}
                  <span className="sr-only"> {errorCount === 1 ? 'problem' : 'problems'} to fix</span>
                </Badge>
              ) : null}
            </TabsTrigger>
            {props.versions ? <TabsTrigger value="versions">Versions</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="build">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveDrag(null)}
              accessibility={{
                announcements,
                screenReaderInstructions: {
                  draggable:
                    'To move this item, press Space or Enter, use the arrow keys to move it, then press Space or Enter to drop it. Press Escape to cancel. The item’s Actions menu also has Move up, Move down and Move to page.',
                },
              }}
            >
              {/* Pane switcher under 1024px */}
              <div role="group" aria-label="Builder panes" className="mb-3 inline-flex rounded-md border bg-muted p-0.5 lg:hidden">
                {(
                  [
                    ['add', 'Add'],
                    ['form', 'Form'],
                    ['settings', 'Settings'],
                  ] as const
                ).map(([p, label]) => (
                  <Button key={p} type="button" size="sm" variant={pane === p ? 'secondary' : 'ghost'} aria-pressed={pane === p} onClick={() => setPane(p)}>
                    {label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)_22rem] lg:items-start">
                <aside aria-label="Add to the form" className={cn('grid gap-3 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto', pane !== 'add' && 'hidden')}>
                  <Tabs value={leftTab} onValueChange={(v) => setLeftTab(v as 'fields' | 'bank')} className="gap-3">
                    <TabsList variant="pill" className="w-full">
                      <TabsTrigger value="fields" className="flex-1">
                        Field types
                      </TabsTrigger>
                      <TabsTrigger value="bank" className="flex-1">
                        Question bank
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="fields">
                      <FieldPalette onAdd={addFromPalette} targetLabel={targetLabel} disabled={readOnly} />
                    </TabsContent>
                    <TabsContent value="bank">
                      <QuestionBankPanel workspaceItems={props.questionBank} onInsert={addFromBank} targetLabel={targetLabel} disabled={readOnly} />
                    </TabsContent>
                  </Tabs>
                </aside>
                <section aria-label="Form pages" className={cn('min-w-0 lg:block', pane !== 'form' && 'hidden')}>
                  <BuilderCanvas
                    model={model}
                    selectedId={selectedId}
                    selectedPageId={selection.kind === 'page' ? selection.id : null}
                    readOnly={readOnly}
                    mappingConflictIds={conflictIds}
                    errorCounts={errorCounts}
                    onSelect={(id) => selectFromCanvas({ kind: 'element', id })}
                    onSelectPage={(id) => selectFromCanvas({ kind: 'page', id })}
                    onMoveBy={onMoveBy}
                    onMoveToPage={onMoveToPage}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                    onAddPage={onAddPage}
                    onMovePage={onMovePage}
                    onDeletePage={onDeletePage}
                    onRequestAdd={(pageId) => {
                      setAddPageId(pageId);
                      setSelection({ kind: 'page', id: pageId });
                      setPane('add');
                      setLeftTab('fields');
                      announce(`New questions will be added to the end of “${model.pages.find((p) => p.id === pageId)?.title ?? ''}”. Choose a field type.`);
                    }}
                  />
                </section>
                <aside aria-label="Settings" className={cn('rounded-lg border bg-card p-4 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto', pane !== 'settings' && 'hidden')}>
                  <PropertiesPanel
                    model={model}
                    selection={selection}
                    edit={edit}
                    readOnly={readOnly}
                    flagLabels={props.flagLabels}
                    onJump={jumpTo}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                    onDeletePage={onDeletePage}
                  />
                </aside>
              </div>
              <DragOverlay dropAnimation={null}>
                {dragKind ? (
                  <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm shadow-overlay">
                    <ElementIcon type={dragKind} />
                    {paletteLabel(dragKind)}
                  </div>
                ) : dragEl ? (
                  <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm shadow-overlay">
                    <ElementIcon type={dragEl.type} />
                    {elementLabel(dragEl)}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </TabsContent>

          <TabsContent value="preview">{mode === 'preview' ? <FormPreview model={model} /> : null}</TabsContent>

          <TabsContent value="check" className="grid gap-4">
            <LintPanel
              model={model}
              issues={issues}
              onJump={({ fieldId, pageId }) => {
                if (fieldId && getElement(model, fieldId)) jumpTo(fieldId);
                else if (pageId) jumpTo(pageId);
              }}
            />
          </TabsContent>

          {props.versions ? (
            <TabsContent value="versions">
              <VersionHistory
                versions={props.versions}
                currentModel={model}
                currentVersionId={props.currentVersionId}
                onLoadVersion={props.onLoadVersion}
                onStartNewVersion={props.onStartNewVersion}
                readOnly={readOnly}
              />
            </TabsContent>
          ) : null}
        </Tabs>

        <TemplatesDialog
          open={templatesOpen !== false}
          initialTab={templatesOpen === 'import' ? 'import' : 'templates'}
          onOpenChange={(o) => setTemplatesOpen(o ? 'templates' : false)}
          templates={props.templates}
          hasContent={hasContent}
          onReplace={(next, source) => {
            edit(() => next);
            setSelection({ kind: 'form' });
            announce(`The form now uses “${source}”. Press Undo to go back.`);
            toast(`Replaced the form with “${source}”`, { action: { label: 'Undo', onClick: () => history.undo() } });
          }}
        />

        <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Publish this version?</AlertDialogTitle>
              <AlertDialogDescription>
                {notice ? notice.summary : 'Applicants will see this form as soon as the opportunity opens.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {props.publishedModel ? (
              <div className="max-h-[50dvh] overflow-y-auto">
                <FormDiffView before={props.publishedModel} after={model} beforeLabel="the published version" afterLabel="this draft" showMigration={false} />
              </div>
            ) : null}
            {notice && notice.details.length > 1 ? (
              <ul className="list-disc pl-5 text-sm">
                {notice.details.slice(1).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
            <Field label="What changed?" htmlFor="builder-change-note" description="Optional. Shown in the version history for your team.">
              <Textarea rows={2} value={changeNote} onChange={(e) => setChangeNote(e.currentTarget.value)} />
            </Field>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void publish();
                }}
              >
                Publish
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
