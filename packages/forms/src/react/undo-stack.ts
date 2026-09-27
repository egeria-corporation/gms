// SPDX-License-Identifier: AGPL-3.0-only
// A small immutable undo/redo stack for the form builder. React-free.

export interface UndoStack<T> {
  past: T[];
  present: T;
  future: T[];
  /** Key of the last recorded change, used to merge bursts (typing a label) into one step. */
  lastKey?: string;
  lastAt?: number;
}

export interface RecordOptions {
  /**
   * Changes with the same key recorded within `mergeWindowMs` of each other become one undo step
   * (e.g. `label:project_title` while someone types).
   */
  key?: string;
  /** Timestamp in ms (injectable for tests). */
  now?: number;
  mergeWindowMs?: number;
  /** Maximum number of undo steps kept. */
  limit?: number;
}

export const DEFAULT_UNDO_LIMIT = 100;
export const DEFAULT_MERGE_WINDOW_MS = 1000;

export function createUndoStack<T>(present: T): UndoStack<T> {
  return { past: [], present, future: [] };
}

/** Records a new present value. Clears the redo stack. */
export function recordChange<T>(stack: UndoStack<T>, next: T, opts: RecordOptions = {}): UndoStack<T> {
  if (Object.is(next, stack.present)) return stack;
  const now = opts.now ?? Date.now();
  const windowMs = opts.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
  const limit = opts.limit ?? DEFAULT_UNDO_LIMIT;
  const merge = opts.key !== undefined && opts.key === stack.lastKey && stack.lastAt !== undefined && now - stack.lastAt <= windowMs && stack.future.length === 0;
  const past = merge ? stack.past : [...stack.past, stack.present].slice(-limit);
  return { past, present: next, future: [], ...(opts.key !== undefined ? { lastKey: opts.key, lastAt: now } : {}) };
}

export function canUndo<T>(stack: UndoStack<T>): boolean {
  return stack.past.length > 0;
}

export function canRedo<T>(stack: UndoStack<T>): boolean {
  return stack.future.length > 0;
}

export function undo<T>(stack: UndoStack<T>): UndoStack<T> {
  if (!stack.past.length) return stack;
  const previous = stack.past[stack.past.length - 1] as T;
  return { past: stack.past.slice(0, -1), present: previous, future: [stack.present, ...stack.future] };
}

export function redo<T>(stack: UndoStack<T>): UndoStack<T> {
  if (!stack.future.length) return stack;
  const [next, ...rest] = stack.future as [T, ...T[]];
  return { past: [...stack.past, stack.present], present: next, future: rest };
}

/**
 * Replaces the present without recording a step (used when the parent hands the builder a model
 * that did not come from the builder itself, e.g. after a reload).
 */
export function resetPresent<T>(stack: UndoStack<T>, present: T): UndoStack<T> {
  if (Object.is(present, stack.present)) return stack;
  return { past: stack.past, present, future: [] };
}
