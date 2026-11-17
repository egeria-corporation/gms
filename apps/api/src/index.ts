// SPDX-License-Identifier: AGPL-3.0-only
// Worker entry: wires Supabase-backed stores. The service-role client is created once per isolate;
// every store query filters by workspace explicitly (RLS is on for every table regardless).
import { AnthropicLlmClient } from "@gms/assist";
import { ComposioAirtableSource, ComposioClient, ComposioSheetsSource, GoogleWorkspaceConnector, HttpMcpDirectory, MercuryBankFeed, connectedAppPorts, quickBooksPort } from "@gms/connectors";
import type { DbClient } from "@gms/db";
import { SupabaseLedgerStore } from "@gms/ledger";
import { MemoryKv } from "@gms/mcp";
import { ResendMailer } from "@gms/notify";
import { SupabaseWebhookStore } from "@gms/webhooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createApp, type Deps } from "./app.ts";
import { SupabaseAuthStore } from "./auth/supabase-store.ts";
import { trimSlash, type Env } from "./env.ts";
import { SupabaseCreationLimiter } from "./lib/rate-limit.ts";
import type { ServicePorts } from "./services/context.ts";
import { SupabaseConsultingStore } from "./services/consulting.ts";
import { SupabaseDirectAwardStore, SupabaseInvitationLimiter } from "./services/direct-award-store.ts";
import { RestOpenGrantsClient, R2FileStorage, SupabaseIdentity, SupabaseSecondSteps, SupabaseSessions, SupabaseUserDirectory, type SupabaseAdminLike, type SupabaseIdentityLike, type SupabaseRpcLike } from "./services/ports.ts";
import { SupabasePreferences, type SupabasePreferencesLike } from "./services/preferences.ts";
import { RepoMembershipStore } from "./services/repos/membership.ts";
import { SupabaseRepos } from "./services/repos/supabase.ts";

let cached: { key: string; db: SupabaseClient; deps: Deps } | undefined;

function depsFor(env: Env): Deps | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const key = `${env.SUPABASE_URL}|${env.SUPABASE_SERVICE_ROLE_KEY.length}`;
  if (!cached || cached.key !== key) {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const repos = new SupabaseRepos(db as unknown as DbClient);
    cached = {
      key,
      db,
      deps: {
        auth: new SupabaseAuthStore(db),
        members: new RepoMembershipStore(repos),
        ledger: new SupabaseLedgerStore(db),
        repos,
        webhooks: new SupabaseWebhookStore(db),
        now: () => new Date(),
        ports: (e) => ({ ...ports(e), directory: new SupabaseUserDirectory(db as unknown as SupabaseAdminLike), sessions: new SupabaseSessions(db as unknown as SupabaseRpcLike), preferences: new SupabasePreferences(db as unknown as SupabasePreferencesLike), identity: new SupabaseIdentity(db as unknown as SupabaseIdentityLike), secondSteps: new SupabaseSecondSteps(db as unknown as SupabaseRpcLike), creationLimiter: new SupabaseCreationLimiter(db as unknown as SupabaseRpcLike), invitationLimiter: new SupabaseInvitationLimiter(db as unknown as SupabaseRpcLike), directAwards: new SupabaseDirectAwardStore(db as unknown as SupabaseRpcLike), consulting: new SupabaseConsultingStore(db as unknown as SupabaseRpcLike, repos) }),
        kv: (e) => (e.RATE_LIMIT ? { get: (k) => e.RATE_LIMIT!.get(k), put: (k, v, o) => e.RATE_LIMIT!.put(k, v, o) } : memoryKv),
        openapi,
      },
    };
  }
  return cached.deps;
}

const memoryKv = new MemoryKv();

