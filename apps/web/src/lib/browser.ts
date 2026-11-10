// SPDX-License-Identifier: AGPL-3.0-only
// Small browser helpers: save a file the API returned, and copy text with a fallback for
// contexts where the async clipboard API is missing or refused (older browsers, plain http).

/** Saves a blob as a file through a temporary link. The object URL is released afterwards. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a later tick so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Quotes a cell for CSV and neutralises spreadsheet formulas (=, +, -, @ at the start). */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(rows: Array<Array<string | number | null | undefined>>, filename: string): void {
  downloadBlob(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }), filename);
}

/** Opens a blob (a PDF, typically) in a new tab; falls back to a download when pop-ups are blocked. */
export function openBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener");
  if (!opened) downloadBlob(blob, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Copies text. Resolves true when the text is on the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the selection-based copy
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Leaves the app for another address (a provider's sign-in page). One place, so tests can stand in for it. */
export function leaveTo(url: string): void {
  window.location.assign(url);
}
