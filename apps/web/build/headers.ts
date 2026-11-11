// SPDX-License-Identifier: AGPL-3.0-only
// Emits `_headers` for Workers static assets, with a Content-Security-Policy built from the
// build-time environment (same approach as Passport's web app).
import type { Plugin } from "vite";

/** Origin of a configured URL, or null when unset or invalid. Only http(s) origins reach the CSP. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** The build-time values that switch on "Export to Drive" (the Google Picker). Both must be set. */
export interface GooglePickerEnv {
  apiKey?: string | undefined;
  clientId?: string | undefined;
}
export const pickerConfigured = (g: GooglePickerEnv | undefined): boolean => !!g?.apiKey?.trim() && !!g?.clientId?.trim();

/**
 * What the Google Picker adds, and nothing wider. Scripts: the Google API loader (which fetches
 * the Picker module from the same origin) and the Google Identity Services client, used for a
 * short-lived `drive.file` token. Frames: the Picker itself, served from docs.google.com, and the
 * Identity Services frame. Identity Services also needs its own stylesheet and endpoint.
 */
const PICKER = {
  script: ["https://apis.google.com", "https://accounts.google.com/gsi/client"],
  style: ["https://accounts.google.com/gsi/style"],
  frame: ["https://docs.google.com", "https://accounts.google.com/gsi/"],
  connect: ["https://accounts.google.com/gsi/"],
};

/**
 * The GMS web app talks to its own API Worker and to the Supabase project (Auth, and Realtime over
 * WebSocket for presence in the application editor); it navigates to Passport, which needs no CSP
 * entry. Scripts and fonts are first-party only. Styles are first-party; React writes `style`
 * through the DOM, which a CSP does not govern, so 'unsafe-inline' is not needed. Images may come
 * from any https origin because a funder's logo is a URL they choose. Nothing may frame the app,
 * and the app frames nothing, unless the Google Picker is configured: then, and only then, the
 * Google origins in PICKER are added.
 */
export function contentSecurityPolicy(apiBaseUrl: string | undefined, supabaseUrl: string | undefined, google?: GooglePickerEnv): string {
  const picker = pickerConfigured(google);
  const api = originOf(apiBaseUrl);
  const supabase = originOf(supabaseUrl);
  const realtime = supabase ? supabase.replace(/^http/, "ws") : null;
  const connect = ["'self'", api, supabase, realtime, ...(picker ? PICKER.connect : [])].filter((o): o is string => o !== null);
  const backends = [api, supabase].filter((o): o is string => o !== null);
  // Only upgrade when every backend is https; an http backend (local development) would break.
  const allHttps = backends.length > 0 && backends.every((o) => o.startsWith("https://"));
  return [
    "default-src 'self'",
    `script-src ${["'self'", ...(picker ? PICKER.script : [])].join(" ")}`,
    `style-src ${["'self'", ...(picker ? PICKER.style : [])].join(" ")}`,
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    `frame-src ${picker ? PICKER.frame.join(" ") : "'none'"}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(allHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function headersFile(apiBaseUrl: string | undefined, supabaseUrl: string | undefined, google?: GooglePickerEnv): string {
  return [
    "/*",
    `  Content-Security-Policy: ${contentSecurityPolicy(apiBaseUrl, supabaseUrl, google)}`,
    "  X-Frame-Options: DENY",
    "  X-Content-Type-Options: nosniff",
    // The OAuth consent screen and invitation links carry a token in the query string; never leak it via Referer.
    "  Referrer-Policy: no-referrer",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    // Google's sign-in opens a pop-up that must hand its answer back to this window; that needs the
    // looser opener policy. Without the Picker the app stays fully isolated.
    `  Cross-Origin-Opener-Policy: ${pickerConfigured(google) ? "same-origin-allow-popups" : "same-origin"}`,
    "  Strict-Transport-Security: max-age=31536000; includeSubDomains",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "/fonts/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n");
}

/** Vite plugin: writes `dist/_headers` at build time. */
export function staticAssetHeaders(env: Record<string, string>): Plugin {
  return {
    name: "gms-static-asset-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: headersFile(env.VITE_API_BASE_URL, env.VITE_SUPABASE_URL, { apiKey: env.VITE_GOOGLE_PICKER_API_KEY, clientId: env.VITE_GOOGLE_OAUTH_CLIENT_ID }) });
    },
  };
}
