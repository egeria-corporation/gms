// SPDX-License-Identifier: AGPL-3.0-only
// Fakes for the deploy tool's tests: a Supabase Management API, a Wrangler, a Resend/Cloudflare REST
// and a command runner. Nothing here touches the network.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx, Result, RunOptions, RunOut } from "../core.ts";
import { execute, STEPS } from "../cli.ts";
import { parseArgs } from "../core.ts";

export const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

export const SECRET = {
  service: "svc-role-key-AAAAAAAAAAAAAAAA",
  anon: "anon-key-BBBBBBBBBBBBBBBBBBBB",
  sbToken: "sbp_access_token_CCCCCCCCCCCC",
  cfToken: "cf_api_token_DDDDDDDDDDDDDDDD",
  resend: "re_full_access_EEEEEEEEEEEEEEEE",
  resendSend: "re_send_only_FFFFFFFFFFFFFFFF",
};

export interface Fake {
  ctx: Ctx;
  root: string;
  deployDir: string;
  calls: { cmd: string; args: string[]; input?: string; env?: Record<string, string> }[];
  requests: { method: string; url: string; body: unknown }[];
  logs: string[];
  sb: SbState;
  cf: CfState;
  files: string;
  /** Run a step the way the CLI does; returns the result and the printed line. */
  step: (name: string, ...argv: string[]) => Promise<{ r: Result; line: string; exit: number }>;
  /** Everything a person or file could see: stdout lines, stderr log, state and generated files. */
  everythingVisible: () => string;
  printed: string[];
  git: { tag: string | null; dirty: boolean };
}

export interface SbState {
  orgs: { id: string; name: string }[] | "forbidden";
  projects: { id: string; name: string; organization_id: string; status: string }[];
  createStatus: number;
  createMessage: string;
  healthyAfter: number;
  polls: number;
  authConfig: Record<string, unknown>;
  /** database: names of tables, applied versions in each history table */
  publicTables: number;
  sbVersions: string[] | null;
  gmsNames: string[] | null;
  queries: string[];
  failMigration: string | null;
  otpStatus: number;
  nextRef: string;
}
export interface CfState {
  buckets: Set<string>;
  queues: Set<string>;
  kv: { id: string; title: string }[];
  /** secrets by config file basename (api.toml / jobs.toml) */
  secrets: Map<string, Set<string>>;
  loggedIn: boolean;
  accounts: { id: string; name: string }[];
  subdomain: string | null;
  failPut: string | null;
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "t1-root-"));
  for (const app of ["api", "jobs"]) {
    mkdirSync(join(root, "apps", app), { recursive: true });
    cpSync(join(REPO, "apps", app, "wrangler.toml"), join(root, "apps", app, "wrangler.toml"));
  }
  mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
  for (const f of ["0001_init.sql", "0002_workspaces.sql", "0003_programs.sql"]) writeFileSync(join(root, "supabase", "migrations", f), `-- ${f}\ncreate table if not exists public.t_${f.slice(0, 4)} (id int);\n`);
  return root;
}

