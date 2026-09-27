// SPDX-License-Identifier: AGPL-3.0-only
// Runs a report-builder config under RLS with the shared report-definition query (packages/actions admin-extra),
// so the page and the export worker compute the same numbers.
import 'server-only';
import { adminExtra } from '@gms/actions/modules';
import type { Tx } from '@gms/db';
import type { ReportConfig } from './datasets';

export type ResultRow = adminExtra.ReportResultRow;

export async function runReport(trx: Tx, workspaceId: string, timeZone: string, c: ReportConfig): Promise<ResultRow[]> {
  return adminExtra.runReportDefinition(trx, workspaceId, timeZone, c);
}
