// SPDX-License-Identifier: AGPL-3.0-or-later
// Screen catalog: every screen in the GMS spec with its route and documented `?state=` values.
// Drives /dev/catalog and screenshot tooling. Pure data (no server imports) so tests can load it.

export type CatalogSurface =
  | 'public'
  | 'portal'
  | 'console'
  | 'reviewer'
  | 'board'
  | 'root'
  | 'dev'
  | 'oauth'
  | 'embed'
  | 'email'
  | 'pdf';

export interface CatalogScreen {
  /** Spec screen id, e.g. "B-09". Secondary routes of one screen use a suffix: "S-05-detail". */
  id: string;
  title: string;
  /** Route pattern. Dynamic segments stay as `[id]`; a query string is allowed (e.g. "/setup?step=owner"). */
  path: string;
  /** Values for `?state=` (kebab-case). */
  states: string[];
  surface: CatalogSurface;
  /** True when the screen lives on a workspace host; false for the root (platform) host. */
  tenantScoped: boolean;
  /** A concrete URL to open when the path has dynamic segments (or a useful variant). */
  example?: string;
  /** Anything a developer should know when opening the screen. */
  notes?: string;
}

export const SURFACE_LABELS: Record<CatalogSurface, string> = {
  public: 'Public site',
  portal: 'Applicant portal',
  console: 'Staff console',
  reviewer: 'Reviewer',
  board: 'Board',
  root: 'Platform (root host)',
  dev: 'Developer tools',
  oauth: 'OAuth',
  embed: 'Embeds',
  email: 'Email',
  pdf: 'PDF documents',
};

export const SURFACE_ORDER: CatalogSurface[] = [
  'public',
  'embed',
  'portal',
  'console',
  'reviewer',
  'board',
  'oauth',
  'root',
  'email',
  'pdf',
  'dev',
];

type Def = Omit<CatalogScreen, 'surface' | 'tenantScoped' | 'states'> & { states?: string[] };

const on =
  (surface: CatalogSurface, tenantScoped = true) =>
  (defs: Def[]): CatalogScreen[] =>
    defs.map((d) => ({ ...d, states: d.states ?? [], surface, tenantScoped }));

const PUBLIC = on('public')([
  { id: 'A-01', title: 'Foundation landing', path: '/', states: ['empty'] },
  {
    id: 'A-02',
    title: 'Opportunity listing with filters',
    path: '/opportunities',
    states: ['none'],
    notes: 'Filters open in a sheet on narrow screens.',
  },
  {
    id: 'A-03',
    title: 'Opportunity detail',
    path: '/opportunities/[slug]',
    states: ['forecasted', 'open', 'closed'],
  },
  {
    id: 'A-04',
    title: 'Eligibility pre-check',
    path: '/opportunities/[slug]/eligibility',
    notes: 'Pass and knock-out results are reached by answering the questions.',
  },
  { id: 'A-05', title: 'Awarded grants (transparency)', path: '/awards', states: ['empty'] },
  { id: 'A-07', title: 'For AI agents', path: '/for-agents' },
  {
    id: 'invite-accept',
    title: 'Invite acceptance',
    path: '/invite/accept',
    states: ['invalid'],
    example: '/invite/accept?token=preview',
  },
]);

const EMBED = on('embed')([
  {
    id: 'A-06',
    title: 'Embeddable opportunity list',
    path: '/embed/opportunities',
    notes: 'Also available as a web component: <script src="/embed/widget.js">.',
  },
]);

