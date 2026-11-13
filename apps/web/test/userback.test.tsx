// SPDX-License-Identifier: AGPL-3.0-only
// The Userback feedback widget: off unless configured, the CSP, who it is told about, and the
// privacy markers that keep secrets, sign-in codes and payout facts out of screenshots.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy, headersFile, USERBACK } from "../build/headers.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { PayeeChip, DestinationCard } from "../src/screens/applicant/grant.tsx";
import { SecretOnce } from "../src/screens/funder/SettingsMcp.tsx";
import { destinationLabel } from "../src/components/payments.tsx";
import { createUserback, USERBACK_DISCLOSURE, USERBACK_SCRIPT, USERBACK_SCRIPT_ID, userbackActive, whoCanSeeAnswer } from "../src/lib/userback.ts";
import { demoSession, MOCK_CODE } from "../src/mocks/auth.ts";

const API = "https://gms.example";
const SB = "https://project.supabase.example";
const TOKEN = "A-test";

const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]));
const scripts = () => document.querySelectorAll(`script#${USERBACK_SCRIPT_ID}`);

afterEach(() => {
  scripts().forEach((s) => s.remove());
  delete (window as unknown as { Userback?: unknown }).Userback;
});

describe("Content-Security-Policy", () => {
  it("is unchanged and names no Userback origin without a token", () => {
    for (const token of [undefined, "", "  "]) {
      expect(contentSecurityPolicy(API, SB, undefined, token)).toBe(contentSecurityPolicy(API, SB));
      expect(headersFile(API, SB, undefined, token)).not.toMatch(/userback/);
    }
    expect(directives(contentSecurityPolicy(API, SB))["font-src"]).toEqual(["'self'"]);
  });

  it("adds exactly Userback's origins with a token and leaves frames and inline styles alone", () => {
    const d = directives(contentSecurityPolicy(API, SB, undefined, TOKEN));
    expect(d["script-src"]).toEqual(["'self'", ...USERBACK.script]);
    expect(d["style-src"]).toEqual(["'self'", ...USERBACK.style]);
    expect(d["font-src"]).toEqual(["'self'", ...USERBACK.font]);
    expect(d["connect-src"]).toEqual(["'self'", API, SB, "wss://project.supabase.example", "https://api.userback.io", "https://events.userback.io", "https://static.userback.io"]);
    expect(d["img-src"]).toEqual(["'self'", "data:", "https:"]);
    expect(d["frame-src"]).toEqual(["'none'"]);
    expect(contentSecurityPolicy(API, SB, undefined, TOKEN)).not.toContain("unsafe-inline");
  });

  it("combines with the Google Picker", () => {
    const d = directives(contentSecurityPolicy(API, SB, { apiKey: "k", clientId: "c" }, TOKEN));
    expect(d["script-src"]).toEqual(["'self'", "https://apis.google.com", "https://accounts.google.com/gsi/client", "https://static.userback.io"]);
  });
});

