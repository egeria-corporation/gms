// SPDX-License-Identifier: AGPL-3.0-only
// Fixes from tester feedback (v1.3.2): switches that flip at once and lists that stay on screen
// while they refresh.
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { useApiQuery } from "../src/api/hooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices, ServicesProvider, type Services } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";

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
