// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { log, redact, setLogSink } from "../src/lib/log.ts";
import { BASE, WEB, clientCredentialsToken, harness } from "./helpers.ts";

afterEach(() => setLogSink(null));

describe("discovery", () => {
  it("publishes public keys only, with kid, use and alg", async () => {
    const h = await harness();
    const res = await h.request("/.well-known/jwks.json");
    expect(res.status).toBe(200);
    const { keys } = (await res.json()) as { keys: Record<string, string>[] };
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "EC", crv: "P-256", kid: h.kid, use: "sig", alg: "ES256" });
    expect(Object.keys(keys[0]!).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
  });

  it("retains rotated keys from JWKS_EXTRA_PUBLIC_KEYS and refuses private material there", async () => {
    const h = await harness();
    const { keys } = (await (await h.request("/.well-known/jwks.json")).json()) as { keys: Record<string, string>[] };
    h.env.JWKS_EXTRA_PUBLIC_KEYS = JSON.stringify([{ ...keys[0], kid: "oauth-old" }]);
    const rotated = (await (await h.request("/.well-known/jwks.json")).json()) as { keys: { kid: string }[] };
    expect(rotated.keys.map((k) => k.kid)).toEqual([h.kid, "oauth-old"]);
    h.env.JWKS_EXTRA_PUBLIC_KEYS = JSON.stringify([{ ...keys[0], kid: "oauth-leak", d: "x" }]);
    setLogSink(() => {});
    expect((await h.request("/.well-known/jwks.json")).status).toBe(500);
  });

  it("serves authorization server and protected resource metadata", async () => {
    const h = await harness();
    const as = (await (await h.request("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(as).toMatchObject({ issuer: BASE, token_endpoint: `${BASE}/oauth/token`, registration_endpoint: `${BASE}/oauth/register`, code_challenge_methods_supported: ["S256"] });
    const pr = (await (await h.request("/.well-known/oauth-protected-resource")).json()) as Record<string, unknown>;
    expect(pr).toMatchObject({ resource: BASE, authorization_servers: [BASE] });
    const mcp = (await (await h.request("/.well-known/oauth-protected-resource/mcp")).json()) as Record<string, unknown>;
    expect(mcp.resource).toBe(`${BASE}/mcp`);
  });

  it("serves the agent card and llms.txt", async () => {
    const h = await harness();
    const card = (await (await h.request("/.well-known/agent.json")).json()) as { capabilities: string[]; humanGatedActions: string[] };
    expect(card.capabilities).toEqual(["mcp", "commongrants:0.5.0"]);
    expect(card.humanGatedActions).toContain("release_tranche");
    const llms = await h.request("/llms.txt");
    expect(llms.headers.get("Content-Type")).toContain("text/plain");
    const text = await llms.text();
    expect(text).toContain(`${BASE}/mcp`);
    expect(text).toContain("pending_approval");
    expect(await (await h.request("/llms-full.txt")).text()).toContain("`payments:release`");
  });

  it("health and discovery answer without a database; everything else says 503", async () => {
    const h = await harness();
    const bare = createApp(() => null);
    const health = await bare.request(`${BASE}/health`, {}, h.env);
    expect(await health.json()).toMatchObject({ status: "ok", database: "not_configured" });
    expect((await bare.request(`${BASE}/.well-known/jwks.json`, {}, h.env)).status).toBe(200);
    const res = await bare.request(`${BASE}/gms/me`, {}, h.env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 503, message: "Database is not configured", errors: [{ code: "database_unavailable" }] });
  });
});

describe("envelopes", () => {
  it("uses the CommonGrants error shape for 401, 404 and 501", async () => {
    const h = await harness();
    const unauth = await h.request("/gms/whoami");
    expect(await unauth.json()).toEqual({ status: 401, message: "A bearer token is required", errors: [{ code: "missing_token" }] });
    const missing = await h.request("/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ status: 404, message: "Route not found", errors: [{ code: "not_found" }] });
    for (const path of ["/common-grants/awards", "/gms/tranches", "/webhooks/passport"]) {
      const res = await h.request(path, { method: path.startsWith("/webhooks") ? "POST" : "GET" });
      expect(res.status, path).toBe(501);
      const body = (await res.json()) as { status: number; errors: { code: string }[] };
      expect(body.status).toBe(501);
      expect(body.errors[0]!.code).toBe("not_implemented");
    }
  });

  it("validates pagination", async () => {
    const h = await harness();
    const token = await clientCredentialsToken(h);
    const res = await h.request("/gms/ledger?page=0", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errors: [{ code: "bad_request" }, { code: "invalid_parameter", field: "page" }] });
    const capped = await h.request("/gms/ledger?pageSize=5000", { headers: { Authorization: `Bearer ${token}` } });
    expect(((await capped.json()) as { paginationInfo: { pageSize: number } }).paginationInfo.pageSize).toBe(100);
  });

  it("sets security headers and scopes CORS to the web origin", async () => {
    const h = await harness();
    const res = await h.request("/gms/whoami", { headers: { Origin: WEB } });
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(WEB);
    expect((await h.request("/gms/whoami", { headers: { Origin: "https://evil.example" } })).headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await h.request("/.well-known/jwks.json", { headers: { Origin: "https://claude.ai" } })).headers.get("Access-Control-Allow-Origin")).toBe("*");
    const preflight = await h.request("/oauth/token", { method: "OPTIONS", headers: { Origin: "https://claude.ai" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
});

describe("logging", () => {
  it("never logs tokens, secrets, query values, or bank and identity fields", async () => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    const h = await harness();
    const token = await clientCredentialsToken(h);
    await h.request("/gms/ledger?subjectId=awd_secret_subject", { headers: { Authorization: `Bearer ${token}` } });
    const bankKey = ["account", "number"].join("_");
    log("info", `issued Bearer ${token}`, { client_secret: "gms_cs_abcdefghijk", note: "refresh gms_rt_abcdefghijk1234", nested: { [bankKey]: "000111222", last4: "4821", bankName: "River City Credit Union" } });
    const all = lines.join("\n");
    expect(all).not.toContain(token);
    expect(all).not.toContain("awd_secret_subject");
    expect(all).not.toContain("gms_cs_abcdefghijk");
    expect(all).not.toContain("abcdefghijk1234");
    expect(all).not.toContain("000111222");
    expect(all).toContain("/gms/ledger?subjectId=…");
    expect(all).toContain("4821");
    expect(redact({ Authorization: "x", ok: 1 })).toEqual({ Authorization: "[REDACTED]", ok: 1 });
  });
});
