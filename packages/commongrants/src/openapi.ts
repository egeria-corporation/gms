// SPDX-License-Identifier: AGPL-3.0-only
// OpenAPI 3.1 document for the CommonGrants routes GMS implements (served at /common-grants/openapi.json).
// Component schemas are generated from the same zod schemas the contract tests validate against,
// so the document and the tests cannot drift apart.
import { z } from 'zod';
import {
  AppFiltersSchema,
  AppFormResponseSchema,
  ApplicationBaseSchema,
  AppSortingSchema,
  AwardBaseSchema,
  AwdFiltersSchema,
  AwdSortingSchema,
  CompetitionBaseSchema,
  FormBaseSchema,
  OppFiltersSchema,
  OppSortingSchema,
  OpportunityBaseSchema,
  OpportunityDetailsSchema,
  PaginatedResultsInfoSchema,
  SortedResultsInfoSchema,
} from './schemas';

/** CG conformance tags from @common-grants/core 0.4 `lib/api.tsp`. `gms-extension` = not in the CG spec. */
export type CgConformance = 'required' | 'optional' | 'experimental' | 'gms-extension';

export interface CgRouteInfo {
  method: 'get' | 'post' | 'put';
  path: string;
  operationId: string;
  summary: string;
  conformance: CgConformance;
  tag: string;
  auth: boolean;
}

export const CG_ROUTES: readonly CgRouteInfo[] = [
  { method: 'get', path: '/common-grants/opportunities', operationId: 'listOpportunities', summary: 'List opportunities', conformance: 'required', tag: 'Opportunities', auth: false },
  { method: 'get', path: '/common-grants/opportunities/{oppId}', operationId: 'readOpportunity', summary: 'View opportunity details', conformance: 'required', tag: 'Opportunities', auth: false },
  { method: 'post', path: '/common-grants/opportunities/search', operationId: 'searchOpportunities', summary: 'Search opportunities', conformance: 'optional', tag: 'Opportunities', auth: false },
  { method: 'get', path: '/common-grants/forms', operationId: 'listForms', summary: 'List forms', conformance: 'experimental', tag: 'Forms', auth: false },
  { method: 'get', path: '/common-grants/forms/{formId}', operationId: 'readForm', summary: 'View form details', conformance: 'experimental', tag: 'Forms', auth: false },
  { method: 'get', path: '/common-grants/competitions', operationId: 'listCompetitions', summary: 'List competitions (GMS extension)', conformance: 'gms-extension', tag: 'Competitions', auth: false },
  { method: 'get', path: '/common-grants/competitions/{compId}', operationId: 'readCompetition', summary: 'View competition details', conformance: 'experimental', tag: 'Competitions', auth: false },
  { method: 'get', path: '/common-grants/awards', operationId: 'listAwards', summary: 'List awards', conformance: 'experimental', tag: 'Awards', auth: false },
  { method: 'post', path: '/common-grants/awards/search', operationId: 'searchAwards', summary: 'Search awards', conformance: 'experimental', tag: 'Awards', auth: false },
  { method: 'get', path: '/common-grants/awards/{awdId}', operationId: 'readAward', summary: 'View award details', conformance: 'experimental', tag: 'Awards', auth: false },
  { method: 'post', path: '/common-grants/applications/start', operationId: 'startApplication', summary: 'Start an application', conformance: 'experimental', tag: 'Applications', auth: true },
  { method: 'get', path: '/common-grants/applications/{appId}', operationId: 'getApplication', summary: 'View an application', conformance: 'experimental', tag: 'Applications', auth: true },
  { method: 'get', path: '/common-grants/applications/{appId}/forms/{formId}', operationId: 'getFormResponse', summary: 'Get a form response', conformance: 'experimental', tag: 'Applications', auth: true },
  { method: 'put', path: '/common-grants/applications/{appId}/forms/{formId}', operationId: 'setFormResponse', summary: 'Respond to a form', conformance: 'experimental', tag: 'Applications', auth: true },
  { method: 'put', path: '/common-grants/applications/{appId}/submit', operationId: 'submitApplication', summary: 'Submit an application', conformance: 'experimental', tag: 'Applications', auth: true },
  { method: 'post', path: '/common-grants/applications/search', operationId: 'searchApplications', summary: 'Search applications', conformance: 'experimental', tag: 'Application Reviews', auth: true },
];

type JsonObject = Record<string, unknown>;

function toSchema(schema: z.ZodType): JsonObject {
  const out = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12', cycles: 'ref', reused: 'inline' }) as JsonObject;
  delete out.$schema;
  return out;
}

