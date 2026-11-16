// SPDX-License-Identifier: AGPL-3.0-only
// The language switcher and the saved preference (docs/i18n.md): a choice switches the page,
// is remembered in the cookie, is saved for a signed-in person only, and a saved preference
// outranks the cookie once the person is known.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices, ServicesProvider } from "../src/app/services.tsx";
import { LanguageSwitcher, LocaleFromPreference } from "../src/components/LanguageSwitcher.tsx";
import { getLocale } from "../src/i18n/index.tsx";
import { demoSession } from "../src/mocks/auth.ts";

const cookie = () => /(?:^|; )gms_lang=([^;]*)/.exec(document.cookie)?.[1] ?? null;
afterEach(() => {
  document.cookie = "gms_lang=; Max-Age=0; Path=/";
});

function Footer({ services }: { services: ReturnType<typeof createMockServices> }) {
  return (
    <ServicesProvider services={services}>
      <MemoryRouter initialEntries={["/f/riverbend?lang=es&x=1"]}>
        <LanguageSwitcher />
      </MemoryRouter>
    </ServicesProvider>
  );
}

describe("the footer switcher", () => {
  it("names each language in itself, marks the current one, and links to each language's address", () => {
    render(<Footer services={createMockServices({ session: null })} />);
    const nav = screen.getByRole("navigation", { name: "Language" });
    const en = screen.getByRole("link", { name: "English" });
    const es = screen.getByRole("link", { name: "Español (beta)" });
    expect(nav).toContainElement(en);
    expect(en).toHaveAttribute("aria-current", "true");
    expect(es).toHaveAttribute("lang", "es");
    expect(es).toHaveAttribute("hreflang", "es");
    expect(es).toHaveAttribute("href", "/f/riverbend?lang=es&x=1");
    expect(en).toHaveAttribute("href", "/f/riverbend?x=1");
  });

  it("switches the page, remembers the choice on this device, and saves nothing for a visitor", async () => {
    const services = createMockServices({ session: null });
    const save = vi.spyOn(services.api, "savePreferences");
    render(<Footer services={services} />);
    await userEvent.click(screen.getByRole("link", { name: "Español (beta)" }));
    await waitFor(() => expect(getLocale()).toBe("es"));
    expect(cookie()).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    expect(screen.getByRole("navigation", { name: "Idioma" })).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("saves the choice for a signed-in person", async () => {
    const services = createMockServices({ session: demoSession() });
    const save = vi.spyOn(services.api, "savePreferences");
    render(<Footer services={services} />);
    await screen.findByRole("link", { name: "Español (beta)" });
    // The session is read asynchronously; choose once it is known.
    await waitFor(async () => {
      await services.auth.getSession();
    });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await userEvent.click(screen.getByRole("link", { name: "Español (beta)" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ locale: "es" }));
  });
});

describe("a signed-in person's saved language", () => {
  it("outranks the cookie once the person is known, and is remembered on this device", async () => {
    document.cookie = "gms_lang=en; Path=/";
    const services = createMockServices({ session: demoSession() });
    await services.api.savePreferences({ locale: "es" });
    render(
      <ServicesProvider services={services}>
        <LocaleFromPreference />
      </ServicesProvider>,
    );
    await waitFor(() => expect(getLocale()).toBe("es"));
    expect(cookie()).toBe("es");
  });

  it("leaves the language alone when the person never chose one", async () => {
    const services = createMockServices({ session: demoSession() });
    render(
      <ServicesProvider services={services}>
        <LocaleFromPreference />
      </ServicesProvider>,
    );
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(getLocale()).toBe("en");
  });
});

describe("the app in Spanish", () => {
  it("draws every screen again in the new language, the skip link included", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App services={createMockServices({ session: null })} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("link", { name: "Skip to main content" })).toBeInTheDocument();
    await userEvent.click((await screen.findAllByRole("link", { name: "Español (beta)" }))[0]!);
    expect(await screen.findByRole("link", { name: "Saltar al contenido principal" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Otorgue y gestione subvenciones, gratis. Regístrese con su correo." })).toBeInTheDocument();
  });
});
