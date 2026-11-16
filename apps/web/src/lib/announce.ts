// SPDX-License-Identifier: AGPL-3.0-only
// One polite live region for the whole page (WCAG 4.1.3). A status message that appears in a new
// element, such as a banner shown after a save, is not reliably spoken: screen readers watch live
// regions that already exist. `announce` speaks through a region that is always there.

const REGION_ID = "gms-announcer";
let lastAction = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Notes when the person last pressed a key or a pointer, so only messages they caused are spoken. */
export function watchActions(doc: Document = document): () => void {
  const mark = () => {
    lastAction = Date.now();
  };
  doc.addEventListener("pointerdown", mark, true);
  doc.addEventListener("keydown", mark, true);
  ensureRegion(doc);
  return () => {
    doc.removeEventListener("pointerdown", mark, true);
    doc.removeEventListener("keydown", mark, true);
  };
}

/** Forgets the last action, as on a fresh page (tests). */
export function forgetActions(): void {
  lastAction = 0;
}

/** True when the person acted within the last few seconds: a message now is the result. */
export const actedRecently = (withinMs = 8000): boolean => Date.now() - lastAction < withinMs;

function ensureRegion(doc: Document): HTMLElement {
  let region = doc.getElementById(REGION_ID);
  if (!region) {
    region = doc.createElement("div");
    region.id = REGION_ID;
    // No role: aria-live alone, so the page keeps exactly the status roles its screens render.
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    region.className = "sr";
    doc.body.appendChild(region);
  }
  return region;
}

/** Speaks `text` once, politely. The region is cleared first so the same words can be said again. */
export function announce(text: string, doc: Document = document): void {
  const words = text.replace(/\s+/g, " ").trim();
  if (!words) return;
  const region = ensureRegion(doc);
  region.textContent = "";
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    region.textContent = words;
  }, 60);
}
