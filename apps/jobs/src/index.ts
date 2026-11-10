// SPDX-License-Identifier: AGPL-3.0-only
// The jobs Worker: Cron Triggers and the GMS_EVENTS queue consumer. It holds no logic of its own:
// each handler builds the same stores the API Worker uses and calls a function exported by
// `@gms/api/jobs`, so scheduled work goes through the same services, state machines and ledger.
import { MercuryBankFeed } from "@gms/connectors";
import { archiveLedger, deliverWebhooks, evaluateRequirements, evaluateTranchesDue, handleQueueMessage, pollBanks, reconcileStuckReleases, sendDigests, syncPassport, SupabaseRepos, SupabaseUserDirectory, type BaseContext, type QueueMessage } from "@gms/api/jobs";
import type { DbClient } from "@gms/db";
import { SupabaseLedgerStore } from "@gms/ledger";
import { ResendMailer } from "@gms/notify";
import { SupabaseWebhookStore } from "@gms/webhooks";
import { createClient } from "@supabase/supabase-js";

export interface Env {
  GMS_BASE_URL: string;
  WEB_BASE_URL: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PASSPORT_BASE_URL?: string;
  PASSPORT_GMS_CLIENT_ID?: string;
  PASSPORT_GMS_CLIENT_SECRET?: string;
  PASSPORT_AWARD_WRITE?: string;
  CREDENTIALS_ENCRYPTION_KEY?: string;
  WEBHOOK_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  LEDGER_ARCHIVE?: R2Bucket;
  EXPORTS?: R2Bucket;
}

const trim = (s: string) => s.replace(/\/+$/, "");

/** Null when the database is not configured: every job is then a no-op. */
export function baseFor(env: Env, now: () => Date = () => new Date()): BaseContext | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const exportsBucket = env.EXPORTS;
  return {
    repos: new SupabaseRepos(db as unknown as DbClient),
    ledger: new SupabaseLedgerStore(db),
    webhooks: new SupabaseWebhookStore(db),
    now,
    config: {
      baseUrl: trim(env.GMS_BASE_URL),
      webBaseUrl: trim(env.WEB_BASE_URL),
      passportBaseUrl: env.PASSPORT_BASE_URL ? trim(env.PASSPORT_BASE_URL) : null,
      credentialsKey: env.CREDENTIALS_ENCRYPTION_KEY ?? null,
      passportClient: env.PASSPORT_GMS_CLIENT_ID && env.PASSPORT_GMS_CLIENT_SECRET ? { id: env.PASSPORT_GMS_CLIENT_ID, secret: env.PASSPORT_GMS_CLIENT_SECRET } : null,
      mailFrom: env.RESEND_FROM ?? null,
      passportAwardWrite: env.PASSPORT_AWARD_WRITE === "true",
      webhookSecretKey: env.WEBHOOK_SECRET_KEY ?? null,
    },
    ports: {
      ...(env.RESEND_API_KEY ? { mailer: new ResendMailer(env.RESEND_API_KEY) } : {}),
      bank: new MercuryBankFeed(),
      // Member addresses for notification email and digests.
      directory: new SupabaseUserDirectory(db as unknown as ConstructorParameters<typeof SupabaseUserDirectory>[0]),
      ...(exportsBucket ? { exports: { put: async (key: string, body: string, contentType: string) => void (await exportsBucket.put(key, body, { httpMetadata: { contentType } })) } } : {}),
    },
  };
}

/** Which jobs a cron expression runs. Keep in step with `[triggers]` in wrangler.toml. */
export const SCHEDULES = {
  "*/5 * * * *": ["webhooks"],
  "*/15 * * * *": ["tranches", "tranche-reconcile", "requirements"],
  "0 * * * *": ["passport"],
  "0 */6 * * *": ["mercury"],
  "30 2 * * *": ["org-changes", "ledger-archive"],
  // 15:00 UTC is 8 AM Pacific in winter, 7 AM in summer.
  "0 15 * * *": ["digest-daily"],
  "5 15 * * 1": ["digest-weekly"],
} as const;
export type JobName = (typeof SCHEDULES)[keyof typeof SCHEDULES][number];

export async function runJob(name: JobName, base: BaseContext, env: Pick<Env, "LEDGER_ARCHIVE">): Promise<Record<string, unknown>> {
  switch (name) {
    case "webhooks":
      return deliverWebhooks(base);
    case "tranches":
      return evaluateTranchesDue(base);
    case "tranche-reconcile":
      return reconcileStuckReleases(base);
    case "requirements":
      return evaluateRequirements(base);
    case "passport":
      return syncPassport(base);
    case "org-changes":
      return syncPassport(base, { orgChanges: true });
    case "mercury":
      return pollBanks(base);
    case "digest-daily":
      return sendDigests(base, "daily");
    case "digest-weekly":
      return sendDigests(base, "weekly");
    case "ledger-archive": {
      const bucket = env.LEDGER_ARCHIVE;
      if (!bucket) return { skipped: "LEDGER_ARCHIVE is not bound" };
      return archiveLedger(base, { put: (key, value, options) => bucket.put(key, value, options) });
    }
  }
}

const log = (level: "info" | "error", msg: string, fields: Record<string, unknown>) => (level === "error" ? console.error : console.warn)(JSON.stringify({ level, msg, ...fields }));

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const base = baseFor(env);
    if (!base) return log("error", "jobs.skipped", { reason: "database_not_configured" });
    for (const name of SCHEDULES[controller.cron as keyof typeof SCHEDULES] ?? []) {
      try {
        log("info", "job.done", { job: name, ...(await runJob(name, base, env)) });
      } catch (e) {
        // One failing job must not stop the others on the same tick; the next tick retries it.
        log("error", "job.failed", { job: name, error: e instanceof Error ? e.name : "error" });
      }
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    const base = baseFor(env);
    for (const message of batch.messages) {
      if (!base) {
        message.retry();
        continue;
      }
      try {
        await handleQueueMessage(base, message.body);
        message.ack();
      } catch (e) {
        log("error", "queue.failed", { kind: message.body?.kind, error: e instanceof Error ? e.name : "error" });
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, QueueMessage>;
