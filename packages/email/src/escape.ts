// SPDX-License-Identifier: AGPL-3.0-only
// Escaping and URL helpers shared by the markdown renderer, merge fields and layout.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for safe use in HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Returns the URL if it is an absolute http(s) or mailto URL, otherwise null.
 * Blocks `javascript:`, `data:`, `vbscript:`, relative and protocol-relative URLs,
 * including obfuscated forms (whitespace/control characters inside the scheme).
 */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Browsers strip ASCII whitespace and control chars before parsing schemes; do the same before checking.
  // eslint-disable-next-line no-control-regex
  const trimmed = raw.replace(/[\u0000-\u001F\u007F]+/g, '').trim();
  if (!trimmed || trimmed.startsWith('//')) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.protocol !== 'mailto:' && !parsed.hostname) return null;
  return parsed.href;
}

/** Like safeUrl, but falls back to a harmless placeholder so templates never emit an unsafe href. */
export function hrefOrHash(raw: string | null | undefined): string {
  return safeUrl(raw) ?? '#';
}
