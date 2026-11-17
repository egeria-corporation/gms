#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Register a SAML 2.0 identity provider for a funder workspace's email domain in Supabase Auth,
// through the Supabase Management API (docs/sso.md). Operator only.
//
//   node scripts/sso/register-provider.mjs --project-ref <ref> --domain example.org \
//     (--metadata-url https://idp.example.org/saml/metadata | --metadata-file metadata.xml) \
//     [--attribute-mapping-file mapping.json] [--workspace <workspace id>] [--apply]
//
// Dry run by default: prints the exact request it would send, with the token left out, and sends
// nothing. `--apply` sends it. The token is read from SUPABASE_ACCESS_TOKEN (a personal access
// token, or an OAuth token with the auth:write scope) and is never printed. After a successful
// --apply it prints the SQL that marks the workspace's domain active with the new provider's id.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MANAGEMENT_API = "https://api.supabase.com";
export const TOKEN_ENV = "SUPABASE_ACCESS_TOKEN";
const REDACTED = `Bearer <${TOKEN_ENV} from the environment, not shown>`;

const USAGE = `Usage: node scripts/sso/register-provider.mjs --project-ref <ref> --domain <domain>
       (--metadata-url <https url> | --metadata-file <path>)
       [--attribute-mapping-file <path>] [--workspace <workspace id>] [--apply]

Registers a SAML 2.0 identity provider for <domain> in the Supabase project <ref>.
Without --apply it prints the request and sends nothing. The token comes from ${TOKEN_ENV}.`;

