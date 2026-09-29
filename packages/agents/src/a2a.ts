// SPDX-License-Identifier: AGPL-3.0-or-later
// A2A (Agent2Agent) v1.0 — JSON-RPC 2.0 binding, hand-rolled (no @a2a-js/sdk dependency).
//
//   GET  /.well-known/agent-card.json   public Agent Card (public skills)
//   POST /a2a                           JSON-RPC: message/send (SendMessage), message/stream (SendStreamingMessage,
//                                       answered as a single SSE event), tasks/get (GetTask), tasks/cancel
//                                       (CancelTask), agent/getAuthenticatedExtendedCard (GetExtendedAgentCard)
//
// Tasks are persisted in agent_tasks (protocol state, written with the service connection like the OAuth
// tables; every domain change a skill makes still goes through the action executor). Task states use the v1.0
// enum spellings (TASK_STATE_*). Multi-turn: continue a task by sending a message with its taskId.
import { randomUUID } from 'node:crypto';
import type { ActionContext } from '@gms/actions';
import { ANON_CLAIMS, withRls, type Database } from '@gms/db';
import { ALL_SCOPES, DomainError, isDomainError, toProblem, type Scope } from '@gms/domain';
import {
  authenticate,
  channelDisabled,
  channelEnabled,
  insufficientScope,
  rateLimitHeaders,
  unauthorized,
  type AgentPrincipal,
} from './auth';
import { findCapability, invokeCapability, type InvokeResult } from './catalog';
import { errorResponse, HttpError, isRecord, readJson, resourceUrl, trimOrigin, type AgentEnv } from './env';
import { passagesFor, rankPassages } from './retrieval';
import { opportunityUrl } from './reads';

export const A2A_PROTOCOL_VERSION = '1.0';
export const AGENT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------------------------------------
// Types (A2A v1.0 JSON shapes)
// ---------------------------------------------------------------------------------------------------------
export type TaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_AUTH_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELLED'
  | 'TASK_STATE_REJECTED';

const DB_STATE: Record<TaskState, string> = {
  TASK_STATE_SUBMITTED: 'submitted',
  TASK_STATE_WORKING: 'working',
  TASK_STATE_INPUT_REQUIRED: 'input_required',
  TASK_STATE_AUTH_REQUIRED: 'auth_required',
  TASK_STATE_COMPLETED: 'completed',
  TASK_STATE_FAILED: 'failed',
  TASK_STATE_CANCELLED: 'canceled',
  TASK_STATE_REJECTED: 'rejected',
};
const FROM_DB = Object.fromEntries(Object.entries(DB_STATE).map(([k, v]) => [v, k])) as Record<
  string,
  TaskState
>;
const TERMINAL = new Set<TaskState>([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELLED',
  'TASK_STATE_REJECTED',
]);

export type Part = { kind: 'text'; text: string } | { kind: 'data'; data: Record<string, unknown> };

