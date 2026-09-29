// SPDX-License-Identifier: AGPL-3.0-or-later
// OpenAPI 3.1 and Arazzo 1.0 documents generated from the action registry and the REST aliases.
import { actionAudience, listActions, type AnyAction } from '@gms/actions';
import { RISK_TIER_LABELS, SCOPES } from '@gms/domain';
import { stringify } from 'yaml';
import { API_ALIASES, type ApiAlias } from './api';
import { agentCallable, capabilitySchemas, findCapability } from './catalog';
import { trimOrigin, type AgentEnv } from './env';
import { jsonSchemaOf, type JsonObject } from './schema';

const PROBLEM_REF = { $ref: '#/components/responses/Problem' };

function problemResponses(): JsonObject {
  return {
    '400': PROBLEM_REF,
    '401': PROBLEM_REF,
    '403': PROBLEM_REF,
    '404': PROBLEM_REF,
    '409': PROBLEM_REF,
    '412': PROBLEM_REF,
    '422': PROBLEM_REF,
    '429': PROBLEM_REF,
    default: PROBLEM_REF,
  };
}

function security(scopes: readonly string[], publicOk: boolean): JsonObject[] {
  return [{ oauth2: [...scopes] }, { bearerAuth: [] }, ...(publicOk ? [{}] : [])];
}

function rateHeaders(): JsonObject {
  return {
    RateLimit: { $ref: '#/components/headers/RateLimit' },
    'RateLimit-Policy': { $ref: '#/components/headers/RateLimitPolicy' },
  };
}

function actionOperation(a: AnyAction): JsonObject {
  const callable = agentCallable(a);
  const notes: string[] = [];
  if (a.riskTier === 'R2')
    notes.push(
      '**Consequential (R2):** an agent call returns `202 approval_required` with a `confirmUrl`; a person confirms inside GMS and GMS then runs the action.',
    );
  if (a.riskTier === 'R3')
    notes.push('**People only (R3):** no token can call this. Bearer callers always get `403 human_only`.');
  else if (!callable) notes.push('**UI only:** there is no scope an agent can be granted for this action.');
  const responses: JsonObject = {
    '200': {
      description: 'Done',
      headers: rateHeaders(),
      content: { 'application/json': { schema: jsonSchemaOf(a.output, 'output') } },
    },
    ...(a.riskTier === 'R2' ? { '202': { $ref: '#/components/responses/ApprovalRequired' } } : {}),
    ...problemResponses(),
  };
  return {
    operationId: `action_${a.id.replace(/\./g, '_')}`,
    summary: a.title,
    description: [a.description, ...notes].join('\n\n'),
    tags: [a.id.split('.')[0]],
    ...(a.idempotent ? { parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }] } : {}),
    requestBody: {
      required: true,
      content: { 'application/json': { schema: jsonSchemaOf(a.input, 'input') } },
    },
    responses,
    security: a.riskTier === 'R3' ? [] : security(a.scopes, a.roles.includes('public')),
    'x-gms-action-id': a.id,
    'x-gms-risk-tier': a.riskTier,
    'x-gms-risk-label': RISK_TIER_LABELS[a.riskTier],
    'x-gms-scopes': [...a.scopes],
    'x-gms-roles': [...a.roles],
    'x-gms-audience': actionAudience(a),
    'x-gms-agent-callable': callable,
    'x-gms-idempotent': a.idempotent,
  };
}

