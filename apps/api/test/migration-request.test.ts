// SPDX-License-Identifier: AGPL-3.0-only
// "Request a free migration" (switch pages): the preview equals what is sent, the confirmation,
// the daily limits per email and per network, the honeypot and the time check, human only (API and
// agent tokens refused, no MCP tool), and numbers that look like bank or identity numbers removed
// from the note. Sample numbers are invalid by construction (area 999, all zeros, all ones).
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { setLogSink } from "../src/lib/log.ts";
import { MIGRATION_REQUEST_LIMITS } from "../src/services/migration-request.ts";
import { CLIENT_AGENT, USER_ADMIN, WS_FUNDER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const ADDRESS = "203.0.113.7";
const input = (extra: Record<string, unknown> = {}) => ({ name: "Ana Ruiz", email: "ana@riverbendcf.example", organization: "Riverbend Community Foundation", system: "submittable", programs: "2-5", pastAwards: "100-999", timing: "3-months", ...extra });
type Body<T> = { data: T; errors?: { code: string; field?: string }[]; message?: string };
async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await h.request(path, { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": ADDRESS, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as Body<T>, headers: res.headers };
}
const later = (seconds: number) => void (h.clock.now = new Date(h.clock.now.getTime() + seconds * 1000));
async function formToken() {
  const r = await call<{ formToken: string; minSeconds: number }>("GET", "/gms/migration-requests/form");
  expect(r.status).toBe(200);
  return r.body.data.formToken;
}
/** A send the way the page makes it: token when the form is shown, a person's few seconds, then send. */
async function send(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const token = await formToken();
  later(MIGRATION_REQUEST_LIMITS.minSecondsToSubmit + 2);
  return call<{ sent: boolean; requestId: string; to: string; replyTo: string; confirmationSent: boolean; message: string }>("POST", "/gms/migration-requests", input({ formToken: token, ...extra }), headers);
}

describe("preview and send", () => {
  it("sends exactly the preview, to OpenGrants with replies to the person, and confirms to the person", async () => {
    const p = await call<{ to: string; replyTo: string; subject: string; text: string; systemLabel: string; programsLabel: string; confirmation: { to: string; subject: string; text: string } }>("POST", "/gms/migration-requests/preview", input({ note: "We run two cycles a year." }));
    expect(p.status).toBe(200);
    expect(p.body.data).toMatchObject({ to: "hello@agents.opengrants.io", replyTo: "ana@riverbendcf.example", subject: "Migration request: Riverbend Community Foundation (from Submittable)", systemLabel: "Submittable", programsLabel: "2 to 5" });
    for (const fact of ["Name: Ana Ruiz", "Work email: ana@riverbendcf.example", "Current system: Submittable", "Past awards: 100 to 999", "Hoping to move: In the next 3 months", "Note:\nWe run two cycles a year."]) expect(p.body.data.text).toContain(fact);
    expect(h.mailer.sent).toHaveLength(0);

    const out = await send({ note: "We run two cycles a year." });
    expect(out.status).toBe(200);
    expect(out.headers.get("Cache-Control")).toBe("no-store");
    expect(out.body.data).toMatchObject({ sent: true, to: "hello@agents.opengrants.io", replyTo: "ana@riverbendcf.example", confirmationSent: true, message: "A person at OpenGrants will reply to ana@riverbendcf.example. Migration help can start right away." });
    const [request, confirmation] = h.mailer.sent;
    expect(request).toMatchObject({ to: ["hello@agents.opengrants.io"], replyTo: "ana@riverbendcf.example", subject: p.body.data.subject, text: p.body.data.text, tags: [{ name: "kind", value: "migration_request" }] });
    expect(confirmation).toMatchObject({ to: [p.body.data.confirmation.to], replyTo: "hello@agents.opengrants.io", subject: p.body.data.confirmation.subject, text: p.body.data.confirmation.text });
    expect(confirmation!.text).toContain("A person at OpenGrants will reply to this address, and migration help can start right away.");
    expect(confirmation!.text).toContain("https://app.gms.test/switch/submittable");
    // The confirmation carries nothing the person typed.
    expect(confirmation!.text).not.toMatch(/Ana|Riverbend|two cycles/);
  });

  it("goes where CONSULTING_REQUEST_TO says on this install", async () => {
    h.env.CONSULTING_REQUEST_TO = "switch@example.org";
    const p = await call<{ to: string }>("POST", "/gms/migration-requests/preview", input());
    expect(p.body.data.to).toBe("switch@example.org");
    await send();
    expect(h.mailer.sent[0]!.to).toEqual(["switch@example.org"]);
  });

  it("previews without counting: a preview never uses up the limits", async () => {
    for (let i = 0; i < 10; i++) expect((await call("POST", "/gms/migration-requests/preview", input())).status).toBe(200);
    expect((await send()).status).toBe(200);
  });

  it("refuses what the form would not send", async () => {
    for (const bad of [{ email: "not-an-email" }, { system: "unknown" }, { programs: "lots" }, { name: "  " }, { note: "x".repeat(2001) }, { extra: true }]) {
      const r = await call("POST", "/gms/migration-requests/preview", input(bad));
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call("POST", "/gms/migration-requests/preview", input({ note: "x".repeat(2000) }))).status).toBe(200);
  });

  it("removes numbers that look like bank or identity numbers from the note, in the preview and the email", async () => {
    const note = "Our acct 11111 is listed, and 999-00-0000 and 000000000 too. We made 1,250 awards since 2019.";
    const p = await call<{ note: string; numbersRemoved: number; text: string }>("POST", "/gms/migration-requests/preview", input({ note }));
    expect(p.body.data.numbersRemoved).toBe(3);
    expect(p.body.data.note).toBe("Our acct [number removed] is listed, and [number removed] and [number removed] too. We made 1,250 awards since 2019.");
    expect(p.body.data.text).toContain("3 numbers that looked like a bank or identity number were removed from the note before it was sent.");
    await send({ note });
    const sent = h.mailer.sent[0]!;
    expect(sent.text).toBe(p.body.data.text);
    for (const digits of ["11111", "999-00-0000", "000000000"]) {
      expect(sent.text).not.toContain(digits);
      expect(sent.html).not.toContain(digits);
    }
  });

  it("logs the send without the address or the note", async () => {
    const lines: string[] = [];
    setLogSink((l) => void lines.push(l));
    try {
      await send({ note: "Private plans." });
    } finally {
      setLogSink(null);
    }
    const line = lines.find((l) => l.includes("migration_request.sent"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/ana@|riverbend|Private plans/i);
  });
});

describe("protection for an anonymous form", () => {
  it("refuses a send with the hidden field filled in, and sends nothing", async () => {
    const r = await send({ website: "https://spam.example" });
    expect(r.status).toBe(422);
    expect(r.body.errors![0]!.code).toBe("not_sent");
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("needs a form token this server issued, a few seconds old and not older than a day", async () => {
    const none = await call("POST", "/gms/migration-requests", input());
    expect(none.status).toBe(422);
    expect(none.body.errors![0]!.code).toBe("form_expired");

    const token = await formToken();
    const tooFast = await call("POST", "/gms/migration-requests", input({ formToken: token }));
    expect(tooFast.status).toBe(422);
    expect(tooFast.body.errors![0]!.code).toBe("too_fast");

    later(5);
    const [issued, nonce, sig] = token.split(".");
    // A token with an earlier time written in, or any other change, does not verify.
    const backdated = `${(parseInt(issued!, 36) - 3_600_000).toString(36)}.${nonce}.${sig}`;
    const forged = await call("POST", "/gms/migration-requests", input({ formToken: backdated }));
    expect(forged.status).toBe(422);
    expect(forged.body.errors![0]!.code).toBe("form_expired");
    expect((await call("POST", "/gms/migration-requests", input({ formToken: `${issued}.${nonce}.${"A".repeat(43)}` }))).status).toBe(422);

    later(MIGRATION_REQUEST_LIMITS.formTokenHours * 3600 + 1);
    const expired = await call("POST", "/gms/migration-requests", input({ formToken: token }));
    expect(expired.body.errors![0]!.code).toBe("form_expired");
    expect(h.mailer.sent).toHaveLength(0);

    expect((await send()).status).toBe(200);
  });

  it("allows 3 a day from one email address and 20 a day from one network", async () => {
    for (let i = 0; i < MIGRATION_REQUEST_LIMITS.perEmailPerDay; i++) expect((await send()).status).toBe(200);
    // The same address in other letter case is the same address.
    const fourth = await send({ email: "ANA@riverbendcf.example" });
    expect(fourth.status).toBe(429);
    expect(fourth.body.errors![0]!.code).toBe("too_many_requests_for_email");

    for (let i = MIGRATION_REQUEST_LIMITS.perEmailPerDay; i < MIGRATION_REQUEST_LIMITS.perAddressPerDay; i++) expect((await send({ email: `person${i}@example.org` })).status, `send ${i + 1}`).toBe(200);
    const over = await send({ email: "one.more@example.org" });
    expect(over.status).toBe(429);
    expect(over.body.errors![0]!.code).toBe("too_many_requests");
    // Another network still can.
    expect((await send({ email: "one.more@example.org" }, { "CF-Connecting-IP": "198.51.100.9" })).status).toBe(200);
    expect(h.mailer.sent.filter((m) => m.subject.startsWith("Migration request"))).toHaveLength(MIGRATION_REQUEST_LIMITS.perAddressPerDay + 1);

    // The next day the counts start again.
    later(86_400);
    expect((await send()).status).toBe(200);
  });

  it("gives the counts back when the email fails, and says when mail is not set up", async () => {
    h.mailer.failNext = new Error("down");
    expect((await send()).status).toBe(502);
    for (let i = 0; i < MIGRATION_REQUEST_LIMITS.perEmailPerDay; i++) expect((await send()).status).toBe(200);
    h.withoutPorts.add("mailer");
    const r = await send({ email: "other@example.org" });
    expect(r.status).toBe(503);
    expect(r.body.errors![0]!.code).toBe("mail_not_configured");
  });

  it("still answers sent when only the confirmation fails: the request reached OpenGrants", async () => {
    const real = h.mailer.send.bind(h.mailer);
    h.mailer.send = async (m) => {
      if (m.subject === "We received your migration request") throw new Error("bounced");
      return real(m);
    };
    const r = await send();
    expect(r.body.data).toMatchObject({ sent: true, confirmationSent: false });
    expect(h.mailer.sent).toHaveLength(1);
  });
});

describe("human only", () => {
  it("refuses an agent's token and an API client's token on every route", async () => {
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "applications:read applications:write approvals:bypass", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-mig-1" });
    const client = await clientCredentialsToken(h);
    for (const token of [agent, client]) {
      const auth = bearer(token).headers;
      for (const [method, path, body] of [
        ["GET", "/gms/migration-requests/form"],
        ["POST", "/gms/migration-requests/preview", input()],
        ["POST", "/gms/migration-requests", input()],
      ] as const) {
        const r = await call(method, path, body, auth);
        expect(r.status, `${method} ${path}`).toBe(403);
        expect(r.body.errors![0]!.code).toBe("person_only");
      }
    }
    expect((await call("GET", "/gms/migration-requests/form", undefined, { Authorization: "Basic dXNlcjpwYXNz" })).status).toBe(403);
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("accepts a signed-in person's session, and refuses one that does not verify", async () => {
    const session = bearer(await h.session(USER_ADMIN)).headers;
    expect((await send({}, session)).status).toBe(200);
    const expired = bearer(await h.session(USER_ADMIN, { exp: Math.floor(h.clock.now.getTime() / 1000) - 60 })).headers;
    expect((await call("GET", "/gms/migration-requests/form", undefined, expired)).status).toBe(401);
  });

  it("has no MCP tool", async () => {
    const token = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "applications:read applications:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-mig-2" });
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const tools = ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.filter((t) => /migrat|switch/i.test(t.name))).toEqual([]);
  });
});
