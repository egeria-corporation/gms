// SPDX-License-Identifier: AGPL-3.0-only
// Fixes from tester feedback (v1.3.2): switches that flip at once and lists that stay on screen
// while they refresh, "Awarded funding" in place of "My grants", and funding alerts kept by the
// GMS's own alerts service.
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { ApplicationStatusView } from "../src/api/applicant.ts";
import { createHttpApplicantFullApi, OPENGRANTS_ALERTS } from "../src/api/applicantFull.ts";
import { ApiError } from "../src/api/client.ts";
import { provideApplicantFullApi } from "../src/api/applicantFullHooks.ts";
import { provideApplicantApi, provideMockApplicantStore, provideRealtime } from "../src/api/applicantHooks.ts";
import { provideApplicantMoreApi } from "../src/api/applicantMoreHooks.ts";
import { createRealtimeHub } from "../src/api/applicantRealtime.ts";
import { useApiQuery } from "../src/api/hooks.ts";
import { provideLaunchApi } from "../src/api/launchHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, ServicesProvider, type Services } from "../src/app/services.tsx";
import { APPLICANT_IDS, createMockApplicantApi, seedApplicantStore } from "../src/mocks/applicant.ts";
import { createMockApplicantFullApi, seedFullStore } from "../src/mocks/applicantFull.ts";
import { createMockApplicantMoreApi, seedMoreStore } from "../src/mocks/applicantMore.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { createMockLaunchApi, seedLaunchStore } from "../src/mocks/launch.ts";
import { DecisionSection } from "../src/screens/applicant/statusExtras.tsx";
import { viewport } from "./setup.ts";

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useApiQuery", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider services={createMockServices()}>{children}</ServicesProvider>;

  it("keeps the current data on screen while reload() fetches again, and says it is refreshing", async () => {
    const calls: ReturnType<typeof deferred<string>>[] = [];
    const { result } = renderHook(
      () =>
        useApiQuery(() => {
          const d = deferred<string>();
          calls.push(d);
          return d.promise;
        }, []),
      { wrapper },
    );
    expect(result.current.status).toBe("loading");
    expect(result.current.refreshing).toBe(false);
    await act(async () => calls.at(-1)!.resolve("first"));
    expect(result.current).toMatchObject({ status: "ready", data: "first", refreshing: false });

    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: "ready", data: "first", refreshing: true });
    await act(async () => calls.at(-1)!.resolve("second"));
    expect(result.current).toMatchObject({ status: "ready", data: "second", refreshing: false });
  });

  it("shows the error when a reload fails, and loads afresh when retried from the error", async () => {
    const calls: ReturnType<typeof deferred<string>>[] = [];
    const { result } = renderHook(
      () =>
        useApiQuery(() => {
          const d = deferred<string>();
          calls.push(d);
          return d.promise;
        }, []),
      { wrapper },
    );
    await act(async () => calls.at(-1)!.resolve("first"));
    act(() => result.current.reload());
    await act(async () => calls.at(-1)!.reject(new Error("offline")));
    expect(result.current.status).toBe("error");
    expect(result.current.data).toBeUndefined();
    expect(result.current.refreshing).toBe(false);

    act(() => result.current.reload());
    expect(result.current.status).toBe("loading");
    await act(async () => calls.at(-1)!.resolve("back"));
    expect(result.current).toMatchObject({ status: "ready", data: "back" });
  });

  it("shows the loading state, not the old data, when its inputs change", async () => {
    const calls: { id: string; d: ReturnType<typeof deferred<string>> }[] = [];
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useApiQuery(() => {
          const d = deferred<string>();
          calls.push({ id, d });
          return d.promise;
        }, [id]),
      { wrapper, initialProps: { id: "a" } },
    );
    await act(async () => calls.at(-1)!.d.resolve("record a"));
    expect(result.current.data).toBe("record a");
    rerender({ id: "b" });
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeUndefined();
    await act(async () => calls.at(-1)!.d.resolve("record b"));
    expect(result.current).toMatchObject({ status: "ready", data: "record b", refreshing: false });
  });

  it("set() replaces the data without a round trip", async () => {
    let n = 0;
    const { result } = renderHook(() => useApiQuery(async () => `load ${++n}`, []), { wrapper });
    await waitFor(() => expect(result.current.data).toBe("load 1"));
    act(() => result.current.set("written"));
    expect(result.current).toMatchObject({ status: "ready", data: "written", refreshing: false });
    expect(n).toBe(1);
  });
});

