// SPDX-License-Identifier: AGPL-3.0-only
// The funder's money and compliance routes: payment schedules and tranches, the Payments center,
// requirements and received reports, budgets, the grantee directory, analytics and exports, and the
// integrations admin. Shapes come from the generated schema; the HTTP implementation here and the
// mock in mocks/funderMoney.ts answer the same interface, and test/funderMoney-contract.test.ts
// holds both to the real Worker.
//
// Nothing here carries bank or identity data: a destination is a bank name and the last four
// digits, and a disbursed amount is always the figure last read from Passport.
import type { components } from "./schema.d.ts";
import type { FunderHttpIo } from "./funder.ts";

type S = components["schemas"];
export type Tranche = S["Models.PaymentTranche"];
export type TrancheRow = S["Models.TrancheListItem"];
export type Schedule = S["Models.PaymentSchedule"];
export type ScheduleLine = S["Models.ScheduleLine"];
export type TrancheReadiness = S["Models.TrancheReadinessView"];
export type PaymentCheck = S["Models.PaymentReadinessCheck"];
export type PaymentBanner = S["Models.PaymentBanner"];
export type PaymentsCenter = S["Models.PaymentsCenter"];
export type PaymentsCenterItem = PaymentsCenter["items"][number];
export type PaymentAlert = S["Models.PaymentAlertView"];
export type ReleaseResult = S["Models.ReleaseResult"];
export type ExternalPaymentInput = S["Models.ExternalPaymentInput"];
export type ExternalPaymentResult = S["Models.ExternalPaymentResult"];
export type BankTransaction = S["Models.BankTransactionView"];
export type BankMatchResult = S["Models.BankMatchResult"];
export type Requirement = S["Models.RequirementView"];
export type RequirementInput = S["Models.RequirementCreate"];
export type Submission = S["Models.SubmissionView"];
export type BudgetBook = S["Models.BudgetBook"];
export type BudgetView = S["Models.BudgetView"];
export type BudgetLine = S["Models.BudgetLineView"];
export type BudgetPut = S["Models.BudgetPut"];
export type BudgetVariance = S["Models.BudgetVariance"];
export type GranteeSummary = S["Models.GranteeSummary"];
export type GranteeDetail = S["Models.GranteeDetail"];
export type OrgChange = S["Models.OrgChangeView"];
export type ProposeChangeResult = S["Models.ProposeChangeResult"];
export type Portfolio = S["Models.PortfolioView"];
export type CycleReport = S["Models.CycleReport"];
export type GrantList990 = S["Models.GrantList990"];
export type BundleExport = S["Models.BundleExport"];
export type CsvImportResult = S["Models.CsvImportResult"];
export type Webhook = S["Models.WebhookView"];
export type WebhookCreated = S["Models.WebhookCreated"];
export type WebhookDelivery = S["Models.WebhookDeliveryView"];
export type ApiClient = S["Models.ApiClientView"];
export type ApiClientIssued = S["Models.ApiClientIssued"];
export type McpConnection = S["Models.McpConnectionView"];
export type McpServer = S["Models.McpServerView"];
export type McpServerRegistered = S["Models.McpServerRegistered"];
export type RemoteTool = S["Models.RemoteToolView"];
export type Connector = S["Models.ConnectorView"];
export type ConnectorProvider = Connector["provider"];

/** What a tranche waits on before it becomes due. */
export type TrancheCondition = { type: "onExecution" } | { type: "onReportAccepted"; requirementId: string } | { type: "onDate"; date: string } | { type: "manual" };

export interface SectionAssignments {
  formId: string;
  stage: string;
  /** Section id → the member's user id. */
  sections: Record<string, string>;
}

