// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@gms/ui';
import { ArrowDown, ArrowUp, CircleAlert, Copy, Ellipsis, FolderInput, GripVertical, Plus, Trash } from 'lucide-react';
import * as React from 'react';
import type { FormModel, Page, Section } from '../../model';
import { type AnyElement, elementLabel, FIELD_TYPE_LABELS, type ContainerId } from '../builder-ops';
import { ElementBadges, ElementIcon } from './shared';

export const CONTAINER_PREFIX = 'container:';

export function containerDroppableId(c: ContainerId): string {
  return `${CONTAINER_PREFIX}${c}`;
}

export interface CanvasActions {
  onSelect: (id: string) => void;
  onSelectPage: (pageId: string) => void;
  onMoveBy: (id: string, delta: -1 | 1) => void;
  onMoveToPage: (id: string, pageId: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddPage: () => void;
  onMovePage: (pageId: string, delta: -1 | 1) => void;
  onDeletePage: (pageId: string) => void;
  /** "Add a question" on a page: points the palette at that page. */
  onRequestAdd: (pageId: string) => void;
}

export interface BuilderCanvasProps extends CanvasActions {
  model: FormModel;
  selectedId: string | null;
  selectedPageId: string | null;
  readOnly?: boolean;
  /** Field ids whose CommonGrants path is also used by another field. */
  mappingConflictIds: ReadonlySet<string>;
  /** Element or page id → number of lint errors. */
  errorCounts: ReadonlyMap<string, number>;
}

function typeName(el: AnyElement): string {
  if (el.type === 'section') return 'Section';
  if (el.type === 'info_block') return 'Text block';
  return FIELD_TYPE_LABELS[el.type];
}

export function BuilderCanvas(props: BuilderCanvasProps) {
  const { model, readOnly } = props;
  if (model.pages.length === 0) {
    return (
      <div className="grid place-items-center gap-3 rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">This form has no pages yet.</p>
        <p className="text-sm text-muted-foreground">Add a page, then add questions to it from the list of field types.</p>
        {!readOnly ? (
          <Button type="button" onClick={props.onAddPage}>
            <Plus aria-hidden="true" />
            Add page
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      {model.pages.map((page, i) => (
        <PageCard key={page.id} page={page} index={i} count={model.pages.length} {...props} />
      ))}
      {!readOnly ? (
        <Button type="button" variant="outline" className="justify-self-start" onClick={props.onAddPage}>
          <Plus aria-hidden="true" />
          Add page
        </Button>
      ) : null}
    </div>
  );
}

function PageCard({ page, index, count, ...props }: BuilderCanvasProps & { page: Page; index: number; count: number }) {
  const container: ContainerId = `page:${page.id}`;
  const { setNodeRef, isOver } = useDroppable({ id: containerDroppableId(container), disabled: props.readOnly });
  const headingId = `builder-page-${page.id}`;
  const selected = props.selectedPageId === page.id && props.selectedId === null;
  const errors = props.errorCounts.get(page.id) ?? 0;
  return (
    <section aria-labelledby={headingId} className={cn('rounded-lg border bg-card shadow-soft', selected && 'ring-2 ring-ring')}>
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={() => props.onSelectPage(page.id)}
          aria-pressed={selected}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="text-xs font-medium text-muted-foreground tabular-nums">Page {index + 1}</span>
          <h3 id={headingId} className="truncate font-heading text-base font-semibold">
            {page.title || 'Untitled page'}
          </h3>
          {errors ? (
            <span className="inline-flex items-center gap-1 text-xs text-status-danger-fg">
              <CircleAlert className="size-3.5" aria-hidden="true" />
              {errors} to fix
            </span>
          ) : null}
        </button>
        {!props.readOnly ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for page “${page.title || 'Untitled page'}”`}>
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => props.onSelectPage(page.id)}>Rename page</DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => props.onMovePage(page.id, -1)}>
                <ArrowUp aria-hidden="true" />
                Move page up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => props.onMovePage(page.id, 1)}>
                <ArrowDown aria-hidden="true" />
                Move page down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => props.onDeletePage(page.id)}>
                <Trash aria-hidden="true" />
                Delete page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      <div ref={setNodeRef} className={cn('grid gap-2 p-3 transition-colors', isOver && 'bg-accent/50')}>
        <SortableContext id={container} items={page.elements.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <ul className="grid gap-2" aria-label={`Questions on “${page.title || 'Untitled page'}”`}>
            {page.elements.map((el, i) =>
              el.type === 'section' ? (
                <SortableSection key={el.id} section={el} index={i} siblings={page.elements.length} page={page} {...props} />
              ) : (
                <SortableCard key={el.id} element={el} index={i} siblings={page.elements.length} page={page} {...props} />
              ),
            )}
          </ul>
        </SortableContext>
        {page.elements.length === 0 ? <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No questions on this page yet.</p> : null}
        {!props.readOnly ? (
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => props.onRequestAdd(page.id)}>
            <Plus aria-hidden="true" />
            Add a question to this page
          </Button>
        ) : null}
      </div>
    </section>
  );
}

interface CardProps extends BuilderCanvasProps {
  element: AnyElement;
  index: number;
  siblings: number;
  page: Page;
  inSection?: boolean;
  children?: React.ReactNode;
}

function CardMenu({ element, index, siblings, page, inSection, ...props }: Omit<CardProps, 'children'>) {
  const label = elementLabel(element);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for “${label}”`}>
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="max-w-64 truncate">{label}</DropdownMenuLabel>
        <DropdownMenuItem disabled={index === 0 && !inSection} onSelect={() => props.onMoveBy(element.id, -1)}>
          <ArrowUp aria-hidden="true" />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === siblings - 1 && !inSection} onSelect={() => props.onMoveBy(element.id, 1)}>
          <ArrowDown aria-hidden="true" />
          Move down
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderInput aria-hidden="true" />
            Move to page…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {props.model.pages.map((p, i) => (
              <DropdownMenuItem key={p.id} disabled={p.id === page.id && !inSection} onSelect={() => props.onMoveToPage(element.id, p.id)}>
                {i + 1}. {p.title || 'Untitled page'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => props.onDuplicate(element.id)}>
          <Copy aria-hidden="true" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete(element.id)}>
          <Trash aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CardBody({ element, selected, errorCount, onSelect, conflict }: { element: AnyElement; selected: boolean; errorCount: number; onSelect: () => void; conflict: boolean }) {
  const label = elementLabel(element);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="grid min-h-11 min-w-0 flex-1 gap-1 rounded-md px-1 py-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex min-w-0 items-center gap-2">
        <ElementIcon type={element.type} />
        <span className="truncate text-sm font-medium">{label}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-xs text-muted-foreground">
        <span>{typeName(element)}</span>
        {element.type !== 'section' && element.type !== 'info_block' ? <span className="font-mono">{element.id}</span> : null}
        {errorCount ? (
          <span className="inline-flex items-center gap-1 text-status-danger-fg">
            <CircleAlert className="size-3.5" aria-hidden="true" />
            {errorCount} to fix
          </span>
        ) : null}
        <ElementBadges element={element} mappingConflict={conflict} />
      </span>
    </button>
  );
}

function DragHandle({ label, attributes, listeners, setRef, disabled }: { label: string; attributes: ReturnType<typeof useSortable>['attributes']; listeners: ReturnType<typeof useSortable>['listeners']; setRef: (el: HTMLElement | null) => void; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <button
      ref={setRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Drag “${label}” to reorder`}
      className="grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}

function SortableCard(props: CardProps) {
  const { element } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: element.id, disabled: props.readOnly });
  const selected = props.selectedId === element.id;
  return (
    <li
      ref={setNodeRef}
      id={`builder-el-${element.id}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex items-start gap-1 rounded-md border bg-card p-1.5 shadow-soft transition-shadow',
        selected && 'border-primary ring-2 ring-ring',
        isDragging && 'z-10 opacity-60 shadow-overlay',
      )}
    >
      <DragHandle label={elementLabel(element)} attributes={attributes} listeners={listeners} setRef={setActivatorNodeRef} disabled={props.readOnly} />
      <CardBody
        element={element}
        selected={selected}
        errorCount={props.errorCounts.get(element.id) ?? 0}
        conflict={props.mappingConflictIds.has(element.id)}
        onSelect={() => props.onSelect(element.id)}
      />
      {!props.readOnly ? <CardMenu {...props} /> : null}
    </li>
  );
}

function SortableSection(props: Omit<CardProps, 'element'> & { section: Section }) {
  const { section } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled: props.readOnly });
  const container: ContainerId = `section:${section.id}`;
  const drop = useDroppable({ id: containerDroppableId(container), disabled: props.readOnly });
  const selected = props.selectedId === section.id;
  return (
    <li
      ref={setNodeRef}
      id={`builder-el-${section.id}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('rounded-md border border-dashed bg-muted/30 p-1.5', selected && 'border-primary ring-2 ring-ring', isDragging && 'z-10 opacity-60')}
    >
      <div className="flex items-start gap-1">
        <DragHandle label={elementLabel(section)} attributes={attributes} listeners={listeners} setRef={setActivatorNodeRef} disabled={props.readOnly} />
        <CardBody element={section} selected={selected} errorCount={props.errorCounts.get(section.id) ?? 0} conflict={false} onSelect={() => props.onSelect(section.id)} />
        {!props.readOnly ? <CardMenu {...props} element={section} /> : null}
      </div>
      <div ref={drop.setNodeRef} className={cn('mt-1.5 ml-4 grid gap-2 border-l-2 pl-3', drop.isOver && 'bg-accent/50')}>
        <SortableContext id={container} items={section.elements.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <ul className="grid gap-2" aria-label={`Questions in “${elementLabel(section)}”`}>
            {section.elements.map((child, i) => (
              <SortableCard key={child.id} {...props} element={child} index={i} siblings={section.elements.length} inSection />
            ))}
          </ul>
        </SortableContext>
        {section.elements.length === 0 ? <p className="py-2 text-xs text-muted-foreground">Drag questions here, or use a question’s “Move” actions.</p> : null}
      </div>
    </li>
  );
}