export function makeFake(opts: { env?: Record<string, string | undefined>; root?: string; routes?: (method: string, url: string, body: any) => Response | undefined } = {}): Fake { // eslint-disable-line @typescript-eslint/no-explicit-any
  const root = opts.root ?? makeRoot();
  const deployDir = mkdtempSync(join(tmpdir(), "t1-deploy-"));
  const home = mkdtempSync(join(tmpdir(), "t1-home-"));
  let rnd = 0;
  const git = { tag: "v1.0.0" as string | null, dirty: false };
  const calls: Fake["calls"] = [];
  const requests: Fake["requests"] = [];
  const logs: string[] = [];
  const printed: string[] = [];

  const sb: SbState = {
    orgs: [{ id: "org1", name: "Org One" }],
    projects: [],
    createStatus: 201,
    createMessage: "",
    healthyAfter: 1,
    polls: 0,
    authConfig: { site_url: "http://localhost:3000", uri_allow_list: "https://old.example/cb", mailer_autoconfirm: true, external_email_enabled: false, mfa_totp_enroll_enabled: false, mfa_totp_verify_enabled: false },
    publicTables: 0,
    sbVersions: null,
    gmsNames: null,
    queries: [],
    failMigration: null,
    otpStatus: 200,
    nextRef: "abcdefghijklmnopqrst",
  };
  const cf: CfState = { buckets: new Set(), queues: new Set(), kv: [], secrets: new Map(), loggedIn: true, accounts: [{ id: "acct1", name: "Acct" }], subdomain: "tester", failPut: null };

  const fetchFake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: any = undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ method, url, body });
    const custom = opts.routes?.(method, url, body);
    if (custom) return custom;

    if (url.startsWith("https://api.supabase.com/v1")) {
      const path = url.slice("https://api.supabase.com/v1".length);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth !== `Bearer ${SECRET.sbToken}`) return json(401, { message: "Unauthorized" });
      if (path === "/organizations") return sb.orgs === "forbidden" ? json(403, { message: "forbidden" }) : json(200, sb.orgs);
      if (path === "/projects" && method === "GET") return json(200, sb.projects);
      if (path === "/projects" && method === "POST") {
        if (sb.createStatus >= 300) return json(sb.createStatus, { message: sb.createMessage });
        const p = { id: sb.nextRef, name: body.name, organization_id: body.organization_id, status: "COMING_UP" };
        sb.projects.push(p);
        return json(201, { id: p.id, name: p.name, status: p.status });
      }
      let m = /^\/projects\/([a-z]+)$/.exec(path);
      if (m) {
        const p = sb.projects.find((x) => x.id === m![1]);
        if (!p) return json(404, { message: "not found" });
        if (p.status === "COMING_UP" && ++sb.polls >= sb.healthyAfter) p.status = "ACTIVE_HEALTHY";
        return json(200, { id: p.id, name: p.name, status: p.status });
      }
      m = /^\/projects\/([a-z]+)\/api-keys\?reveal=true$/.exec(path);
      if (m) return json(200, [{ name: "anon", api_key: SECRET.anon }, { name: "service_role", api_key: SECRET.service }]);
      m = /^\/projects\/([a-z]+)\/config\/auth$/.exec(path);
      if (m) {
        if (method === "GET") return json(200, sb.authConfig);
        Object.assign(sb.authConfig, body);
        return json(200, sb.authConfig);
      }
      m = /^\/projects\/([a-z]+)\/database\/query$/.exec(path);
      if (m) return queryFake(sb, body.query as string);
    }
    if (url.startsWith("https://abcdefghijklmnopqrst.supabase.co/auth/v1/otp")) return json(sb.otpStatus, {});
    if (url.endsWith("/health")) return json(200, { status: "ok", service: "gms-api", database: "configured" });
    if (url.endsWith("/.well-known/jwks.json")) return json(200, { keys: [{ kid: "k" }] });
    if (url.endsWith("/.well-known/oauth-authorization-server")) return json(200, { issuer: url.replace("/.well-known/oauth-authorization-server", "") });
    if (url.endsWith("/gms/config")) return json(200, { data: { facilitatedPayments: false } });
    if (/^https:\/\/[^/]+\/$/.test(url)) return new Response("<!doctype html><html><body><div id=root></div></body></html>", { status: 200 });
    if (url.startsWith("https://api.cloudflare.com/client/v4/accounts/acct1/workers/subdomain")) return json(200, { result: { subdomain: cf.subdomain } });
    return json(404, { message: `no fake for ${method} ${url}` });
  };

  const runFake = async (cmd: string, args: string[], o: RunOptions = {}): Promise<RunOut> => {
    calls.push({ cmd, args, input: o.input, env: o.env });
    const ok = (stdout = ""): RunOut => ({ code: 0, stdout, stderr: "" });
    const fail = (stderr: string): RunOut => ({ code: 1, stdout: "", stderr });
    if (cmd === "git") {
      if (args[0] === "describe" && args.includes("--exact-match")) return git.tag ? ok(git.tag) : fail("no tag");
      if (args[0] === "describe") return ok(git.tag ? `${git.tag}${git.dirty ? "-dirty" : ""}` : "abc1234");
      if (args[0] === "rev-parse") return ok("deadbeefdeadbeef");
      if (args[0] === "status") return ok(git.dirty ? " M file" : "");
      return ok("git version 2");
    }
    if (cmd === "pnpm" && args[0] === "--version") return ok("11.18.0");
    if (cmd === "pnpm" && args.includes("wrangler")) {
      const w = args.slice(args.indexOf("wrangler") + 1);
      if (w[0] === "--version") return ok("4.153.0");
      if (w[0] === "whoami") return cf.loggedIn ? ok(JSON.stringify({ loggedIn: true, accounts: cf.accounts })) : fail("not logged in");
      if (w[0] === "r2" && w[2] === "list") return ok([...cf.buckets].map((b) => `name:           ${b}\ncreation_date:  2026-01-01\n`).join("\n"));
      if (w[0] === "r2" && w[2] === "create") {
        if (cf.buckets.has(w[3]!)) return fail("already exists");
        cf.buckets.add(w[3]!);
        return ok();
      }
      if (w[0] === "queues" && w[1] === "info") return cf.queues.has(w[2]!) ? ok() : fail("Queue does not exist");
      if (w[0] === "queues" && w[1] === "create") {
        cf.queues.add(w[2]!);
        return ok();
      }
      if (w[0] === "kv" && w[2] === "list") return ok(JSON.stringify(cf.kv));
      if (w[0] === "kv" && w[2] === "create") {
        cf.kv.push({ id: "0123456789abcdef0123456789abcdef", title: w[3]! });
        return ok("created");
      }
      if (w[0] === "secret") {
        const cfg = (w[w.indexOf("--config") + 1] ?? "").split("/").pop()!;
        const set = cf.secrets.get(cfg) ?? new Set<string>();
        cf.secrets.set(cfg, set);
        if (w[1] === "list") return ok(JSON.stringify([...set].map((name) => ({ name, type: "secret_text" }))));
        if (w[1] === "put") {
          if (cf.failPut === w[2]) return fail("boom");
          set.add(w[2]!);
          return ok("Success");
        }
      }
      if (w[0] === "deploy") return ok("Deployed");
    }
    if (cmd === "pnpm" || cmd === "node") return ok("done");
    return fail(`unexpected command ${cmd}`);
  };

  const base = parseArgs([]).flags;
  const ctx: Ctx = {
    root,
    deployDir,
    env: { SUPABASE_ACCESS_TOKEN: SECRET.sbToken, ...opts.env },
    home,
    nodeVersion: "v22.23.4",
    fetch: fetchFake as typeof fetch,
    run: runFake,
    log: (m) => logs.push(m),
    sleep: async () => undefined,
    random: (n) => Buffer.alloc(n, ++rnd),
    now: () => new Date("2026-11-12T00:00:00Z"),
    flags: base,
    yes: false,
    dryRun: false,
    secrets: new Set(),
  };

  const fake: Fake = {
    ctx,
    root,
    deployDir,
    calls,
    requests,
    logs,
    sb,
    cf,
    files: deployDir,
    printed,
    git,
    step: async (name, ...argv) => {
      const { flags } = parseArgs(argv);
      const c: Ctx = { ...ctx, flags, yes: flags.yes === true, dryRun: flags["dry-run"] === true };
      const { line, exit, result } = await execute(c, name);
      printed.push(line);
      return { r: result, line, exit };
    },
    everythingVisible: () => {
      const parts = [...printed, ...logs];
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else parts.push(readFileSync(p, "utf8"));
        }
      };
      walk(deployDir);
      return parts.join("\n");
    },
  };
  fake.git = git;
  return fake;
}

function queryFake(sb: SbState, q: string): Response {
  sb.queries.push(q);
  if (/to_regclass\('supabase_migrations/.test(q)) return json(201, [{ sb: sb.sbVersions !== null, gm: sb.gmsNames !== null, tables: String(sb.publicTables) }]);
  if (/from supabase_migrations\.schema_migrations/.test(q) && q.startsWith("select")) return json(201, (sb.sbVersions ?? []).map((version) => ({ version })));
  if (/from gms_meta\.schema_migrations/.test(q) && q.startsWith("select")) return json(201, (sb.gmsNames ?? []).map((name) => ({ name })));
  if (/^create schema if not exists supabase_migrations/.test(q)) {
    sb.sbVersions ??= [];
    return json(201, []);
  }
  if (q.startsWith("begin;")) {
    const file = /-- (\S+\.sql)/.exec(q)?.[1];
    if (sb.failMigration && file === sb.failMigration) return json(400, { message: `syntax error in ${file}` });
    const v = /values \('(\d+)'/.exec(q)?.[1];
    if (v) (sb.sbVersions ??= []).push(v);
    return json(201, []);
  }
  return json(201, []);
}

export const flagsOf = (...argv: string[]) => parseArgs(argv).flags;
export { STEPS };
