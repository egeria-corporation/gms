// SPDX-License-Identifier: AGPL-3.0-only
// The web app's language: the hook, the switch, <html lang>, and the start-up choice.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { changeLocale, getLocale, initialLocale, useLocale, useT } from "../src/i18n/index.tsx";
import { formatAwardRange, formatDate, formatMoney } from "../src/lib/format.ts";

function Probe() {
  const s = useT("shared");
  const locale = useLocale();
  return (
    <p data-locale={locale}>
      {s("app.skipLink")} · {s("format.awardCountAbout", { count: 3 })}
    </p>
  );
}

const setUrl = (search: string) => window.history.replaceState(null, "", `/${search}`);
const setCookie = (value: string | null) => {
  document.cookie = value === null ? "gms_lang=; Max-Age=0; Path=/" : `gms_lang=${value}; Path=/`;
};

describe("the page's language", () => {
  afterEach(() => {
    setUrl("");
    setCookie(null);
  });

  it("starts in English and switches every message, and <html lang>, at once", async () => {
    render(<Probe />);
    expect(screen.getByText(/Skip to main content · About 3 awards/)).toBeInTheDocument();
    await act(() => changeLocale("es"));
    expect(screen.getByText(/Saltar al contenido principal · Aproximadamente 3 subvenciones/)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es");
    expect(getLocale()).toBe("es");
    await act(() => changeLocale("en"));
    expect(screen.getByText(/Skip to main content/)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("formats money and dates in the active language", async () => {
    expect(formatDate("2026-11-15")).toBe("Nov 15, 2026");
    await changeLocale("es");
    expect(formatDate("2026-11-15")).toBe("15 nov 2026");
    expect(formatMoney({ amount: "50000", currency: "USD" })).toBe("$50,000");
    expect(formatAwardRange({ maxAwardAmount: { amount: "10000", currency: "USD" } } as never)).toBe("Hasta $10,000");
  });

  it("starts from ?lang=, then the cookie, then the browser's languages", () => {
    setUrl("?lang=es");
    setCookie("en");
    expect(initialLocale()).toBe("es");
    setUrl("");
    expect(initialLocale()).toBe("en");
    setCookie("es");
    expect(initialLocale()).toBe("es");
    setCookie(null);
    // jsdom's navigator.languages is ["en-US", "en"].
    expect(initialLocale()).toBe("en");
  });
});
