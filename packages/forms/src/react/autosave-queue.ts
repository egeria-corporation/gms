// SPDX-License-Identifier: AGPL-3.0-only
// The autosave engine behind useAutosave(): debounced partial saves of changed fields only, one
// request in flight at a time (later changes queue up), offline detection with retry and backoff,
// and conflict reporting. React-free (timers and the online check are injectable) so it can be
// tested in node with fake timers.
import type { ResponseError } from '../validate';

export type AutosaveQueueStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

/** Another person (or tab) changed a field after this editor loaded it. */
export interface AutosaveConflict {
  fieldId: string;
  /** The value now stored on the server. */
  theirValue: unknown;
  /** The value this editor tried to save. */
  yourValue?: unknown;
  /** Display name of whoever made the other change, e.g. "Maya Okafor". */
  by?: string;
  /** ISO timestamp of their change. */
  at?: string;
}

export interface AutosaveResult {
  etag: string;
  /** Save-mode validation errors for the saved fields (shown inline; they never block saving). */
  errors?: ResponseError[];
  /** Fields that were not saved because someone else changed them first. */
  conflicts?: AutosaveConflict[];
}

export type AutosaveFn = (changed: Record<string, unknown>, etag: string | undefined) => Promise<AutosaveResult>;

export interface AutosaveState {
  status: AutosaveQueueStatus;
  etag: string | undefined;
  savedAt: Date | null;
  /** Field ids changed locally but not yet confirmed by the server. */
  pendingFieldIds: string[];
  errors: ResponseError[];
  conflicts: AutosaveConflict[];
  /** Consecutive failed attempts (resets after a successful save). */
  attempt: number;
  /** When the next automatic retry happens, if one is scheduled. */
  nextRetryAt: Date | null;
  errorMessage?: string;
}

export interface Scheduler {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

export interface AutosaveQueueOptions {
  save: AutosaveFn;
  etag?: string;
  debounceMs?: number;
  /** Delays between retries after a failed save; the last value repeats. */
  backoffMs?: readonly number[];
  /** Returns false when the device is offline (defaults to navigator.onLine when available). */
  isOnline?: () => boolean;
  scheduler?: Scheduler;
  onState?: (state: AutosaveState) => void;
}

export const DEFAULT_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000] as const;

const defaultScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
  now: () => Date.now(),
};

function defaultIsOnline(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}

/** True for errors that mean "we could not reach the server" rather than "the server said no". */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch() rejects with TypeError on network failure
  if (typeof err === 'object' && err !== null) {
    const e = err as { name?: unknown; offline?: unknown; code?: unknown };
    if (e.offline === true) return true;
    if (e.name === 'NetworkError' || e.name === 'AbortError' || e.name === 'TimeoutError') return true;
    if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT') return true;
  }
  return false;
}

export class AutosaveQueue {
  private readonly save: AutosaveFn;
  private readonly debounceMs: number;
  private readonly backoff: readonly number[];
  private readonly isOnline: () => boolean;
  private readonly scheduler: Scheduler;
  private readonly onState: ((s: AutosaveState) => void) | undefined;

  /** Changes waiting to be sent (latest value per field). */
  private pending: Record<string, unknown> = {};
  /** Changes currently being sent. */
  private inflight: Record<string, unknown> | null = null;
  private debounceHandle: unknown = null;
  private retryHandle: unknown = null;
  private disposed = false;
  private state: AutosaveState;
  private idleWaiters: (() => void)[] = [];

  constructor(opts: AutosaveQueueOptions) {
    this.save = opts.save;
    this.debounceMs = opts.debounceMs ?? 800;
    this.backoff = opts.backoffMs && opts.backoffMs.length ? opts.backoffMs : DEFAULT_BACKOFF_MS;
    this.isOnline = opts.isOnline ?? defaultIsOnline;
    this.scheduler = opts.scheduler ?? defaultScheduler;
    this.onState = opts.onState;
    this.state = { status: 'idle', etag: opts.etag, savedAt: null, pendingFieldIds: [], errors: [], conflicts: [], attempt: 0, nextRetryAt: null };
  }

  getState(): AutosaveState {
    return this.state;
  }

  /** True while there are changes the server has not confirmed. */
  hasUnsavedChanges(): boolean {
    return Object.keys(this.pending).length > 0 || this.inflight !== null;
  }

  /** Records changed fields and (re)starts the debounce timer. */
  change(changed: Record<string, unknown>): void {
    if (this.disposed) return;
    const ids = Object.keys(changed);
    if (!ids.length) return;
    Object.assign(this.pending, changed);
    // A local edit to a conflicted field settles the conflict in favor of the new edit.
    const conflicts = this.state.conflicts.filter((c) => !ids.includes(c.fieldId));
    this.setState({ pendingFieldIds: this.pendingIds(), conflicts });
    this.clearDebounce();
    this.debounceHandle = this.scheduler.setTimeout(() => {
      this.debounceHandle = null;
      void this.run();
    }, this.debounceMs);
  }

