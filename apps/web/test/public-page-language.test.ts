// SPDX-License-Identifier: AGPL-3.0-only
// The public opportunity page asks the API in the page's language (`?lang=`), so a funder's own
// Spanish follows the switcher even without the language cookie or a Spanish browser.
import { afterEach, describe, expect, it } from "vitest";
import { createHttpApi } from "../src/api/client.ts";
import { changeLocale } from "../src/i18n/current.ts";

const asked: string[] = [];
const api = createHttpApi({
  baseUrl: "https://api.test",
  token: async () => null,
  identity: async () => ({ email: "" }),
  fetch: (async (input: RequestInfo | URL) => {
    asked.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch,
});

afterEach(async () => {
  asked.length = 0;
  await changeLocale("en");
});

describe("the public opportunity page's language", () => {
  it("sends ?lang= with the page's language", async () => {
    await api.publicOpportunity("riverbend", "community-health-2027");
    expect(asked).toEqual(["https://api.test/gms/public/funders/riverbend/opportunities/community-health-2027?lang=en"]);
    await changeLocale("es");
    await api.publicOpportunity("riverbend", "community-health-2027");
    expect(asked[1]).toBe("https://api.test/gms/public/funders/riverbend/opportunities/community-health-2027?lang=es");
  });
});