let components: JsonObject | null = null;
function buildComponents(): JsonObject {
  if (components) return components;
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const success = { type: 'object', required: ['status', 'message'], properties: { status: { type: 'integer' }, message: { type: 'string' } } };
  const ok = (data: JsonObject) => ({ allOf: [success, { type: 'object', required: ['data'], properties: { data } }] });
  const paginated = (item: string) => ({
    allOf: [success, { type: 'object', required: ['items', 'paginationInfo'], properties: { items: { type: 'array', items: ref(item) }, paginationInfo: ref('PaginatedResultsInfo') } }],
  });
  const filtered = (item: string, filters: string) => ({
    allOf: [
      paginated(item),
      {
        type: 'object',
        required: ['sortInfo', 'filterInfo'],
        properties: {
          sortInfo: ref('SortedResultsInfo'),
          filterInfo: { type: 'object', required: ['filters'], properties: { filters: ref(filters), errors: { type: 'array', items: { type: 'string' } } } },
        },
      },
    ],
  });
  const searchBody = (filters: string, sorting: string) => ({
    type: 'object',
    properties: {
      search: { type: 'string' },
      filters: ref(filters),
      sorting: ref(sorting),
      pagination: { type: 'object', properties: { page: { type: 'integer', minimum: 1, default: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 100 } } },
    },
  });
  components = {
    schemas: {
      OpportunityBase: toSchema(OpportunityBaseSchema),
      OpportunityDetails: toSchema(OpportunityDetailsSchema),
      CompetitionBase: toSchema(CompetitionBaseSchema),
      FormBase: toSchema(FormBaseSchema),
      AppFormResponse: toSchema(AppFormResponseSchema),
      ApplicationBase: toSchema(ApplicationBaseSchema),
      AwardBase: toSchema(AwardBaseSchema),
      OppFilters: toSchema(OppFiltersSchema),
      OppSorting: toSchema(OppSortingSchema),
      AwdFilters: toSchema(AwdFiltersSchema),
      AwdSorting: toSchema(AwdSortingSchema),
      AppFilters: toSchema(AppFiltersSchema),
      AppSorting: toSchema(AppSortingSchema),
      PaginatedResultsInfo: toSchema(PaginatedResultsInfoSchema),
      SortedResultsInfo: toSchema(SortedResultsInfoSchema),
      Problem: {
        type: 'object',
        description: 'RFC 9457 problem details. Also carries the CommonGrants error fields `status`, `message` and `errors`.',
        required: ['type', 'title', 'status', 'detail', 'message', 'errors'],
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'integer' },
          detail: { type: 'string' },
          instance: { type: 'string' },
          code: { type: 'string' },
          message: { type: 'string' },
          errors: { type: 'array', items: { type: 'object', properties: { pointer: { type: 'string' }, message: { type: 'string' } } } },
        },
      },
      OpportunityList: paginated('OpportunityBase'),
      OpportunityRead: ok(ref('OpportunityDetails')),
      OpportunitySearch: filtered('OpportunityBase', 'OppFilters'),
      OpportunitySearchRequest: searchBody('OppFilters', 'OppSorting'),
      FormList: paginated('FormBase'),
      FormRead: ok(ref('FormBase')),
      CompetitionList: paginated('CompetitionBase'),
      CompetitionRead: ok(ref('CompetitionBase')),
      AwardList: paginated('AwardBase'),
      AwardRead: ok(ref('AwardBase')),
      AwardSearch: filtered('AwardBase', 'AwdFilters'),
      AwardSearchRequest: searchBody('AwdFilters', 'AwdSorting'),
      ApplicationRead: ok(ref('ApplicationBase')),
      ApplicationSearch: filtered('ApplicationBase', 'AppFilters'),
      ApplicationSearchRequest: searchBody('AppFilters', 'AppSorting'),
      FormResponseRead: ok(ref('AppFormResponse')),
      StartApplicationRequest: {
        type: 'object',
        required: ['competitionId'],
        properties: { competitionId: { type: 'string', format: 'uuid' }, organizationId: { type: 'string', format: 'uuid' }, title: { type: 'string' } },
      },
      SubmitApplicationRequest: {
        type: 'object',
        required: ['attestation'],
        description: 'GMS requires a signed attestation to submit. The CG spec defines no body for this route.',
        properties: {
          attestation: {
            type: 'object',
            required: ['typedName', 'agreed'],
            properties: { typedName: { type: 'string' }, agreed: { const: true } },
          },
          aiDisclosure: { type: 'string', description: 'Disclosure of AI assistance, stored in Application.customFields.aiDisclosure.' },
        },
      },
      SubmitResult: ok({
        type: 'object',
        properties: { status: { type: 'string' }, receiptNumber: { type: 'string' }, submittedAt: { type: 'string', format: 'date-time' } },
      }),
      ApprovalRequired: ok({
        type: 'object',
        required: ['status', 'approvalRequestId', 'confirmUrl'],
        properties: { status: { const: 'approval_required' }, approvalRequestId: { type: 'string' }, confirmUrl: { type: 'string', format: 'uri' } },
      }),
    },
    parameters: {
      page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      pageSize: { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
    },
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer', description: 'OAuth 2.1 access token or GMS personal access token.' },
    },
  };
  return components;
}

const PROBLEM = (description: string) => ({ description, content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } });
const JSON_OK = (name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } });

