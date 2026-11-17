// SPDX-License-Identifier: AGPL-3.0-only
// Field problems under an error banner. The API names each as `{ code, field, detail }`; the mocks
// as `{ field, message }`. Until v1.8.0 the banner read `message` only, so the reasons the server gave
// for a field never showed anywhere in the app. problems-contract.test.ts holds it to the real Worker.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client.ts";
import { ErrorBanner, problemFor, problemsOf } from "../src/components/ui.tsx";

describe("problemsOf", () => {
  it("reads the API's detail and the mocks' message alike", () => {
    const api = new ApiError(400, "The request body is not valid", [{ code: "bad_request" }, { code: "invalid_field", field: "definition.columns.0", detail: "Name a column of the data set" }]);
    expect(problemsOf(api)).toEqual([{ field: "definition.columns.0", message: "Name a column of the data set" }]);
    const mock = new ApiError(400, "Write at least a sentence or two", [{ field: "text", message: "Too short" }]);
    expect(problemsOf(mock)).toEqual([{ field: "text", message: "Too short" }]);
    expect(problemFor(api, "columns.0")).toBe("Name a column of the data set");
  });

  it("leaves out a detail that only names a record, and anything that is not an API error", () => {
    const ref = new ApiError(409, "Sign the conflict-of-interest policy first", [{ code: "coi_policy_unsigned" }, { code: "coi_policy_unsigned", field: "competitionId", detail: "cmp_0193a1c0-0000-7000-8000-0000000000c1" }]);
    expect(problemsOf(ref)).toEqual([]);
    expect(problemsOf(new ApiError(409, "Exists", [{ code: "existing", detail: "0193a1c0-0000-7000-8000-0000000000c1" }]))).toEqual([]);
    expect(problemsOf(new Error("x"))).toEqual([]);
  });

  it("lists the server's reasons under the banner", () => {
    render(<ErrorBanner error={new ApiError(400, "The request body is not valid", [{ code: "bad_request" }, { code: "invalid_field", field: "name", detail: "Give the view a name" }])} />);
    const alert = within(screen.getByRole("alert"));
    expect(alert.getByText("The request body is not valid")).toBeInTheDocument();
    expect(alert.getByText("name")).toBeInTheDocument();
    expect(alert.getByText(/Give the view a name/)).toBeInTheDocument();
  });
});
