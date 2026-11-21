// SPDX-License-Identifier: AGPL-3.0-only
// The sign-in page's `next` after Apply is `/apply/{handle}/{slug}`. Naming that grant on the
// sign-in page is what tells the person they will get back to it.

/** The public opportunity an apply hand-off will return to, or null when `next` is something else. */
export function applyGrantOf(next: string | null): { handle: string; slug: string } | null {
  if (!next) return null;
  const path = next.startsWith("/") ? next : "";
  const match = /^\/apply\/([^/]+)\/([^/?#]+)\/?$/.exec(path);
  const handle = match?.[1];
  const slug = match?.[2];
  if (!handle || !slug) return null;
  try {
    return { handle: decodeURIComponent(handle), slug: decodeURIComponent(slug) };
  } catch {
    return { handle, slug };
  }
}