function aliasOperation(alias: ApiAlias): JsonObject | null {
  const caps = alias.caps.map((c) => findCapability(c)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const cap = caps[0];
  if (!cap) return null;
  const { input, output } = capabilitySchemas(cap);
  const params: JsonObject[] = [
    ...alias.pathParams.map((n) => ({ name: n, in: 'path', required: true, schema: { type: 'string' } })),
    ...(alias.queryParams ?? []).map((q) => ({
      name: q.name,
      in: 'query',
      required: false,
      description: q.description,
      schema: q.schema,
    })),
    ...(alias.method !== 'GET' ? [{ $ref: '#/components/parameters/IdempotencyKey' }] : []),
    ...(alias.etag === 'form'
      ? [
          {
            name: 'If-Match',
            in: 'header',
            required: false,
            description: 'The form etag from GET …/form (ETag header). 412 if it changed.',
            schema: { type: 'string' },
          },
        ]
      : []),
    ...(alias.etag === 'lastModified'
      ? [{ name: 'If-None-Match', in: 'header', required: false, schema: { type: 'string' } }]
      : []),
  ];
  let body: JsonObject | null = null;
  if (alias.method !== 'GET') {
    const props = { ...((input.properties as JsonObject | undefined) ?? {}) };
    for (const p of alias.pathParams) delete props[p];
    const required = ((input.required as string[] | undefined) ?? []).filter(
      (r) => !alias.pathParams.includes(r),
    );
    body = {
      required: true,
      content: {
        'application/json': {
          schema: {
            ...input,
            properties: props,
            ...(required.length ? { required } : { required: undefined }),
          },
        },
      },
    };
  }
  const tiers = caps.map((c) => c.riskTier);
  return {
    operationId: alias.operationId,
    summary: alias.summary,
    description: caps.map((c) => `**${c.name}** — ${c.description}`).join('\n\n'),
    tags: ['rest'],
    ...(params.length ? { parameters: params } : {}),
    ...(body ? { requestBody: body } : {}),
    responses: {
      '200': {
        description: 'OK',
        headers: { ...rateHeaders(), ...(alias.etag ? { ETag: { schema: { type: 'string' } } } : {}) },
        content: {
          'application/json': {
            schema: cap.read ? output : ((output?.properties as JsonObject | undefined)?.result ?? {}),
          },
        },
      },
      ...(tiers.includes('R2') ? { '202': { $ref: '#/components/responses/ApprovalRequired' } } : {}),
      ...(alias.etag === 'lastModified' ? { '304': { description: 'Not modified' } } : {}),
      ...problemResponses(),
    },
    security: security(
      cap.scopes,
      caps.every((c) => c.roles.includes('public')),
    ),
    'x-gms-capabilities': caps.map((c) => c.name),
    'x-gms-risk-tier': tiers.includes('R2') ? 'R2' : tiers.includes('R1') ? 'R1' : 'R0',
    'x-gms-scopes': [...new Set(caps.flatMap((c) => c.scopes))],
  };
}

/** OpenAPI 3.1 for /api/v1. Every non-system action has an operation; R3 ones are documented as people-only. */
export function openApiDocument(env: AgentEnv): JsonObject {
  const origin = trimOrigin(env.origin);
  const paths: Record<string, JsonObject> = {};
  for (const alias of API_ALIASES) {
    const op = aliasOperation(alias);
    if (!op) continue;
    (paths[alias.path] ??= {})[alias.method.toLowerCase()] = op;
  }
  for (const a of listActions()) {
    if (actionAudience(a) === 'system') continue;
    paths[`/actions/${a.id}`] = { post: actionOperation(a) };
  }
  const scopes = Object.fromEntries(Object.entries(SCOPES).map(([k, v]) => [k, v.label]));
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: `${env.brandName} Platform API`,
      version: '1.0.0',
      summary: 'Grants management API for agents and integrations (GMS).',
      description: [
        `Generated from the GMS action registry. Every mutation is an action; \`POST /actions/{actionId}\` runs one.`,
        'People always confirm consequential (R2) actions: agents get `202` with a `confirmUrl`. People-only (R3) actions cannot be called with any token.',
        `Errors are RFC 9457 problem details. Agent guide: ${origin}/agents.md`,
      ].join('\n\n'),
      license: { name: 'AGPL-3.0-or-later', identifier: 'AGPL-3.0-or-later' },
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ oauth2: [] }, { bearerAuth: [] }],
    tags: [{ name: 'rest', description: 'Friendly REST aliases over the same actions and read models.' }],
    paths,
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          description: 'OAuth 2.1 authorization code + PKCE (S256) with a resource indicator (RFC 8707).',
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/oauth/authorize`,
              tokenUrl: `${origin}/oauth/token`,
              refreshUrl: `${origin}/oauth/token`,
              scopes,
            },
          },
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Personal access token (gms_pat_…), agent-account key (gms_ak_…), workspace key (gms_sk_…) or OAuth access token.',
        },
      },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description:
            'Retry-safe key (1–255 visible ASCII). Same key + same input replays the first result.',
          schema: { type: 'string', maxLength: 255 },
        },
      },
      headers: {
        RateLimit: {
          description: 'draft-ietf-httpapi-ratelimit-headers: remaining quota and reset seconds.',
          schema: { type: 'string' },
        },
        RateLimitPolicy: { description: 'Quota policy, e.g. "gms";q=60;w=60.', schema: { type: 'string' } },
      },
      schemas: {
        Problem: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            instance: { type: 'string' },
            code: { type: 'string' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: { pointer: { type: 'string' }, message: { type: 'string' } },
                required: ['pointer', 'message'],
              },
            },
          },
          required: ['type', 'title', 'status', 'detail'],
        },
        ApprovalRequired: {
          type: 'object',
          properties: {
            status: { const: 'approval_required' },
            approvalRequestId: { type: 'string', format: 'uuid' },
            confirmUrl: { type: 'string', format: 'uri' },
            expiresAt: { type: 'string', format: 'date-time' },
            preview: { type: 'object' },
            message: { type: 'string' },
          },
          required: ['status', 'approvalRequestId', 'confirmUrl'],
        },
      },
      responses: {
        Problem: {
          description: 'RFC 9457 problem details',
          content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
        },
        ApprovalRequired: {
          description:
            'Accepted: a person must confirm inside GMS. Poll the Location (approval request) until status is confirmed.',
          headers: { Location: { schema: { type: 'string' } } },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApprovalRequired' } } },
        },
      },
    },
  };
}

/** Arazzo 1.0 workflows: apply to an opportunity; submit a grantee report. */
export function arazzoDocument(env: AgentEnv): JsonObject {
  const pollApproval = (after: string) => ({
    stepId: 'waitForPerson',
    description:
      'Poll until the person confirms in GMS (they open confirmUrl). Status becomes confirmed, rejected or expired.',
    operationId: 'getApprovalRequest',
    parameters: [
      { name: 'approvalRequestId', in: 'path', value: `$steps.${after}.outputs.approvalRequestId` },
    ],
    successCriteria: [
      { condition: '$statusCode == 200' },
      { context: '$response.body', condition: "$.status == 'confirmed'", type: 'jsonpath' },
    ],
    onFailure: [
      {
        name: 'keepWaiting',
        type: 'retry',
        retryAfter: 60,
        retryLimit: 4320,
        criteria: [
          { context: '$response.body', condition: "$.status == 'awaiting_confirmation'", type: 'jsonpath' },
        ],
      },
    ],
    outputs: { status: '$response.body#/status', result: '$response.body#/result' },
  });
  return {
    arazzo: '1.0.1',
    info: {
      title: `${env.brandName}: agent workflows`,
      version: '1.0.0',
      description:
        'Step-by-step flows for agents. Submitting always ends with a person confirming inside GMS.',
    },
    sourceDescriptions: [
      { name: 'gmsApi', url: `${trimOrigin(env.origin)}/api/v1/openapi.json`, type: 'openapi' },
    ],
    workflows: [
      {
        workflowId: 'applyToOpportunity',
        summary: 'Apply to an opportunity',
        description:
          'Search → get the form → start → save answers (fix JSON-Pointer errors) → validate → request submission (202) → wait for the person → check status.',
        inputs: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to search for' },
            applicantOrgId: { type: 'string', format: 'uuid' },
            answers: { type: 'object', description: 'Answers keyed by field id (currency in cents)' },
            typedName: { type: 'string', description: 'The person’s name for the attestation' },
            aiDisclosure: { type: 'string' },
          },
          required: ['query', 'answers', 'typedName'],
        },
        steps: [
          {
            stepId: 'search',
            operationId: 'searchOpportunities',
            parameters: [{ name: 'q', in: 'query', value: '$inputs.query' }],
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: { opportunityId: '$response.body#/opportunities/0/id' },
          },
          {
            stepId: 'getForm',
            operationId: 'getOpportunityForm',
            parameters: [{ name: 'opportunityId', in: 'path', value: '$steps.search.outputs.opportunityId' }],
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: {
              competitionId: '$response.body#/competitionId',
              formId: '$response.body#/forms/0/formId',
            },
          },
          {
            stepId: 'start',
            operationId: 'startApplication',
            requestBody: {
              contentType: 'application/json',
              payload: {
                competitionId: '$steps.getForm.outputs.competitionId',
                applicantOrgId: '$inputs.applicantOrgId',
              },
            },
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: { applicationId: '$response.body#/applicationId' },
          },
          {
            stepId: 'saveAnswers',
            operationId: 'saveAnswers',
            parameters: [
              { name: 'applicationId', in: 'path', value: '$steps.start.outputs.applicationId' },
              { name: 'formId', in: 'path', value: '$steps.getForm.outputs.formId' },
            ],
            requestBody: { contentType: 'application/json', payload: { answers: '$inputs.answers' } },
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: { etag: '$response.body#/etag', errors: '$response.body#/errors' },
          },
          {
            stepId: 'validate',
            operationId: 'validateApplication',
            parameters: [{ name: 'applicationId', in: 'path', value: '$steps.start.outputs.applicationId' }],
            successCriteria: [
              { condition: '$statusCode == 200' },
              { context: '$response.body', condition: '$.ready == true', type: 'jsonpath' },
            ],
            onFailure: [
              {
                name: 'fixAnswers',
                type: 'end',
                criteria: [{ context: '$response.body', condition: '$.ready == false', type: 'jsonpath' }],
              },
            ],
            outputs: { errors: '$response.body#/errors' },
          },
          {
            stepId: 'requestSubmission',
            operationId: 'submitApplication',
            parameters: [{ name: 'applicationId', in: 'path', value: '$steps.start.outputs.applicationId' }],
            requestBody: {
              contentType: 'application/json',
              payload: {
                attestation: { typedName: '$inputs.typedName', agreed: true },
                aiDisclosure: '$inputs.aiDisclosure',
              },
            },
            successCriteria: [{ condition: '$statusCode == 202' }],
            outputs: {
              approvalRequestId: '$response.body#/approvalRequestId',
              confirmUrl: '$response.body#/confirmUrl',
            },
          },
          pollApproval('requestSubmission'),
          {
            stepId: 'status',
            operationId: 'getApplication',
            parameters: [{ name: 'applicationId', in: 'path', value: '$steps.start.outputs.applicationId' }],
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: { status: '$response.body#/status' },
          },
        ],
        outputs: {
          applicationId: '$steps.start.outputs.applicationId',
          confirmUrl: '$steps.requestSubmission.outputs.confirmUrl',
          status: '$steps.status.outputs.status',
        },
      },
      {
        workflowId: 'submitGranteeReport',
        summary: 'Submit a grantee report',
        description:
          'List required reports → save the draft → request submission (202) → wait for the person to confirm.',
        inputs: {
          type: 'object',
          properties: { answers: { type: 'object' }, typedName: { type: 'string' } },
          required: ['answers', 'typedName'],
        },
        steps: [
          {
            stepId: 'listReports',
            operationId: 'listReports',
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: { requirementId: '$response.body#/reports/0/requirementId' },
          },
          {
            stepId: 'saveReport',
            operationId: 'saveReport',
            parameters: [
              { name: 'requirementId', in: 'path', value: '$steps.listReports.outputs.requirementId' },
            ],
            requestBody: { contentType: 'application/json', payload: { answers: '$inputs.answers' } },
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: { errors: '$response.body#/errors' },
          },
          {
            stepId: 'requestSubmission',
            operationId: 'submitReport',
            parameters: [
              { name: 'requirementId', in: 'path', value: '$steps.listReports.outputs.requirementId' },
            ],
            requestBody: {
              contentType: 'application/json',
              payload: { attestation: { typedName: '$inputs.typedName', agreed: true } },
            },
            successCriteria: [{ condition: '$statusCode == 202' }],
            outputs: {
              approvalRequestId: '$response.body#/approvalRequestId',
              confirmUrl: '$response.body#/confirmUrl',
            },
          },
          pollApproval('requestSubmission'),
        ],
        outputs: { confirmUrl: '$steps.requestSubmission.outputs.confirmUrl' },
      },
    ],
  };
}

export function arazzoYaml(env: AgentEnv): string {
  return `# SPDX-License-Identifier: AGPL-3.0-or-later\n${stringify(arazzoDocument(env), { lineWidth: 0 })}`;
}
