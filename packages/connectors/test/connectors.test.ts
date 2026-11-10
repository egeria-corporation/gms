// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { ConnectorAuthError, ConnectorUnavailableError, HttpMcpDirectory, MercuryBankFeed, isRegistrableMcpUrl } from "../src/index.ts";

const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));

describe("MercuryBankFeed", () => {
  const txn = (over: Record<string, unknown>) => ({ id: "txn-1", amount: -75000, postedAt: "2027-05-25T16:00:00Z", status: "sent", kind: "outgoingPayment", counterpartyName: "Alder Creek Family Services", note: null, externalMemo: "Grant tranche 1", bankDescription: "ACH", details: { doNotRead: "bank details live here" }, ...over });

  it("reads settled outbound payments only, with the two documented endpoints and no account details", async () => {
    const urls: string[] = [];
    const feed = new MercuryBankFeed((url, init) => {
      urls.push(url);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer read-only-test-token");
      if (url.includes("/accounts")) return json({ accounts: [{ id: "acct-1" }] });
      return json({ transactions: [txn({}), txn({ id: "txn-in", amount: 500 }), txn({ id: "txn-card", kind: "debitCardTransaction" }), txn({ id: "txn-fee", kind: "wireFee" }), txn({ id: "txn-own", kind: "internalTransfer" }), txn({ id: "txn-pending", status: "pending", postedAt: null })] });
    });
    const out = await feed.listOutbound("read-only-test-token", "2027-05-01T00:00:00Z");
    expect(out).toEqual([{ externalId: "txn-1", amountMinor: 7_500_000, currency: "USD", postedAt: "2027-05-25T16:00:00Z", counterpartyName: "Alder Creek Family Services", memo: "Grant tranche 1" }]);
    expect(JSON.stringify(out)).not.toContain("bank details");
    expect(urls[0]).toBe("https://api.mercury.com/api/v1/accounts?limit=1000");
    const q = new URL(urls[1]!).searchParams;
    expect(new URL(urls[1]!).pathname).toBe("/api/v1/account/acct-1/transactions");
    expect(Object.fromEntries(q)).toEqual({ limit: "1000", offset: "0", order: "asc", status: "sent", start: "2027-05-01" });
  });

  it("pages through a full page of transactions", async () => {
    let calls = 0;
    const feed = new MercuryBankFeed((url) => {
      if (url.includes("/accounts")) return json({ accounts: [{ id: "acct-1" }] });
      calls++;
      const offset = Number(new URL(url).searchParams.get("offset"));
      return json({ transactions: offset === 0 ? Array.from({ length: 1000 }, (_, i) => txn({ id: `t-${i}` })) : [txn({ id: "t-last" })] });
    });
    expect(await feed.listOutbound("read-only-test-token", null)).toHaveLength(1001);
    expect(calls).toBe(2);
  });

  it("separates rejected credentials from an outage", async () => {
    await expect(new MercuryBankFeed(() => json({}, 401)).listOutbound("x", null)).rejects.toBeInstanceOf(ConnectorAuthError);
    await expect(new MercuryBankFeed(() => json({}, 500)).listOutbound("x", null)).rejects.toBeInstanceOf(ConnectorUnavailableError);
    await expect(new MercuryBankFeed(() => Promise.reject(new Error("down"))).listOutbound("x", null)).rejects.toBeInstanceOf(ConnectorUnavailableError);
  });
});

describe("HttpMcpDirectory", () => {
  const server = { url: "https://crm.example/mcp", authHeader: "Bearer low-entropy-test" };

  it("lists tools and marks only declared read-only tools as read-only", async () => {
    const dir = new HttpMcpDirectory(() => json({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "lookup_org", annotations: { readOnlyHint: true } }, { name: "update_org" }] } }));
    expect(await dir.listTools(server)).toEqual([
      { name: "lookup_org", description: null, readOnly: true },
      { name: "update_org", description: null, readOnly: false },
    ]);
  });

  it("calls a tool and prefers structured content, capping free text", async () => {
    const sent: unknown[] = [];
    const structured = new HttpMcpDirectory((_u, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return json({ jsonrpc: "2.0", id: 1, result: { structuredContent: { priorGrants: 1 }, content: [{ type: "text", text: "ignored" }] } });
    });
    expect(await structured.callTool(server, "lookup_org", { organizationName: "Alder Creek Family Services" })).toEqual({ priorGrants: 1 });
    expect(sent[0]).toMatchObject({ method: "tools/call", params: { name: "lookup_org", arguments: { organizationName: "Alder Creek Family Services" } } });

    const text = new HttpMcpDirectory(() => json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "x".repeat(9000) }] } }));
    expect(String(await text.callTool(server, "lookup_org", {}))).toHaveLength(4000);

    const failing = new HttpMcpDirectory(() => json({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [] } }));
    await expect(failing.callTool(server, "lookup_org", {})).rejects.toBeInstanceOf(ConnectorUnavailableError);
  });
});

describe("isRegistrableMcpUrl", () => {
  it("accepts public HTTPS hosts only", () => {
    expect(isRegistrableMcpUrl("https://crm.example/mcp")).toBe(true);
    for (const bad of ["http://crm.example/mcp", "https://localhost/mcp", "https://10.0.0.5/mcp", "https://user:pw@crm.example/mcp", "https://svc.internal/mcp", "not a url"]) expect(isRegistrableMcpUrl(bad)).toBe(false);
  });
});