const PORTAL = on('portal')([
  {
    id: 'B-01',
    title: 'Applicant sign-in',
    path: '/portal/sign-in',
    states: ['expired'],
    notes: '"Check your email" appears after sending a link.',
  },
  { id: 'B-02', title: 'Organization setup (EIN lookup)', path: '/portal/org/new' },
  { id: 'B-03-list', title: 'My organizations', path: '/portal/org' },
  { id: 'B-03', title: 'Organization profile & document vault', path: '/portal/org/[orgId]' },
  { id: 'B-04', title: 'Applicant dashboard', path: '/portal', states: ['new-user', 'error'] },
  { id: 'B-04-apply', title: 'Start an application', path: '/portal/apply/[slug]' },
  { id: 'B-05', title: 'Application workspace (autosave, multi-page)', path: '/portal/applications/[id]/form' },
  { id: 'B-06', title: 'Review & submit', path: '/portal/applications/[id]/review', states: ['deadline-passed', 'grace'] },
  { id: 'B-07', title: 'Application collaborators', path: '/portal/applications/[id]/collaborators' },
  { id: 'B-08', title: 'Submission receipt', path: '/portal/applications/[id]/submitted' },
  {
    id: 'B-09',
    title: 'Application detail & messages',
    path: '/portal/applications/[id]',
    states: ['info-requested', 'submitted', 'awarded', 'declined', 'withdrawn', 'ineligible'],
    notes:
      'Every application status can be forced; multi-word statuses use underscores (?state=under_review, in_progress, invited_to_next_stage).',
  },
  { id: 'B-10-list', title: 'Grants & reports', path: '/portal/grants' },
  {
    id: 'B-10',
    title: 'Grant hub: accept, sign, bank onboarding',
    path: '/portal/grants/[awardId]',
    states: ['sign', 'onboarding', 'ready'],
    notes: 'Also ?state=invite_sent and ?state=invite_expired.',
  },
  { id: 'B-10-sign', title: 'Sign the grant agreement', path: '/portal/grants/[awardId]/agreement' },
  { id: 'B-11', title: 'Grant report form', path: '/portal/grants/[awardId]/reports/[reqId]' },
  {
    id: 'B-12',
    title: 'Extension, amendment or budget-change request',
    path: '/portal/grants/[awardId]/requests/new',
  },
  { id: 'B-13', title: 'Connected agents', path: '/portal/account/agents' },
  {
    id: 'B-14',
    title: 'Agent confirmation',
    path: '/portal/confirm/[id]',
    states: ['confirmed', 'rejected', 'expired'],
  },
  { id: 'B-15', title: 'Account, notifications & data export', path: '/portal/account' },
  { id: 'join', title: 'Join an application (collaborator invite)', path: '/portal/join', notes: 'Opened from an invitation link.' },
]);

