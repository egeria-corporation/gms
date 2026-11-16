// SPDX-License-Identifier: AGPL-3.0-only
// The web app shows the API's message in the page's language when the API gave one
// (`errors[0].detailLocalized`, docs/i18n.md), and the English message otherwise.
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client.ts";

describe("ApiError", () => {
  it("reads detailLocalized when the API gave one, and keeps the English as detail", () => {
    const e = new ApiError(404, "Application not found", [{ code: "not_found", detailLocalized: "No se encontró la solicitud." }]);
    expect(e.message).toBe("No se encontró la solicitud.");
    expect(e.detail).toBe("Application not found");
    expect(e.status).toBe(404);
  });

  it("reads the English message when there is no localized one", () => {
    for (const errors of [[], [{ code: "not_found" }], [{ code: "x", detailLocalized: "  " }], [null]]) {
      const e = new ApiError(404, "Application not found", errors);
      expect(e.message).toBe("Application not found");
      expect(e.detail).toBe("Application not found");
    }
  });
});