export interface A2aMessage {
  kind: 'message';
  messageId: string;
  role: 'ROLE_USER' | 'ROLE_AGENT';
  parts: Part[];
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface A2aTask {
  kind: 'task';
  id: string;
  contextId: string;
  status: { state: TaskState; message?: A2aMessage; timestamp: string };
  artifacts: { artifactId: string; name: string; parts: Part[] }[];
  history: A2aMessage[];
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------------------
// Skills and the Agent Card
// ---------------------------------------------------------------------------------------------------------
interface SkillDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  authenticated: boolean;
  /** Capability whose scopes/roles gate the skill (authenticated skills). */
  capability?: string;
}

export const SKILLS: SkillDef[] = [
  {
    id: 'find_opportunities',
    name: 'Find funding opportunities',
    description:
      'Searches the foundation’s published funding opportunities by keywords, cause or geography. Send text, or a data part {query, status}.',
    tags: ['grants', 'search', 'opportunities'],
    examples: ['Find open grants for youth arts programs', '{"query": "watershed", "status": "open"}'],
    authenticated: false,
  },
  {
    id: 'check_eligibility',
    name: 'Check eligibility',
    description:
      'Checks an organization against an opportunity’s eligibility questions. Multi-turn: returns TASK_STATE_INPUT_REQUIRED listing the questions still unanswered; reply on the same taskId with a data part {answers: {<questionId>: value}} until it completes with eligible true/false.',
    tags: ['grants', 'eligibility'],
    examples: ['{"opportunityId": "…", "answers": {}}'],
    authenticated: false,
  },
  {
    id: 'answer_opportunity_question',
    name: 'Answer a question about an opportunity',
    description:
      'Answers a question from the opportunity’s published description, eligibility, guidelines and FAQ, with citations. Without a configured language model it returns the most relevant passages verbatim.',
    tags: ['grants', 'faq', 'guidelines'],
    examples: ['Can fiscally sponsored groups apply to the Youth Arts Fund?'],
    authenticated: false,
  },
  {
    id: 'start_application',
    name: 'Start an application',
    description:
      'Starts (or resumes) a draft application for the person. Data part {opportunityId | competitionId, applicantOrgId?}. Nothing is submitted.',
    tags: ['applications'],
    examples: ['{"opportunityId": "…", "applicantOrgId": "…"}'],
    authenticated: true,
    capability: 'start_application',
  },
  {
    id: 'application_status',
    name: 'Application status',
    description:
      'Reports the status of the person’s applications (or one, with {applicationId}), including confirmations still waiting for them.',
    tags: ['applications', 'status'],
    examples: ['What is the status of my application?'],
    authenticated: true,
    capability: 'get_status',
  },
  {
    id: 'submit_report',
    name: 'Submit a grant report',
    description:
      'Asks to submit a grant report {requirementId, attestation: {typedName, agreed: true}}. Consequential: the task moves to TASK_STATE_AUTH_REQUIRED with a confirmUrl; it completes once the person confirms in GMS.',
    tags: ['reports', 'post-award'],
    examples: ['{"requirementId": "…", "attestation": {"typedName": "Jordan Reyes", "agreed": true}}'],
    authenticated: true,
    capability: 'submit_report',
  },
  {
    id: 'request_extension',
    name: 'Request an extension',
    description:
      'Asks the foundation for more time on a report or grant {awardId, requirementId?, newDueDate (YYYY-MM-DD), reason}. Staff decide.',
    tags: ['reports', 'extension'],
    examples: [
      '{"awardId": "…", "newDueDate": "2027-03-31", "reason": "Our program ran two weeks late because of flooding."}',
    ],
    authenticated: true,
    capability: 'awards_request_change',
  },
];

function skillCard(s: SkillDef) {
  const cap = s.capability ? findCapability(s.capability) : undefined;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags,
    examples: s.examples,
    inputModes: ['text/plain', 'application/json'],
    outputModes: ['text/plain', 'application/json'],
    ...(s.authenticated ? { security: [{ oauth2: [...(cap?.scopes ?? [])] }, { bearer: [] }] } : {}),
    ...(s.authenticated ? {} : { 'x-gms-public': true }),
  };
}

/** The Agent Card. `extended` adds the authenticated skills (served to authenticated callers only). */
export function agentCard(env: AgentEnv, opts: { extended?: boolean } = {}): Record<string, unknown> {
  const o = trimOrigin(env.origin);
  const url = resourceUrl(env, 'a2a');
  const skills = SKILLS.filter((s) => opts.extended || !s.authenticated).map(skillCard);
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: `${env.brandName} grants agent`,
    description: `Ask ${env.brandName} about its funding opportunities, check eligibility, and — acting for a signed-in person — start applications, check status, and submit reports. People always confirm consequential actions inside GMS.`,
    url,
    preferredTransport: 'JSONRPC',
    supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', protocolVersion: A2A_PROTOCOL_VERSION }],
    additionalInterfaces: [{ url, transport: 'JSONRPC' }],
    provider: { organization: env.brandName, url: o },
    version: AGENT_VERSION,
    documentationUrl: `${o}/agents.md`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
      extendedAgentCard: true,
    },
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        description: 'OAuth 2.1 authorization code + PKCE with resource indicator ' + url,
        oauth2MetadataUrl: `${o}/.well-known/oauth-authorization-server`,
        flows: {
          authorizationCode: {
            authorizationUrl: `${o}/oauth/authorize`,
            tokenUrl: `${o}/oauth/token`,
            refreshUrl: `${o}/oauth/token`,
            scopes: Object.fromEntries(ALL_SCOPES.map((s) => [s, s])),
          },
        },
      },
      bearer: {
        type: 'http',
        scheme: 'bearer',
        description: 'Personal access token (gms_pat_…) or OAuth access token for resource ' + url,
      },
    },
    supportsAuthenticatedExtendedCard: true,
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Task storage
// ---------------------------------------------------------------------------------------------------------
interface TaskRow {
  id: string;
  workspace_id: string | null;
  client_id: string | null;
  user_id: string | null;
  skill: string;
  context_id: string | null;
  state: string;
  input: unknown;
  output: unknown;
  history: unknown;
  last_modified_at: string;
}

function agentMessage(parts: Part[], task?: { id: string; contextId: string }): A2aMessage {
  return {
    kind: 'message',
    messageId: randomUUID(),
    role: 'ROLE_AGENT',
    parts,
    ...(task ? { taskId: task.id, contextId: task.contextId } : {}),
  };
}

