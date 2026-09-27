// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Warns before leaving a page with unsaved changes: browser navigation (beforeunload) and in-app link
// clicks (the App Router has no navigation-blocking API, so we confirm on clicks of same-origin links).
import { useEffect } from 'react';

export const UNSAVED_MESSAGE = 'You have unsaved changes. Leave this page and lose them?';

export function useUnsavedChangesWarning(dirty: boolean, message = UNSAVED_MESSAGE): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Some browsers still need returnValue set to show the prompt.
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