describe("Human gates", () => {
  const card = () => within(screen.getByRole("heading", { name: "Human gates" }).closest("section")!);

  async function open(updateWorkspace?: (orig: Services["api"]["updateWorkspace"]) => Services["api"]["updateWorkspace"]) {
    const services = createMockServices({ session: demoSession() });
    if (updateWorkspace) services.api.updateWorkspace = updateWorkspace(services.api.updateWorkspace.bind(services.api));
    render(
      <MemoryRouter initialEntries={["/w/riverbend/settings/mcp"]}>
        <App services={services} />
      </MemoryRouter>,
    );
    await waitFor(() => card());
    const toggle = await card().findByRole("switch", { name: "Request a revision requires approval" });
    return { services, toggle };
  }

  it("flips the switch at once, holds it while the save runs, and keeps the list on screen", async () => {
    const gate = deferred<void>();
    const { services, toggle } = await open((orig) => async (id, patch) => {
      await gate.promise;
      return orig(id, patch);
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeDisabled();
    expect(card().queryByText(/Loading gates/)).toBeNull();
    expect(card().getByText("Saving…")).toBeInTheDocument();

    await act(async () => gate.resolve());
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(card().getByText("Saved")).toBeInTheDocument();
    const ws = await services.api.workspace("riverbend");
    expect((await services.api.workspaceRecord(ws.id)).settings).toMatchObject({ gatedTools: ["request_revision"] });

    // And back off again, the same way.
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(((await services.api.workspaceRecord(ws.id)).settings as { gatedTools: string[] }).gatedTools).toEqual([]);
  });

  it("puts the switch back and says which gate did not change when the save fails", async () => {
    const gate = deferred<void>();
    const { toggle } = await open(() => async () => {
      await gate.promise;
      throw Object.assign(new Error("The server could not be reached."), { status: 503 });
    });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await act(async () => gate.resolve());
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(toggle).toBeEnabled();
    const alert = card().getByRole("alert");
    expect(alert).toHaveTextContent("“Request a revision” did not change. The switch is back where it was.");
    expect(alert).toHaveTextContent("The server could not be reached.");
  });
});

/** An applicant at Alder Creek, with every applicant port on the mocks. */
function applicant(path: string) {
  const services = createMockServices({ session: demoSession() });
  const store = seedApplicantStore();
  const more = seedMoreStore(store);
  const full = seedFullStore(store);
  const launch = seedLaunchStore();
  const session = () => services.auth.getSession();
  provideMockApplicantStore(services, store);
  provideApplicantApi(services, createMockApplicantApi({ session, store }));
  provideApplicantMoreApi(services, createMockApplicantMoreApi({ session, store, more }));
  provideApplicantFullApi(services, createMockApplicantFullApi({ session, store, full }));
  provideLaunchApi(services, createMockLaunchApi({ session, store: launch }), launch);
  provideRealtime(services, createRealtimeHub());
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
}

describe("Awarded funding (was My grants)", () => {
  const A = "/w/alder-creek";
  afterEach(() => {
    viewport.phone = false;
  });

  it("names the page, its title and the rail link Awarded funding, at the same address", async () => {
    applicant(`${A}/grants`);
    expect(await screen.findByRole("heading", { level: 1, name: "Awarded funding" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Applicant workspace" });
    const link = within(rail).getByRole("link", { name: "Awarded funding" });
    expect(link).toHaveAttribute("href", `${A}/grants`);
    expect(link).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(document.title).toMatch(/^Awarded funding — /));
    expect(document.body).not.toHaveTextContent(/My grants/i);
  });

  it("uses Awarded funding in a grant's breadcrumb and on the reports page", async () => {
    const grant = applicant(`${A}/grants/awd_${APPLICANT_IDS.awardClinic}`);
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Awarded funding" })).toHaveAttribute("href", `${A}/grants`);
    expect(within(screen.getByRole("navigation", { name: "Applicant workspace" })).getByRole("link", { name: "Awarded funding" })).toHaveAttribute("aria-current", "page");
    grant.unmount();

    applicant(`${A}/reports`);
    const main = await screen.findByRole("main");
    expect(await within(main).findByRole("link", { name: "Awarded funding" })).toHaveAttribute("href", `${A}/grants`);
    expect(document.body).not.toHaveTextContent(/My grants/i);
  });

  it("on a phone, the page is titled Awarded funding and its tab says Awards", async () => {
    viewport.phone = true;
    applicant(`${A}/grants`);
    const tabs = await screen.findByRole("navigation", { name: "Primary" });
    expect(await screen.findByRole("heading", { level: 1, name: "Awarded funding" })).toBeInTheDocument();
    const tab = within(tabs).getByRole("link", { name: "Awards" });
    expect(tab).toHaveAttribute("href", `${A}/grants`);
    expect(tab).toHaveAttribute("aria-current", "page");
    expect(within(tabs).queryByRole("link", { name: "Grants" })).toBeNull();
  });

  it("an accepted decision points to Awarded funding", () => {
    const status = { status: "accepted", timeline: [{ id: "e1", type: "accept", fromStatus: "under_review", toStatus: "accepted", fromStage: null, toStage: null, at: "2027-06-12T17:00:00Z", message: null }] } as unknown as ApplicationStatusView;
    render(
      <MemoryRouter>
        <DecisionSection status={status} funder="Riverbend Community Foundation" base={A} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/The award and its agreement are under Awarded funding\./)).toBeInTheDocument();
  });
});

describe("funding alerts over HTTP", () => {
  type Sent = { method: string; path: string; body: unknown };
  /** A fake GMS: the alerts service answers, OpenGrants alerts answer 501 as they do in production. */
  function server(opts: { alerts?: { status: number; body: unknown } } = {}) {
    const sent: Sent[] = [];
    const rows: { id: string; name: string; query: string | null; filters: object; frequency: string; createdAt: string }[] = [
      { id: "a-old", name: "rural health", query: "rural health", filters: {}, frequency: "weekly", createdAt: "2027-03-01T00:00:00Z" },
    ];
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      sent.push({ method, path: url.pathname, body });
      if (url.pathname === "/gms/discover/alerts" && method === "GET") return json(200, { data: rows });
      if (url.pathname === "/gms/discover/alerts" && method === "POST") {
        if (opts.alerts) return json(opts.alerts.status, opts.alerts.body);
        const b = body as { name: string; query?: string };
        const row = { id: `a-${rows.length + 1}`, name: b.name, query: b.query ?? null, filters: {}, frequency: "weekly", createdAt: "2027-04-20T00:00:00Z" };
        rows.push(row);
        return json(201, { data: row });
      }
      if (url.pathname === "/gms/discover/opengrants/alerts") return json(501, { code: "opengrants_not_supported", message: "Funding alerts are set up on opengrants.io; they are not available from here yet" });
      return json(404, { message: "Not found" });
    };
    return { sent, fetch };
  }
  const api = (fetch: typeof globalThis.fetch, openGrantsAlerts?: boolean) =>
    createHttpApplicantFullApi({ baseUrl: "http://api.test", token: async () => "t", workspaceId: () => "ws-1", fetch, ...(openGrantsAlerts === undefined ? {} : { openGrantsAlerts }) });

  it("creates the alert with the GMS's own alerts service and never asks OpenGrants, which cannot take one", async () => {
    expect(OPENGRANTS_ALERTS).toBe(false);
    const s = server();
    const alert = await api(s.fetch).createAlert("  housing stability ");
    expect(alert).toEqual({ id: "a-2", query: "housing stability", createdAt: "2027-04-20T00:00:00Z" });
    expect(s.sent).toEqual([{ method: "POST", path: "/gms/discover/alerts", body: { name: "housing stability", query: "housing stability" } }]);
  });

  it("lists the alerts from the same service, newest first", async () => {
    const s = server();
    const full = api(s.fetch);
    await full.createAlert("housing stability");
    expect((await full.alerts()).map((a) => a.query)).toEqual(["housing stability", "rural health"]);
    expect(s.sent.map((x) => `${x.method} ${x.path}`)).toEqual(["POST /gms/discover/alerts", "GET /gms/discover/alerts"]);
  });

  it("keeps a long topic whole and shortens only the alert's name to what the service takes", async () => {
    const s = server();
    const topic = "community health worker programs ".repeat(6).trim();
    expect(topic.length).toBeGreaterThan(120);
    const alert = await api(s.fetch).createAlert(topic);
    expect(alert.query).toBe(topic);
    expect((s.sent[0]!.body as { name: string }).name).toHaveLength(120);
  });

  it("where OpenGrants is said to take alerts, also tells it, and its 501 does not lose the saved alert", async () => {
    const s = server();
    const alert = await api(s.fetch, true).createAlert("housing stability");
    expect(alert.query).toBe("housing stability");
    expect(s.sent.map((x) => x.path)).toEqual(["/gms/discover/alerts", "/gms/discover/opengrants/alerts"]);
  });

  it("reports a refused alert as an error and asks OpenGrants nothing", async () => {
    const s = server({ alerts: { status: 422, body: { message: "A workspace can keep up to 25 funding alerts" } } });
    const err = await api(s.fetch, true).createAlert("one more").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, message: "A workspace can keep up to 25 funding alerts" });
    expect(s.sent.map((x) => x.path)).toEqual(["/gms/discover/alerts"]);
  });
});
