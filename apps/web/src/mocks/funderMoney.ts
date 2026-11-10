// SPDX-License-Identifier: AGPL-3.0-only
// Mock implementation of the funder's money and compliance routes (api/funderMoney.ts). The seed
// is Riverbend's FY2027 portfolio from the design canvas: Alder Creek's first tranche is ready,
// Harbor Light's second is blocked by a pending destination change, Copper Valley dropped below
// L3, Lakeside is in flight, and Northgate's interim report is overdue.
//
// It follows the Worker's rules where a screen depends on them: readiness is computed from the
// recipient's facts and never collapses "unknown" into pass or fail, a release is refused unless
// every check passes, accepting a report makes its tranche due, and a destination is only ever a
// bank name and the last four digits.
import type {
  ApiClient,
  BankTransaction,
  BudgetBook,
  BudgetLine,
  Connector,
  ConnectorProvider,
  FunderMoneyApi,
  GranteeDetail,
  GranteeSummary,
  LedgerEvent,
  McpConnection,
  McpServer,
  OrgChange,
  PaymentAlert,
  PaymentBanner,
  PaymentCheck,
  RemoteTool,
  Requirement,
  Submission,
  Tranche,
  TrancheCondition,
  TrancheReadiness,
  TrancheRow,
  Webhook,
  WebhookDelivery,
} from "../api/funderMoney.ts";
import { MOCK_IDS, USERS, type MockFunderCtx } from "./funder.ts";
import { IDS } from "./store.ts";

const id = (prefix: string, block: string, n: number) => `${prefix}_${block}0000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const bare = (block: string, n: number) => `${block}0000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const at = (local: string) => `${local.length === 10 ? `${local}T17:00` : local}:00Z`;
const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.parse(iso));

export const MONEY_IDS = {
  awardAlder: MOCK_IDS.award,
  awardHarbor: id("awd", "b", 2),
  awardLakeside: id("awd", "b", 3),
  awardNorthgate: id("awd", "b", 4),
  awardCopper: id("awd", "b", 5),
  alderT1: id("trn", "1", 1),
  alderT2: id("trn", "1", 2),
  alderT3: id("trn", "1", 3),
  harborT1: id("trn", "1", 4),
  harborT2: id("trn", "1", 5),
  lakesideT1: id("trn", "1", 6),
  northgateT1: id("trn", "1", 7),
  northgateT2: id("trn", "1", 8),
  copperT1: id("trn", "1", 9),
  reqAlderInterim: id("req", "2", 1),
  reqAlderFinal: id("req", "2", 2),
  reqNorthgateInterim: id("req", "2", 3),
  reqHarborFinal: id("req", "2", 4),
  subAlderInterim: id("sub", "3", 1),
  subHarborFinal: id("sub", "3", 2),
  subShared: id("sub", "3", 3),
  wsAlder: bare("2", 11),
  wsHarbor: bare("2", 12),
  wsLakeside: bare("2", 13),
  wsNorthgate: bare("2", 14),
  wsCopper: bare("2", 15),
  orgChange: bare("4", 1),
  bankTxn: bare("5", 1),
} as const;

interface Recipient {
  workspaceId: string;
  name: string;
  handle: string;
  level: "L0" | "L1" | "L2" | "L3";
  bankName: string;
  last4: string;
  /** A destination change in its cooling-off window at Passport, with the date it clears. */
  pendingChangeUntil: string | null;
  active: boolean;
  consent: boolean;
  tags: string[];
  notes: string | null;
  ein: string;
  city: string;
}
interface MockAward {
  id: string;
  title: string;
  recipient: string;
  awardedMinor: number;
  disbursedMinor: number;
  programId: string;
  programName: string;
  agreementExecuted: boolean;
}
interface State {
  recipients: Recipient[];
  awards: MockAward[];
  tranches: Tranche[];
  requirements: Requirement[];
  submissions: Submission[];
  budgets: Map<string, BudgetBook>;
  orgChanges: OrgChange[];
  bank: BankTransaction[];
  webhooks: (Webhook & { deliveries: WebhookDelivery[] })[];
  apiClients: ApiClient[];
  connections: McpConnection[];
  servers: (McpServer & { tools: RemoteTool[] })[];
  connectors: Record<ConnectorProvider, Connector>;
  ledger: LedgerEvent[];
  passportReachable: boolean;
  disbursedAsOf: string | null;
  seq: number;
}

/** What a test (or a demo) can do to the mock that only Passport does in production. */
export type PassportSimulation =
  | { type: "disbursement.settled"; trancheId: string }
  | { type: "payee.destination.changed"; workspaceId: string }
  | { type: "passport.unreachable"; unreachable: boolean };
export interface MockMoneyControls {
  simulatePassport(event: PassportSimulation): Promise<void>;
}

function tranche(idv: string, awardId: string, seq: number, dollars: number, condition: TrancheCondition, status: Tranche["status"], more: Partial<Tranche> = {}): Tranche {
  return { id: idv, awardId, seq, amountMinor: dollars * 100, currency: "USD", condition, status, dueAt: null, holdReason: null, mode: null, passportDisbursementId: null, passportStatus: null, releasedAt: null, releasedBy: null, external: null, ...more };
}

