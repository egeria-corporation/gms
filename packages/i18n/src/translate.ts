// SPDX-License-Identifier: AGPL-3.0-only
// Formatting a message: ICU MessageFormat through FormatJS's `intl-messageformat` (placeholders
// `{name}`, plurals `{count, plural, one {# day} other {# days}}`, selects, and tags `<link>…</link>`
// for rich text). Plain messages (no `{` and no `<`) skip the formatter.
import { IntlMessageFormat } from "intl-messageformat";
import { NAMESPACES, peekCatalog, type Catalog, type Key, type Message, type Namespace } from "./catalogs.ts";
import { INTL_LOCALE, type Locale } from "./locales.ts";

/** A value for a placeholder; a function formats a tag's contents (rich text). */
export type Value = string | number | bigint | boolean | Date | null | undefined | ((chunks: unknown[]) => unknown);
export type Values = Record<string, Value>;

// One formatter per language and message: text messages by their text, precompiled ones by identity.
const byText = new Map<string, IntlMessageFormat>();
const byElements = new WeakMap<object, Map<Locale, IntlMessageFormat>>();

const isPlain = (message: Message): message is string => typeof message === "string" && !message.includes("{") && !message.includes("<");

function formatter(locale: Locale, message: Message): IntlMessageFormat {
  if (typeof message === "string") {
    const key = `${locale}\u0000${message}`;
    let f = byText.get(key);
    if (!f) byText.set(key, (f = new IntlMessageFormat(message, INTL_LOCALE[locale])));
    return f;
  }
  let perLocale = byElements.get(message);
  if (!perLocale) byElements.set(message, (perLocale = new Map()));
  let f = perLocale.get(locale);
  if (!f) perLocale.set(locale, (f = new IntlMessageFormat(message, INTL_LOCALE[locale])));
  return f;
}

/**
 * The parts of a formatted message: strings, and whatever the tag functions returned. `id` names
 * the message in an error report. A message that fails to format (a placeholder without a
 * value) is reported and shown as written, never thrown at the person.
 */
export function formatParts(locale: Locale, id: string, message: Message, values?: Values): unknown[] {
  if (isPlain(message)) return [message];
  try {
    const out = formatter(locale, message).format(values as Record<string, never>);
    return Array.isArray(out) ? out : [out];
  } catch (error) {
    console.error(`i18n: could not format ${id} (${locale})`, error);
    return [typeof message === "string" ? message : id];
  }
}

/** The formatted message as text. Tag functions should return text here; use `rich` for elements. */
export function formatMessage(locale: Locale, id: string, message: Message, values?: Values): string {
  return formatParts(locale, id, message, values)
    .map((p) => (typeof p === "string" || typeof p === "number" ? String(p) : ""))
    .join("");
}

export interface Translate<N extends Namespace> {
  /** The message as text. */
  (key: Key<N>, values?: Values): string;
  /** The message as parts, for rich text (`<link>terms</link>` with `{ link: (chunks) => … }`). */
  rich(key: Key<N>, values: Values): unknown[];
  readonly locale: Locale;
  readonly ns: N;
}

/**
 * A translator for one namespace. A key missing from the language falls back to English, and a key
 * missing from English (only possible from untyped input) is shown as the key.
 */
export function createTranslator<N extends Namespace>(locale: Locale, ns: N, catalog?: Catalog, english?: Catalog): Translate<N> {
  const own = catalog ?? peekCatalog(locale, ns);
  const source = english ?? peekCatalog("en", ns);
  const lookup = (key: string): [Locale, Message] => {
    const mine = own?.[key];
    if (mine !== undefined) return [locale, mine];
    const en = source?.[key];
    return en !== undefined ? ["en", en] : ["en", key];
  };
  const t = ((key: string, values?: Values) => {
    const [lang, message] = lookup(key);
    return formatMessage(lang, `${ns}:${key}`, message, values);
  }) as unknown as Translate<N>;
  Object.defineProperties(t, {
    rich: {
      value: (key: string, values: Values) => {
        const [lang, message] = lookup(key);
        return formatParts(lang, `${ns}:${key}`, message, values);
      },
    },
    locale: { value: locale },
    ns: { value: ns },
  });
  return t;
}

/** True when a namespace name is one of the catalogs. */
export const isNamespace = (value: string): value is Namespace => (NAMESPACES as readonly string[]).includes(value);