/** One entry of the workspace's append-only audit ledger. */
export interface LedgerEvent {
  id: string;
  actor: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  data: Record<string, unknown>;
  occurredAt: string;
}
export interface LedgerFilter {
  subjectType?: string;
  eventType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export type TrancheView = "due" | "in-flight" | "done" | "upcoming";

export interface FunderMoneyApi {
  // ---- schedules and tranches ----
  getSchedule(awardId: string): Promise<Schedule>;
  putSchedule(awardId: string, tranches: { amountMinor: number; condition: TrancheCondition }[]): Promise<Schedule>;
  listTranches(filter?: { view?: TrancheView; status?: string; awardId?: string }): Promise<TrancheRow[]>;
  trancheReadiness(trancheId: string): Promise<TrancheReadiness>;
  /** Facilitated release through Passport. A person only; the tranche id is the idempotency key. */
  releaseTranche(trancheId: string, input?: { rail?: "auto" | "standard" | "instant"; confirmDuplicate?: boolean }): Promise<ReleaseResult>;
  recordExternalPayment(trancheId: string, input: ExternalPaymentInput): Promise<ExternalPaymentResult>;
  holdTranche(trancheId: string, reason: string): Promise<Tranche>;
  releaseHold(trancheId: string): Promise<Tranche>;
  cancelTranche(trancheId: string, reason: string): Promise<Tranche>;

  // ---- payments center ----
  paymentsReadiness(): Promise<PaymentsCenter>;
  paymentAlerts(): Promise<PaymentAlert[]>;
  listBankTransactions(filter?: { matched?: boolean }): Promise<BankTransaction[]>;
  matchBankTransaction(transactionId: string, input: { trancheId: string; destinationLast4: string }): Promise<BankMatchResult>;

  // ---- requirements and received reports ----
  listRequirements(awardId: string): Promise<Requirement[]>;
  createRequirement(awardId: string, input: RequirementInput): Promise<Requirement>;
  updateRequirement(id: string, patch: Partial<RequirementInput>): Promise<Requirement>;
  listDueRequirements(status?: string): Promise<Requirement[]>;
  waiveRequirement(id: string, reason: string): Promise<Requirement>;
  remindRequirement(id: string): Promise<{ sent: boolean }>;
  listSubmissions(filter?: { status?: string; shared?: boolean }): Promise<Submission[]>;
  getSubmission(id: string): Promise<Submission>;
  /** Accepting a report can make a tranche due; the answer names it. */
  acceptSubmission(id: string, note?: string): Promise<Submission>;
  returnSubmission(id: string, note: string): Promise<Submission>;

  // ---- budgets ----
  getBudget(awardId: string): Promise<BudgetBook>;
  /** The funder sets the approved budget; actuals are reported by the grantee. Answers the saved budget. */
  putBudget(awardId: string, input: BudgetPut): Promise<BudgetView>;
  getVariance(awardId: string): Promise<BudgetVariance>;

  // ---- grantees and organization changes ----
  listGrantees(filter?: { q?: string; tag?: string }): Promise<GranteeSummary[]>;
  getGrantee(workspaceId: string): Promise<GranteeDetail>;
  updateGrantee(workspaceId: string, patch: { tags?: string[]; notes?: string | null; ownerUserId?: string | null }): Promise<GranteeDetail>;
  proposeOrgChange(workspaceId: string, input: { patch: Record<string, unknown>; note?: string }): Promise<ProposeChangeResult>;
  listOrgChanges(status?: "pending" | "accepted" | "dismissed"): Promise<OrgChange[]>;
  acceptOrgChange(id: string): Promise<OrgChange>;
  dismissOrgChange(id: string): Promise<OrgChange>;

  // ---- analytics, exports, imports ----
  portfolio(fiscalYear?: number): Promise<Portfolio>;
  cycleReport(competitionId: string): Promise<CycleReport>;
  grantList990(year: number): Promise<GrantList990>;
  grantList990Csv(year: number): Promise<Blob>;
  exportBundle(): Promise<BundleExport>;
  importAwardsCsv(input: { csv: string; mapping: Record<string, string>; dryRun?: boolean }): Promise<CsvImportResult>;

  // ---- integrations admin ----
  listWebhooks(): Promise<Webhook[]>;
  /** The signing secret is in the answer once and never again. */
  createWebhook(input: { url: string; events?: string[] }): Promise<WebhookCreated>;
  deleteWebhook(id: string): Promise<void>;
  listWebhookDeliveries(id: string): Promise<WebhookDelivery[]>;
  listApiClients(): Promise<ApiClient[]>;
  /** The client secret is in the answer once and never again. */
  createApiClient(input: { name: string; scopes: string[] }): Promise<ApiClientIssued>;
  revokeApiClient(id: string): Promise<void>;
  listMcpConnections(): Promise<McpConnection[]>;
  revokeMcpConnection(id: string): Promise<void>;
  listMcpServers(): Promise<McpServer[]>;
  registerMcpServer(input: { name: string; url: string; authHeader?: string }): Promise<McpServerRegistered>;
  listMcpServerTools(id: string): Promise<RemoteTool[]>;
  updateMcpServer(id: string, allowedTools: string[]): Promise<McpServer>;
  removeMcpServer(id: string): Promise<void>;
  getConnector(provider: ConnectorProvider): Promise<Connector>;
  connectConnector(provider: ConnectorProvider, token?: string): Promise<Connector>;
  disconnectConnector(provider: ConnectorProvider): Promise<Connector>;
  syncConnector(provider: ConnectorProvider): Promise<Connector>;
  listLedger(filter?: LedgerFilter): Promise<{ items: LedgerEvent[]; total: number }>;
  /** Change a member's role. Admins only; a person only. */
  updateMemberRole(workspaceId: string, userId: string, role: string): Promise<{ userId: string; role: string }>;