  /** Sends pending changes now (e.g. before navigating away or when coming back online). */
  flush(): Promise<void> {
    this.clearDebounce();
    this.clearRetry();
    void this.run();
    return this.whenIdle();
  }

  /** Resolves when nothing is pending or in flight (or the queue is waiting to retry). */
  whenIdle(): Promise<void> {
    if (!this.inflight && (!Object.keys(this.pending).length || this.retryHandle !== null || this.state.status === 'error')) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Updates the etag after the host app reloaded the record. */
  setEtag(etag: string | undefined): void {
    if (etag !== this.state.etag) this.setState({ etag });
  }

  /** Removes a conflict from the list (after the person chose what to keep). */
  dismissConflict(fieldId: string): void {
    this.setState({ conflicts: this.state.conflicts.filter((c) => c.fieldId !== fieldId) });
  }

  /** The device came back online: retry right away. */
  online(): void {
    if (this.hasUnsavedChanges()) void this.flush();
  }

  /** The device went offline: show it, and keep changes queued. */
  offline(): void {
    if (this.hasUnsavedChanges()) this.setState({ status: 'offline' });
  }

  /** Re-enables a disposed queue (React Strict Mode remounts effects). */
  activate(): void {
    this.disposed = false;
  }

  dispose(): void {
    this.disposed = true;
    this.clearDebounce();
    this.clearRetry();
    this.releaseWaiters();
  }

  private pendingIds(): string[] {
    const ids = new Set([...Object.keys(this.pending), ...Object.keys(this.inflight ?? {})]);
    return [...ids];
  }

  private async run(): Promise<void> {
    if (this.disposed || this.inflight) return; // the in-flight save picks up pending changes when it finishes
    if (!Object.keys(this.pending).length) {
      this.releaseWaiters();
      return;
    }
    if (!this.isOnline()) {
      this.scheduleRetry('offline', "You're offline. We'll keep trying.");
      return;
    }
    const batch = this.pending;
    this.pending = {};
    this.inflight = batch;
    this.setState({ status: 'saving', pendingFieldIds: this.pendingIds(), nextRetryAt: null });
    try {
      const result = await this.save(batch, this.state.etag);
      if (this.disposed) return;
      this.inflight = null;
      const savedIds = Object.keys(batch);
      const newConflicts = result.conflicts ?? [];
      const conflicts = [...this.state.conflicts.filter((c) => !newConflicts.some((n) => n.fieldId === c.fieldId)), ...newConflicts].filter(
        // A newer local edit to the same field is already queued; it will be sent with the new etag.
        (c) => !(c.fieldId in this.pending),
      );
      const errors = [...this.state.errors.filter((e) => !savedIds.includes(e.fieldId)), ...(result.errors ?? [])];
      this.setState({
        status: 'saved',
        etag: result.etag,
        savedAt: new Date(this.scheduler.now()),
        attempt: 0,
        errors,
        conflicts,
        pendingFieldIds: this.pendingIds(),
        nextRetryAt: null,
        errorMessage: undefined,
      });
      if (Object.keys(this.pending).length) void this.run();
      else this.releaseWaiters();
    } catch (err) {
      if (this.disposed) return;
      // Put the batch back under anything typed since (newer values win).
      this.pending = { ...batch, ...this.pending };
      this.inflight = null;
      if (!this.isOnline() || isNetworkError(err)) this.scheduleRetry('offline', "You're offline. We'll keep trying.");
      else this.scheduleRetry('error', err instanceof Error && err.message ? err.message : 'Something went wrong while saving.');
    }
  }

  private scheduleRetry(status: 'offline' | 'error', message: string): void {
    const attempt = this.state.attempt + 1;
    const delay = this.backoff[Math.min(attempt - 1, this.backoff.length - 1)] ?? 30_000;
    this.clearRetry();
    this.retryHandle = this.scheduler.setTimeout(() => {
      this.retryHandle = null;
      void this.run();
    }, delay);
    this.setState({
      status,
      attempt,
      pendingFieldIds: this.pendingIds(),
      nextRetryAt: new Date(this.scheduler.now() + delay),
      errorMessage: message,
    });
    this.releaseWaiters();
  }

  private clearDebounce(): void {
    if (this.debounceHandle !== null) this.scheduler.clearTimeout(this.debounceHandle);
    this.debounceHandle = null;
  }

  private clearRetry(): void {
    if (this.retryHandle !== null) this.scheduler.clearTimeout(this.retryHandle);
    this.retryHandle = null;
  }

  private releaseWaiters(): void {
    const w = this.idleWaiters;
    this.idleWaiters = [];
    for (const fn of w) fn();
  }

  private setState(patch: Partial<AutosaveState>): void {
    this.state = { ...this.state, ...patch };
    this.onState?.(this.state);
  }
}