const CONSOLE = on('console')([
  { id: 'C-01', title: 'Console home', path: '/console', states: ['new-workspace'] },
  { id: 'console-mfa', title: 'Staff two-step sign-in', path: '/console/mfa', notes: 'Redirects to the console once verified.' },
  { id: 'console-denied', title: 'No console access', path: '/console/denied' },
  { id: 'C-02', title: 'Programs & budgets', path: '/console/programs', states: ['empty', 'error'] },
  { id: 'C-02-detail', title: 'Program detail', path: '/console/programs/[programId]', states: ['no-budget', 'over-budget', 'no-account'] },
  { id: 'C-03', title: 'Opportunities', path: '/console/opportunities', states: ['empty', 'error'] },
  { id: 'C-04-new', title: 'New opportunity', path: '/console/opportunities/new', states: ['saving-error'] },
  { id: 'C-04', title: 'Opportunity editor', path: '/console/opportunities/[id]', states: ['archived', 'saving-error'] },
  { id: 'C-05', title: 'Publish checks', path: '/console/opportunities/[id]/publish', states: ['ready', 'blocked', 'published'] },
  { id: 'FB-01', title: 'Forms', path: '/console/forms', states: ['empty', 'import-error'] },
  // FB-02…FB-08 are tabs and dialogs of one builder page (FormBuilder has no deep link per tab yet).
  { id: 'FB-02', title: 'Form builder: pages, fields & CommonGrants mapping', path: '/console/forms/[formId]', states: ['mapping-conflict', 'read-only'] },
  { id: 'FB-03', title: 'Form builder: conditional logic', path: '/console/forms/[formId]', states: ['circular-rule'], notes: 'Logic tab.' },
  { id: 'FB-04', title: 'Form builder: applicant preview', path: '/console/forms/[formId]', notes: 'Preview tab.' },
  { id: 'FB-05', title: 'Form builder: versions & diff', path: '/console/forms/[formId]', notes: 'Versions tab.' },
  { id: 'FB-06', title: 'Form builder: publish with migration notice', path: '/console/forms/[formId]', notes: 'Publish dialog.' },
  { id: 'FB-07', title: 'Form builder: form checker', path: '/console/forms/[formId]', states: ['lint'], notes: 'Check tab.' },
  { id: 'FB-08', title: 'Form templates, CommonGrants import & question bank', path: '/console/forms', notes: 'Create-from-template and import dialogs on the forms list.' },
  { id: 'C-06', title: 'Application pipeline', path: '/console/pipeline', states: ['empty', 'error', 'kanban', 'bulk'] },
  { id: 'C-06-list', title: 'Applications', path: '/console/applications' },
  { id: 'C-07', title: 'Application detail', path: '/console/applications/[id]', states: ['in-progress', 'info-requested', 'agent'] },
  { id: 'C-08', title: 'Grantees', path: '/console/grantees', states: ['empty', 'error'] },
  { id: 'C-08-detail', title: 'Grantee profile', path: '/console/grantees/[orgId]', states: ['empty'] },

  { id: 'R-01', title: 'Review setup: stages & rubrics', path: '/console/review', states: ['empty', 'weights-invalid', 'error'] },
  { id: 'R-01-new', title: 'New rubric', path: '/console/review/rubrics/new', states: ['weights-invalid'] },
  { id: 'R-01-rubric', title: 'Rubric editor', path: '/console/review/rubrics/[rubricId]', states: ['weights-invalid', 'locked'] },
  { id: 'R-02', title: 'Reviewer assignments', path: '/console/review/[stageId]/assign', states: ['over-capacity', 'conflicts', 'empty'] },
  { id: 'R-03', title: 'Review progress', path: '/console/review/[stageId]', states: ['empty', 'complete'] },
  { id: 'R-04', title: 'Panel view', path: '/console/review/[stageId]/panel', states: ['variance', 'empty'] },
  { id: 'R-05', title: 'Decisions', path: '/console/decisions', states: ['empty', 'confirm-final', 'bulk-decline'] },
  { id: 'R-06', title: 'Award builder', path: '/console/decisions/[applicationId]/award', states: ['over-budget', 'schedule-mismatch', 'active'] },
  { id: 'R-07', title: 'Grant agreement', path: '/console/decisions/[applicationId]/agreement', states: ['no-award', 'draft', 'sent', 'signed'] },
  { id: 'E-01', title: 'Board dockets', path: '/console/dockets', states: ['empty', 'error'] },
  { id: 'E-01-detail', title: 'Docket builder', path: '/console/dockets/[docketId]', states: ['empty', 'in-session', 'closed'] },

  { id: 'awards', title: 'Awards', path: '/console/awards', states: ['flags', 'empty'] },
  { id: 'awards-detail', title: 'Award detail', path: '/console/awards/[awardId]', states: ['draft', 'countersign', 'on-hold', 'report-overdue', 'completed'] },
  { id: 'P-01', title: 'Payments overview', path: '/console/payments', states: ['no-bank', 'empty'] },
  { id: 'P-02', title: 'Payees', path: '/console/payments/payees', states: ['empty', 'no-bank'] },
  { id: 'P-03', title: 'New payment batch', path: '/console/payments/batches/new', states: ['no-bank'] },
  { id: 'P-03-list', title: 'Payment batches', path: '/console/payments/batches', states: ['empty'] },
  {
    id: 'P-04',
    title: 'Batch detail & approval',
    path: '/console/payments/batches/[id]',
    states: ['awaiting-approval', 'creator', 'needs-second-approval', 'approved', 'submitted', 'rejected'],
  },
  { id: 'P-05', title: 'Payment status', path: '/console/payments/status', states: ['empty', 'failed'] },
  { id: 'P-06', title: 'Exceptions & reconciliation', path: '/console/payments/exceptions', states: ['empty'] },
  { id: 'P-07', title: 'Payment detail', path: '/console/payments/[paymentId]', states: ['failed'] },
  { id: 'P-08', title: 'Connect bank (Mercury)', path: '/console/payments/connect', states: ['not-connected', 'webhook-failing'] },
  { id: 'P-manual', title: 'Manual payments', path: '/console/payments/manual', states: ['no-awards'] },
  { id: 'PA-01', title: 'Grantee reports', path: '/console/reports', states: ['overdue', 'hold', 'empty'] },
  { id: 'PA-02', title: 'Report review', path: '/console/reports/[requirementId]', states: ['submitted', 'accepted', 'revisions', 'not-submitted'] },
  { id: 'PA-03', title: 'Diligence & screening', path: '/console/diligence', states: ['match', 'empty'] },

  { id: 'CM-00', title: 'Communications', path: '/console/comms' },
  { id: 'CM-01', title: 'Email templates', path: '/console/comms/templates', states: ['empty'] },
  {
    id: 'CM-01-editor',
    title: 'Email template editor',
    path: '/console/comms/templates/[key]',
    states: ['new'],
    example: '/console/comms/templates/award_notice',
  },
  {
    id: 'CM-02',
    title: 'Bulk message composer',
    path: '/console/comms/compose',
    states: ['confirm-count', 'bounced', 'empty'],
  },
  { id: 'CM-03', title: 'Notification rules', path: '/console/comms/rules', states: ['empty'] },

  { id: 'AN-01', title: 'Dashboards', path: '/console/analytics', states: ['empty', 'suppressed'] },
  { id: 'AN-02', title: 'Report builder', path: '/console/analytics/builder', states: ['empty', 'saved'] },
  { id: 'AN-03', title: 'Compliance (990-PF)', path: '/console/analytics/compliance', states: ['empty'] },

  { id: 'S-00', title: 'Workspace settings', path: '/console/settings', states: ['support-granted'] },
  {
    id: 'S-01',
    title: 'Branding',
    path: '/console/settings/branding',
    states: ['contrast-autofix', 'unsaved', 'conflict'],
  },
  {
    id: 'S-02',
    title: 'Team & roles',
    path: '/console/settings/team',
    states: ['invite-pending', 'step-up'],
  },
  {
    id: 'S-03',
    title: 'Integrations',
    path: '/console/settings/integrations',
    states: ['dns-pending', 'dns-verified'],
  },
  {
    id: 'S-04',
    title: 'AI agents & policy',
    path: '/console/settings/agents',
    states: ['key-created', 'empty'],
  },
  { id: 'S-05', title: 'Approval inbox', path: '/console/approvals', states: ['empty'] },
  {
    id: 'S-05-detail',
    title: 'Approval request detail',
    path: '/console/approvals/[id]',
    states: ['confirmed', 'rejected', 'expired'],
  },
  { id: 'S-06', title: 'Audit log', path: '/console/settings/audit', states: ['empty', 'diff-open'] },
  {
    id: 'S-07',
    title: 'Developers: API keys & webhooks',
    path: '/console/settings/developers',
    states: ['key-created', 'secret-created', 'empty'],
  },
  { id: 'S-08', title: 'Custom fields & taxonomies', path: '/console/settings/fields', states: ['empty'] },
  { id: 'S-09', title: 'Workspace export', path: '/console/settings/export', states: ['running', 'empty'] },
  { id: 'S-09-exports', title: 'Exports (Insights)', path: '/console/exports', states: ['empty'] },
]);

