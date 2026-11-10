// SPDX-License-Identifier: AGPL-3.0-only
// Discovery documents: OAuth protected-resource metadata (RFC 9728) and the tool sections of /llms.txt.
import { DEFAULT_GATED_TOOLS, isGated, isNonBypassable, NON_BYPASSABLE_TOOLS } from "./gates.ts";
import type { ToolRegistry } from "./registry.ts";
import { SCOPES } from "./scopes.ts";
import type { Side } from "./types.ts";

export function protectedResourceMetadata(options: { gmsBaseUrl: string; issuer: string }): Record<string, unknown> {
  const base = options.gmsBaseUrl.replace(/\/$/, "");
  return {
    resource: `${base}/mcp`,
    authorization_servers: [options.issuer],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "OpenGrants GMS",
    resource_documentation: `${base}/agents`,
  };
}

/** The `WWW-Authenticate` value for a 401 from /mcp, pointing clients at the metadata document. */
export function wwwAuthenticate(gmsBaseUrl: string): string {
  return `Bearer resource_metadata="${gmsBaseUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource"`;
}

function gateMark(name: string): string {
  if (isNonBypassable(name)) return " — always needs a person";
  if (isGated(name)) return " — needs a person's approval";
  return "";
}

function section(registry: ToolRegistry, side: Side, full: boolean): string {
  const title = side === "funder" ? "Funder tools" : "Applicant tools";
  const lines = registry.list(side).map((t) => {
    const head = `- \`${t.name}\` (${t.scope})${gateMark(t.name)}: ${t.description}`;
    return full ? `${head}\n\n\`\`\`json\n${JSON.stringify(t.inputSchema, null, 2)}\n\`\`\`` : head;
  });
  return `## ${title}\n\n${lines.join("\n")}`;
}

/** Markdown for the tool list and gates sections of /llms.txt (`full` adds input schemas, for /llms-full.txt). */
export function llmsToolSections(registry: ToolRegistry, options: { full?: boolean } = {}): string {
  const full = options.full ?? false;
  const gates = [
    "## Human gates",
    "",
    `These tools return \`{ "status": "pending_approval", "approvalId", "url" }\` when an agent calls them: ${DEFAULT_GATED_TOOLS.map((t) => `\`${t}\``).join(", ")}.`,
    "A person approves or rejects in the GMS at the returned URL. Poll `get_approval`, or subscribe to the `approval.resolved` webhook.",
    `No token and no workspace setting lets an agent skip ${NON_BYPASSABLE_TOOLS.map((t) => `\`${t}\``).join(", ")}. Workspaces can gate more tools, never fewer.`,
  ].join("\n");
  return [section(registry, "funder", full), section(registry, "applicant", full), gates].join("\n\n");
}
