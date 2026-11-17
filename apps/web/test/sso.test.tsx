// SPDX-License-Identifier: AGPL-3.0-only
// Single sign-on in the web app (docs/sso.md): a workspace that requires it sends an email-code
// session to the SSO step with the message, a domain without SSO says so, the SSO sign-in returns
// to the workspace, and the security settings show pending and active domains with icon + label.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, type Services } from "../src/app/services.tsx";
import { createHttpSsoApi, emailDomain, isSsoRequired, rememberSsoNext, takeSsoNext } from "../src/auth/sso.ts";
import { ssoProviderOf } from "../src/auth/supabase.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_SSO_PROVIDER } from "../src/mocks/sso.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
const where = () => screen.getByTestId("where").textContent;
function open(path: string, services: Services) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => window.sessionStorage.clear());

describe("signing in to a workspace that requires single sign-on", () => {
  it("sends an email-code session to the SSO step with the message, and SSO brings the person back", async () => {
    const services = createMockServices({ session: demoSession("aal1", "sam.lee@cascadecounty.example") });
    open("/w/cascade-county", services);
    await waitFor(() => expect(where()).toBe("/signin?next=%2Fw%2Fcascade-county&step=sso"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This workspace requires single sign-on");
    const input = screen.getByLabelText("Work email");
    await waitFor(() => expect(input).toHaveValue("sam.lee@cascadecounty.example"));
    await userEvent.click(screen.getByRole("button", { name: /Continue with single sign-on/ }));
    await waitFor(() => expect(where()).toBe("/w/cascade-county"));
    expect((await services.auth.getSession())?.ssoProviderId).toBe(MOCK_SSO_PROVIDER);
  });

  it("says plainly when a domain has no single sign-on", async () => {
    const services = createMockServices({ session: null });
    open("/signin", services);
    await userEvent.click(await screen.findByRole("button", { name: "Use single sign-on" }));
    await userEvent.type(screen.getByLabelText("Work email"), "pat@nossohere.example");
    await userEvent.click(screen.getByRole("button", { name: /Continue with single sign-on/ }));
    expect(await screen.findByText(/Single sign-on is not set up for nossohere\.example/)).toBeInTheDocument();
    // The email code is still there.
    await userEvent.click(screen.getByRole("button", { name: "Sign in with an email code instead" }));
    expect(screen.getByRole("button", { name: /Send code/ })).toBeInTheDocument();
  });

  it("leaves people on other domains alone", async () => {
    // The demo person (riverbendcf.example) reviews for Cascade County, which requires SSO only for cascadecounty.example.
    const services = createMockServices({ session: demoSession("aal1") });
    open("/w/cascade-county", services);
    await waitFor(() => expect(where()).toBe("/w/cascade-county"));
    await new Promise((r) => setTimeout(r, 50));
    expect(where()).toBe("/w/cascade-county");
  });
});

describe("a single sign-on session the GMS does not accept", () => {
  it("says the address cannot be used through that sign-on, and offers to sign out instead of trying again", async () => {
    const services = createMockServices({ session: demoSession("aal1", "dana@cascadecounty.example") });
    const message = "Your organization's single sign-on cannot sign you in with this email address. Sign in with a code sent to your email instead";
    services.api.me = () => Promise.reject(new ApiError(403, message, [{ code: "sso_domain_mismatch" }]));
    open("/signin", services);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Single sign-on cannot be used with this email address");
    expect(alert).toHaveTextContent(message);
    expect(within(alert).queryByRole("button", { name: "Retry" })).toBeNull();
    await userEvent.click(within(alert).getByRole("button", { name: "Sign out" }));
    await waitFor(async () => expect(await services.auth.getSession()).toBeNull());
  });
});

describe("security settings", () => {
  it("shows the pending domain with its DNS record, the IT values and why SSO cannot be required yet", async () => {
    const services = createMockServices({ session: demoSession("aal2") });
    open("/w/riverbend/settings/security", services);
    const list = await screen.findByRole("list", { name: "Single sign-on domains" });
    const item = within(list).getByRole("listitem");
    expect(item).toHaveTextContent("riverbendcf.example");
    expect(within(item).getByText("Pending")).toBeInTheDocument();
    expect(item).toHaveTextContent("_gms-verify.riverbendcf.example");
    expect(item).toHaveTextContent(/gms-verify=[A-Za-z0-9_-]{43}/);
    expect(screen.getByText("You are signed in with an email code.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Require single sign-on for people with these email addresses" })).toBeDisabled();
    expect(screen.getByText("Single sign-on can be required once one of your domains is active.")).toBeInTheDocument();
    expect(screen.getByText("https://mockprojectrefabcdefg.supabase.co/auth/v1/sso/saml/acs")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download metadata file/ })).toHaveAttribute("href", "https://mockprojectrefabcdefg.supabase.co/auth/v1/sso/saml/metadata?download=true");
    // Settings link to it once.
    expect(screen.getByRole("link", { name: "Security · Single sign-on" })).toHaveAttribute("aria-current", "page");

    await userEvent.click(within(item).getByRole("button", { name: /Check DNS record/ }));
    expect(await within(item).findByText(/could not find the record yet/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Email domain"), "riverbend.org");
    await userEvent.click(screen.getByRole("button", { name: "Add domain" }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(within(list).getAllByText("Pending")).toHaveLength(2);
  });

  it("shows an active, required domain as icon and label", async () => {
    const services = createMockServices({ session: demoSession("aal2") });
    // The demo person reviews for Cascade County; the mock settings port answers for the workspace in view.
    open("/w/cascade-county/settings/security", services);
    const list = await screen.findByRole("list", { name: "Single sign-on domains" });
    expect(within(list).getByText("Active")).toBeInTheDocument();
    expect(within(list).getByText("Required")).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("reads the SSO provider from amr wherever it sits", () => {
    expect(ssoProviderOf([{ method: "totp", timestamp: 2 }, { method: "sso/saml", timestamp: 1, provider: MOCK_SSO_PROVIDER }])).toBe(MOCK_SSO_PROVIDER);
    expect(ssoProviderOf([{ method: "otp", timestamp: 1 }])).toBeNull();
    expect(ssoProviderOf(undefined)).toBeNull();
    expect(emailDomain(" A@Example.ORG ")).toBe("example.org");
    expect(emailDomain("no-at-sign")).toBeNull();
    expect(isSsoRequired({ errors: [{ code: "sso_required" }] })).toBe(true);
  });

  it("keeps the page to return to for this tab only, once", () => {
    rememberSsoNext("/w/cascade-county");
    expect(takeSsoNext()).toBe("/w/cascade-county");
    expect(takeSsoNext()).toBeNull();
  });

  it("sends the workspace header on settings calls and none on join", async () => {
    const calls: { url: string; headers: Record<string, string>; method: string }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ status: 200, message: "Success", data: { joined: [] } }), { status: 200 });
    });
    const api = createHttpSsoApi({ baseUrl: "http://api.test", token: async () => "tok", workspaceId: () => "ws-1", fetch: fetchFn as unknown as typeof fetch });
    await api.settings();
    await api.join();
    expect(calls[0]).toMatchObject({ url: "http://api.test/gms/sso/settings", method: "GET", headers: { Authorization: "Bearer tok", "X-GMS-Workspace": "ws-1" } });
    expect(calls[1]).toMatchObject({ url: "http://api.test/gms/sso/join", method: "POST" });
    expect(calls[1]!.headers["X-GMS-Workspace"]).toBeUndefined();
  });
});