const REVIEWER = on('reviewer')([
  { id: 'D-01', title: 'Reviewer queue', path: '/review', states: ['empty', 'all-done'] },
  { id: 'D-02', title: 'Conflict-of-interest declaration', path: '/review/[assignmentId]/coi', states: ['conflict', 'recused'] },
  { id: 'D-03', title: 'Scoring workspace', path: '/review/[assignmentId]', states: ['blind', 'submitted', 'tablet', 'recused'] },
  { id: 'D-denied', title: 'Not a reviewer here', path: '/review/denied' },
]);

const BOARD = on('board')([
  { id: 'E-02', title: 'Board home: dockets', path: '/board', states: ['empty'] },
  { id: 'E-02-docket', title: 'Docket book & votes', path: '/board/[docketId]', states: ['voted', 'closed', 'not-in-session'] },
]);

const OAUTH = on('oauth')([
  {
    id: 'O-01',
    title: 'OAuth consent for AI agents',
    path: '/oauth/consent',
    notes: 'Opened by an agent client during authorization; needs OAuth query parameters.',
  },
]);

const ERRORS = on('public')([
  { id: 'not-found', title: 'Page not found', path: '/this-page-does-not-exist' },
]);

const ROOT = on(
  'root',
  false,
)([
  { id: 'platform-directory', title: 'Platform directory', path: '/' },
  { id: 'root-sign-in', title: 'Platform sign-in', path: '/sign-in', states: ['check-email'] },
  { id: 'root-mfa', title: 'Operator two-step sign-in', path: '/mfa' },
  { id: 'F-01', title: 'Setup: owner account', path: '/setup?step=owner', states: ['already-set-up'] },
  { id: 'F-02', title: 'Setup: brand', path: '/setup?step=brand', states: ['contrast-autofix'] },
  { id: 'F-03', title: 'Setup: email', path: '/setup?step=email' },
  { id: 'F-04', title: 'Setup: payments (Mercury)', path: '/setup?step=payments' },
  { id: 'F-05', title: 'Setup: first program', path: '/setup?step=program', states: ['check-email'] },
  { id: 'F-05-team', title: 'Setup: invite your team', path: '/setup?step=team' },
  { id: 'G-01', title: 'Operator: tenants', path: '/operator', states: ['empty'] },
  {
    id: 'G-02',
    title: 'Operator: tenant detail',
    path: '/operator/[id]',
    states: ['no-access', 'access-granted'],
  },
]);