function seed(): State {
  const recipients: Recipient[] = [
    { workspaceId: MONEY_IDS.wsAlder, name: "Alder Creek Family Services", handle: "alder-creek", level: "L3", bankName: "River City Credit Union", last4: "4821", pendingChangeUntil: null, active: true, consent: true, tags: ["rural health", "returning grantee"], notes: "Strong evaluation practice. Ask about the van route expansion at the fall site visit.", ein: "00-1234567", city: "Alder Creek, OR" },
    { workspaceId: MONEY_IDS.wsHarbor, name: "Harbor Light Shelter", handle: "harbor-light", level: "L3", bankName: "Harbor Community Bank", last4: "7730", pendingChangeUntil: at("2027-06-03"), active: true, consent: true, tags: ["housing"], notes: null, ein: "00-2345678", city: "Port Marlow, OR" },
    { workspaceId: MONEY_IDS.wsLakeside, name: "Lakeside Senior Center", handle: "lakeside-senior", level: "L3", bankName: "Lakeside Savings", last4: "1164", pendingChangeUntil: null, active: true, consent: true, tags: [], notes: null, ein: "00-3456789", city: "Lakeside, OR" },
    { workspaceId: MONEY_IDS.wsNorthgate, name: "Northgate Housing Trust", handle: "northgate-housing", level: "L3", bankName: "First Northgate", last4: "9052", pendingChangeUntil: null, active: true, consent: false, tags: ["housing"], notes: null, ein: "00-4567890", city: "Northgate, OR" },
    { workspaceId: MONEY_IDS.wsCopper, name: "Copper Valley Clinic", handle: "copper-valley", level: "L1", bankName: "Copper Valley Bank", last4: "3308", pendingChangeUntil: null, active: true, consent: true, tags: ["rural health"], notes: null, ein: "00-5678901", city: "Copper Valley, OR" },
  ];
  const health = { programId: IDS.programHealth27, programName: "Community Health 2027" };
  const awards: MockAward[] = [
    { id: MONEY_IDS.awardAlder, title: "Mobile Health Navigation for Rural Families", recipient: MONEY_IDS.wsAlder, awardedMinor: 15_000_000, disbursedMinor: 0, ...health, agreementExecuted: true },
    { id: MONEY_IDS.awardHarbor, title: "Winter Shelter Capacity", recipient: MONEY_IDS.wsHarbor, awardedMinor: 7_600_000, disbursedMinor: 3_800_000, programId: IDS.programHealth26, programName: "Community Health 2026", agreementExecuted: true },
    { id: MONEY_IDS.awardLakeside, title: "Senior Nutrition Outreach", recipient: MONEY_IDS.wsLakeside, awardedMinor: 8_000_000, disbursedMinor: 0, ...health, agreementExecuted: true },
    { id: MONEY_IDS.awardNorthgate, title: "Tenant Stability Counseling", recipient: MONEY_IDS.wsNorthgate, awardedMinor: 9_000_000, disbursedMinor: 4_500_000, programId: IDS.programHealth26, programName: "Community Health 2026", agreementExecuted: true },
    { id: MONEY_IDS.awardCopper, title: "Telehealth Room Expansion", recipient: MONEY_IDS.wsCopper, awardedMinor: 6_000_000, disbursedMinor: 0, ...health, agreementExecuted: true },
  ];
  const tranches: Tranche[] = [
    tranche(MONEY_IDS.alderT1, MONEY_IDS.awardAlder, 1, 75_000, { type: "onExecution" }, "due", { dueAt: at("2027-05-24") }),
    tranche(MONEY_IDS.alderT2, MONEY_IDS.awardAlder, 2, 60_000, { type: "onReportAccepted", requirementId: MONEY_IDS.reqAlderInterim }, "scheduled"),
    tranche(MONEY_IDS.alderT3, MONEY_IDS.awardAlder, 3, 15_000, { type: "onReportAccepted", requirementId: MONEY_IDS.reqAlderFinal }, "scheduled"),
    tranche(MONEY_IDS.harborT1, MONEY_IDS.awardHarbor, 1, 38_000, { type: "onExecution" }, "settled", { dueAt: at("2026-09-01"), mode: "facilitated", passportDisbursementId: "dsb_mock_harbor_1", passportStatus: "settled", releasedAt: at("2026-09-02"), releasedBy: USERS.marcus }),
    tranche(MONEY_IDS.harborT2, MONEY_IDS.awardHarbor, 2, 38_000, { type: "onDate", date: "2027-05-15" }, "held", { dueAt: at("2027-05-15"), holdReason: "destination_change_in_flight" }),
    tranche(MONEY_IDS.lakesideT1, MONEY_IDS.awardLakeside, 1, 40_000, { type: "onExecution" }, "initiated", { dueAt: at("2027-05-17"), mode: "facilitated", passportDisbursementId: "dsb_mock_lakeside_1", passportStatus: "initiated", releasedAt: at("2027-05-18T16:05"), releasedBy: USERS.marcus }),
    tranche(MONEY_IDS.northgateT1, MONEY_IDS.awardNorthgate, 1, 45_000, { type: "onExecution" }, "settled", { dueAt: at("2026-10-01"), mode: "resolve", passportStatus: "unverified", releasedAt: at("2026-10-03"), releasedBy: USERS.marcus, external: { reference: "Wire 20261003-118", paidAt: "2026-10-03", destinationLast4: "9052" } }),
    tranche(MONEY_IDS.northgateT2, MONEY_IDS.awardNorthgate, 2, 45_000, { type: "onReportAccepted", requirementId: MONEY_IDS.reqNorthgateInterim }, "scheduled"),
    tranche(MONEY_IDS.copperT1, MONEY_IDS.awardCopper, 1, 30_000, { type: "onExecution" }, "due", { dueAt: at("2027-05-20") }),
  ];
  const req = (idv: string, awardId: string, title: string, dueAt: string, status: Requirement["status"], more: Partial<Requirement> = {}): Requirement => ({ id: idv, awardId, type: "report", title, formId: IDS.formLibraryReport, formVersion: 1, dueAt, graceDays: 7, reminderPlan: [-30, -14, -7, 0, 3, 14], status, releasesTrancheId: null, submissionId: null, submissionStatus: null, ...more });
  const requirements: Requirement[] = [
    req(MONEY_IDS.reqAlderInterim, MONEY_IDS.awardAlder, "Interim report", at("2027-12-15"), "submitted", { releasesTrancheId: MONEY_IDS.alderT2, submissionId: MONEY_IDS.subAlderInterim, submissionStatus: "submitted" }),
    req(MONEY_IDS.reqAlderFinal, MONEY_IDS.awardAlder, "Final report", at("2028-07-31"), "scheduled", { releasesTrancheId: MONEY_IDS.alderT3 }),
    req(MONEY_IDS.reqNorthgateInterim, MONEY_IDS.awardNorthgate, "Interim report", at("2027-04-14"), "overdue", { releasesTrancheId: MONEY_IDS.northgateT2 }),
    req(MONEY_IDS.reqHarborFinal, MONEY_IDS.awardHarbor, "Final report", at("2027-06-30"), "due"),
  ];
  const responses = (response: Record<string, unknown>): Submission["formResponses"] => [{ formId: IDS.formLibraryReport, formVersion: 1, response, status: "complete", validationErrors: [], provenance: { "/legalName": "passport", "/approach": "prior_submission" }, lockedAt: at("2027-12-10") }];
  const submissions: Submission[] = [
    {
      id: MONEY_IDS.subAlderInterim,
      requirementId: MONEY_IDS.reqAlderInterim,
      awardId: MONEY_IDS.awardAlder,
      status: "submitted",
      submittedAt: at("2027-12-10T18:22"),
      reviewNote: null,
      shared: false,
      sharedFromSubmissionId: null,
      sharedFields: null,
      requirement: { title: "Interim report", type: "report", dueAt: at("2027-12-15"), status: "submitted" },
      formResponses: responses({ legalName: "Alder Creek Family Services", approach: "Two navigators now cover a weekly route of six stops. 412 families enrolled in the first five months, against a target of 380.", outcomes: "Well-child visit completion rose from 61% to 78% among enrolled families. Missed appointments fell by a third." }),
    },
    {
      id: MONEY_IDS.subShared,
      requirementId: null,
      awardId: null,
      status: "accepted",
      submittedAt: at("2027-03-02T17:00"),
      reviewNote: null,
      shared: true,
      sharedFromSubmissionId: id("sub", "3", 99),
      sharedFields: ["approach", "outcomes"],
      requirement: { title: "2026 final report (Cascade County Health Department)", type: "report", dueAt: null, status: "accepted" },
      formResponses: responses({ approach: "The pilot served 38 families across two communities.", outcomes: "Every enrolled child completed a well-child visit within the grant period." }),
    },
  ];
  const lines = (personnel: number, travel: number, supplies: number, indirect: number): BudgetLine[] => [
    { category: "personnel", label: "Personnel", amountMinor: personnel * 100 },
    { category: "travel", label: "Travel & vehicle", amountMinor: travel * 100 },
    { category: "supplies", label: "Supplies", amountMinor: supplies * 100 },
    { category: "indirect", label: "Indirect (10% cap)", amountMinor: indirect * 100 },
  ];
  const view = (kind: "approved" | "actual", l: BudgetLine[], periodStart: string | null, periodEnd: string | null) => ({ id: bare("6", kind === "approved" ? 1 : 2), kind, currency: "USD", categories: ["personnel", "travel", "supplies", "indirect"], lines: l, totalMinor: l.reduce((n, x) => n + x.amountMinor, 0), source: "user", periodStart, periodEnd, updatedAt: at("2027-12-10") });
  const budgets = new Map<string, BudgetBook>([[MONEY_IDS.awardAlder, { awardId: MONEY_IDS.awardAlder, currency: "USD", awardedAmountMinor: 15_000_000, proposed: null, approved: view("approved", lines(96_000, 28_000, 11_000, 15_000), null, null), actuals: [view("actual", lines(41_500, 15_900, 4_200, 6_100), "2027-07-01", "2027-11-30")] }]]);
  const orgChanges: OrgChange[] = [{ id: MONEY_IDS.orgChange, passportOrgId: bare("9", 11), changeId: "chg_mock_alder_1", patch: { addresses: { primary: { street1: "418 Mill Road, Suite 2" } }, phones: { primary: { number: "+1 541 555 0142" } } }, status: "pending", receivedAt: at("2027-05-19T15:30"), decidedAt: null, decidedBy: null, grantee: { workspaceId: MONEY_IDS.wsAlder, name: "Alder Creek Family Services" } }];
  const bank: BankTransaction[] = [
    { id: MONEY_IDS.bankTxn, provider: "mercury", amountMinor: 3_000_000, currency: "USD", postedAt: at("2027-05-21T14:10"), counterpartyName: "COPPER VALLEY CLINIC", memo: "Grant payment tranche 1", matchedTrancheId: null, matchedAt: null, proposals: [{ trancheId: MONEY_IDS.copperT1, score: 0.94, amountDeltaMinor: 0, ambiguous: false }] },
    { id: bare("5", 2), provider: "mercury", amountMinor: 4_500_000, currency: "USD", postedAt: at("2026-10-03T15:00"), counterpartyName: "NORTHGATE HOUSING TRUST", memo: "Wire 20261003-118", matchedTrancheId: MONEY_IDS.northgateT1, matchedAt: at("2026-10-04T16:00") },
  ];
  const ledger: LedgerEvent[] = [
    { id: bare("7", 3), actor: `user:${USERS.marcus}`, eventType: "tranche.release", subjectType: "tranche", subjectId: MONEY_IDS.lakesideT1.slice(4), data: { from: "ready", to: "releasing", amountMinor: 4_000_000 }, occurredAt: at("2027-05-18T16:05") },
    { id: bare("7", 2), actor: "passport", eventType: "tranche.passport_hold", subjectType: "tranche", subjectId: MONEY_IDS.harborT2.slice(4), data: { reason: "destination_change_in_flight" }, occurredAt: at("2027-05-15T09:00") },
    { id: bare("7", 1), actor: `user:${USERS.dana}/client:claude-mcp`, eventType: "decision.proposed", subjectType: "application", subjectId: MOCK_IDS.alder.slice(4), data: { outcome: "decline", count: 14 }, occurredAt: at("2027-04-20T16:40") },
  ];
  return {
    recipients,
    awards,
    tranches,
    requirements,
    submissions,
    budgets,
    orgChanges,
    bank,
    webhooks: [{ id: bare("8", 1), url: "https://hooks.riverbendcf.example/gms", events: ["application.submitted", "tranche.status.changed"], active: true, deliveries: [{ id: "dlv_mock_1", eventId: "evt_mock_1", eventType: "tranche.status.changed", status: "delivered", attempts: 1, lastStatusCode: 200, lastError: null, nextAttemptAt: null, deliveredAt: at("2027-05-18T16:06"), createdAt: at("2027-05-18T16:05") }] }],
    apiClients: [{ id: bare("8", 2), name: "Board dashboard sync", scopes: ["awards:read", "analytics:read"], createdAt: at("2027-01-09"), lastUsedAt: at("2027-05-20T06:10"), revokedAt: null }],
    connections: [{ id: bare("8", 3), clientId: "claude-mcp", clientName: "Riverbend Triage Agent", clientUri: "https://claude.ai", userId: USERS.dana, mine: true, scopes: ["applications:read", "applications:write", "communications:write"], lastUsedAt: at("2027-04-20T16:40"), revokedAt: null, createdAt: at("2027-03-01") }],
    servers: [{ id: bare("8", 4), name: "Riverbend CRM", url: "https://crm.riverbendcf.example/mcp", hasAuth: true, allowedTools: ["lookup_organization"], readOnly: true, createdAt: at("2027-02-11"), tools: [{ name: "lookup_organization", description: "Prior relationship with an organization, by name or EIN.", readOnly: true }, { name: "list_site_visits", description: "Site visits on record for an organization.", readOnly: true }, { name: "update_contact", description: "Change a contact record.", readOnly: false }] }],
    connectors: {
      mercury: { provider: "mercury", connected: true, status: "active", scopes: ["transactions:read"], lastSyncAt: at("2027-05-21T18:00") },
      google_workspace: { provider: "google_workspace", connected: false, status: "not_configured", scopes: [], lastSyncAt: null, connectUrl: null },
    },
    ledger,
    passportReachable: true,
    disbursedAsOf: at("2027-05-21T18:00"),
    seq: 100,
  };
}

