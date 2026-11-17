// SPDX-License-Identifier: AGPL-3.0-only
// User-facing error messages in the person's language (docs/i18n.md). The API's `code` and its
// English text are what clients read and never change; a request in Spanish to a GMS route also gets
// `detailLocalized` beside the code (in `errors[0]`, so the CommonGrants error shape is untouched),
// when the code is in the `errors` catalog. The web app shows `detailLocalized`, else the English.
// The CommonGrants protocol routes, OAuth and MCP are machine interfaces and stay English only.
import { DEFAULT_LOCALE, type Key, type Locale } from "@gms/i18n";
import { SERVER_CATALOGS, serverTranslator } from "@gms/i18n/server";
import type { ApiError, ErrorBody } from "./errors.ts";

/** The languages `detailLocalized` is given in: every one but English, whose text is `message` itself. One place to widen. */
const LOCALIZED: ReadonlySet<Locale> = new Set<Locale>(["es"]);

/** The route prefixes whose errors may carry `detailLocalized`: the GMS's own routes. */
const LOCALIZED_PATHS = ["/gms/"];

const resourceKey = (what: string) => `notFound.${what.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

/** The catalog message for an error, or null when its code is not catalogued (or the language is English). */
export function localizedDetail(err: Pick<ApiError, "code" | "resource">, locale: Locale): string | null {
  if (locale === DEFAULT_LOCALE || !LOCALIZED.has(locale)) return null;
  const catalog = SERVER_CATALOGS[locale].errors as Record<string, unknown>;
  const byResource = err.code === "not_found" && err.resource ? resourceKey(err.resource) : null;
  const key = byResource && byResource in catalog ? byResource : `code.${err.code}`;
  return key in catalog ? serverTranslator(locale, "errors")(key as Key<"errors">) : null;
}

/** The error body for a request: `detailLocalized` added to the first entry when the request is in another language and on a GMS route. */
export function localizedBody(err: ApiError, body: ErrorBody, path: string, locale: Locale): ErrorBody {
  if (!LOCALIZED_PATHS.some((p) => path.startsWith(p))) return body;
  const detail = localizedDetail(err, locale);
  if (!detail || !body.errors.length) return body;
  const [first, ...rest] = body.errors;
  return { ...body, errors: [{ ...first!, detailLocalized: detail }, ...rest] };
}
