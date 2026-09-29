// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowRight, ArrowUp, Ellipsis, GripVertical } from 'lucide-react';
import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/dropdown-menu';
import { cn } from '../lib/utils';

export interface KanbanColumn {
  id: string;
  title: string;
  description?: string;
}

export interface KanbanItem {
  id: string;
  columnId: string;
}

export interface KanbanMove {
  itemId: string;
  fromColumnId: string;
  toColumnId: string;
  /** Position in the destination column after the move (0-based). */
  toIndex: number;
}

export interface KanbanProps<T extends KanbanItem> {
  /** Accessible name for the board, e.g. "Review pipeline". */
  label: string;
  columns: KanbanColumn[];
  /** Items in display order. */
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  /** Short name used in announcements and menus, e.g. the applicant's name. */
  getItemLabel: (item: T) => string;
  onMove: (move: KanbanMove) => void;
  /** Return false to block a move (e.g. a stage that requires a decision). */
  canMove?: (item: T, toColumnId: string) => boolean;
  className?: string;
}

type Board = Record<string, string[]>;
const COLUMN_PREFIX = 'column:';

function buildBoard(columns: KanbanColumn[], items: KanbanItem[]): Board {
  const b: Board = Object.fromEntries(columns.map((c) => [c.id, [] as string[]]));
  for (const it of items) b[it.columnId]?.push(it.id);
  return b;
}

function findColumn(board: Board, id: UniqueIdentifier): string | undefined {
  const s = String(id);
  if (s.startsWith(COLUMN_PREFIX)) return s.slice(COLUMN_PREFIX.length);
  return Object.keys(board).find((c) => board[c]!.includes(s));
}

/**
 * Drag-and-drop board. Keyboard users can drag with Space/arrow keys, or use each card's
 * "Move to…" menu, which does the same thing without dragging.
 */