const empty = (): State => ({ ...seed(), recipients: [], awards: [], tranches: [], requirements: [], submissions: [], budgets: new Map(), orgChanges: [], bank: [], webhooks: [], apiClients: [], connections: [], servers: [], ledger: [], connectors: { mercury: { provider: "mercury", connected: false, status: "not_connected", scopes: [], lastSyncAt: null }, google_workspace: { provider: "google_workspace", connected: false, status: "not_configured", scopes: [], lastSyncAt: null, connectUrl: null } } });

const clone = <T>(v: T): T => structuredClone(v);

export function createMockFunderMoneyApi(ctx: MockFunderCtx): FunderMoneyApi & MockMoneyControls {
  const states = new Map<string, State>();
  async function st() {
    const w = await ctx.ws();
    if (!states.has(w.record.id)) states.set(w.record.id, w.record.id === IDS.riverbend ? seed() : empty());
    return { w, s: states.get(w.record.id)! };
  }
  const same = (a: string, b: string) => a === b || a.replace(/^[a-z]{3}_/, "") === b.replace(/^[a-z]{3}_/, "");
  const find = <T extends { id: string }>(rows: T[], idv: string, what: string): T => {
    const row = rows.find((r) => same(r.id, idv));
    if (!row) throw ctx.fail(404, `${what} not found`);
    return row;
  };
  const awardOf = (s: State, awardId: string) => {
    const a = s.awards.find((x) => same(x.id, awardId));
    if (!a) throw ctx.fail(404, "Award not found");
    return a;
  };
  const recipientOf = (s: State, a: MockAward) => s.recipients.find((r) => r.workspaceId === a.recipient)!;
  const log = (s: State, eventType: string, subjectType: string, subjectId: string, data: Record<string, unknown>) => {
    s.ledger.unshift({ id: bare("7", ++s.seq), actor: `user:${USERS.dana}`, eventType, subjectType, subjectId: subjectId.replace(/^[a-z]{3}_/, ""), data, occurredAt: ctx.now() });
  };

  function readiness(s: State, linked: boolean, t: Tranche): TrancheReadiness {
    const a = awardOf(s, t.awardId);
    const r = recipientOf(s, a);
    const up = s.passportReachable && linked;
    const unknown = (label: string, key: string): PaymentCheck => ({ key, state: "unknown", label, reason: linked ? "Passport can’t be reached, so this can’t be confirmed right now." : "Connect Passport to check this.", fixHref: linked ? null : "/settings/passport" });
    const conditionMet = !["scheduled", "cancelled"].includes(t.status);
    const pending = r.pendingChangeUntil !== null;
    const headroom = a.awardedMinor - a.disbursedMinor >= t.amountMinor;
    const checks: PaymentCheck[] = [
      { key: "agreement", state: a.agreementExecuted ? "pass" : "fail", label: "Agreement executed", reason: a.agreementExecuted ? "Signed by both parties." : "The grant agreement is not executed yet.", fixHref: a.agreementExecuted ? null : `/awards/${a.id}/agreement` },
      { key: "condition", state: conditionMet ? "pass" : "fail", label: "Tranche condition met", reason: conditionMet ? "This tranche is due." : "The condition for this tranche has not been met.", fixHref: null },
      linked ? (s.passportReachable ? { key: "funder_link", state: "pass", label: "Funder source account ready", reason: "Passport can debit your funding source.", fixHref: null } : unknown("Funder source account ready", "funder_link")) : { key: "funder_link", state: "fail", label: "Passport connected", reason: "Connect Passport to pay. Awards still work without it.", fixHref: "/settings/passport" },
      !up
        ? unknown("Payee verified at L3 with an active destination", "payee_credential")
        : pending
          ? { key: "payee_credential", state: "fail", label: "Payee verified at L3 with an active destination", reason: `A destination change is pending at Passport until ${dateLabel(r.pendingChangeUntil!)}.`, fixHref: null }
          : r.level !== "L3"
            ? { key: "payee_credential", state: "fail", label: "Payee verified at L3 with an active destination", reason: `Passport level is ${r.level}; payments need L3.`, fixHref: null }
            : { key: "payee_credential", state: "pass", label: "Payee verified at L3 with an active destination", reason: `${r.bankName} •••• ${r.last4} · active`, fixHref: null },
      !up ? unknown("Award has headroom at Passport", "award_headroom") : { key: "award_headroom", state: headroom ? "pass" : "fail", label: "Award has headroom at Passport", reason: headroom ? "Awarded minus disbursed covers this tranche." : "This tranche is more than what is left on the award.", fixHref: null },
      { key: "no_duplicate", state: "pass", label: "No duplicate in the last 24 hours", reason: "No other payment of this amount is in flight on this award.", fixHref: null },
      !up ? unknown("Recipient in good standing", "recipient_standing") : { key: "recipient_standing", state: r.active ? "pass" : "fail", label: "Recipient in good standing", reason: r.active ? "Active at Passport; level unchanged since the offer." : "Passport reports this organization as inactive.", fixHref: null },
    ];
    const count = (state: string) => checks.filter((c) => c.state === state).length;
    let banner: PaymentBanner | null = null;
    if (!linked) banner = { cause: "passport_not_linked", tone: "neutral", title: "Connect Passport to pay", detail: "This workspace has no Passport link, so payments cannot be released or recorded.", clears: "Clears when an admin connects Passport in Settings." };
    else if (!s.passportReachable) banner = { cause: "passport_unavailable", tone: "neutral", title: "Passport can’t be reached", detail: "Readiness shows Unknown until Passport is reachable; nothing is released in the meantime.", clears: "Retrying automatically." };
    else if (pending) banner = { cause: "pending_destination_change", tone: "warn", title: `${r.name} · destination change pending`, detail: `Tranche ${t.seq} is held. The new destination is in its cooling-off window at Passport.`, clears: `Clears automatically on ${dateLabel(r.pendingChangeUntil!)}.` };
    else if (r.level !== "L3") banner = { cause: "level_below_l3", tone: "danger", title: `${r.name} · level dropped to ${r.level}`, detail: "Payments to this organization require L3.", clears: "Clears when the organization re-attests in Passport." };
    else if (!a.agreementExecuted) banner = { cause: "agreement_not_executed", tone: "warn", title: "Agreement not executed", detail: "The grant agreement must be signed by both parties before any payment.", clears: "Clears when the agreement is countersigned." };
    const failed = count("fail");
    const unk = count("unknown");
    const releasable = failed === 0 && unk === 0 && ["due", "ready"].includes(t.status);
    return { checks, passed: count("pass"), failed, unknown: unk, total: checks.length, releasable, text: `${count("pass")} of ${checks.length} checks pass`, banner, destination: up ? { bankName: r.bankName, last4: r.last4, status: pending ? "pending_change" : "active" } : null, tranche: clone(t) };
  }

  const rowOf = (s: State, t: Tranche): TrancheRow => {
    const a = awardOf(s, t.awardId);
    const r = recipientOf(s, a);
    return { ...clone(t), award: { id: a.id, title: a.title, status: "active" }, recipient: { workspaceId: r.workspaceId, name: r.name, handle: r.handle, verificationLevel: r.level, pendingDestinationChange: r.pendingChangeUntil !== null } };
  };
  const VIEWS: Record<string, string[]> = { due: ["due", "ready", "held"], "in-flight": ["releasing", "initiated"], done: ["settled", "returned", "failed", "cancelled"], upcoming: ["scheduled"] };
  const scheduleOf = (s: State, a: MockAward) => ({ awardId: a.id, currency: "USD", awardedAmountMinor: a.awardedMinor, disbursedAmountMinor: a.disbursedMinor, disbursedAsOf: s.disbursedAsOf, tranches: clone(s.tranches.filter((t) => same(t.awardId, a.id)).sort((x, y) => x.seq - y.seq)) });
  const reqView = (s: State, r: Requirement): Requirement => {
    const a = awardOf(s, r.awardId);
    const rec = recipientOf(s, a);
    return { ...clone(r), award: { id: a.id, title: a.title }, recipient: { workspaceId: rec.workspaceId, name: rec.name, handle: rec.handle } };
  };
  const summaryOf = (s: State, r: Recipient): GranteeSummary => ({ workspaceId: r.workspaceId, handle: r.handle, name: r.name, legalName: r.name, passportOrgId: bare("9", Number(r.workspaceId.slice(-2))), verificationLevel: r.level, payee: { pendingDestinationChange: r.pendingChangeUntil !== null, active: r.active }, tags: [...r.tags], ownerUserId: USERS.dana, applications: 1, awards: s.awards.filter((a) => a.recipient === r.workspaceId).length, pendingChanges: s.orgChanges.filter((c) => c.status === "pending" && (c.grantee as { workspaceId?: string } | null)?.workspaceId === r.workspaceId).length });
  const detailOf = (s: State, r: Recipient): GranteeDetail => ({
    ...summaryOf(s, r),
    notes: r.notes,
    lastSyncedAt: s.disbursedAsOf,
    organization: r.consent ? { name: r.name, identifiers: { "org:us:ein": { id: r.ein } }, addresses: { primary: { street1: "418 Mill Road", city: r.city.split(",")[0], stateOrProvince: "OR" } }, emails: { primary: `office@${r.handle}.example` }, mission: "Fictional organization for the demonstration workspace." } : null,
    consent: r.consent,
    payeeStatus: { bankName: r.bankName, last4: r.last4, status: r.pendingChangeUntil ? "pending_change" : "active", pendingChangeUntil: r.pendingChangeUntil },
    applicationList: [{ id: MOCK_IDS.alder, title: s.awards.find((a) => a.recipient === r.workspaceId)?.title ?? "Application", status: "accepted" }],
    awardList: s.awards.filter((a) => a.recipient === r.workspaceId).map((a) => ({ id: a.id, title: a.title, status: "active", awardedAmountMinor: a.awardedMinor, disbursedAmountMinor: a.disbursedMinor })),
    orgChanges: clone(s.orgChanges.filter((c) => (c.grantee as { workspaceId?: string } | null)?.workspaceId === r.workspaceId)),
  });
  const granteeOf = (s: State, workspaceId: string) => {
    const r = s.recipients.find((x) => x.workspaceId === workspaceId || `org_${x.handle}` === workspaceId || x.handle === workspaceId);
    if (!r) throw ctx.fail(404, "Grantee not found");
    return r;
  };
  const fakeSecret = (kind: string, n: number) => `mock-${kind}-secret-${n}`;

  return {
    async simulatePassport(event) {
      const { s } = await st();
      if (event.type === "passport.unreachable") s.passportReachable = !event.unreachable;
      else if (event.type === "payee.destination.changed") {
        const r = granteeOf(s, event.workspaceId);
        r.pendingChangeUntil = null;
        for (const t of s.tranches) if (t.status === "held" && t.holdReason === "destination_change_in_flight" && awardOf(s, t.awardId).recipient === r.workspaceId) Object.assign(t, { status: "due", holdReason: null });
      } else {
        const t = find(s.tranches, event.trancheId, "Tranche");
        if (t.status !== "initiated") throw ctx.fail(409, "This tranche is not in flight");
        Object.assign(t, { status: "settled", passportStatus: "settled" });
        const a = awardOf(s, t.awardId);
        a.disbursedMinor += t.amountMinor;
        s.disbursedAsOf = ctx.now();
      }
    },

    async getSchedule(awardId) {
      const { s } = await st();
      return scheduleOf(s, awardOf(s, awardId));
    },
    async putSchedule(awardId, lines) {
      const { s } = await st();
      const a = awardOf(s, awardId);
      const started = s.tranches.filter((t) => same(t.awardId, a.id) && !["scheduled", "due", "ready", "held"].includes(t.status));
      const left = a.awardedMinor - started.filter((t) => t.status !== "cancelled").reduce((n, t) => n + t.amountMinor, 0);
      const total = lines.reduce((n, l) => n + l.amountMinor, 0);
      if (total !== left) throw ctx.fail(422, `The schedule must add up to what is left of the award (${(left / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })})`, [{ field: "tranches", message: "Amounts do not add up" }]);
      for (const t of s.tranches) if (same(t.awardId, a.id) && ["scheduled", "due", "ready", "held"].includes(t.status)) t.status = "cancelled";
      let seq = Math.max(0, ...s.tranches.filter((t) => same(t.awardId, a.id)).map((t) => t.seq));
      for (const l of lines) s.tranches.push(tranche(id("trn", "1", ++s.seq), a.id, ++seq, l.amountMinor / 100, l.condition, "scheduled", l.condition.type === "onDate" ? { dueAt: at(l.condition.date) } : {}));
      log(s, "schedule.replaced", "award", a.id, { tranches: lines.length });
      return scheduleOf(s, a);
    },
    async listTranches(filter = {}) {
      const { s } = await st();
      const statuses = filter.status ? [filter.status] : filter.view ? VIEWS[filter.view] : undefined;
      return s.tranches.filter((t) => (!statuses || statuses.includes(t.status)) && (!filter.awardId || same(t.awardId, filter.awardId))).map((t) => rowOf(s, t));
    },
    async trancheReadiness(trancheId) {
      const { s, w } = await st();
      return readiness(s, w.passport.linked, find(s.tranches, trancheId, "Tranche"));
    },
    async releaseTranche(trancheId) {
      const { s, w } = await st();
      const t = find(s.tranches, trancheId, "Tranche");
      if (t.status === "initiated") return { result: "accepted", tranche: clone(t), replayed: true };
      const r = readiness(s, w.passport.linked, t);
      if (!r.releasable) throw ctx.fail(409, r.unknown > 0 ? "Readiness is unknown, so nothing was released" : "This tranche is not ready to release", r.checks.filter((c) => c.state !== "pass").map((c) => ({ code: "not_ready", field: c.key, message: c.reason })));
      Object.assign(t, { status: "initiated", mode: "facilitated", passportDisbursementId: `dsb_mock_${++s.seq}`, passportStatus: "initiated", releasedAt: ctx.now(), releasedBy: USERS.dana });
      log(s, "tranche.release", "tranche", t.id, { amountMinor: t.amountMinor });
      return { result: "accepted", tranche: clone(t) };
    },
    async recordExternalPayment(trancheId, input) {
      const { s, w } = await st();
      if (!w.passport.linked) throw ctx.fail(409, "Connect Passport to record payments: this award has no mirror at Passport to record against");
      const t = find(s.tranches, trancheId, "Tranche");
      if (!["due", "ready"].includes(t.status)) throw ctx.fail(409, "Only a due tranche can be recorded as paid");
      const a = awardOf(s, t.awardId);
      const verified = recipientOf(s, a).last4 === input.destinationLast4;
      Object.assign(t, { status: "settled", mode: "resolve", passportStatus: verified ? "settled" : "unverified", releasedAt: ctx.now(), releasedBy: USERS.dana, external: { reference: input.reference, paidAt: input.paidAt, destinationLast4: input.destinationLast4 } });
      if (verified) a.disbursedMinor += t.amountMinor;
      log(s, "tranche.record_external", "tranche", t.id, { reference: input.reference, verified });
      return verified ? { result: "recorded", tranche: clone(t) } : { result: "unverified", tranche: clone(t), code: "destination_mismatch", message: "Passport could not match the last four digits to this payee’s verified destination. The payment is recorded here as unverified." };
    },
    async holdTranche(trancheId, reason) {
      const { s } = await st();
      const t = find(s.tranches, trancheId, "Tranche");
      if (!["due", "ready"].includes(t.status)) throw ctx.fail(409, "Only a due tranche can be held");
      Object.assign(t, { status: "held", holdReason: "manual" });
      log(s, "tranche.hold", "tranche", t.id, { reason });
      return clone(t);
    },
    async releaseHold(trancheId) {
      const { s } = await st();
      const t = find(s.tranches, trancheId, "Tranche");
      if (t.status !== "held") throw ctx.fail(409, "This tranche is not held");
      if (t.holdReason !== "manual") throw ctx.fail(409, "This hold was placed by Passport and clears there");
      Object.assign(t, { status: "due", holdReason: null });
      log(s, "tranche.release_hold", "tranche", t.id, {});
      return clone(t);
    },
    async cancelTranche(trancheId, reason) {
      const { s } = await st();
      const t = find(s.tranches, trancheId, "Tranche");
      if (!["scheduled", "due", "ready", "held", "failed"].includes(t.status)) throw ctx.fail(409, "This tranche can no longer be cancelled");
      t.status = "cancelled";
      log(s, "tranche.cancel", "tranche", t.id, { reason });
      return clone(t);
    },

    async paymentsReadiness() {
      const { s, w } = await st();
      const items = s.tranches.filter((t) => ["due", "ready", "held"].includes(t.status)).map((t) => ({ ...readiness(s, w.passport.linked, t), award: { id: t.awardId, title: awardOf(s, t.awardId).title } }));
      return { items, totals: { dueMinor: items.reduce((n, i) => n + i.tranche.amountMinor, 0), releasable: items.filter((i) => i.releasable).length, blocked: items.filter((i) => !i.releasable).length } };
    },
    async paymentAlerts() {
      const { s } = await st();
      const alerts: PaymentAlert[] = [];
      for (const r of s.recipients) {
        if (r.pendingChangeUntil) alerts.push({ kind: "destination_change_pending", tone: "warn", title: `${r.name} · destination change pending`, detail: `The new destination is in its cooling-off window at Passport. Clears automatically on ${dateLabel(r.pendingChangeUntil)}.`, recipientWorkspaceId: r.workspaceId });
        if (r.level !== "L3") alerts.push({ kind: "level_below_l3", tone: "danger", title: `${r.name} · level ${r.level}`, detail: "Payments to this organization require L3. Clears when the organization re-attests in Passport.", recipientWorkspaceId: r.workspaceId });
      }
      for (const t of s.tranches) {
        const name = recipientOf(s, awardOf(s, t.awardId)).name;
        if (t.status === "held") alerts.push({ kind: "held", tone: "warn", title: `${name} · tranche ${t.seq} held`, detail: `Reason: ${(t.holdReason ?? "manual").replace(/_/g, " ")}.`, trancheId: t.id, awardId: t.awardId });
        if (t.passportStatus === "unverified") alerts.push({ kind: "unverified_external", tone: "neutral", title: `${name} · tranche ${t.seq} recorded as unverified`, detail: "Passport could not match this externally paid tranche to the payee’s verified destination.", trancheId: t.id, awardId: t.awardId });
      }
      return alerts;
    },
    async listBankTransactions(filter = {}) {
      const { s } = await st();
      return clone(s.bank.filter((b) => filter.matched === undefined || (b.matchedTrancheId !== null) === filter.matched));
    },
    async matchBankTransaction(transactionId, input) {
      const { s } = await st();
      const txn = find(s.bank, transactionId, "Bank transaction");
      if (txn.matchedTrancheId) throw ctx.fail(409, "This transaction is already matched to a payment");
      const result = await this.recordExternalPayment(input.trancheId, { reference: txn.memo ?? `Bank transaction ${txn.id.slice(-4)}`, paidAt: txn.postedAt, destinationLast4: input.destinationLast4, bankTransactionId: txn.id });
      Object.assign(txn, { matchedTrancheId: result.tranche.id, matchedAt: ctx.now() });
      delete txn.proposals;
      return { ...result, transaction: clone(txn) };
    },

    async listRequirements(awardId) {
      const { s } = await st();
      const a = awardOf(s, awardId);
      return s.requirements.filter((r) => same(r.awardId, a.id)).map((r) => reqView(s, r));
    },
    async createRequirement(awardId, input) {
      const { s } = await st();
      const a = awardOf(s, awardId);
      const r: Requirement = { id: id("req", "2", ++s.seq), awardId: a.id, type: input.type, title: input.title, formId: input.formId ?? null, formVersion: input.formVersion ?? (input.formId ? 1 : null), dueAt: input.dueAt ? at(input.dueAt.slice(0, 10)) : null, graceDays: input.graceDays ?? 7, reminderPlan: input.reminderPlan ?? [-30, -14, -7, 0, 3, 14], status: "scheduled", releasesTrancheId: input.releasesTrancheId ?? null, submissionId: null, submissionStatus: null };
      s.requirements.push(r);
      log(s, "requirement.created", "requirement", r.id, { title: r.title });
      return reqView(s, r);
    },
    async updateRequirement(idv, patch) {
      const { s } = await st();
      const r = find(s.requirements, idv, "Requirement");
      if (patch.title !== undefined) r.title = patch.title;
      if (patch.dueAt !== undefined) r.dueAt = at(patch.dueAt.slice(0, 10));
      if (patch.graceDays !== undefined) r.graceDays = patch.graceDays;
      if (patch.reminderPlan !== undefined) r.reminderPlan = [...patch.reminderPlan];
      return reqView(s, r);
    },
    async listDueRequirements(status) {
      const { s } = await st();
      return s.requirements.filter((r) => (status ? r.status === status : !["accepted", "waived"].includes(r.status))).map((r) => reqView(s, r));
    },
    async waiveRequirement(idv, reason) {
      const { s } = await st();
      const r = find(s.requirements, idv, "Requirement");
      if (["accepted", "waived"].includes(r.status)) throw ctx.fail(409, "This requirement is already closed");
      r.status = "waived";
      log(s, "requirement.waive", "requirement", r.id, { reason });
      return reqView(s, r);
    },
    async remindRequirement(idv) {
      const { s } = await st();
      const r = find(s.requirements, idv, "Requirement");
      log(s, "requirement.reminder_sent", "requirement", r.id, { manual: true });
      return { sent: true };
    },
    async listSubmissions(filter = {}) {
      const { s } = await st();
      return clone(s.submissions.filter((x) => (!filter.status || x.status === filter.status) && (filter.shared === undefined || x.shared === filter.shared)));
    },
    async getSubmission(idv) {
      const { s } = await st();
      return clone(find(s.submissions, idv, "Submission"));
    },
    async acceptSubmission(idv, note) {
      const { s } = await st();
      const sub = find(s.submissions, idv, "Submission");
      if (sub.shared) throw ctx.fail(409, "A report shared by a grantee is for reference; there is nothing to accept");
      if (!["submitted", "under_review"].includes(sub.status)) throw ctx.fail(409, "Only a submitted report can be accepted");
      Object.assign(sub, { status: "accepted", reviewNote: note ?? null });
      const r = s.requirements.find((x) => x.id === sub.requirementId);
      let trancheDue: string | null = null;
      if (r) {
        Object.assign(r, { status: "accepted", submissionStatus: "accepted" });
        if (sub.requirement) sub.requirement.status = "accepted";
        const t = r.releasesTrancheId ? s.tranches.find((x) => x.id === r.releasesTrancheId) : undefined;
        if (t && t.status === "scheduled") {
          Object.assign(t, { status: "due", dueAt: ctx.now() });
          trancheDue = t.id;
        }
      }
      log(s, "submission.accept", "submission", sub.id, { trancheDue });
      return { ...clone(sub), requirementStatus: "accepted", trancheDue };
    },
    async returnSubmission(idv, note) {
      const { s } = await st();
      const sub = find(s.submissions, idv, "Submission");
      if (!["submitted", "under_review"].includes(sub.status)) throw ctx.fail(409, "Only a submitted report can be returned");
      Object.assign(sub, { status: "returned", reviewNote: note });
      const r = s.requirements.find((x) => x.id === sub.requirementId);
      if (r) Object.assign(r, { status: "due", submissionStatus: "returned" });
      log(s, "submission.return", "submission", sub.id, {});
      return { ...clone(sub), requirementStatus: "due", trancheDue: null };
    },

    async getBudget(awardId) {
      const { s } = await st();
      const a = awardOf(s, awardId);
      return clone(s.budgets.get(a.id) ?? { awardId: a.id, currency: "USD", awardedAmountMinor: a.awardedMinor, proposed: null, approved: null, actuals: [] });
    },
    async putBudget(awardId, input) {
      const { s } = await st();
      const a = awardOf(s, awardId);
      if (input.kind !== "approved") throw ctx.fail(403, "Actuals are reported by the grantee");
      const totalMinor = input.lines.reduce((n, l) => n + l.amountMinor, 0);
      if (totalMinor > a.awardedMinor) throw ctx.fail(422, "The approved budget is more than the awarded amount");
      const book = s.budgets.get(a.id) ?? { awardId: a.id, currency: "USD", awardedAmountMinor: a.awardedMinor, proposed: null, approved: null, actuals: [] };
      const v = { id: bare("6", ++s.seq), kind: input.kind, currency: "USD", categories: [...new Set(input.lines.map((l) => l.category))], lines: clone(input.lines), totalMinor, source: "user", periodStart: null, periodEnd: null, updatedAt: ctx.now() };
      book.approved = v;
      s.budgets.set(a.id, book);
      return clone(v);
    },
    async getVariance(awardId) {
      const { s } = await st();
      const a = awardOf(s, awardId);
      const book = s.budgets.get(a.id);
      const approved = book?.approved?.lines ?? [];
      const actual = (cat: string) => (book?.actuals ?? []).reduce((n, v) => n + v.lines.filter((l) => l.category === cat).reduce((m, l) => m + l.amountMinor, 0), 0);
      const categories = approved.map((l) => ({ category: l.label, approvedMinor: l.amountMinor, actualMinor: actual(l.category), varianceMinor: l.amountMinor - actual(l.category), percentSpent: l.amountMinor ? Math.round((actual(l.category) / l.amountMinor) * 1000) / 10 : null, over: actual(l.category) > l.amountMinor }));
      const sum = (k: "approvedMinor" | "actualMinor") => categories.reduce((n, c) => n + c[k], 0);
      return { awardId: a.id, currency: "USD", hasApprovedBudget: !!book?.approved, periods: (book?.actuals ?? []).map((v) => ({ periodStart: v.periodStart, periodEnd: v.periodEnd, totalMinor: v.totalMinor })), categories, totals: { approvedMinor: sum("approvedMinor"), actualMinor: sum("actualMinor"), varianceMinor: sum("approvedMinor") - sum("actualMinor"), over: sum("actualMinor") > sum("approvedMinor") } };
    },

    async listGrantees(filter = {}) {
      const { s } = await st();
      const needle = filter.q?.trim().toLowerCase();
      return s.recipients.filter((r) => (!needle || r.name.toLowerCase().includes(needle)) && (!filter.tag || r.tags.includes(filter.tag))).map((r) => summaryOf(s, r));
    },
    async getGrantee(workspaceId) {
      const { s } = await st();
      return detailOf(s, granteeOf(s, workspaceId));
    },
    async updateGrantee(workspaceId, patch) {
      const { s } = await st();
      const r = granteeOf(s, workspaceId);
      if (patch.tags !== undefined) r.tags = [...new Set(patch.tags)];
      if (patch.notes !== undefined) r.notes = patch.notes;
      return detailOf(s, r);
    },
    async proposeOrgChange(workspaceId, input) {
      const { s } = await st();
      const r = granteeOf(s, workspaceId);
      if (!r.consent) throw ctx.fail(403, `${r.name} has not given this funder permission to propose changes to its Passport record. Ask them to grant it under Team & access.`, [{ code: "consent_required" }]);
      log(s, "org_change.proposed", "grantee", r.workspaceId, { fields: Object.keys(input.patch) });
      return { status: "pending", changeId: `chg_mock_${++s.seq}`, location: null, message: `Proposed to ${r.name}. The change takes effect only if they accept it in Passport.` };
    },
    async listOrgChanges(status) {
      const { s } = await st();
      return clone(s.orgChanges.filter((c) => !status || c.status === status));
    },
    async acceptOrgChange(idv) {
      const { s } = await st();
      const c = find(s.orgChanges, idv, "Organization change");
      if (c.status !== "pending") throw ctx.fail(409, "This change is already decided");
      Object.assign(c, { status: "accepted", decidedAt: ctx.now(), decidedBy: USERS.dana });
      log(s, "org_change.accept", "org_change", c.id, {});
      return clone(c);
    },
    async dismissOrgChange(idv) {
      const { s } = await st();
      const c = find(s.orgChanges, idv, "Organization change");
      if (c.status !== "pending") throw ctx.fail(409, "This change is already decided");
      Object.assign(c, { status: "dismissed", decidedAt: ctx.now(), decidedBy: USERS.dana });
      return clone(c);
    },

    async portfolio() {
      const { s, w } = await st();
      const programs = w.programs.map((p) => {
        const mine = s.awards.filter((a) => a.programId === p.id);
        const committed = mine.reduce((n, a) => n + a.awardedMinor, 0);
        const paid = mine.reduce((n, a) => n + a.disbursedMinor, 0);
        const budget = p.budgetAmountMinor ?? null;
        return { programId: p.id, name: p.name, currency: "USD", budgetMinor: budget, committedMinor: committed, paidMinor: paid, committedNotPaidMinor: committed - paid, awards: mine.length, overBudgetMinor: budget !== null && committed > budget ? committed - budget : 0 };
      });
      const sum = (k: "committedMinor" | "paidMinor" | "awards") => programs.reduce((n, p) => n + p[k], 0);
      return { asOf: ctx.now(), paidAsOf: s.disbursedAsOf, totals: { budgetMinor: programs.reduce((n, p) => n + (p.budgetMinor ?? 0), 0), committedMinor: sum("committedMinor"), paidMinor: sum("paidMinor"), awards: sum("awards") }, programs, applications: { submitted: 58, under_review: 28, accepted: 5, declined: 22 }, reporting: { due: s.requirements.filter((r) => r.status === "due").length, overdue: s.requirements.filter((r) => r.status === "overdue").length, submitted: s.requirements.filter((r) => r.status === "submitted").length, accepted: s.requirements.filter((r) => r.status === "accepted").length }, payments: { due: s.tranches.filter((t) => ["due", "ready"].includes(t.status)).length, held: s.tranches.filter((t) => t.status === "held").length, inFlight: s.tranches.filter((t) => t.status === "initiated").length, settled: s.tranches.filter((t) => t.status === "settled").length } };
    },
    async cycleReport(competitionId) {
      const { w } = await st();
      const c = w.competitions.find((x) => same(x.id, competitionId));
      if (!c) throw ctx.fail(404, "Competition not found");
      return { competitionId: c.id, title: c.title, status: c.status, started: 71, submitted: 58, submitRate: 0.82, stages: [{ key: "loi", label: "Letter of intent", applications: 58 }, { key: "full", label: "Full proposal", applications: 36 }], byStatus: { submitted: 4, under_review: 28, recommended: 4, accepted: 5, declined: 22 }, eligibility: { true: 40, false: 14, unknown: 4 }, byLevel: { L3: 31, L2: 15, L1: 9, L0: 3 }, reviews: { assigned: 72, submitted: 49 }, decisions: { approve: 5, decline: 22, waitlist: 2 }, requestedMinor: 612_000_000, awardedMinor: 45_600_000, medianDaysToDecision: 41 };
    },
    async grantList990(year) {
      const { s } = await st();
      const items = s.awards.map((a) => ({ awardId: a.id, recipientName: recipientOf(s, a).name, recipientAddress: recipientOf(s, a).city, relationship: "None", foundationStatus: "PC", purpose: a.title, currency: "USD", awardedMinor: a.awardedMinor, paidMinor: a.disbursedMinor, approvedForFuturePaymentMinor: a.awardedMinor - a.disbursedMinor, paidAsOf: s.disbursedAsOf }));
      return { year, items, totals: { paidMinor: items.reduce((n, i) => n + i.paidMinor, 0), approvedForFuturePaymentMinor: items.reduce((n, i) => n + i.approvedForFuturePaymentMinor, 0) } };
    },
    async grantList990Csv(year) {
      const list = await this.grantList990(year);
      const rows = [["Recipient", "Purpose", "Paid", "Approved for future payment"], ...list.items.map((i) => [i.recipientName, i.purpose, String(i.paidMinor / 100), String(i.approvedForFuturePaymentMinor / 100)])];
      return new Blob([rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    },
    async exportBundle() {
      const { s, w } = await st();
      return { prefix: `exports/${w.record.handle}/mock`, written: true, files: ["commongrants.json", "gms.json", "attachments/manifest.json"], counts: { opportunities: w.opportunities.length, competitions: w.competitions.length, forms: w.forms.length, awards: s.awards.length } };
    },
    async importAwardsCsv(input) {
      const { s } = await st();
      const [header = "", ...rows] = input.csv.trim().split(/\r?\n/);
      const cols = header.split(",").map((c) => c.trim());
      for (const target of ["recipientName", "title", "awardedAmount"]) if (!input.mapping[target] || !cols.includes(input.mapping[target])) throw ctx.fail(422, `Map a column to ${target}`, [{ field: `mapping.${target}`, message: "Required" }]);
      const results = rows.map((line, i) => {
        const cells = line.split(",").map((c) => c.trim());
        const name = cells[cols.indexOf(input.mapping.recipientName!)] ?? "";
        const amount = Number(cells[cols.indexOf(input.mapping.awardedAmount!)]);
        if (!name || !Number.isFinite(amount) || amount <= 0) return { row: i + 2, ok: false, error: "Recipient name and a positive amount are required" };
        return { row: i + 2, ok: true, matchedRecipient: s.recipients.some((r) => r.name.toLowerCase() === name.toLowerCase()) };
      });
      const okRows = results.filter((r) => r.ok);
      return { dryRun: input.dryRun ?? false, rows: rows.length, created: input.dryRun ? 0 : okRows.length, failed: results.length - okRows.length, unmatchedRecipients: okRows.filter((r) => !r.matchedRecipient).length, results };
    },

    async listWebhooks() {
      const { s } = await st();
      return s.webhooks.map(({ deliveries: _d, ...w }) => clone(w));
    },
    async createWebhook(input) {
      const { s } = await st();
      if (!/^https:\/\//.test(input.url)) throw ctx.fail(422, "Enter an https URL", [{ field: "url", message: "Enter an https URL" }]);
      const hook = { id: bare("8", ++s.seq), url: input.url, events: input.events ?? [], active: true, deliveries: [] };
      s.webhooks.push(hook);
      const { deliveries: _d, ...viewOf } = hook;
      return { ...clone(viewOf), secret: fakeSecret("webhook", s.seq) };
    },
    async deleteWebhook(idv) {
      const { s } = await st();
      s.webhooks = s.webhooks.filter((w) => w.id !== find(s.webhooks, idv, "Webhook").id);
    },
    async listWebhookDeliveries(idv) {
      const { s } = await st();
      return clone(find(s.webhooks, idv, "Webhook").deliveries);
    },
    async listApiClients() {
      const { s } = await st();
      return clone(s.apiClients);
    },
    async createApiClient(input) {
      const { s } = await st();
      if (!input.name.trim() || !input.scopes.length) throw ctx.fail(422, "Name the client and choose at least one scope", [{ field: "name", message: "Required" }]);
      const c: ApiClient = { id: bare("8", ++s.seq), name: input.name.trim(), scopes: [...input.scopes], createdAt: ctx.now(), lastUsedAt: null, revokedAt: null };
      s.apiClients.push(c);
      return { ...clone(c), clientId: `gms_mock_client_${s.seq}`, clientSecret: fakeSecret("client", s.seq) };
    },
    async revokeApiClient(idv) {
      const { s } = await st();
      find(s.apiClients, idv, "API client").revokedAt = ctx.now();
    },
    async listMcpConnections() {
      const { s } = await st();
      return clone(s.connections.filter((c) => !c.revokedAt));
    },
    async revokeMcpConnection(idv) {
      const { s } = await st();
      find(s.connections, idv, "MCP connection").revokedAt = ctx.now();
    },
    async listMcpServers() {
      const { s } = await st();
      return s.servers.map(({ tools: _t, ...v }) => clone(v));
    },
    async registerMcpServer(input) {
      const { s } = await st();
      if (!/^https:\/\//.test(input.url)) throw ctx.fail(422, "Enter an https URL", [{ field: "url", message: "Enter an https URL" }]);
      const server = { id: bare("8", ++s.seq), name: input.name.trim(), url: input.url, hasAuth: !!input.authHeader, allowedTools: [] as string[], readOnly: true, createdAt: ctx.now(), tools: [{ name: "search_records", description: "Search this server’s records.", readOnly: true }] as RemoteTool[] };
      s.servers.push(server);
      const { tools, ...v } = server;
      return { ...clone(v), tools: clone(tools) };
    },
    async listMcpServerTools(idv) {
      const { s } = await st();
      const server = find(s.servers, idv, "MCP server");
      return server.tools.map((t) => ({ ...t, allowed: server.allowedTools.includes(t.name) }));
    },
    async updateMcpServer(idv, allowedTools) {
      const { s } = await st();
      const server = find(s.servers, idv, "MCP server");
      const writable = allowedTools.filter((n) => server.tools.find((t) => t.name === n)?.readOnly === false);
      if (writable.length) throw ctx.fail(422, `Only read-only tools can be allowed (${writable.join(", ")})`, [{ field: "allowedTools", message: "Read-only tools only" }]);
      server.allowedTools = [...allowedTools];
      const { tools: _t, ...v } = server;
      return clone(v);
    },
    async removeMcpServer(idv) {
      const { s } = await st();
      s.servers = s.servers.filter((x) => x.id !== find(s.servers, idv, "MCP server").id);
    },
    async getConnector(provider) {
      const { s } = await st();
      return clone(s.connectors[provider]);
    },
    async connectConnector(provider, token) {
      const { s } = await st();
      if (provider === "google_workspace") throw ctx.fail(503, "Google Workspace is not configured on this installation", [{ code: "connector_not_configured" }]);
      if (!token || token.length < 8) throw ctx.fail(422, "Paste a read-only Mercury API token", [{ field: "token", message: "Required" }]);
      s.connectors[provider] = { provider, connected: true, status: "active", scopes: ["transactions:read"], lastSyncAt: null };
      return clone(s.connectors[provider]);
    },
    async disconnectConnector(provider) {
      const { s } = await st();
      s.connectors[provider] = { ...s.connectors[provider], connected: false, status: provider === "mercury" ? "not_connected" : "not_configured", scopes: [], lastSyncAt: null };
      return clone(s.connectors[provider]);
    },
    async syncConnector(provider) {
      const { s } = await st();
      if (!s.connectors[provider].connected) throw ctx.fail(409, "Connect this connector first");
      s.connectors[provider] = { ...s.connectors[provider], lastSyncAt: ctx.now(), fetched: s.bank.length, added: 0 };
      return clone(s.connectors[provider]);
    },
    async listLedger(filter = {}) {
      const { s } = await st();
      const rows = s.ledger.filter((e) => (!filter.subjectType || e.subjectType === filter.subjectType) && (!filter.eventType || e.eventType === filter.eventType) && (!filter.from || e.occurredAt >= filter.from) && (!filter.to || e.occurredAt <= filter.to));
      const size = filter.pageSize ?? 50;
      const start = ((filter.page ?? 1) - 1) * size;
      return { items: clone(rows.slice(start, start + size)), total: rows.length };
    },

    async updateMemberRole(_workspaceId, userId, role) {
      const { w } = await st();
      const m = w.members.find((x) => x.userId === userId);
      if (!m) throw ctx.fail(404, "Member not found");
      if (m.role === "admin" && role !== "admin" && w.members.filter((x) => x.role === "admin").length === 1) throw ctx.fail(409, "A workspace needs at least one admin");
      m.role = role;
      return { userId, role };
    },

    async applicationSections() {
      return [{ formId: IDS.formFull, stage: "full", sections: { budget: USERS.marcus, need: USERS.dana } }];
    },
  };
}