/** Mail (Resend), file bytes (R2) and OpenGrants discovery, each only when configured. */
function ports(env: Env): ServicePorts {
  return {
    ...(env.RESEND_API_KEY ? { mailer: new ResendMailer(env.RESEND_API_KEY) } : {}),
    ...(env.ATTACHMENTS ? { storage: new R2FileStorage(env.ATTACHMENTS) } : {}),
    // The REST API with a server-side key. Without a key there is no funding search; the web app says so.
    ...(env.OPENGRANTS_API_KEY ? { openGrants: new RestOpenGrantsClient(env.OPENGRANTS_API_URL ?? "https://ops.opengrants.io/functions/v1", env.OPENGRANTS_API_KEY) } : {}),
    // Mercury is read-only reconciliation, never a rail.
    bank: new MercuryBankFeed(),
    // The funder's Google Workspace through Composio, only when both the key and the auth config are set.
    ...(env.COMPOSIO_API_KEY && env.COMPOSIO_GOOGLE_AUTH_CONFIG_ID
      ? {
          workspaceApps: new GoogleWorkspaceConnector({
            client: new ComposioClient({ apiKey: env.COMPOSIO_API_KEY }),
            authConfigId: env.COMPOSIO_GOOGLE_AUTH_CONFIG_ID,
            callbackUrl: (_entityId, returnTo) => `${trimSlash(env.WEB_BASE_URL)}${returnTo ?? "/workspaces"}?connected=google_workspace`,
          }),
        }
      : {}),
    // Import sources, read-only, each only when the key and its own auth config are set. Composio sends
    // the browser back to the import page it was started from (`returnTo`, a path in the web app).
    ...(env.COMPOSIO_API_KEY && env.COMPOSIO_GOOGLE_SHEETS_AUTH_CONFIG_ID
      ? { sheets: new ComposioSheetsSource({ client: new ComposioClient({ apiKey: env.COMPOSIO_API_KEY }), authConfigId: env.COMPOSIO_GOOGLE_SHEETS_AUTH_CONFIG_ID, callbackUrl: (_entityId, returnTo) => returnUrl(env, returnTo, "google_sheets") }) }
      : {}),
    ...(env.COMPOSIO_API_KEY && env.COMPOSIO_AIRTABLE_AUTH_CONFIG_ID
      ? { airtable: new ComposioAirtableSource({ client: new ComposioClient({ apiKey: env.COMPOSIO_API_KEY }), authConfigId: env.COMPOSIO_AIRTABLE_AUTH_CONFIG_ID, callbackUrl: (_entityId, returnTo) => returnUrl(env, returnTo, "airtable") }) }
      : {}),
    // Connected apps (v1.12.0): Slack, Google Calendar, Google Drive, Salesforce, each only with the key and its own auth config.
    ...connectedAppPorts(env, (returnTo, provider) => returnUrl(env, returnTo, provider)),
    // QuickBooks sync (v1.13.0), record-keeping only: the key and its own auth config.
    ...quickBooksPort(env, (returnTo, provider) => returnUrl(env, returnTo, provider)),
    mcpDirectory: new HttpMcpDirectory(),
    // The drafting assistant exists only when it is switched on and has a key.
    ...(env.ASSISTANT_ENABLED === "true" && env.ANTHROPIC_API_KEY ? { llm: new AnthropicLlmClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.ASSISTANT_MODEL ?? null }) } : {}),
    ...(env.EXPORTS ? { exports: { put: async (key: string, body: string, contentType: string) => void (await env.EXPORTS!.put(key, body, { httpMetadata: { contentType } })) } } : {}),
    ...(env.EXPORTS ? { exportFiles: new R2FileStorage(env.EXPORTS) } : {}),
  };
}

/** The web page Composio returns to after sign-in, with `connected=<provider>` added to its query. */
function returnUrl(env: Env, returnTo: string | undefined, provider: string): string {
  const path = returnTo ?? "/workspaces";
  return `${trimSlash(env.WEB_BASE_URL)}${path}${path.includes("?") ? "&" : "?"}connected=${provider}`;
}

/** Where the OpenAPI document sits in the EXPORTS bucket when the Worker is deployed without static assets. */
export const OPENAPI_OBJECT_KEY = "site/openapi.json";

/**
 * The compiled OpenAPI document ships as a static asset (`pnpm --filter @gms/api build:openapi`).
 * A deployment without the asset binding serves the same file from the EXPORTS bucket.
 */
async function openapi(env: Env): Promise<unknown | null> {
  const res = await env.ASSETS?.fetch(new Request("https://assets.local/openapi.json"));
  if (res?.ok) return (await res.json()) as unknown;
  const stored = await env.EXPORTS?.get(OPENAPI_OBJECT_KEY);
  return stored ? ((await stored.json()) as unknown) : null;
}

const app = createApp(depsFor);

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
