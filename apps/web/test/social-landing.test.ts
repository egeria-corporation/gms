// SPDX-License-Identifier: AGPL-3.0-only
// A visit from a shared social link is remembered in this tab per funder and opportunity, and the
// application start sends `?utm_source=social` for that opportunity only; nothing breaks without storage.
import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberSocialLanding, socialSourceFor } from "../src/lib/socialLanding.ts";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("social landing", () => {
  it("remembers a landing from a shared link, for that opportunity only", () => {
    rememberSocialLanding("riverbend", "community-health-2027", "?utm_source=newsletter");
    expect(socialSourceFor("riverbend", "community-health-2027")).toBeUndefined();
    rememberSocialLanding("riverbend", "community-health-2027", "?utm_source=social&x=1");
    expect(socialSourceFor("riverbend", "community-health-2027")).toBe("social");
    expect(socialSourceFor("riverbend", "other-call")).toBeUndefined();
    expect(socialSourceFor(null, "community-health-2027")).toBeUndefined();
  });

  it("does nothing when storage refuses", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => rememberSocialLanding("riverbend", "community-health-2027", "?utm_source=social")).not.toThrow();
    expect(socialSourceFor("riverbend", "community-health-2027")).toBeUndefined();
  });
});