describe("loader", () => {
  it("does nothing without a token or in mock mode", () => {
    expect(userbackActive({ token: "", useMocks: false })).toBe(false);
    expect(userbackActive({ token: TOKEN, useMocks: true })).toBe(false);
    expect(createUserback({ token: "", useMocks: false })).toBeNull();
    expect(createUserback({ token: TOKEN, useMocks: true })).toBeNull();
    expect(scripts()).toHaveLength(0);
    expect((window as unknown as { Userback?: unknown }).Userback).toBeUndefined();
  });

  it("injects nothing when the whole app runs in mock mode, signed in or out", async () => {
    render(
      <MemoryRouter initialEntries={["/w/riverbend"]}>
        <App services={createMockServices({ session: demoSession() })} />
      </MemoryRouter>,
    );
    await screen.findByRole("navigation", { name: "Funder workspace" });
    expect(document.querySelector(`script[src="${USERBACK_SCRIPT}"]`)).toBeNull();
  });

  it("loads the script once, async, with the token and no user when signed out", () => {
    const ub = createUserback({ token: ` ${TOKEN} `, useMocks: false })!;
    ub.sync(null);
    ub.sync(null);
    expect(scripts()).toHaveLength(1);
    const s = scripts()[0] as HTMLScriptElement;
    expect(s.src).toBe(USERBACK_SCRIPT);
    expect(s.async).toBe(true);
    expect((window as unknown as { Userback: unknown }).Userback).toEqual({ access_token: TOKEN });
  });

  it("sets user_data to the id, name and email only, before the script loads", () => {
    const ub = createUserback({ token: TOKEN, useMocks: false })!;
    ub.sync({ id: "u-1", name: "Dana Ortiz", email: "dana@example.org" });
    expect((window as unknown as { Userback: unknown }).Userback).toEqual({
      access_token: TOKEN,
      user_data: { id: "u-1", info: { name: "Dana Ortiz", email: "dana@example.org" } },
    });
    expect(scripts()).toHaveLength(1);
  });

  it("uses identify on sign-in when the widget has it", () => {
    const ub = createUserback({ token: TOKEN, useMocks: false })!;
    ub.sync(null);
    const identify = vi.fn();
    const destroy = vi.fn();
    Object.assign((window as unknown as { Userback: object }).Userback, { identify, destroy });
    ub.sync({ id: "u-2", name: "Sam", email: "sam@example.org" });
    expect(identify).toHaveBeenCalledWith("u-2", { name: "Sam", email: "sam@example.org" });
    expect(destroy).not.toHaveBeenCalled();
    expect(scripts()).toHaveLength(1);
  });

  it("destroys and reloads on sign-in without identify, and on every sign-out", () => {
    const ub = createUserback({ token: TOKEN, useMocks: false })!;
    ub.sync(null);
    const destroy = vi.fn();
    Object.assign((window as unknown as { Userback: object }).Userback, { destroy });
    ub.sync({ id: "u-3", name: "Lee", email: "lee@example.org" });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(scripts()).toHaveLength(1);
    expect((window as unknown as { Userback: { user_data: unknown } }).Userback.user_data).toEqual({ id: "u-3", info: { name: "Lee", email: "lee@example.org" } });

    // Sign-out never uses identify, even when it exists.
    const identify = vi.fn();
    const destroy2 = vi.fn();
    Object.assign((window as unknown as { Userback: object }).Userback, { identify, destroy: destroy2 });
    ub.sync(null);
    expect(destroy2).toHaveBeenCalledTimes(1);
    expect(identify).not.toHaveBeenCalled();
    expect(scripts()).toHaveLength(1);
    expect((window as unknown as { Userback: object }).Userback).toEqual({ access_token: TOKEN });
  });
});

describe("disclosure", () => {
  it("is added to the answer only when the widget is active", () => {
    expect(whoCanSeeAnswer(false)).toBe("Only funders you apply to or accept an award from.");
    expect(whoCanSeeAnswer(true)).toBe(`Only funders you apply to or accept an award from. ${USERBACK_DISCLOSURE}`);
    expect(whoCanSeeAnswer(false)).not.toMatch(/Userback/);
  });
});

describe("privacy markers", () => {
  it("marks the sign-in code boxes ignore and the two-step card block", async () => {
    render(
      <MemoryRouter initialEntries={["/signin"]}>
        <App services={createMockServices({ session: null })} />
      </MemoryRouter>,
    );
    await userEvent.type(await screen.findByLabelText("Work email"), "dana.ortiz@riverbendcf.example");
    await userEvent.click(screen.getByRole("button", { name: /Send code/ }));
    const group = await screen.findByRole("group", { name: "One-time code" });
    const boxes = group.querySelectorAll("input");
    expect(boxes).toHaveLength(6);
    boxes.forEach((b) => expect(b).toHaveClass("userback-ignore"));
    await userEvent.click(boxes[0]!);
    await userEvent.paste(MOCK_CODE);
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    const setup = await screen.findByRole("heading", { name: "Set Up Two-Step Verification" });
    expect(setup.closest("form")).toHaveClass("userback-block");
    expect((await screen.findByText("QHX7-R2MP-4TLC-W9KD")).closest(".userback-block")).not.toBeNull();
    expect(screen.getByLabelText("Enter the 6-digit code from your app").closest(".userback-block")).not.toBeNull();
  });

  it("marks one-time secrets block", () => {
    render(<SecretOnce title="Webhook signing secret" label="Signing secret" value="whsec_test" onClose={() => undefined} />);
    expect(screen.getByDisplayValue("whsec_test").closest(".userback-block")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Copy/ }).closest(".userback-block")).not.toBeNull();
  });

  it("marks payout facts block", () => {
    const payee = { status: "pending_change", bankName: "Test Bank", last4: "0000", level: "L3", manageUrl: null } as never;
    render(
      <MemoryRouter>
        <PayeeChip payee={payee} />
        <DestinationCard payee={payee} orgHref="/x" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Change pending")[0]!.closest(".userback-block")).not.toBeNull();
    expect(screen.getByText(/Test Bank/).closest(".userback-block")).not.toBeNull();
    expect(destinationLabel({ bankName: "Test Bank", last4: "0000" } as never)).toContain("0000");
  });
});
