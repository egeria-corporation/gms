// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { chooseLocale, cookieValue, localeCookie, localeFromAcceptLanguage, localeFromLanguages, localeFromTag } from "../src/index.ts";

describe("choosing the language", () => {
  it("takes a signed-in person's preference before anything else", () => {
    expect(chooseLocale({ preference: "es", query: "en", cookie: "en", acceptLanguage: "en-US" })).toBe("es");
    expect(chooseLocale({ preference: "en", query: "es", cookie: "es", acceptLanguage: "es" })).toBe("en");
  });

  it("then ?lang=, then the cookie, then Accept-Language, then English", () => {
    expect(chooseLocale({ preference: null, query: "es", cookie: "en", acceptLanguage: "en" })).toBe("es");
    expect(chooseLocale({ query: null, cookie: "es", acceptLanguage: "en" })).toBe("es");
    expect(chooseLocale({ cookie: null, acceptLanguage: "es-MX,es;q=0.9,en;q=0.8" })).toBe("es");
    expect(chooseLocale({ languages: ["es-419", "en"] })).toBe("es");
    expect(chooseLocale({})).toBe("en");
  });

  it("skips values it does not speak instead of failing", () => {
    expect(chooseLocale({ preference: "fr", query: "de", cookie: "pt", acceptLanguage: "fr-FR, de;q=0.5", languages: ["it"] })).toBe("en");
    expect(chooseLocale({ preference: "fr", query: "zz", cookie: "es" })).toBe("es");
  });

  it("reads ?lang= as a language tag (es-MX is Spanish)", () => {
    expect(chooseLocale({ query: "es-MX" })).toBe("es");
    expect(localeFromTag("EN_us")).toBe("en");
    expect(localeFromTag("")).toBeNull();
  });
});

describe("Accept-Language", () => {
  it("takes the highest weight, then the header's order, and ignores q=0 and *", () => {
    expect(localeFromAcceptLanguage("fr;q=1, en;q=0.4, es;q=0.7")).toBe("es");
    expect(localeFromAcceptLanguage("en, es")).toBe("en");
    expect(localeFromAcceptLanguage("es;q=0, en;q=0.1")).toBe("en");
    expect(localeFromAcceptLanguage("*")).toBeNull();
    expect(localeFromAcceptLanguage("fr-CA")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it("navigator.languages is already in the person's order", () => {
    expect(localeFromLanguages(["fr", "es-ES", "en"])).toBe("es");
    expect(localeFromLanguages([])).toBeNull();
  });
});

describe("the cookie", () => {
  it("is read from a Cookie header", () => {
    expect(cookieValue("a=1; gms_lang=es; b=2", "gms_lang")).toBe("es");
    expect(cookieValue("gms_langx=es", "gms_lang")).toBeNull();
    expect(cookieValue(undefined, "gms_lang")).toBeNull();
  });

  it("is site-wide, lasts a year and is not sent cross-site", () => {
    expect(localeCookie("es")).toBe("gms_lang=es; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(localeCookie("en", { secure: true })).toContain("; Secure");
  });
});
