// SPDX-License-Identifier: AGPL-3.0-only
// Choosing the language (docs/i18n.md): the public pages' footer and the account menu. A choice is
// remembered on this device (the cookie) and, for a signed-in person, saved to their account so
// the app and their emails follow it everywhere. Each language's name is written in itself.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { Check } from "lucide-react";
import { LANGUAGE_NAMES, LOCALES, changeLocale, getLocale, isLocale, rememberLocale, useLocale, useT, type Locale } from "../i18n/index.tsx";
import { useServices } from "../app/services.tsx";

// The control to put focus back on once the screens have redrawn in the new language.
let refocus: string | null = null;

/** Switch the page's language, remember it, and save it for a signed-in person. */
export function useChooseLanguage(): (locale: Locale, focusId?: string) => Promise<void> {
  const { api, sessionState } = useServices();
  const navigate = useNavigate();
  const location = useLocation();
  return async (locale, focusId) => {
    rememberLocale(locale);
    // An address that names a language keeps naming the one chosen, so a reload does not undo it.
    const params = new URLSearchParams(location.search);
    if (params.has("lang")) {
      if (locale === "en") params.delete("lang");
      else params.set("lang", locale);
      const search = params.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
    }
    if (sessionState.status === "signedIn") api.savePreferences({ locale }).catch(() => undefined);
    refocus = focusId ?? null;
    await changeLocale(locale);
  };
}

/** After the switch the screen is new: focus returns to the control that made it. */
function useRefocus(id: string) {
  useEffect(() => {
    if (refocus !== id) return;
    refocus = null;
    document.getElementById(id)?.focus();
  }, [id]);
}

/**
 * Applies a signed-in person's saved language when their account loads (it outranks `?lang=`, the
 * cookie and the browser), and remembers it on this device so the next visit starts in it.
 */
export function LocaleFromPreference() {
  const { meState } = useServices();
  const me = meState.status === "ready" ? meState.me : null;
  const applied = useRef<unknown>(null);
  useEffect(() => {
    if (!me || applied.current === me) return;
    applied.current = me;
    const saved = me.locale;
    if (!isLocale(saved)) return;
    rememberLocale(saved);
    if (saved !== getLocale()) void changeLocale(saved);
  }, [me]);
  return null;
}

/** The footer switcher: links, so each language's page can be reached and shared (`?lang=es`). */
export function LanguageSwitcher({ id = "lang-footer" }: { id?: string }) {
  const s = useT("shared");
  const current = useLocale();
  const choose = useChooseLanguage();
  const location = useLocation();
  useRefocus(id);
  const hrefFor = (locale: Locale) => {
    const params = new URLSearchParams(location.search);
    if (locale === "en") params.delete("lang");
    else params.set("lang", locale);
    const search = params.toString();
    return `${location.pathname}${search ? `?${search}` : ""}`;
  };
  return (
    <nav className="lang-switch" aria-label={s("language.label")}>
      <ul>
        {LOCALES.map((locale) => (
          <li key={locale}>
            <a
              id={locale === current ? id : undefined}
              href={hrefFor(locale)}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === current ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                if (locale !== current) void choose(locale, id);
              }}
            >
              {LANGUAGE_NAMES[locale]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The account menu's language choice: two radio items in the menu, the current one checked. */
export function LanguageMenuItems({ onChosen }: { onChosen: () => void }) {
  const s = useT("shared");
  const current = useLocale();
  const choose = useChooseLanguage();
  return (
    <div role="group" aria-label={s("language.label")} className="lang-menu">
      <span className="eyebrow" aria-hidden="true">
        {s("language.label")}
      </span>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          role="menuitemradio"
          aria-checked={locale === current}
          lang={locale}
          className="btn btn-sm btn-ghost"
          onClick={() => {
            onChosen();
            if (locale !== current) void choose(locale, "ws-menu-button");
          }}
        >
          {locale === current && <Check className="ic" aria-hidden="true" />}
          {LANGUAGE_NAMES[locale]}
        </button>
      ))}
    </div>
  );
}

/** Focus back on the account menu's button after a switch from the menu. */
export const useMenuRefocus = () => useRefocus("ws-menu-button");