const RESPONSES: Record<string, JsonObject> = {
  listOpportunities: { 200: JSON_OK('OpportunityList'), 400: PROBLEM('Invalid pagination') },
  readOpportunity: { 200: JSON_OK('OpportunityRead'), 404: PROBLEM('Not found or not public') },
  searchOpportunities: { 200: JSON_OK('OpportunitySearch'), 400: PROBLEM('Invalid search request') },
  listForms: { 200: JSON_OK('FormList'), 400: PROBLEM('Invalid pagination') },
  readForm: { 200: JSON_OK('FormRead'), 404: PROBLEM('Not found') },
  listCompetitions: { 200: JSON_OK('CompetitionList'), 400: PROBLEM('Invalid pagination') },
  readCompetition: { 200: JSON_OK('CompetitionRead'), 404: PROBLEM('Not found') },
  listAwards: { 200: JSON_OK('AwardList'), 400: PROBLEM('Invalid pagination') },
  searchAwards: { 200: JSON_OK('AwardSearch'), 400: PROBLEM('Invalid search request') },
  readAward: { 200: JSON_OK('AwardRead'), 404: PROBLEM('Not found') },
  startApplication: { 201: JSON_OK('ApplicationRead', 'Created'), 202: JSON_OK('ApprovalRequired', 'A person must confirm'), 401: PROBLEM('Unauthenticated'), 404: PROBLEM('Competition not found') },
  getApplication: { 200: JSON_OK('ApplicationRead'), 401: PROBLEM('Unauthenticated'), 404: PROBLEM('Not found') },
  getFormResponse: { 200: JSON_OK('FormResponseRead'), 401: PROBLEM('Unauthenticated'), 404: PROBLEM('Not found') },
  setFormResponse: {
    200: JSON_OK('FormResponseRead'),
    401: PROBLEM('Unauthenticated'),
    404: PROBLEM('Not found'),
    409: PROBLEM('Stale If-Match etag'),
  },
  submitApplication: {
    200: JSON_OK('SubmitResult'),
    202: JSON_OK('ApprovalRequired', 'An agent asked to submit; the applicant must confirm in GMS'),
    400: PROBLEM('Missing attestation or validation errors'),
    401: PROBLEM('Unauthenticated'),
    404: PROBLEM('Not found'),
  },
  searchApplications: { 200: JSON_OK('ApplicationSearch'), 400: PROBLEM('Invalid search request'), 401: PROBLEM('Unauthenticated') },
};

const REQUEST_BODIES: Record<string, string> = {
  searchOpportunities: 'OpportunitySearchRequest',
  searchAwards: 'AwardSearchRequest',
  searchApplications: 'ApplicationSearchRequest',
  startApplication: 'StartApplicationRequest',
  submitApplication: 'SubmitApplicationRequest',
};

export function buildOpenApi(origin: string): JsonObject {
  const paths: Record<string, Record<string, JsonObject>> = {};
  for (const r of CG_ROUTES) {
    const pathParams = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }));
    const listLike = r.method === 'get' && !r.path.endsWith('}');
    const op: JsonObject = {
      operationId: r.operationId,
      summary: r.summary,
      tags: [r.tag, r.conformance],
      'x-cg-conformance': r.conformance,
      parameters: [...pathParams, ...(listLike ? [{ $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/pageSize' }] : [])],
      responses: RESPONSES[r.operationId] ?? {},
      ...(r.auth ? { security: [{ bearer: [] }] } : { security: [] }),
    };
    const body = REQUEST_BODIES[r.operationId];
    if (body) op.requestBody = { required: r.operationId !== 'searchOpportunities', content: { 'application/json': { schema: { $ref: `#/components/schemas/${body}` } } } };
    if (r.operationId === 'setFormResponse') {
      op.requestBody = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } };
      (op.parameters as JsonObject[]).push({ name: 'If-Match', in: 'header', required: false, schema: { type: 'string' }, description: 'ETag of the answers you last read.' });
    }
    (paths[r.path] ??= {})[r.method] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'GMS CommonGrants API',
      version: '0.4.0',
      description:
        'CommonGrants 0.4 routes implemented by GMS. Tags mark each route as CG "required", "optional", "experimental", or a "gms-extension". ' +
        'GMS extras are carried in `customFields` (see the GMS CommonGrants plugin). Errors are RFC 9457 problem details that also carry the CG `status`/`message`/`errors` fields.',
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
    },
    servers: [{ url: origin.replace(/\/$/, '') }],
    tags: [
      { name: 'required', description: 'Endpoints that MUST be implemented by all CommonGrants APIs' },
      { name: 'optional', description: 'Endpoints that MAY be implemented by CommonGrants APIs' },
      { name: 'experimental', description: 'Endpoints that MAY be implemented but are not guaranteed to be stable' },
      { name: 'gms-extension', description: 'GMS additions outside the CommonGrants spec' },
    ],
    paths,
    components: buildComponents(),
  };
}
