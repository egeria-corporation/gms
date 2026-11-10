// SPDX-License-Identifier: AGPL-3.0-only
// /llms.txt and /llms-full.txt: what the GMS is, how an agent authenticates, what it can do and
// where a person has to approve. The tool lists and input schemas are generated from the
// `@gms/mcp` registry, the same one the /mcp endpoint serves.
import { createRegistry, llmsToolSections } from "@gms/mcp";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { DEFAULT_GATED_TOOLS, SCOPES, SCOPE_DESCRIPTIONS } from "../auth/scopes.ts";
import { trimSlash } from "../env.ts";

const registry = createRegistry();
const names = (side: "funder" | "applicant") => registry.list(side).map((t) => t.name).join(", ");

function summary(base: string): string {
  return `# OpenGrants GMS

> Free, open-source grants management for funders and applicants, built on the CommonGrants protocol (v0.5.0). Funders design opportunities and forms, run reviews, decide, issue awards, pay through OpenGrants Passport and track reporting. Applicants apply with their Passport record pre-filled, report once and get paid to a verified destination.

Agents are first-class users. An agent gets exactly what its person can do in the app, limited to the scopes that person approved, and never more.

## Connect

- MCP server (Streamable HTTP): ${base}/mcp
- Protected resource metadata: ${base}/.well-known/oauth-protected-resource
- Authorization server metadata: ${base}/.well-known/oauth-authorization-server
- Dynamic client registration: POST ${base}/oauth/register (public clients, PKCE S256 required)
- Authorization: OAuth 2.1 authorization code + PKCE. The person picks one workspace during consent; the token is bound to that person, that workspace and the approved scopes.
- Workspace API clients (scripts, integrations): client credentials at POST ${base}/oauth/token.
- Send the token as \`Authorization: Bearer <token>\`. Tokens last one hour; refresh tokens rotate on every use.

## APIs

- CommonGrants protocol routes: ${base}/common-grants (opportunities, competitions, forms, applications, awards, orgs)
- GMS routes: ${base}/gms
- OpenAPI: ${base}/openapi.json
- Agent card: ${base}/.well-known/agent.json

## Human gates

These actions are never completed by an agent alone: ${DEFAULT_GATED_TOOLS.join(", ")}.
Calling one returns \`{ "status": "pending_approval", "approvalId": "…", "url": "…" }\`. A person approves or rejects it in the app; poll \`get_approval\` or subscribe to the \`approval.resolved\` webhook. Signing an agreement is always done by a person.

## What the GMS will not do

- It never stores, shows or accepts bank account or identity numbers. Payee details are a bank name and the last four digits, read from Passport.
- It never sets a payout destination and never pays an unverified payee. Money moves only through Passport.
- It never edits an organization's profile directly; edits are proposed to Passport as changes.

## Tools

Funder workspace: ${names("funder")}.

Applicant workspace: ${names("applicant")}.

Resources: gms://opportunity/{id}, gms://competition/{id}, gms://form/{id}, gms://application/{id}, gms://award/{id}, gms://org/{id}.
Prompts: triage-cohort, write-decline-letter, prepare-report, fill-application-from-passport.

Full reference: ${base}/llms-full.txt
`;
}

function full(base: string): string {
  const scopes = SCOPES.map((s) => `- \`${s}\`: ${SCOPE_DESCRIPTIONS[s]}`).join("\n");
  return `${summary(base)}
${llmsToolSections(registry, { full: true })}

## Scopes

${scopes}

## Envelopes

Success: \`{ "status": 200, "message": "Success", "data": … }\` or \`{ "status": 200, "message": "Success", "items": […], "paginationInfo": { "page", "pageSize", "totalItems", "totalPages" } }\`.
Errors: \`{ "status": 403, "message": "…", "errors": [{ "code": "insufficient_scope" }] }\`. \`errors[0].code\` is stable and machine-readable.
Pagination: \`page\` (from 1) and \`pageSize\` (default 100, maximum 100).

## Token claims

- \`sub\`: the person (delegated tokens) or the client (client credentials)
- \`client_id\`, \`scope\`, \`grant_type\`, \`jti\`, \`iss\`, \`aud\`, \`exp\`
- \`https://gms.opengrants.io/workspace_id\`: the one workspace the token may act on
- \`https://commongrants.org/org_id\`: present when the workspace is linked to a Passport organization

## Webhooks

Events: application.submitted, application.status.changed, review.submitted, decision.committed, award.created, award.status.changed, agreement.executed, tranche.due, tranche.status.changed, disbursement.status.changed, requirement.due, submission.received, submission.accepted, org.change.pending, approval.requested.
Each delivery carries \`X-GMS-Timestamp\` (Unix seconds) and \`X-GMS-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>\`. Failed deliveries are retried with backoff for 24 hours.

## Status vocabulary

Applications: draft, submitted, screening, under_review, recommended, accepted, declined, waitlisted, revision_requested, interview, withdrawn. In CommonGrants responses these project to the protocol's status enum, with \`custom\` and \`customValue\` where the protocol has no equivalent.
Awards: offered, accepted, active, suspended, completed, cancelled.
Tranches: scheduled, due, ready, releasing, initiated, settled, held, failed, returned, cancelled.
Requirements: scheduled, due, overdue, submitted, under_review, accepted, returned, waived.
`;
}

export const agentdocs = new Hono<AppEnv>();

const text = (body: string) => new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });

agentdocs.get("/llms.txt", (c) => text(summary(trimSlash(c.env.GMS_BASE_URL))));
agentdocs.get("/llms-full.txt", (c) => text(full(trimSlash(c.env.GMS_BASE_URL))));