  // ---- application detail extras ----
  applicationSections(applicationId: string): Promise<SectionAssignments[]>;
}

type Json = { data?: unknown; items?: unknown[]; paginationInfo?: { totalItems?: number }; message?: string; errors?: unknown[] };

export function createHttpFunderMoneyApi(io: FunderHttpIo): FunderMoneyApi {
  const e = encodeURIComponent;
  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await io.token();
    const ws = io.workspaceId();
    const res = await (io.fetch ?? fetch)(`${io.baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ws ? { "X-GMS-Workspace": ws } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as Json;
      throw io.fail(res.status, j.message ?? `Request failed (${res.status})`, j.errors ?? []);
    }
    return res;
  }
  const raw = async (method: string, path: string, body?: unknown) => (await (await send(method, path, body)).json()) as Json;
  const data = async <T>(method: string, path: string, body?: unknown) => (await raw(method, path, body)).data as T;
  const items = async <T>(path: string) => ((await raw("GET", path)).items ?? []) as T[];
  const nothing = async (method: string, path: string) => {
    await send(method, path);
  };
  const q = (params: object) => {
    const pairs = Object.entries(params).filter((p): p is [string, string | number | boolean] => p[1] !== undefined && p[1] !== "");
    return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${e(v)}`).join("&")}` : "";
  };

  return {
    getSchedule: (awardId) => data("GET", `/gms/awards/${e(awardId)}/schedule`),
    putSchedule: (awardId, tranches) => data("PUT", `/gms/awards/${e(awardId)}/schedule`, { tranches }),
    listTranches: (filter = {}) => items(`/gms/tranches${q({ pageSize: 100, ...filter })}`),
    trancheReadiness: (id) => data("GET", `/gms/tranches/${e(id)}/readiness`),
    releaseTranche: (id, input = {}) => data("POST", `/gms/tranches/${e(id)}/release`, input),
    recordExternalPayment: (id, input) => data("POST", `/gms/tranches/${e(id)}/record-external`, input),
    holdTranche: (id, reason) => data("POST", `/gms/tranches/${e(id)}/hold`, { reason }),
    releaseHold: (id) => data("POST", `/gms/tranches/${e(id)}/release-hold`, {}),
    cancelTranche: (id, reason) => data("POST", `/gms/tranches/${e(id)}/cancel`, { reason }),

    paymentsReadiness: () => data("GET", "/gms/payments/readiness"),
    paymentAlerts: () => data("GET", "/gms/payments/alerts"),
    listBankTransactions: (filter = {}) => items(`/gms/bank-transactions${q({ pageSize: 100, ...filter })}`),
    matchBankTransaction: (id, input) => data("POST", `/gms/bank-transactions/${e(id)}/match`, input),

    listRequirements: (awardId) => data("GET", `/gms/awards/${e(awardId)}/requirements`),
    createRequirement: (awardId, input) => data("POST", `/gms/awards/${e(awardId)}/requirements`, input),
    updateRequirement: (id, patch) => data("PATCH", `/gms/requirements/${e(id)}`, patch),
    listDueRequirements: (status) => items(`/gms/requirements/due${q({ pageSize: 100, status })}`),
    waiveRequirement: (id, reason) => data("POST", `/gms/requirements/${e(id)}/waive`, { reason }),
    remindRequirement: (id) => data("POST", `/gms/requirements/${e(id)}/remind`, {}),
    listSubmissions: (filter = {}) => items(`/gms/submissions${q({ pageSize: 100, ...filter })}`),
    getSubmission: (id) => data("GET", `/gms/submissions/${e(id)}`),
    acceptSubmission: (id, note) => data("POST", `/gms/submissions/${e(id)}/accept`, note ? { note } : {}),
    returnSubmission: (id, note) => data("POST", `/gms/submissions/${e(id)}/return`, { note }),

    getBudget: (awardId) => data("GET", `/gms/awards/${e(awardId)}/budget`),
    putBudget: (awardId, input) => data("PUT", `/gms/awards/${e(awardId)}/budget`, input),
    getVariance: (awardId) => data("GET", `/gms/awards/${e(awardId)}/variance`),

    listGrantees: (filter = {}) => items(`/gms/grantees${q({ pageSize: 100, ...filter })}`),
    getGrantee: (id) => data("GET", `/gms/grantees/${e(id)}`),
    updateGrantee: (id, patch) => data("PATCH", `/gms/grantees/${e(id)}`, patch),
    proposeOrgChange: (id, input) => data("POST", `/gms/grantees/${e(id)}/propose-change`, input),
    listOrgChanges: (status) => items(`/gms/org-changes${q({ pageSize: 100, status })}`),
    acceptOrgChange: (id) => data("POST", `/gms/org-changes/${e(id)}/accept`, {}),
    dismissOrgChange: (id) => data("POST", `/gms/org-changes/${e(id)}/dismiss`, {}),

    portfolio: (fiscalYear) => data("GET", `/gms/analytics/portfolio${q({ fy: fiscalYear })}`),
    cycleReport: (competitionId) => data("GET", `/gms/analytics/cycle/${e(competitionId)}`),
    grantList990: (year) => data("GET", `/gms/exports/990pf${q({ year })}`),
    grantList990Csv: async (year) => (await send("GET", `/gms/exports/990pf${q({ year, format: "csv" })}`)).blob(),
    exportBundle: () => data("POST", "/gms/exports/bundle", {}),
    importAwardsCsv: (input) => data("POST", "/gms/imports/csv", input),

    listWebhooks: () => data("GET", "/gms/webhooks"),
    createWebhook: (input) => data("POST", "/gms/webhooks", input),
    deleteWebhook: (id) => nothing("DELETE", `/gms/webhooks/${e(id)}`),
    listWebhookDeliveries: (id) => data("GET", `/gms/webhooks/${e(id)}/deliveries`),
    listApiClients: () => data("GET", "/gms/api-clients"),
    createApiClient: (input) => data("POST", "/gms/api-clients", input),
    revokeApiClient: (id) => nothing("DELETE", `/gms/api-clients/${e(id)}`),
    listMcpConnections: () => data("GET", "/gms/mcp-connections"),
    revokeMcpConnection: (id) => nothing("DELETE", `/gms/mcp-connections/${e(id)}`),
    listMcpServers: () => data("GET", "/gms/custom-mcp-servers"),
    registerMcpServer: (input) => data("POST", "/gms/custom-mcp-servers", input),
    listMcpServerTools: (id) => data("GET", `/gms/custom-mcp-servers/${e(id)}/tools`),
    updateMcpServer: (id, allowedTools) => data("PATCH", `/gms/custom-mcp-servers/${e(id)}`, { allowedTools }),
    removeMcpServer: (id) => nothing("DELETE", `/gms/custom-mcp-servers/${e(id)}`),
    getConnector: (provider) => data("GET", `/gms/connectors/${e(provider)}`),
    connectConnector: (provider, token) => data("POST", `/gms/connectors/${e(provider)}`, token ? { token } : {}),
    disconnectConnector: (provider) => data("DELETE", `/gms/connectors/${e(provider)}`),
    syncConnector: (provider) => data("POST", `/gms/connectors/${e(provider)}/sync`, {}),
    async listLedger(filter = {}) {
      const j = await raw("GET", `/gms/ledger${q({ pageSize: 50, ...filter })}`);
      return { items: (j.items ?? []) as LedgerEvent[], total: j.paginationInfo?.totalItems ?? j.items?.length ?? 0 };
    },

    updateMemberRole: (workspaceId, userId, role) => data("PATCH", `/gms/workspaces/${e(workspaceId)}/members/${e(userId)}`, { role }),
    applicationSections: (applicationId) => data("GET", `/gms/applications/${e(applicationId)}/sections`),
  };
}
