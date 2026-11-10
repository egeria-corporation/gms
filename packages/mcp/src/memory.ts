// SPDX-License-Identifier: AGPL-3.0-only
// In-memory ports for tests and local development.
import type { Approval, ApprovalStatus, ApprovalStore, EventPort, KvPort, LedgerEvent, LedgerPort } from "./types.ts";

export class MemoryApprovalStore implements ApprovalStore {
  readonly rows = new Map<string, Approval>();
  async create(approval: Approval): Promise<void> {
    this.rows.set(approval.id, { ...approval });
  }
  async get(id: string): Promise<Approval | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }
  async transition(id: string, from: ApprovalStatus, patch: Partial<Approval> & { status: ApprovalStatus }): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== from) return false;
    this.rows.set(id, { ...row, ...patch });
    return true;
  }
}

export class MemoryKv implements KvPort {
  readonly data = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}

export class MemoryLedger implements LedgerPort {
  readonly events: LedgerEvent[] = [];
  async append(event: LedgerEvent): Promise<void> {
    this.events.push(event);
  }
}

export class MemoryEvents implements EventPort {
  readonly emitted: Parameters<EventPort["emit"]>[0][] = [];
  async emit(event: Parameters<EventPort["emit"]>[0]): Promise<void> {
    this.emitted.push(event);
  }
}
