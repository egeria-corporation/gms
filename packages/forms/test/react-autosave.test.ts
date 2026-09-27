// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AutosaveFn, AutosaveQueue, type AutosaveState, isNetworkError } from '../src/react';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const scheduler = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

describe('AutosaveQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces and sends only the changed fields', async () => {
    const save = vi.fn<AutosaveFn>(async (_c, etag) => ({ etag: `${etag}+1` }));
    const states: AutosaveState[] = [];
    const q = new AutosaveQueue({ save, etag: 'e1', debounceMs: 800, scheduler, onState: (s) => states.push(s) });
    q.change({ a: 1 });
    await vi.advanceTimersByTimeAsync(500);
    q.change({ b: 2 });
    q.change({ a: 3 });
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ a: 3, b: 2 }, 'e1');
    await vi.runAllTimersAsync();
    expect(q.getState()).toMatchObject({ status: 'saved', etag: 'e1+1', pendingFieldIds: [] });
    expect(states.map((s) => s.status)).toContain('saving');
  });

  it('queues edits made while a save is in flight and sends them next with the new etag', async () => {
    const first = deferred<{ etag: string }>();
    const save = vi.fn<AutosaveFn>().mockReturnValueOnce(first.promise).mockResolvedValue({ etag: 'e3' });
    const q = new AutosaveQueue({ save, etag: 'e1', debounceMs: 100, scheduler });
    q.change({ a: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    q.change({ b: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1); // still waiting on the first request
    expect(q.getState().pendingFieldIds.sort()).toEqual(['a', 'b']);
    first.resolve({ etag: 'e2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ b: 2 }, 'e2');
    await vi.runAllTimersAsync();
    expect(q.getState()).toMatchObject({ status: 'saved', etag: 'e3' });
    expect(q.hasUnsavedChanges()).toBe(false);
  });

  it('goes offline, keeps changes and retries with backoff', async () => {
    let online = false;
    const save = vi.fn<AutosaveFn>(async () => ({ etag: 'e2' }));
    const q = new AutosaveQueue({ save, etag: 'e1', debounceMs: 100, backoffMs: [1000, 5000], isOnline: () => online, scheduler });
    q.change({ a: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(save).not.toHaveBeenCalled();
    expect(q.getState()).toMatchObject({ status: 'offline', attempt: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(q.getState()).toMatchObject({ status: 'offline', attempt: 2 });
    online = true;
    await vi.advanceTimersByTimeAsync(4999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledWith({ a: 1 }, 'e1');
    await vi.runAllTimersAsync();
    expect(q.getState()).toMatchObject({ status: 'saved', attempt: 0 });
  });

  it('treats network failures as offline and merges the failed batch under newer edits', async () => {
    const save = vi.fn<AutosaveFn>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ etag: 'e2' });
    const q = new AutosaveQueue({ save, etag: 'e1', debounceMs: 100, backoffMs: [1000], isOnline: () => true, scheduler });
    q.change({ a: 1, b: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(q.getState().status).toBe('offline');
    q.change({ b: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenLastCalledWith({ a: 1, b: 2 }, 'e1');
  });

  it('reports server errors, and online() retries immediately', async () => {
    const save = vi.fn<AutosaveFn>().mockRejectedValueOnce(new Error('Your session expired.')).mockResolvedValue({ etag: 'e2' });
    const q = new AutosaveQueue({ save, etag: 'e1', debounceMs: 100, backoffMs: [60_000], isOnline: () => true, scheduler });
    q.change({ a: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(q.getState()).toMatchObject({ status: 'error', errorMessage: 'Your session expired.' });
    q.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect(q.getState().status).toBe('saved');
  });

  it('returns conflicts and save-mode errors, and a newer edit clears the conflict', async () => {
    const save = vi.fn<AutosaveFn>().mockResolvedValueOnce({
      etag: 'e2',
      conflicts: [{ fieldId: 'project_title', theirValue: 'Murals on Main Street', yourValue: 'Murals', by: 'Maya' }],
      errors: [{ pointer: '/org_ein', fieldId: 'org_ein', pageId: 'about_org', message: 'Enter the EIN as 9 digits in the format 12-3456789.', keyword: 'pattern' }],
    });
    save.mockResolvedValue({ etag: 'e3' });
    const q = new AutosaveQueue({ save, etag: 'e1', debounceMs: 100, scheduler });
    q.change({ project_title: 'Murals', org_ein: '12' });
    await vi.runAllTimersAsync();
    expect(q.getState().conflicts).toHaveLength(1);
    expect(q.getState().errors[0]?.fieldId).toBe('org_ein');
    q.change({ org_ein: '12-3456789' });
    await vi.runAllTimersAsync();
    expect(q.getState().errors).toEqual([]);
    q.change({ project_title: 'Murals on Main' });
    expect(q.getState().conflicts).toEqual([]);
  });

  it('flush() sends right away and resolves when idle', async () => {
    const save = vi.fn<AutosaveFn>(async () => ({ etag: 'e2' }));
    const q = new AutosaveQueue({ save, etag: 'e1', debounceMs: 10_000, scheduler });
    q.change({ a: 1 });
    const done = q.flush();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(save).toHaveBeenCalledTimes(1);
    expect(q.hasUnsavedChanges()).toBe(false);
  });

  it('recognizes network errors', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ offline: true })).toBe(true);
    expect(isNetworkError(new Error('403'))).toBe(false);
  });
});