function toTask(row: TaskRow, historyLength?: number): A2aTask {
  const out = isRecord(row.output) ? row.output : {};
  const history = Array.isArray(row.history) ? (row.history as A2aMessage[]) : [];
  return {
    kind: 'task',
    id: row.id,
    contextId: row.context_id ?? row.id,
    status: {
      state: FROM_DB[row.state] ?? 'TASK_STATE_FAILED',
      ...(isRecord(out.statusMessage) ? { message: out.statusMessage as unknown as A2aMessage } : {}),
      timestamp: row.last_modified_at,
    },
    artifacts: Array.isArray(out.artifacts) ? (out.artifacts as A2aTask['artifacts']) : [],
    history: historyLength !== undefined ? history.slice(-historyLength) : history,
    metadata: { skill: row.skill },
  };
}

async function saveTask(
  db: Database,
  row: {
    id: string;
    workspaceId: string;
    clientId: string | null;
    userId: string | null;
    skill: string;
    contextId: string;
    state: TaskState;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    history: A2aMessage[];
  },
  isNew: boolean,
): Promise<TaskRow> {
  if (isNew) {
    return db
      .insertInto('agent_tasks')
      .values({
        id: row.id,
        workspace_id: row.workspaceId,
        client_id: row.clientId,
        user_id: row.userId,
        protocol: 'a2a',
        skill: row.skill,
        context_id: row.contextId,
        state: DB_STATE[row.state],
        input: JSON.stringify(row.input),
        output: JSON.stringify(row.output),
        history: JSON.stringify(row.history.slice(-50)),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  return db
    .updateTable('agent_tasks')
    .set({
      state: DB_STATE[row.state],
      input: JSON.stringify(row.input),
      output: JSON.stringify(row.output),
      history: JSON.stringify(row.history.slice(-50)),
      last_modified_at: new Date().toISOString(),
    })
    .where('id', '=', row.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

function canSee(row: TaskRow, env: AgentEnv, principal: AgentPrincipal | null): boolean {
  if (row.workspace_id !== env.workspace.id) return false;
  if (!row.user_id) return true; // anonymous (public-skill) tasks: the unguessable task id is the capability
  return Boolean(
    principal &&
    principal.userId === row.user_id &&
    (row.client_id === null || row.client_id === principal.clientId),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Skill execution
// ---------------------------------------------------------------------------------------------------------
interface Outcome {
  state: TaskState;
  text: string;
  data?: Record<string, unknown>;
  artifactName?: string;
  /** Merged into the task's stored input (multi-turn state). */
  input?: Record<string, unknown>;
  extraOutput?: Record<string, unknown>;
}

interface SkillCall {
  env: AgentEnv;
  ctx: ActionContext;
  principal: AgentPrincipal | null;
  text: string;
  data: Record<string, unknown>;
  prior: Record<string, unknown>;
}

const SEARCH_NOISE = new Set(
  'find search show list me any all grant grants opportunity opportunities funding fund funds for the a an in of to open available please what which are there i we looking look need our my is with about on'.split(
    ' ',
  ),
);

function keywords(text: string): string {
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => !SEARCH_NOISE.has(w) && w.length > 2,
  );
  return words.slice(0, 8).join(' or ');
}

async function capCall(c: SkillCall, name: string, input: unknown): Promise<InvokeResult> {
  const cap = findCapability(name);
  if (!cap) throw new DomainError('internal', `Capability ${name} is missing.`);
  if (
    c.principal &&
    c.ctx.scopes !== '*' &&
    !cap.scopes.every((s) => (c.ctx.scopes as readonly string[]).includes(s))
  ) {
    throw insufficientScope(c.env, 'a2a', cap.scopes, c.ctx.scopes as readonly string[]);
  }
  return invokeCapability(c.env, cap, input, c.ctx, c.principal);
}

async function publicOpportunityRows(env: AgentEnv, where: { id?: string; slug?: string } = {}) {
  return withRls(
    ANON_CLAIMS,
    (trx) => {
      let q = trx
        .selectFrom('opportunities')
        .select(['id', 'title', 'slug', 'status', 'description_md', 'eligibility_md', 'guidelines_md', 'faq'])
        .where('workspace_id', '=', env.workspace.id)
        .where('visibility', '=', 'public')
        .where('status', 'in', ['open', 'forecasted', 'closed']);
      if (where.id) q = q.where('id', '=', where.id);
      if (where.slug) q = q.where('slug', '=', where.slug);
      return q.execute();
    },
    env.runtime.db,
  );
}

async function findOpportunities(c: SkillCall): Promise<Outcome> {
  const query = typeof c.data.query === 'string' ? c.data.query : keywords(c.text);
  const status = typeof c.data.status === 'string' ? c.data.status : 'open';
  let r = await capCall(c, 'search_opportunities', { ...(query ? { query } : {}), status, limit: 10 });
  let out =
    r.status === 'ok'
      ? (r.output as { opportunities: unknown[]; total: number })
      : { opportunities: [], total: 0 };
  if (!out.total && query && typeof c.data.query !== 'string') {
    r = await capCall(c, 'search_opportunities', { status, limit: 10 });
    out = r.status === 'ok' ? (r.output as { opportunities: unknown[]; total: number }) : out;
  }
  return {
    state: 'TASK_STATE_COMPLETED',
    text: r.summary,
    data: out as unknown as Record<string, unknown>,
    artifactName: 'opportunities',
  };
}

async function resolveOpportunityId(c: SkillCall): Promise<string | { ask: Outcome }> {
  const given =
    (typeof c.data.opportunityId === 'string' && c.data.opportunityId) ||
    (typeof c.prior.opportunityId === 'string' && c.prior.opportunityId) ||
    null;
  if (given) return given;
  const slug = typeof c.data.slug === 'string' ? c.data.slug : null;
  const rows = await publicOpportunityRows(c.env, slug ? { slug } : {});
  const open = rows.filter((o) => o.status === 'open');
  const pool = slug ? rows : open;
  if (pool.length === 1) return pool[0]!.id;
  const byText = c.text ? pool.filter((o) => c.text.toLowerCase().includes(o.title.toLowerCase())) : [];
  if (byText.length === 1) return byText[0]!.id;
  return {
    ask: {
      state: 'TASK_STATE_INPUT_REQUIRED',
      text: 'Which opportunity? Reply with a data part {"opportunityId": "…"}.',
      data: {
        needed: ['opportunityId'],
        options: pool.map((o) => ({ opportunityId: o.id, title: o.title })),
      },
    },
  };
}

async function checkEligibility(c: SkillCall): Promise<Outcome> {
  const opp = await resolveOpportunityId(c);
  if (typeof opp !== 'string') return opp.ask;
  const answers = {
    ...(isRecord(c.prior.answers) ? c.prior.answers : {}),
    ...(isRecord(c.data.answers) ? c.data.answers : {}),
  };
  const r = await capCall(c, 'check_eligibility', { opportunityId: opp, answers });
  const out = (r.status === 'ok' ? r.output : {}) as {
    eligible: boolean | null;
    missing: { ruleId: string; question: string; kind: string; options?: string[] }[];
    outcomes: { question: string; passed: boolean | null; message?: string }[];
  };
  if (out.eligible === null) {
    return {
      state: 'TASK_STATE_INPUT_REQUIRED',
      text: `I need ${out.missing.length} more answer(s): ${out.missing.map((m) => `[${m.ruleId}] ${m.question}${m.options ? ` (options: ${m.options.join(', ')})` : ''}`).join(' ')} Reply on this task with a data part {"answers": {"<questionId>": <value>}}.`,
      data: { opportunityId: opp, missing: out.missing, answeredSoFar: Object.keys(answers) },
      input: { opportunityId: opp, answers },
    };
  }
  const failed = out.outcomes.filter((o) => o.passed === false);
  return {
    state: 'TASK_STATE_COMPLETED',
    text: out.eligible
      ? 'Eligible: every eligibility question passes.'
      : `Not eligible: ${failed.map((f) => f.message ?? f.question).join(' ')}`,
    data: { opportunityId: opp, ...out },
    artifactName: 'eligibility',
    input: { opportunityId: opp, answers },
  };
}

async function answerQuestion(c: SkillCall): Promise<Outcome> {
  const question = (typeof c.data.question === 'string' ? c.data.question : c.text).trim();
  if (!question)
    return {
      state: 'TASK_STATE_INPUT_REQUIRED',
      text: 'What would you like to know? Send the question as text.',
      data: { needed: ['question'] },
    };
  const id = typeof c.data.opportunityId === 'string' ? c.data.opportunityId : undefined;
  const slug = typeof c.data.slug === 'string' ? c.data.slug : undefined;
  const rows = await publicOpportunityRows(c.env, { id, slug });
  const top = rankPassages(rows.flatMap(passagesFor), question, 3);
  if (!top.length) {
    return {
      state: 'TASK_STATE_COMPLETED',
      text: 'The published guidelines and FAQ do not cover this. Contact the foundation directly.',
      data: { question, citations: [], answeredBy: 'retrieval' },
      artifactName: 'answer',
    };
  }
  const citations = top.map((t, i) => ({
    n: i + 1,
    opportunityId: t.passage.opportunityId,
    opportunity: t.passage.opportunityTitle,
    source: t.passage.source,
    heading: t.passage.heading,
    url: `${opportunityUrl(c.env, t.passage.slug)}#${t.passage.source}`,
    quote: t.passage.text,
  }));
  const llm = c.env.runtime.adapters.llm;
  if (llm && llm.name !== 'fake-llm') {
    const context = citations
      .map((ct) => `[${ct.n}] (${ct.opportunity} — ${ct.source})\n${ct.quote}`)
      .join('\n\n');
    const r = await llm.complete({
      system:
        'You answer questions about a foundation’s grant opportunity using ONLY the numbered passages from its published guidelines and FAQ. Cite passages like [1]. If the passages do not answer the question, say so and suggest contacting the foundation. Never invent eligibility rules, amounts or dates.',
      messages: [{ role: 'user', content: `Question: ${question}\n\nPassages:\n${context}` }],
      maxTokens: 600,
    });
    return {
      state: 'TASK_STATE_COMPLETED',
      text: r.text,
      data: { question, answer: r.text, citations, answeredBy: 'llm' },
      artifactName: 'answer',
    };
  }
  const verbatim = citations
    .map((ct) => `[${ct.n}] ${ct.opportunity} (${ct.source}): “${ct.quote}” — ${ct.url}`)
    .join('\n');
  return {
    state: 'TASK_STATE_COMPLETED',
    text: `No language model is configured here, so these are the most relevant passages from the published guidelines and FAQ, quoted verbatim:\n${verbatim}`,
    data: { question, answer: null, citations, answeredBy: 'retrieval' },
    artifactName: 'answer',
  };
}

async function startApplication(c: SkillCall): Promise<Outcome> {
  let competitionId = typeof c.data.competitionId === 'string' ? c.data.competitionId : null;
  if (!competitionId) {
    const opp = await resolveOpportunityId(c);
    if (typeof opp !== 'string') return opp.ask;
    const form = await capCall(c, 'get_application_form', { opportunityId: opp });
    competitionId =
      form.status === 'ok' ? String((form.output as { competitionId: string }).competitionId) : null;
  }
  const r = await capCall(c, 'start_application', {
    competitionId,
    ...(typeof c.data.applicantOrgId === 'string' ? { applicantOrgId: c.data.applicantOrgId } : {}),
  });
  const out = r.status === 'ok' ? (r.output as { result?: unknown } & Record<string, unknown>) : {};
  return {
    state: 'TASK_STATE_COMPLETED',
    text: `${r.summary} Next: get the form (MCP get_application_form or GET /api/v1/applications/{id}/form), save answers, then request submission — the person confirms it.`,
    data: out,
    artifactName: 'application',
  };
}

async function applicationStatus(c: SkillCall): Promise<Outcome> {
  const r = await capCall(
    c,
    'get_status',
    typeof c.data.applicationId === 'string' ? { applicationId: c.data.applicationId } : {},
  );
  return {
    state: 'TASK_STATE_COMPLETED',
    text: r.summary,
    data: r.status === 'ok' ? (r.output as Record<string, unknown>) : {},
    artifactName: 'status',
  };
}

function approvalOutcome(r: Extract<InvokeResult, { status: 'approval_required' }>): Outcome {
  return {
    state: 'TASK_STATE_AUTH_REQUIRED',
    text: `${r.summary}`,
    data: {
      status: 'approval_required',
      approvalRequestId: r.approvalRequestId,
      confirmUrl: r.confirmUrl,
      expiresAt: r.expiresAt,
      preview: r.preview,
    },
    extraOutput: { approvalRequestId: r.approvalRequestId, confirmUrl: r.confirmUrl },
  };
}

async function submitReport(c: SkillCall): Promise<Outcome> {
  const input = { ...c.prior, ...c.data } as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof input.requirementId !== 'string') missing.push('requirementId');
  const att = isRecord(input.attestation) ? input.attestation : null;
  if (!att || typeof att.typedName !== 'string' || att.agreed !== true) missing.push('attestation');
  if (missing.length) {
    const reports = await capCall(c, 'list_reports', {}).catch(() => null);
    return {
      state: 'TASK_STATE_INPUT_REQUIRED',
      text: `To submit a report I need: ${missing.join(', ')}. Send a data part {"requirementId": "…", "attestation": {"typedName": "<the person's name>", "agreed": true}}.`,
      data: {
        needed: missing,
        reports: reports?.status === 'ok' ? (reports.output as { reports: unknown[] }).reports : [],
      },
      input,
    };
  }
  const r = await capCall(c, 'submit_report', { requirementId: input.requirementId, attestation: att });
  if (r.status === 'approval_required') return { ...approvalOutcome(r), input };
  return {
    state: 'TASK_STATE_COMPLETED',
    text: r.summary,
    data: r.output as Record<string, unknown>,
    artifactName: 'report',
    input,
  };
}

async function requestExtension(c: SkillCall): Promise<Outcome> {
  const input = { ...c.prior, ...c.data } as Record<string, unknown>;
  const details = isRecord(input.details) ? input.details : {};
  const payload = {
    awardId: input.awardId,
    kind: typeof input.kind === 'string' ? input.kind : 'extension',
    ...(typeof input.requirementId === 'string' ? { requirementId: input.requirementId } : {}),
    reason: input.reason ?? (c.text || undefined),
    details: {
      ...details,
      ...(typeof input.newDueDate === 'string' ? { newDueDate: input.newDueDate } : {}),
    },
  };
  try {
    const r = await capCall(c, 'awards_request_change', payload);
    if (r.status === 'approval_required') return { ...approvalOutcome(r), input };
    return {
      state: 'TASK_STATE_COMPLETED',
      text: 'Sent. Foundation staff will decide and the person will be notified.',
      data: r.output as Record<string, unknown>,
      artifactName: 'change_request',
      input,
    };
  } catch (err) {
    if (isDomainError(err) && err.code === 'validation_failed') {
      return {
        state: 'TASK_STATE_INPUT_REQUIRED',
        text: `${err.message} ${err.issues.map((i) => `${i.pointer}: ${i.message}`).join('; ')}`,
        data: { errors: err.issues },
        input,
      };
    }
    throw err;
  }
}

const RUNNERS: Record<string, (c: SkillCall) => Promise<Outcome>> = {
  find_opportunities: findOpportunities,
  check_eligibility: checkEligibility,
  answer_opportunity_question: answerQuestion,
  start_application: startApplication,
  application_status: applicationStatus,
  submit_report: submitReport,
  request_extension: requestExtension,
};

function inferSkill(text: string, data: Record<string, unknown>): string {
  if (data.requirementId || data.attestation) return 'submit_report';
  if (data.answers || /eligib/i.test(text)) return 'check_eligibility';
  if (data.question || /\?\s*$/.test(text)) return 'answer_opportunity_question';
  if (/\bstatus\b/i.test(text)) return 'application_status';
  if (/\bextension\b|more time/i.test(text)) return 'request_extension';
  if (/\breport\b/i.test(text)) return 'submit_report';
  if (/\b(start|begin)\b.*\bapplication\b/i.test(text)) return 'start_application';
  return 'find_opportunities';
}

// ---------------------------------------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------------------------------------
type Id = string | number | null;
const A2A_ERR = {
  taskNotFound: -32001,
  notCancelable: -32002,
  pushNotSupported: -32003,
  unsupported: -32004,
  authRequired: -32040,
} as const;

function rpcResult(id: Id, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id: Id, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function parseParts(raw: unknown): { text: string; data: Record<string, unknown> } {
  let text = '';
  let data: Record<string, unknown> = {};
  if (!Array.isArray(raw)) return { text, data };
  for (const p of raw) {
    if (!isRecord(p)) continue;
    if (typeof p.text === 'string') text += (text ? '\n' : '') + p.text;
    if (isRecord(p.data)) data = { ...data, ...p.data };
  }
  return { text: text.slice(0, 5000), data };
}

async function runMessage(
  env: AgentEnv,
  params: Record<string, unknown>,
  ctx: ActionContext,
  principal: AgentPrincipal | null,
): Promise<A2aTask> {
  const msg = isRecord(params.message) ? params.message : null;
  if (!msg) throw new DomainError('validation_failed', 'params.message is required.');
  const { text, data } = parseParts(msg.parts);
  const db = env.runtime.db;
  const userMsg: A2aMessage = {
    kind: 'message',
    messageId: typeof msg.messageId === 'string' ? msg.messageId.slice(0, 100) : randomUUID(),
    role: 'ROLE_USER',
    parts: [
      ...(text ? [{ kind: 'text' as const, text }] : []),
      ...(Object.keys(data).length ? [{ kind: 'data' as const, data }] : []),
    ],
  };

  let existing: TaskRow | undefined;
  if (typeof msg.taskId === 'string') {
    existing = await db
      .selectFrom('agent_tasks')
      .selectAll()
      .where('id', '=', msg.taskId)
      .where('protocol', '=', 'a2a')
      .executeTakeFirst();
    if (!existing || !canSee(existing, env, principal))
      throw new A2aRpcError(A2A_ERR.taskNotFound, 'Task not found.');
    if (TERMINAL.has(FROM_DB[existing.state] ?? 'TASK_STATE_FAILED'))
      throw new A2aRpcError(A2A_ERR.unsupported, 'This task is finished. Start a new task (omit taskId).');
  }
  const meta = isRecord(msg.metadata) ? msg.metadata : isRecord(params.metadata) ? params.metadata : {};
  const skillId =
    existing?.skill ??
    (typeof meta.skill === 'string'
      ? meta.skill
      : typeof data.skill === 'string'
        ? data.skill
        : inferSkill(text, data));
  const skill = SKILLS.find((s) => s.id === skillId);
  if (!skill) throw new A2aRpcError(A2A_ERR.unsupported, `Unknown skill "${skillId}". See the agent card.`);
  if (skill.authenticated && !principal) {
    const cap = skill.capability ? findCapability(skill.capability) : undefined;
    throw unauthorized(env, 'a2a', undefined, cap?.scopes as Scope[] | undefined);
  }

  const id = existing?.id ?? randomUUID();
  const contextId =
    existing?.context_id ?? (typeof msg.contextId === 'string' ? msg.contextId.slice(0, 100) : randomUUID());
  const prior = existing && isRecord(existing.input) ? existing.input : {};
  const history = [
    ...(existing && Array.isArray(existing.history) ? (existing.history as A2aMessage[]) : []),
    { ...userMsg, taskId: id, contextId },
  ];

  let outcome: Outcome;
  try {
    outcome = await RUNNERS[skill.id]!({ env, ctx, principal, text, data, prior });
  } catch (err) {
    if (err instanceof HttpError || err instanceof A2aRpcError) throw err;
    const p = toProblem(err);
    if (p.status >= 500) console.error('[a2a] skill failed', skill.id, (err as Error)?.message);
    const rejected = p.code === 'human_only' || p.code === 'forbidden';
    outcome = {
      state: rejected ? 'TASK_STATE_REJECTED' : 'TASK_STATE_FAILED',
      text: `${p.title}: ${p.detail}`,
      data: { problem: p },
    };
  }
  const parts: Part[] = [
    { kind: 'text', text: outcome.text },
    ...(outcome.data ? [{ kind: 'data' as const, data: outcome.data }] : []),
  ];
  const statusMessage = agentMessage(parts, { id, contextId });
  const previousOut = existing && isRecord(existing.output) ? existing.output : {};
  const artifacts =
    outcome.state === 'TASK_STATE_COMPLETED'
      ? [{ artifactId: randomUUID(), name: outcome.artifactName ?? 'result', parts }]
      : [];
  const row = await saveTask(
    db,
    {
      id,
      workspaceId: env.workspace.id,
      clientId: principal?.clientId ?? null,
      userId: principal?.userId ?? null,
      skill: skill.id,
      contextId,
      state: outcome.state,
      input: outcome.input ?? { ...prior, ...data },
      output: { ...previousOut, ...(outcome.extraOutput ?? {}), statusMessage, artifacts },
      history: [...history, statusMessage],
    },
    !existing,
  );
  return toTask(row);
}

/** Refreshes AUTH_REQUIRED tasks whose approval request a person has since decided. */
async function refreshApproval(env: AgentEnv, row: TaskRow): Promise<TaskRow> {
  if (
    row.state !== 'auth_required' ||
    !isRecord(row.output) ||
    typeof row.output.approvalRequestId !== 'string'
  )
    return row;
  const ar = await env.runtime.db
    .selectFrom('approval_requests')
    .select(['status', 'result'])
    .where('id', '=', row.output.approvalRequestId)
    .executeTakeFirst();
  if (!ar || ar.status === 'awaiting_confirmation') return row;
  const state: TaskState =
    ar.status === 'confirmed'
      ? 'TASK_STATE_COMPLETED'
      : ar.status === 'rejected'
        ? 'TASK_STATE_REJECTED'
        : 'TASK_STATE_FAILED';
  const text =
    ar.status === 'confirmed'
      ? 'The person confirmed it in GMS. Done.'
      : `The request was ${ar.status.replace(/_/g, ' ')}.`;
  const parts: Part[] = [
    { kind: 'text', text },
    { kind: 'data', data: { approvalStatus: ar.status, result: ar.result } },
  ];
  const statusMessage = agentMessage(parts, { id: row.id, contextId: row.context_id ?? row.id });
  return saveTask(
    env.runtime.db,
    {
      id: row.id,
      workspaceId: env.workspace.id,
      clientId: row.client_id,
      userId: row.user_id,
      skill: row.skill,
      contextId: row.context_id ?? row.id,
      state,
      input: isRecord(row.input) ? row.input : {},
      output: {
        ...row.output,
        statusMessage,
        artifacts:
          state === 'TASK_STATE_COMPLETED' ? [{ artifactId: randomUUID(), name: 'result', parts }] : [],
      },
      history: [...(Array.isArray(row.history) ? (row.history as A2aMessage[]) : []), statusMessage],
    },
    false,
  );
}

class A2aRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const METHOD_ALIASES: Record<string, string> = {
  SendMessage: 'message/send',
  SendStreamingMessage: 'message/stream',
  GetTask: 'tasks/get',
  CancelTask: 'tasks/cancel',
  GetExtendedAgentCard: 'agent/getAuthenticatedExtendedCard',
  'agent/getExtendedAgentCard': 'agent/getAuthenticatedExtendedCard',
};

/** POST /a2a */
export async function handleA2a(req: Request, env: AgentEnv): Promise<Response> {
  const instance = resourceUrl(env, 'a2a');
  let id: Id = null;
  let headers: Record<string, string> = {};
  try {
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
    if (!(await channelEnabled(env, 'a2a'))) throw channelDisabled(env, 'a2a');
    const auth = await authenticate(req, env, 'a2a', { channel: 'a2a' });
    headers = rateLimitHeaders(auth.rate);
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400, headers });
    }
    if (!isRecord(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string')
      return Response.json(rpcError(null, -32600, 'Invalid JSON-RPC request.'), { status: 400, headers });
    id = typeof body.id === 'string' || typeof body.id === 'number' ? body.id : null;
    const method = METHOD_ALIASES[body.method] ?? body.method;
    const params = isRecord(body.params) ? body.params : {};
    const stream = method === 'message/stream';
    let result: unknown;
    try {
      switch (method) {
        case 'message/send':
        case 'message/stream':
          result = await runMessage(env, params, auth.ctx, auth.principal);
          break;
        case 'tasks/get': {
          const taskId =
            typeof params.id === 'string'
              ? params.id
              : typeof params.name === 'string'
                ? params.name.replace(/^tasks\//, '')
                : '';
          const row = /^[0-9a-f-]{36}$/i.test(taskId)
            ? await env.runtime.db
                .selectFrom('agent_tasks')
                .selectAll()
                .where('id', '=', taskId)
                .where('protocol', '=', 'a2a')
                .executeTakeFirst()
            : undefined;
          if (!row || !canSee(row, env, auth.principal))
            throw new A2aRpcError(A2A_ERR.taskNotFound, 'Task not found.');
          const fresh = await refreshApproval(env, row);
          result = toTask(fresh, typeof params.historyLength === 'number' ? params.historyLength : undefined);
          break;
        }
        case 'tasks/cancel': {
          const taskId = typeof params.id === 'string' ? params.id : '';
          const row = /^[0-9a-f-]{36}$/i.test(taskId)
            ? await env.runtime.db
                .selectFrom('agent_tasks')
                .selectAll()
                .where('id', '=', taskId)
                .where('protocol', '=', 'a2a')
                .executeTakeFirst()
            : undefined;
          if (!row || !canSee(row, env, auth.principal))
            throw new A2aRpcError(A2A_ERR.taskNotFound, 'Task not found.');
          if (TERMINAL.has(FROM_DB[row.state] ?? 'TASK_STATE_FAILED'))
            throw new A2aRpcError(A2A_ERR.notCancelable, 'This task already finished.');
          const updated = await env.runtime.db
            .updateTable('agent_tasks')
            .set({ state: 'canceled', last_modified_at: new Date().toISOString() })
            .where('id', '=', row.id)
            .returningAll()
            .executeTakeFirstOrThrow();
          result = toTask(updated);
          break;
        }
        case 'agent/getAuthenticatedExtendedCard':
          if (!auth.principal) throw unauthorized(env, 'a2a');
          result = agentCard(env, { extended: true });
          break;
        case 'tasks/pushNotificationConfig/set':
        case 'tasks/pushNotificationConfig/get':
          throw new A2aRpcError(
            A2A_ERR.pushNotSupported,
            'Push notifications are not supported. Poll tasks/get.',
          );
        case 'tasks/resubscribe':
          throw new A2aRpcError(A2A_ERR.unsupported, 'Resubscribe is not supported. Poll tasks/get.');
        default:
          return Response.json(rpcError(id, -32601, `Method not found: ${body.method}`), { headers });
      }
    } catch (err) {
      if (err instanceof A2aRpcError) return Response.json(rpcError(id, err.code, err.message), { headers });
      if (err instanceof HttpError) throw err;
      if (isDomainError(err)) {
        if (err.code === 'unauthenticated') throw unauthorized(env, 'a2a');
        return Response.json(rpcError(id, -32602, err.message, toProblem(err)), { headers });
      }
      throw err;
    }
    const payload = rpcResult(id, result);
    if (stream) {
      return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
        status: 200,
        headers: { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      });
    }
    return Response.json(payload, { headers });
  } catch (err) {
    if (err instanceof HttpError) {
      const code = err.status === 401 ? A2A_ERR.authRequired : -32603;
      return Response.json(rpcError(id, code, err.message, err.problem(instance)), {
        status: err.status,
        headers: { ...headers, ...err.headers },
      });
    }
    return errorResponse(err, instance, headers);
  }
}
