// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The free migration request, one scenario on two backends: (a) the web HTTP client
// (api/migrationRequest.ts) against the real API Worker in-process, with its in-memory mail port,
// and (b) the in-browser mock. The same assertions run on both: the preview equals what is sent,
// every option the form lists reads the same, numbers are removed from the note the same way, and
// the refusals (too fast, hidden field, daily limit) carry the same codes. So the mock-mode e2e flow
// proves what a real install does.
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client.ts";
import { createHttpMigrationRequestApi, type MigrationRequestApi, type MigrationRequestInput } from "../src/api/migrationRequest.ts";
import { PAST_AWARD_OPTIONS, PROGRAM_OPTIONS, SYSTEM_OPTIONS, TIMING_OPTIONS } from "../src/content/switch.ts";
import { createMockMigrationRequestApi } from "../src/mocks/migrationRequest.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

interface Mail {
  to: string[];
  replyTo?: string;
  subject: string;
  text: string;
}
interface Backend {
  api: MigrationRequestApi;
  sent: () => Mail[];
  /** Moves the backend's clock on. */
  later: (seconds: number) => void;
}

const helpers = await loadApi();

async function real(): Promise<Backend> {
  const h = (await helpers.harness()) as ApiHarness & { mailer: { sent: Mail[] } };
  const fetchInProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    // The client never sends a token; nothing is added here either.
    expect(req.headers.get("Authorization")).toBeNull();
    const body = req.method === "GET" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  return { api: createHttpMigrationRequestApi({ baseUrl: helpers.BASE, fetch: fetchInProcess }), sent: () => h.mailer.sent, later: (s) => void (h.clock.now = new Date(h.clock.now.getTime() + s * 1000)) };
}
function mock(): Backend {
  const clock = { now: Date.parse("2027-04-16T17:00:00Z") };
  const api = createMockMigrationRequestApi({ now: () => clock.now, webBaseUrl: helpers.WEB });
  return { api, sent: () => api.store.sent, later: (s) => void (clock.now += s * 1000) };
}

const input = (extra: Partial<MigrationRequestInput> = {}): MigrationRequestInput => ({ name: "Ana Ruiz", email: "ana@riverbendcf.example", organization: "Riverbend Community Foundation", system: "submittable", programs: "2-5", pastAwards: "100-999", timing: "3-months", ...extra });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "sent";
  } catch (e) {
    return e instanceof ApiError ? `${e.status} ${(e.errors[0] as { code?: string }).code}` : String(e);
  }
};

describe.each([
  ["real API", real],
  ["mock", async () => mock()],
] as const)("migration request on the %s", (_name, make) => {
  let b: Backend;
  beforeEach(async () => {
    b = await make();
  });

  it("sends exactly the preview, then the confirmation", async () => {
    const p = await b.api.preview(input({ note: "We run two cycles a year." }));
    const { formToken } = await b.api.form();
    b.later(5);
    const out = await b.api.send(input({ note: "We run two cycles a year.", formToken }));
    expect(out).toMatchObject({ sent: true, to: "hello@agents.opengrants.io", replyTo: "ana@riverbendcf.example", confirmationSent: true, message: "A person at OpenGrants will reply to ana@riverbendcf.example. Migration help can start right away." });
    const [request, confirmation] = b.sent();
    expect(request).toMatchObject({ to: [p.to], replyTo: p.replyTo, subject: p.subject, text: p.text });
    expect(confirmation).toMatchObject({ to: [p.confirmation.to], replyTo: p.to, subject: p.confirmation.subject, text: p.confirmation.text });
  });

  it("reads every option the form lists the same way", async () => {
    for (const o of SYSTEM_OPTIONS) expect((await b.api.preview(input({ system: o.value }))).systemLabel).toBe(o.label);
    for (const o of PROGRAM_OPTIONS) expect((await b.api.preview(input({ programs: o.value }))).programsLabel).toBe(o.label);
    for (const o of PAST_AWARD_OPTIONS) expect((await b.api.preview(input({ pastAwards: o.value }))).pastAwardsLabel).toBe(o.label);
    for (const o of TIMING_OPTIONS) expect((await b.api.preview(input({ timing: o.value }))).timingLabel).toBe(o.label);
  });

  it("removes numbers from the note the same way (sample numbers are invalid by construction)", async () => {
    const notes = ["Our acct 11111 is listed", "999-00-0000 and 999 00 0000", "Pay 000000000 or 1111 2222 3333 4444", "born 01/01/1900", "We hope to move by 2027-06-01 with 1,250 awards since 2019", "We linked OpenGrants Passport in 2026"];
    const out = await Promise.all(notes.map(async (note) => (({ note: n, numbersRemoved }) => ({ n, numbersRemoved }))(await b.api.preview(input({ note })))));
    expect(out).toEqual([
      { n: "Our acct [number removed] is listed", numbersRemoved: 1 },
      { n: "[number removed] and [number removed]", numbersRemoved: 2 },
      { n: "Pay [number removed] or [number removed]", numbersRemoved: 2 },
      { n: "born [number removed]", numbersRemoved: 1 },
      { n: "We hope to move by 2027-06-01 with 1,250 awards since 2019", numbersRemoved: 0 },
      { n: "We linked OpenGrants Passport in 2026", numbersRemoved: 0 },
    ]);
    expect((await b.api.preview(input({ note: "   " }))).note).toBeNull();
  });

  it("refuses the same sends with the same codes", async () => {
    const { formToken } = await b.api.form();
    expect(await codeOf(b.api.send(input()))).toBe("422 form_expired");
    expect(await codeOf(b.api.send(input({ formToken })))).toBe("422 too_fast");
    b.later(5);
    expect(await codeOf(b.api.send(input({ formToken, website: "x" })))).toBe("422 not_sent");
    expect(await codeOf(b.api.preview(input({ email: "nope" })))).toMatch(/^400 /);
    for (let i = 0; i < 3; i++) expect(await codeOf(b.api.send(input({ formToken })))).toBe("sent");
    expect(await codeOf(b.api.send(input({ formToken, email: "Ana@RiverbendCF.example" })))).toBe("429 too_many_requests_for_email");
    b.later(25 * 3600);
    expect(await codeOf(b.api.send(input({ formToken })))).toBe("422 form_expired");
  });
});
