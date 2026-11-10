// SPDX-License-Identifier: AGPL-3.0-only
// MCP resources: gms://{kind}/{id}. Reads go through a port backed by the same service layer.
import { hasScope, type Scope } from "./scopes.ts";
import type { Actor, CallContext, Side, ToolError } from "./types.ts";

export const RESOURCE_KINDS = ["opportunity", "competition", "form", "application", "award", "org"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

interface ResourceTemplate {
  kind: ResourceKind;
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: "application/json";
  /** Scope needed per side; `null` means readable when published (public data). */
  scope: Record<Side, Scope | null>;
}

export const RESOURCE_TEMPLATES: readonly ResourceTemplate[] = [
  { kind: "opportunity", uriTemplate: "gms://opportunity/{id}", name: "Opportunity", description: "CommonGrants OpportunityDetails.", mimeType: "application/json", scope: { funder: "opportunities:read", applicant: null } },
  { kind: "competition", uriTemplate: "gms://competition/{id}", name: "Competition", description: "CommonGrants CompetitionBase; stages in customFields.gms.stages.", mimeType: "application/json", scope: { funder: "competitions:read", applicant: null } },
  { kind: "form", uriTemplate: "gms://form/{id}", name: "Form", description: "CommonGrants FormBase: JSON Schema, UI schema and mappings.", mimeType: "application/json", scope: { funder: "forms:read", applicant: null } },
  { kind: "application", uriTemplate: "gms://application/{id}", name: "Application", description: "CommonGrants ApplicationBase with form responses.", mimeType: "application/json", scope: { funder: "applications:read", applicant: "applications:read" } },
  { kind: "award", uriTemplate: "gms://award/{id}", name: "Award", description: "CommonGrants AwardBase; disbursed amount is the cached Passport value.", mimeType: "application/json", scope: { funder: "awards:read", applicant: "awards:read" } },
  { kind: "org", uriTemplate: "gms://org/{id}", name: "Organization", description: "CommonGrants OrganizationBase as cached from Passport.", mimeType: "application/json", scope: { funder: "grantees:read", applicant: "org:read" } },
];

const URI = /^gms:\/\/([a-z]+)\/([0-9A-Za-z_-]{1,80})$/;

export function parseResourceUri(uri: string): { kind: ResourceKind; id: string } | null {
  const m = URI.exec(uri);
  if (!m) return null;
  const kind = m[1] as ResourceKind;
  if (!RESOURCE_KINDS.includes(kind)) return null;
  return { kind, id: m[2]! };
}

export function resourceUri(kind: ResourceKind, id: string): string {
  return `gms://${kind}/${id}`;
}

export function listResourceTemplates(): { uriTemplate: string; name: string; description: string; mimeType: string }[] {
  return RESOURCE_TEMPLATES.map(({ uriTemplate, name, description, mimeType }) => ({ uriTemplate, name, description, mimeType }));
}

/** Backed by the service layer; must apply the same visibility rules as the REST read routes. */
export interface ResourceReader {
  read(actor: Actor, kind: ResourceKind, id: string): Promise<unknown | null>;
}

export async function readResource(
  ctx: CallContext,
  reader: ResourceReader,
  uri: string,
): Promise<{ ok: true; contents: { uri: string; mimeType: "application/json"; text: string } } | { ok: false; error: ToolError }> {
  const parsed = parseResourceUri(uri);
  if (!parsed) return { ok: false, error: { code: "invalid_input", message: `Not a GMS resource URI: expected gms://{${RESOURCE_KINDS.join("|")}}/{id}.` } };
  const template = RESOURCE_TEMPLATES.find((t) => t.kind === parsed.kind)!;
  const scope = template.scope[ctx.workspaceKind];
  if (scope && !hasScope(ctx.scopes, scope)) return { ok: false, error: { code: "insufficient_scope", message: `Reading ${parsed.kind} requires the ${scope} scope.` } };
  const actor: Actor = { actor: ctx.clientId ? `user:${ctx.userId}/client:${ctx.clientId}` : `user:${ctx.userId}`, userId: ctx.userId, clientId: ctx.clientId, workspaceId: ctx.workspaceId, workspaceKind: ctx.workspaceKind, scopes: ctx.scopes };
  const data = await reader.read(actor, parsed.kind, parsed.id);
  if (data === null || data === undefined) return { ok: false, error: { code: "not_found", message: "No such resource." } };
  return { ok: true, contents: { uri, mimeType: "application/json", text: JSON.stringify(data) } };
}
