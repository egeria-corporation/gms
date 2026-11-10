// SPDX-License-Identifier: AGPL-3.0-only
// Tool registry: the declared tools plus the built-in `get_approval`, with JSON Schemas.
import { z } from "zod";
import { DEFAULT_GATED_TOOLS, isGated, isNonBypassable, type GatePolicy } from "./gates.ts";
import { APPLICANT_TOOLS } from "./tools/applicant.ts";
import { FUNDER_TOOLS } from "./tools/funder.ts";
import type { Side, ToolDefinition, ToolSpec } from "./types.ts";

export const GET_APPROVAL = "get_approval";
export const getApprovalInput = z.object({ approvalId: z.string().min(8).max(64).describe("Approval id returned by a gated tool") });

function define(side: Side, specs: Record<string, ToolSpec>): ToolDefinition[] {
  return Object.entries(specs).map(([name, spec]) => ({
    ...spec,
    name,
    side,
    inputSchema: z.toJSONSchema(spec.input, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>,
  }));
}

export class ToolRegistry {
  private readonly bySide: Record<Side, Map<string, ToolDefinition>> = { funder: new Map(), applicant: new Map() };

  constructor(tools: ToolDefinition[]) {
    for (const t of tools) {
      const map = this.bySide[t.side];
      if (map.has(t.name)) throw new Error(`Duplicate tool ${t.side}/${t.name}`);
      map.set(t.name, t);
    }
    for (const name of DEFAULT_GATED_TOOLS) {
      const declared = this.find(name);
      if (declared.length === 0) throw new Error(`Gated tool ${name} is not declared`);
      for (const t of declared) if (!t.gated) throw new Error(`Tool ${name} is on the default gate list but not declared gated`);
    }
    for (const t of tools) {
      if (t.gated && !isGated(t.name)) throw new Error(`Tool ${t.name} is declared gated but missing from the default gate list`);
    }
  }

  get(side: Side, name: string): ToolDefinition | undefined {
    return this.bySide[side].get(name);
  }
  /** Every side on which a tool name exists. */
  find(name: string): ToolDefinition[] {
    return (["funder", "applicant"] as const).flatMap((s) => this.bySide[s].get(name) ?? []);
  }
  list(side: Side): ToolDefinition[] {
    return [...this.bySide[side].values()];
  }

  /** `tools/list` payload for a side. Gate state reflects the workspace policy. */
  describe(side: Side, policy: GatePolicy = {}): { name: string; description: string; inputSchema: Record<string, unknown>; annotations: { scope: string; gated: boolean; alwaysHuman: boolean } }[] {
    return this.list(side).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { scope: t.scope, gated: isGated(t.name, policy), alwaysHuman: isNonBypassable(t.name) },
    }));
  }
}

const getApprovalSpec: ToolSpec = {
  service: "__getApproval",
  scope: "org:read", // not checked: any token of the workspace may poll its own approvals
  description: "Get the status of an approval request created by a gated tool: pending, approved, rejected, executed (with the result) or failed.",
  input: getApprovalInput,
  gated: false,
};

export function createRegistry(): ToolRegistry {
  return new ToolRegistry([
    ...define("funder", { ...FUNDER_TOOLS, [GET_APPROVAL]: getApprovalSpec }),
    ...define("applicant", { ...APPLICANT_TOOLS, [GET_APPROVAL]: getApprovalSpec }),
  ]);
}