const EMAIL = on('email')([
  {
    id: 'H-01',
    title: 'Email previews',
    path: '/dev/preview/email/[template]',
    example: '/dev/preview/email/award_notice',
    notes: 'Index of every template at /dev/preview/email.',
  },
]);

const PDF = on('pdf')([
  { id: 'H-02', title: 'Award letter & grant agreement (PDF)', path: '/dev/preview/pdf', notes: 'Documents: /dev/preview/pdf/award_letter and /dev/preview/pdf/agreement.' },
  { id: 'H-03', title: 'Application packet (PDF)', path: '/dev/preview/pdf', example: '/dev/preview/pdf#application_packet' },
  { id: 'H-04', title: 'Remittance advice (PDF)', path: '/dev/preview/pdf', example: '/dev/preview/pdf#remittance' },
  { id: 'H-05', title: 'Board book (PDF)', path: '/dev/preview/pdf', example: '/dev/preview/pdf#board_book' },
]);

const DS_TITLES = [
  'Tokens & theming',
  'Components',
  'Form renderer modes',
  'Status & actor system',
  'Shells',
  'System states',
];

const DEV = on('dev')([
  ...DS_TITLES.map((title, i) => ({
    id: `DS-0${i + 1}`,
    title: `Design system: ${title}`,
    path: `/dev/design-system?section=ds-0${i + 1}`,
    example: `/dev/design-system#ds-0${i + 1}`,
  })),
  { id: 'dev-catalog', title: 'Screen catalog', path: '/dev/catalog' },
  { id: 'dev-mail', title: 'Dev outbox', path: '/dev/mail' },
  { id: 'dev-email-index', title: 'Email previews index', path: '/dev/preview/email' },
  { id: 'dev-mercury', title: 'Fake Mercury controls', path: '/dev/mercury' },
]);

export const CATALOG: CatalogScreen[] = [
  ...PUBLIC,
  ...EMBED,
  ...ERRORS,
  ...PORTAL,
  ...CONSOLE,
  ...REVIEWER,
  ...BOARD,
  ...OAUTH,
  ...ROOT,
  ...EMAIL,
  ...PDF,
  ...DEV,
];

/** Screens grouped by surface, in display order (surfaces without screens are omitted). */
export function catalogBySurface(
  screens: readonly CatalogScreen[] = CATALOG,
): { surface: CatalogSurface; label: string; screens: CatalogScreen[] }[] {
  return SURFACE_ORDER.map((surface) => ({
    surface,
    label: SURFACE_LABELS[surface],
    screens: screens.filter((s) => s.surface === surface),
  })).filter((g) => g.screens.length > 0);
}

/** True when the path still has a `[param]` placeholder. */
export function isDynamicPath(path: string): boolean {
  return /\[[^\]]+\]/.test(path);
}

/**
 * URL for a screen (optionally with `?state=`). Uses the example URL for dynamic paths when there is one;
 * returns null when there is nothing concrete to link to.
 */
export function catalogUrl(screen: CatalogScreen, state?: string): string | null {
  const base = isDynamicPath(screen.path) ? (screen.example ?? null) : screen.path;
  if (!base) return null;
  if (!state) return base;
  const hash = base.indexOf('#');
  const [head, tail] = hash === -1 ? [base, ''] : [base.slice(0, hash), base.slice(hash)];
  return `${head}${head.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}${tail}`;
}