export class UsageError extends Error {}

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse argv (without node and the script) into options. Unknown flags are refused. */
export function parseArgs(argv) {
  const opts = { apply: false };
  const takes = new Set(["--project-ref", "--domain", "--metadata-url", "--metadata-file", "--attribute-mapping-file", "--workspace"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") opts.apply = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (takes.has(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      opts[a.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = v;
    } else if (/^--[a-z-]+=/.test(a)) {
      const [k, ...rest] = a.split("=");
      if (!takes.has(k)) throw new UsageError(`Unknown option ${k}`);
      opts[k.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = rest.join("=");
    } else throw new UsageError(`Unknown option ${a}`);
  }
  return opts;
}

/** Validate the options and build the request. Reads the metadata and mapping files, never the token. */
export function buildRequest(opts, readFile = (p) => readFileSync(p, "utf8")) {
  if (!opts.projectRef || !/^[a-z]{20}$/.test(opts.projectRef)) throw new UsageError("--project-ref is the project's 20-letter reference (Project Settings, General)");
  const domain = String(opts.domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(domain) || domain.length > 253) throw new UsageError("--domain is the email domain, like example.org");
  if (!!opts.metadataUrl === !!opts.metadataFile) throw new UsageError("Give exactly one of --metadata-url or --metadata-file");
  if (opts.workspace !== undefined && !UUID_RE.test(opts.workspace)) throw new UsageError("--workspace is the workspace's id (a UUID)");

  const body = { type: "saml", domains: [domain] };
  if (opts.metadataUrl) {
    let url;
    try {
      url = new URL(opts.metadataUrl);
    } catch {
      throw new UsageError("--metadata-url is not a URL");
    }
    if (url.protocol !== "https:") throw new UsageError("--metadata-url must use https");
    if (url.username || url.password) throw new UsageError("--metadata-url must not carry a user name or password");
    body.metadata_url = url.toString();
  } else {
    const xml = readFile(opts.metadataFile);
    if (/PRIVATE KEY/.test(xml)) throw new UsageError("That file holds a private key. Identity provider metadata never does: use the metadata file the identity provider publishes");
    if (!/<(\w+:)?EntityDescriptor[\s>]/.test(xml)) throw new UsageError("--metadata-file is not SAML 2.0 metadata (no EntityDescriptor)");
    body.metadata_xml = xml;
  }
  if (opts.attributeMappingFile) {
    let mapping;
    try {
      mapping = JSON.parse(readFile(opts.attributeMappingFile));
    } catch {
      throw new UsageError("--attribute-mapping-file is not JSON");
    }
    if (!mapping || typeof mapping !== "object" || !mapping.keys || typeof mapping.keys !== "object" || Array.isArray(mapping.keys)) throw new UsageError('--attribute-mapping-file must look like { "keys": { "email": { "name": "email" } } }');
    body.attribute_mapping = mapping;
  }
  return {
    method: "POST",
    url: `${MANAGEMENT_API}/v1/projects/${opts.projectRef}/config/auth/sso/providers`,
    headers: { Authorization: REDACTED, "Content-Type": "application/json" },
    body,
    domain,
    workspace: opts.workspace ?? null,
  };
}

/** The request as the dry run prints it. The Authorization header is always the placeholder. */
export function describeRequest(req) {
  return [`${req.method} ${req.url}`, ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`), "", JSON.stringify(req.body, null, 2)].join("\n");
}

/** The SQL the operator runs after registering, to mark the domain active with the provider. */
export function activationSql(workspace, domain, providerId) {
  const ws = workspace ?? "<workspace id: Settings, Security in the workspace, or select id from public.workspaces where handle = '...'>";
  return `select gms.activate_sso_domain('${ws}', '${domain}', '${providerId}');`;
}

/** Run the command. `io` is injected so tests see what it prints and that nothing is sent. */
export async function main(argv, env = process.env, io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`), fetch: (u, i) => globalThis.fetch(u, i) }) {
  let opts;
  let req;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      io.out(USAGE);
      return 0;
    }
    req = buildRequest(opts);
  } catch (e) {
    if (e instanceof UsageError || e?.code === "ENOENT") {
      io.err(e instanceof UsageError ? e.message : `Cannot read ${e.path}`);
      io.err("");
      io.err(USAGE);
      return 2;
    }
    throw e;
  }

  if (!opts.apply) {
    io.out("Dry run: nothing is sent. Re-run with --apply to register the provider.\n");
    io.out(describeRequest(req));
    io.out(`\n${env[TOKEN_ENV]?.trim() ? `${TOKEN_ENV} is set.` : `${TOKEN_ENV} is not set; --apply needs it.`}`);
    io.out(`After --apply, mark the domain active with:\n${activationSql(req.workspace, req.domain, "<provider id from the reply>")}`);
    return 0;
  }

  const token = env[TOKEN_ENV]?.trim();
  if (!token) {
    io.err(`${TOKEN_ENV} is not set. Create a personal access token in the Supabase dashboard (Account, Access Tokens) and export it.`);
    return 2;
  }
  const res = await io.fetch(req.url, { method: req.method, headers: { ...req.headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(req.body) });
  const text = await res.text();
  let reply = null;
  try {
    reply = text ? JSON.parse(text) : null;
  } catch {
    reply = null;
  }
  // Nothing from the reply is printed verbatim except the fields named here, so a token can never be echoed.
  if (res.status !== 201 || !reply || typeof reply.id !== "string") {
    const why = { 401: "the token was refused", 403: "the token may not change this project's auth settings", 404: "SAML 2.0 is not switched on for this project (Authentication, Providers, SAML 2.0), or the project reference is wrong", 429: "too many requests; wait and try again" }[res.status] ?? "see the Supabase dashboard's logs";
    const message = reply && typeof reply.message === "string" ? `: ${reply.message.replaceAll(token, "<token>").slice(0, 300)}` : "";
    io.err(`Supabase answered ${res.status} (${why})${message}`);
    return 1;
  }
  io.out(`Registered identity provider ${reply.id} for ${req.domain}.`);
  if (reply.saml?.entity_id) io.out(`Identity provider EntityID: ${reply.saml.entity_id}`);
  io.out("\nNow mark the workspace's domain active (Supabase SQL editor):\n");
  io.out(activationSql(req.workspace, req.domain, reply.id));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
