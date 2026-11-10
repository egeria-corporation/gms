// SPDX-License-Identifier: AGPL-3.0-only
// MCP server core: tool registry over the service layer, human gates, resources, prompts and
// discovery metadata. Transport-independent; apps/api mounts it on Streamable HTTP at /mcp.
export * from "./scopes.ts";
export * from "./types.ts";
export * from "./gates.ts";
export * from "./service.ts";
export * from "./registry.ts";
export * from "./dispatcher.ts";
export * from "./resources.ts";
export * from "./prompts.ts";
export * from "./metadata.ts";
export * from "./memory.ts";
export { FUNDER_TOOLS } from "./tools/funder.ts";
export { APPLICANT_TOOLS } from "./tools/applicant.ts";