export function Kanban<T extends KanbanItem>({ label, columns, items, renderItem, getItemLabel, onMove, canMove, className }: KanbanProps<T>) {
  const [board, setBoard] = React.useState<Board>(() => buildBoard(columns, items));
  const boardRef = React.useRef(board);
  boardRef.current = board;
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const origin = React.useRef<string | null>(null);

  React.useEffect(() => {
    setBoard(buildBoard(columns, items));
  }, [columns, items]);

  const byId = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const colTitle = React.useCallback((id: string | undefined) => columns.find((c) => c.id === id)?.title ?? 'column', [columns]);
  const itemLabel = React.useCallback((id: UniqueIdentifier) => {
    const it = byId.get(String(id));
    return it ? getItemLabel(it) : 'card';
  }, [byId, getItemLabel]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const position = (id: UniqueIdentifier) => {
    const col = findColumn(boardRef.current, id);
    if (!col) return '';
    const list = boardRef.current[col]!;
    return `${colTitle(col)}, position ${list.indexOf(String(id)) + 1} of ${list.length}`;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${itemLabel(active.id)} in ${position(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${itemLabel(active.id)} is now in ${position(active.id)}.` : `${itemLabel(active.id)} is no longer over a column.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${itemLabel(active.id)} in ${position(active.id)}.` : `Dropped ${itemLabel(active.id)}.`),
    onDragCancel: ({ active }) => `Move cancelled. ${itemLabel(active.id)} is back in ${colTitle(origin.current ?? undefined)}.`,
  };

  const commit = (itemId: string, from: string, to: string, toIndex: number) => {
    const item = byId.get(itemId);
    if (!item) return;
    if (from !== to && canMove && !canMove(item, to)) {
      setBoard(buildBoard(columns, items));
      return;
    }
    onMove({ itemId, fromColumnId: from, toColumnId: to, toIndex });
  };

  const moveByMenu = (itemId: string, to: string, toIndex: number) => {
    const from = findColumn(board, itemId);
    if (!from) return;
    setBoard((b) => {
      const next = { ...b, [from]: b[from]!.filter((x) => x !== itemId) };
      const dest = [...(next[to] ?? [])];
      dest.splice(Math.max(0, Math.min(toIndex, dest.length)), 0, itemId);
      next[to] = dest;
      return next;
    });
    commit(itemId, from, to, toIndex);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    origin.current = findColumn(board, active.id) ?? null;
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findColumn(board, active.id);
    const to = findColumn(board, over.id);
    if (!from || !to || from === to) return;
    setBoard((b) => {
      const src = b[from]!.filter((x) => x !== active.id);
      const dest = [...b[to]!];
      const overIndex = dest.indexOf(String(over.id));
      dest.splice(overIndex >= 0 ? overIndex : dest.length, 0, String(active.id));
      return { ...b, [from]: src, [to]: dest };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const start = origin.current;
    origin.current = null;
    if (!over || !start) {
      setBoard(buildBoard(columns, items));
      return;
    }
    const col = findColumn(board, active.id);
    if (!col) return;
    let list = board[col]!;
    const oldIndex = list.indexOf(String(active.id));
    const overIndex = list.indexOf(String(over.id));
    if (overIndex >= 0 && overIndex !== oldIndex) {
      list = arrayMove(list, oldIndex, overIndex);
      setBoard((b) => ({ ...b, [col]: list }));
    }
    const toIndex = list.indexOf(String(active.id));
    const originalIndex = buildBoard(columns, items)[start]?.indexOf(String(active.id)) ?? -1;
    if (col !== start || toIndex !== originalIndex) commit(String(active.id), start, col, toIndex);
  };

  const active = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setBoard(buildBoard(columns, items));
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To move a card, press Space or Enter on its drag handle, use the arrow keys to move it, then press Space or Enter to drop it. Press Escape to cancel. You can also use the card’s Move menu.',
        },
      }}
    >
      <div role="region" aria-label={label} className={cn('flex gap-3 overflow-x-auto pb-2', className)}>
        {columns.map((col) => (
          <KanbanColumnView key={col.id} column={col} count={board[col.id]?.length ?? 0}>
            <SortableContext id={col.id} items={board[col.id] ?? []} strategy={verticalListSortingStrategy}>
              <ul className="grid gap-2" aria-label={`${col.title} cards`}>
                {(board[col.id] ?? []).map((id, index, list) => {
                  const item = byId.get(id);
                  if (!item) return null;
                  return (
                    <SortableCard
                      key={id}
                      id={id}
                      label={getItemLabel(item)}
                      columns={columns}
                      columnId={col.id}
                      index={index}
                      count={list.length}
                      canMoveTo={(to) => !canMove || canMove(item, to)}
                      onMoveTo={(to) => moveByMenu(id, to, board[to]?.length ?? 0)}
                      onMoveBy={(delta) => moveByMenu(id, col.id, index + delta)}
                    >
                      {renderItem(item)}
                    </SortableCard>
                  );
                })}
              </ul>
            </SortableContext>
          </KanbanColumnView>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="rotate-1 rounded-md border bg-card p-3 text-sm shadow-overlay">{renderItem(active)}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumnView({ column, count, children }: { column: KanbanColumn; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${column.id}` });
  const headingId = React.useId();
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        'flex w-72 shrink-0 flex-col gap-2 rounded-lg border bg-muted/50 p-2 transition-colors duration-150',
        isOver && 'border-primary/50 bg-accent',
      )}
    >
      <header className="flex items-baseline justify-between gap-2 px-1 pt-1">
        <h3 id={headingId} className="text-sm font-semibold">
          {column.title}
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {count}
          <span className="sr-only"> cards</span>
        </span>
      </header>
      {column.description ? <p className="px-1 text-xs text-muted-foreground">{column.description}</p> : null}
      <div className="min-h-16">{children}</div>
    </section>
  );
}

function SortableCard({
  id,
  label,
  columns,
  columnId,
  index,
  count,
  canMoveTo,
  onMoveTo,
  onMoveBy,
  children,
}: {
  id: string;
  label: string;
  columns: KanbanColumn[];
  columnId: string;
  index: number;
  count: number;
  canMoveTo: (to: string) => boolean;
  onMoveTo: (to: string) => void;
  onMoveBy: (delta: number) => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex gap-1 rounded-md border bg-card p-2 text-sm shadow-soft',
        isDragging && 'opacity-40',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag ${label}`}
        className="grid w-6 shrink-0 cursor-grab touch-none place-items-center self-stretch rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1 py-0.5">{children}</div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-7 shrink-0 place-items-center self-start rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`Move ${label}`}
        >
          <Ellipsis className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Move to…</DropdownMenuLabel>
          {columns
            .filter((c) => c.id !== columnId)
            .map((c) => (
              <DropdownMenuItem key={c.id} disabled={!canMoveTo(c.id)} onSelect={() => onMoveTo(c.id)}>
                <ArrowRight aria-hidden="true" />
                {c.title}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={index === 0} onSelect={() => onMoveBy(-1)}>
            <ArrowUp aria-hidden="true" />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index >= count - 1} onSelect={() => onMoveBy(1)}>
            <ArrowDown aria-hidden="true" />
            Move down
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
