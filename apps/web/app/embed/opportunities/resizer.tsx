// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect } from 'react';

/** Tells the embedding page our height (the <gms-opportunities> web component listens for it). */
export function EmbedResizer(_: { nonce?: string }) {
  useEffect(() => {
    const post = () => window.parent?.postMessage({ type: 'gms:embed-height', height: document.documentElement.scrollHeight }, '*');
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return null;
}
