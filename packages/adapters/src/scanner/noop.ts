// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Scanner, ScanResult } from '../types';

/** No scanner configured: files are marked "not scanned"; the reviewer gate follows workspace SCAN_REQUIRED. */
export class NoopScanner implements Scanner {
  readonly name = 'noop' as const;
  async scan(): Promise<ScanResult> {
    return { status: 'not_scanned' };
  }
}
