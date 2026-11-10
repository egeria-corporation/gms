// SPDX-License-Identifier: AGPL-3.0-only
// Cron Triggers and Queue consumers. Handlers land with phases 2-4 (reminders, due evaluators,
// webhook delivery, Passport sync, Mercury poll, ledger archive, exports).
export default {
  async scheduled(): Promise<void> {},
  async queue(): Promise<void> {},
};
