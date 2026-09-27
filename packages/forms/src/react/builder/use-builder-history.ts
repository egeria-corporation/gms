// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import * as React from 'react';
import type { FormModel } from '../../model';
import { canRedo, canUndo, createUndoStack, recordChange, redo, resetPresent, undo, type UndoStack } from '../undo-stack';

export interface BuilderHistory {
  /** Records `next` as one undo step (merged with the previous step when `key` repeats quickly) and emits it. */
  apply: (next: FormModel, key?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Undo/redo for a controlled model. External model changes (not from `apply`) reset the redo stack. */
export function useBuilderHistory(model: FormModel, onChange: (model: FormModel) => void): BuilderHistory {
  const [stack, setStack] = React.useState<UndoStack<FormModel>>(() => createUndoStack(model));
  const stackRef = React.useRef(stack);
  // Adopt models that arrive from outside (e.g. a reload), keeping undo history.
  let current = stack;
  if (model !== stack.present) {
    current = resetPresent(stack, model);
    setStack(current);
  }
  stackRef.current = current;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const apply = React.useCallback((next: FormModel, key?: string) => {
    const s = recordChange(stackRef.current, next, key ? { key } : {});
    if (s === stackRef.current) return;
    stackRef.current = s;
    setStack(s);
    onChangeRef.current(next);
  }, []);
  const doUndo = React.useCallback(() => {
    const s = undo(stackRef.current);
    if (s === stackRef.current) return;
    stackRef.current = s;
    setStack(s);
    onChangeRef.current(s.present);
  }, []);
  const doRedo = React.useCallback(() => {
    const s = redo(stackRef.current);
    if (s === stackRef.current) return;
    stackRef.current = s;
    setStack(s);
    onChangeRef.current(s.present);
  }, []);
  return { apply, undo: doUndo, redo: doRedo, canUndo: canUndo(current), canRedo: canRedo(current) };
}
