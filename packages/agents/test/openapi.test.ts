// SPDX-License-Identifier: AGPL-3.0-or-later
import { actionAudience, listActions, type Runtime } from '@gms/actions';
import { createAjv } from '@gms/forms';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { arazzoYaml, openApiDocument, type AgentEnv } from '../src';

const env = {
  workspace: {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'halcyon',
    name: 'Halcyon Foundation',
    timezone: 'America/Los_Angeles',
  },
  origin: 'http://halcyon.localhost:3000',
  brandName: 'Halcyon Foundation',
  runtime: {} as Runtime,
  requestId: 'test',
} satisfies AgentEnv;

type Op = Record<string, unknown> & {
  operationId: string;
  requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
};
const doc = openApiDocument(env) as {
  openapi: string;
  paths: Record<string, Record<string, Op>>;
  components: Record<string, Record<string, unknown>>;
  info: Record<string, unknown>;
  servers: { url: string }[];
};

function allOps(): Op[] {
  return Object.values(doc.paths).flatMap((p) => Object.values(p));
}

describe('OpenAPI 3.1', () => {
  it('has a valid 3.1 top-level shape with bearer + OAuth security schemes', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Halcyon Foundation Platform API');
    expect(doc.servers[0]!.url).toBe('http://halcyon.localhost:3000/api/v1');
    const schemes = doc.components.securitySchemes as Record<
      string,
      { type: string; scheme?: string; flows?: { authorizationCode?: { authorizationUrl: string } } }
    >;
    expect(schemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(schemes.oauth2!.flows!.authorizationCode!.authorizationUrl).toBe(
      'http://halcyon.localhost:3000/oauth/authorize',
    );
    for (const [path, item] of Object.entries(doc.paths)) {
      expect(path.startsWith('/')).toBe(true);
      for (const [method, op] of Object.entries(item)) {
        expect(['get', 'post', 'put', 'patch', 'delete']).toContain(method);
        expect(op.responses, `${method} ${path}`).toBeTruthy();
        expect(typeof op.operationId).toBe('string');
      }
    }
  });

  it('has unique operationIds and resolvable $refs', () => {
    const ids = allOps().map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    const refs = JSON.stringify(doc).match(/"\$ref":"#\/[^"]+"/g) ?? [];
    for (const r of refs) {
      const path = r.slice(9, -1).split('/').slice(1);
      let node: unknown = doc;
      for (const seg of path) node = (node as Record<string, unknown>)[seg];
      expect(node, r).toBeTruthy();
    }
  });

  it('documents every non-system action with its risk tier and scopes', () => {
    const actions = listActions().filter((a) => actionAudience(a) !== 'system');
    expect(actions.length).toBeGreaterThan(100);
    for (const a of actions) {
      const op = doc.paths[`/actions/${a.id}`]?.post;
      expect(op, a.id).toBeTruthy();
      expect(op!['x-gms-risk-tier']).toBe(a.riskTier);
      expect(op!['x-gms-scopes']).toEqual([...a.scopes]);
    }
    expect(doc.paths['/actions/system.submit_batch']).toBeUndefined();
  });

  it('marks R3 actions people-only and not callable by agents', () => {
    // System-only actions (run by the server itself) are never in the API document; see the test above.
    const r3 = listActions().filter((a) => a.riskTier === 'R3' && actionAudience(a) !== 'system');
    expect(r3.map((a) => a.id)).toContain('payments.approve_batch');
    for (const a of r3) {
      const op = doc.paths[`/actions/${a.id}`]!.post!;
      expect(op['x-gms-risk-tier']).toBe('R3');
      expect(op['x-gms-agent-callable']).toBe(false);
      expect(op.security).toEqual([]);
      expect(String(op.description)).toContain('People only (R3)');
    }
    const submit = doc.paths['/actions/applications.submit']!.post!;
    expect((submit.responses as Record<string, unknown>)['202']).toEqual({
      $ref: '#/components/responses/ApprovalRequired',
    });
  });

  it('includes the REST aliases', () => {
    expect(doc.paths['/opportunities']!.get!.operationId).toBe('searchOpportunities');
    expect(doc.paths['/applications/{applicationId}/forms/{formId}']!.patch!.operationId).toBe('saveAnswers');
    expect(doc.paths['/applications/{applicationId}/submit']!.post!['x-gms-risk-tier']).toBe('R2');
    expect(doc.paths['/approval-requests/{approvalRequestId}']!.get).toBeTruthy();
  });

  it('request body schemas are valid JSON Schema', () => {
    const ajv = createAjv();
    for (const op of allOps()) {
      const schema = op.requestBody?.content['application/json']?.schema;
      if (!schema) continue;
      expect(
        ajv.validateSchema(JSON.parse(JSON.stringify(schema))),
        `${op.operationId}: ${JSON.stringify(ajv.errors)}`,
      ).toBe(true);
    }
  });
});

describe('Arazzo 1.0', () => {
  it('parses and only references operations that exist', () => {
    const text = arazzoYaml(env);
    const doc2 = parse(text) as {
      arazzo: string;
      sourceDescriptions: { url: string; type: string }[];
      workflows: { workflowId: string; steps: { stepId: string; operationId?: string }[] }[];
    };
    expect(doc2.arazzo).toMatch(/^1\.0\.\d+$/);
    expect(doc2.sourceDescriptions[0]).toMatchObject({
      type: 'openapi',
      url: 'http://halcyon.localhost:3000/api/v1/openapi.json',
    });
    expect(doc2.workflows.map((w) => w.workflowId)).toEqual(['applyToOpportunity', 'submitGranteeReport']);
    const opIds = new Set(allOps().map((o) => o.operationId));
    for (const wf of doc2.workflows) {
      const stepIds = wf.steps.map((s) => s.stepId);
      expect(new Set(stepIds).size).toBe(stepIds.length);
      for (const step of wf.steps)
        expect(opIds.has(step.operationId!), `${wf.workflowId}.${step.stepId} → ${step.operationId}`).toBe(
          true,
        );
    }
    const apply = doc2.workflows[0]!.steps.map((s) => s.stepId);
    expect(apply).toEqual([
      'search',
      'getForm',
      'start',
      'saveAnswers',
      'validate',
      'requestSubmission',
      'waitForPerson',
      'status',
    ]);
  });
});
