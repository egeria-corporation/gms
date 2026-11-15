// SPDX-License-Identifier: AGPL-3.0-only
// The operator script that registers a SAML identity provider (scripts/sso/register-provider.mjs):
// a dry run by default that prints the exact request, never the token, and sends nothing. Its
// --apply path is not run here or anywhere in the tests.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../../scripts/sso/register-provider.mjs", import.meta.url));
// A stand-in value: the test checks that whatever is in the variable is never printed.
const TOKEN = "sbp_not_a_real_token_0123456789abcdef";
const REF = "abcdefghijklmnopqrst";

interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}
interface ScriptModule {
  main(argv: string[], env: Record<string, string | undefined>, io: Io): Promise<number>;
  activationSql(workspace: string | null, domain: string, providerId: string): string;
}
const load = async () => (await import(/* @vite-ignore */ SCRIPT)) as ScriptModule;

/** Run main() with a fetch that fails the test if it is ever called. */
async function dryRun(argv: string[], env: Record<string, string | undefined> = { SUPABASE_ACCESS_TOKEN: TOKEN }) {
  const { main } = await load();
  const out: string[] = [];
  const err: string[] = [];
  let sent = 0;
  const code = await main(argv, env, { out: (s) => out.push(s), err: (s) => err.push(s), fetch: async () => { sent++; throw new Error("a dry run must not send anything"); } });
  return { code, out: out.join("\n"), err: err.join("\n"), sent };
}

describe("register-provider (dry run)", () => {
  it("prints the exact Management API request, without the token, and sends nothing", async () => {
    const r = await dryRun(["--project-ref", REF, "--domain", "Example.ORG", "--metadata-url", "https://idp.example.org/saml/metadata", "--workspace", "20000000-0000-7000-8000-000000000001"]);
    expect(r).toMatchObject({ code: 0, sent: 0 });
    expect(r.out).toContain("Dry run: nothing is sent");
    expect(r.out).toContain(`POST https://api.supabase.com/v1/projects/${REF}/config/auth/sso/providers`);
    expect(r.out).toContain("Authorization: Bearer <SUPABASE_ACCESS_TOKEN from the environment, not shown>");
    const body = JSON.parse(r.out.slice(r.out.indexOf("{"), r.out.lastIndexOf("}") + 1)) as Record<string, unknown>;
    expect(body).toEqual({ type: "saml", domains: ["example.org"], metadata_url: "https://idp.example.org/saml/metadata" });
    expect(r.out).toContain("SUPABASE_ACCESS_TOKEN is set.");
    expect(r.out).toContain("select gms.activate_sso_domain('20000000-0000-7000-8000-000000000001', 'example.org', '<provider id from the reply>');");
    expect(`${r.out}${r.err}`).not.toContain(TOKEN);
    expect(`${r.out}${r.err}`).not.toContain("sbp_");
  });

  it("sends a metadata file's XML and an attribute mapping in the body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "h5-sso-"));
    writeFileSync(join(dir, "idp.xml"), '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.org"></md:EntityDescriptor>');
    writeFileSync(join(dir, "map.json"), JSON.stringify({ keys: { email: { name: "mail" } } }));
    const r = await dryRun(["--project-ref", REF, "--domain", "example.org", "--metadata-file", join(dir, "idp.xml"), "--attribute-mapping-file", join(dir, "map.json")], {});
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out.slice(r.out.indexOf("{"), r.out.lastIndexOf("}") + 1)) as Record<string, unknown>;
    expect(body).toMatchObject({ type: "saml", domains: ["example.org"], attribute_mapping: { keys: { email: { name: "mail" } } } });
    expect(String(body.metadata_xml)).toContain("EntityDescriptor");
    expect(r.out).toContain("SUPABASE_ACCESS_TOKEN is not set; --apply needs it.");
  });

  it("refuses what it should not send", async () => {
    const dir = mkdtempSync(join(tmpdir(), "h5-sso-"));
    writeFileSync(join(dir, "key.pem"), "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n<EntityDescriptor>");
    const cases: [string[], RegExp][] = [
      [["--domain", "example.org", "--metadata-url", "https://idp.example.org/m"], /project-ref/],
      [["--project-ref", REF, "--domain", "not a domain", "--metadata-url", "https://idp.example.org/m"], /--domain/],
      [["--project-ref", REF, "--domain", "example.org"], /exactly one/],
      [["--project-ref", REF, "--domain", "example.org", "--metadata-url", "http://idp.example.org/m"], /https/],
      [["--project-ref", REF, "--domain", "example.org", "--metadata-url", "https://user:pw@idp.example.org/m"], /user name or password/],
      [["--project-ref", REF, "--domain", "example.org", "--metadata-file", join(dir, "key.pem")], /private key/],
      [["--project-ref", REF, "--domain", "example.org", "--metadata-file", join(dir, "missing.xml")], /Cannot read/],
      [["--project-ref", REF, "--domain", "example.org", "--metadata-url", "https://idp.example.org/m", "--workspace", "riverbend"], /UUID/],
      [["--project-ref", REF, "--token", TOKEN], /Unknown option/],
    ];
    for (const [argv, why] of cases) {
      const r = await dryRun(argv);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.err).toMatch(why);
      expect(r.sent).toBe(0);
      expect(`${r.out}${r.err}`).not.toContain(TOKEN);
    }
  });

  it("runs as a command, printing the dry run and never the token", () => {
    const out = execFileSync(process.execPath, [SCRIPT, "--project-ref", REF, "--domain", "example.org", "--metadata-url", "https://idp.example.org/saml/metadata"], { env: { PATH: process.env.PATH ?? "", SUPABASE_ACCESS_TOKEN: TOKEN }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).toContain("Dry run: nothing is sent");
    expect(out).toContain('"type": "saml"');
    expect(out).not.toContain(TOKEN);
  });

  it("names the follow-up SQL for the operator", async () => {
    const { activationSql } = await load();
    expect(activationSql("20000000-0000-7000-8000-000000000001", "example.org", "5a5a5a5a-1111-4111-8111-5a5a5a5a5a5a")).toBe("select gms.activate_sso_domain('20000000-0000-7000-8000-000000000001', 'example.org', '5a5a5a5a-1111-4111-8111-5a5a5a5a5a5a');");
  });
});
