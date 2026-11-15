// SPDX-License-Identifier: AGPL-3.0-only
// Scheduled reports, on every tick of the one 5-minute cron. The work is the report builder's
// `sendScheduledReports` (apps/api/src/services/report-builder.ts): each active schedule whose
// send time has come writes its CSV once per period to the EXPORTS bucket and emails its
// recipients a signed-in link. A failure is logged and never stops the other jobs of the tick.
import { r2ReportStore, sendScheduledReports, type BaseContext } from "@gms/api/jobs";

export async function runScheduledReports(base: BaseContext, env: { EXPORTS?: R2Bucket }): Promise<void> {
  try {
    const out = await sendScheduledReports(base, r2ReportStore(env.EXPORTS));
    // Counts only: never a recipient, a view's name or a row of a report.
    console.warn(JSON.stringify({ level: "info", msg: "job.done", job: "reports", ...out }));
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "job.failed", job: "reports", error: e instanceof Error ? e.name : "error" }));
  }
}
