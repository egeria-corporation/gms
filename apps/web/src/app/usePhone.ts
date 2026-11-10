// SPDX-License-Identifier: AGPL-3.0-only
import { useSyncExternalStore } from "react";

/** Phone layouts take over below this width (the design's 390 artboards). Keep in sync with screens.css. */
export const PHONE_QUERY = "(max-width: 720px)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
