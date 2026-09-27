// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import * as React from 'react';
import type { ResponseError } from '../validate';
import { type AutosaveConflict, AutosaveQueue, type AutosaveFn, type AutosaveState } from './autosave-queue';

export interface UseAutosaveOptions {
  /** Saves only the changed fields. Resolve with the new etag, save-mode errors and any conflicts. */
  save: AutosaveFn;
  debounceMs?: number;
  /** The etag the answers were loaded with. Changing it (after a reload) updates the queue. */
  etag?: string;
  backoffMs?: readonly number[];
  /** Warn before closing the tab while changes are unsaved (default true). */
  warnOnUnload?: boolean;
}

export interface UseAutosaveResult extends AutosaveState {
  /** Queue changed fields (call from GmsForm's onChange with the changed ids' values). */
  queue: (changed: Record<string, unknown>) => void;
  /** Save now (e.g. before Next or Submit). Resolves when the queue is idle. */
  flush: () => Promise<void>;
  /** Retry after an error. */
  retry: () => void;
  hasUnsavedChanges: () => boolean;
  /** Keep your value: re-sends it with the latest etag and clears the notice. */
  keepMine: (conflict: AutosaveConflict) => void;
  /** Use their value: clears the notice and returns the value to put in the form. */
  acceptTheirs: (conflict: AutosaveConflict) => unknown;
  /** Props for @gms/ui's AutosaveIndicator. */
  indicator: { status: AutosaveState['status']; savedAt: Date | null; onRetry: () => void; errorMessage?: string };
  /** Save-mode errors reported by the server for fields saved so far. */
  errors: ResponseError[];
}

/**
 * Debounced autosave of changed fields only. One request is in flight at a time; later edits
 * queue and go out when it finishes. When the device is offline (or a request fails to reach the
 * server) the status becomes "offline" and saves retry with backoff; they also retry as soon as
 * the browser reports it is back online.
 */
export function useAutosave({ save, debounceMs = 800, etag, backoffMs, warnOnUnload = true }: UseAutosaveOptions): UseAutosaveResult {
  const saveRef = React.useRef(save);
  saveRef.current = save;
  const [state, setState] = React.useState<AutosaveState>(() => ({
    status: 'idle',
    etag,
    savedAt: null,
    pendingFieldIds: [],
    errors: [],
    conflicts: [],
    attempt: 0,
    nextRetryAt: null,
  }));
  const queueRef = React.useRef<AutosaveQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new AutosaveQueue({
      save: (changed, tag) => saveRef.current(changed, tag),
      debounceMs,
      etag,
      backoffMs,
      onState: setState,
    });
  }
  const q = queueRef.current;

  React.useEffect(() => {
    q.setEtag(etag);
  }, [q, etag]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => q.online();
    const off = () => q.offline();
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [q]);

  React.useEffect(() => {
    if (!warnOnUnload || typeof window === 'undefined') return;
    const handler = (e: BeforeUnloadEvent) => {
      if (!q.hasUnsavedChanges()) return;
      void q.flush();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [q, warnOnUnload]);

  React.useEffect(() => {
    q.activate(); // Strict Mode unmounts and remounts effects; the same queue keeps working.
    return () => q.dispose();
  }, [q]);

  const queue = React.useCallback((changed: Record<string, unknown>) => q.change(changed), [q]);
  const flush = React.useCallback(() => q.flush(), [q]);
  const retry = React.useCallback(() => void q.flush(), [q]);
  const hasUnsavedChanges = React.useCallback(() => q.hasUnsavedChanges(), [q]);
  const keepMine = React.useCallback(
    (c: AutosaveConflict) => {
      q.dismissConflict(c.fieldId);
      q.change({ [c.fieldId]: c.yourValue });
    },
    [q],
  );
  const acceptTheirs = React.useCallback(
    (c: AutosaveConflict) => {
      q.dismissConflict(c.fieldId);
      return c.theirValue;
    },
    [q],
  );

  return {
    ...state,
    queue,
    flush,
    retry,
    hasUnsavedChanges,
    keepMine,
    acceptTheirs,
    indicator: { status: state.status, savedAt: state.savedAt, onRetry: retry, ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}) },
  };
}

/** Picks the changed fields' values out of the full answers (for `queue`). */
export function pickChanged(data: Record<string, unknown>, changedFieldIds: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // A cleared answer is sent as null so the server removes it.
  for (const id of changedFieldIds) out[id] = data[id] === undefined ? null : data[id];
  return out;
}
