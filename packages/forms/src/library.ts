// SPDX-License-Identifier: AGPL-3.0-or-later
// The default question bank and form templates, including the flagship
// "Youth Arts Fund 2027 — Letter of Inquiry". All sample data is fictional.
import { defineForm, type Field, type FieldInput, FieldSchema, type FormModel } from './model';

export interface QuestionBankItem {
  /** Stable key; also the default field id when the item is added to a form. */
  key: string;
  label: string;
  description: string;
  tags: string[];
  cgPath?: string;
  field: FieldInput;
}

const MB = 1024 * 1024;

const COUNTY_OPTIONS = [
  { value: 'alder', label: 'Alder County' },
  { value: 'bramble', label: 'Bramble County' },
  { value: 'cinder', label: 'Cinder County' },
  { value: 'other', label: 'Other' },
];

const AGE_GROUP_OPTIONS = [
  { value: '12-14', label: '12–14' },
  { value: '15-17', label: '15–17' },
  { value: '18-24', label: '18–24' },
];

const BUDGET_CATEGORY_OPTIONS = [
  { value: 'personnel', label: 'Personnel' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'space', label: 'Space' },
  { value: 'stipends', label: 'Stipends' },
  { value: 'other', label: 'Other' },
];

const FISCALLY_SPONSORED = { field: 'fiscally_sponsored', op: 'eq', value: true } as const;

const ITEMS: QuestionBankItem[] = [
  {
    key: 'org_legal_name',
    label: 'Organization legal name',
    description: 'The name on the IRS determination letter. Prefilled from the applicant profile.',
    tags: ['organization', 'identity'],
    cgPath: 'organization.name',
    field: {
      id: 'org_legal_name',
      type: 'text',
      label: 'Organization legal name',
      help: 'Use the name on your IRS letter or your state registration.',
      required: true,
      maxLength: 200,
      cgMapping: 'organization.name',
      blind: true,
    },
  },
  {
    key: 'org_ein',
    label: 'EIN',
    description: 'Employer Identification Number. Prefilled from the applicant profile.',
    tags: ['organization', 'identity', 'tax'],
    cgPath: 'organization.ein',
    field: {
      id: 'org_ein',
      type: 'ein',
      label: 'Employer Identification Number (EIN)',
      help: 'Nine digits, like 12-3456789. You can find it on your IRS letter.',
      required: true,
      cgMapping: 'organization.ein',
      blind: false,
    },
  },
  {
    key: 'org_uei',
    label: 'UEI',
    description: 'Unique Entity ID from SAM.gov, for federal pass-through funds.',
    tags: ['organization', 'identity', 'federal'],
    cgPath: 'organization.uei',
    field: {
      id: 'org_uei',
      type: 'uei',
      label: 'Unique Entity ID (UEI)',
      help: 'The 12-character ID from SAM.gov. Leave blank if you do not have one yet.',
      cgMapping: 'organization.uei',
    },
  },
  {
    key: 'org_mission',
    label: 'Mission statement',
    description: 'The organization’s mission, up to 150 words.',
    tags: ['organization', 'narrative'],
    cgPath: 'organization.mission',
    field: { id: 'org_mission', type: 'long_text', label: 'What is your organization’s mission?', required: true, maxWords: 150, cgMapping: 'organization.mission' },
  },
  {
    key: 'org_annual_budget',
    label: 'Annual operating budget',
    description: 'Current-year operating budget in dollars.',
    tags: ['organization', 'finance'],
    cgPath: 'organization.annualBudget',
    field: {
      id: 'annual_budget',
      type: 'currency',
      label: 'What is your organization’s annual operating budget?',
      help: 'Use your budget for this fiscal year. A close estimate is fine.',
      required: true,
      min: 0,
      cgMapping: 'organization.annualBudget',
      blind: false,
    },
  },
  {
    key: 'org_address',
    label: 'Mailing address',
    description: 'Organization mailing address.',
    tags: ['organization', 'contact'],
    cgPath: 'organization.address',
    field: { id: 'org_address', type: 'address', label: 'Mailing address', required: true, cgMapping: 'organization.address', blind: true },
  },
  {
    key: 'org_website',
    label: 'Website',
    description: 'Organization website (optional).',
    tags: ['organization', 'contact'],
    cgPath: 'organization.website',
    field: { id: 'org_website', type: 'text', label: 'Website', help: 'For example, https://www.example.org', maxLength: 300, cgMapping: 'organization.website', blind: true },
  },
  {
    key: 'org_type',
    label: 'Organization type',
    description: 'Legal status of the applicant.',
    tags: ['organization', 'eligibility'],
    cgPath: 'organization.type',
    field: {
      id: 'org_type',
      type: 'select',
      label: 'What kind of organization are you?',
      required: true,
      cgMapping: 'organization.type',
      options: [
        { value: 'nonprofit_501c3', label: '501(c)(3) nonprofit' },
        { value: 'fiscally_sponsored', label: 'Project with a fiscal sponsor' },
        { value: 'public_agency', label: 'Public agency or school' },
        { value: 'tribal', label: 'Tribal government or organization' },
        { value: 'for_profit', label: 'For-profit business' },
        { value: 'other', label: 'Other' },
      ],
      eligibility: { op: 'eq', value: 'for_profit', message: 'This fund supports nonprofits, public agencies and tribal organizations. For-profit businesses are not eligible.' },
    },
  },
  {
    key: 'fiscally_sponsored',
    label: 'Fiscally sponsored?',
    description: 'Yes/no gate for fiscal sponsor questions.',
    tags: ['organization', 'fiscal sponsor'],
    field: {
      id: 'fiscally_sponsored',
      type: 'yes_no',
      label: 'Is your organization fiscally sponsored?',
      help: 'Choose Yes if another nonprofit receives grants on your behalf.',
      required: true,
    },
  },
  {
    key: 'sponsor_name',
    label: 'Fiscal sponsor name',
    description: 'Shown and required only when the applicant is fiscally sponsored.',
    tags: ['organization', 'fiscal sponsor'],
    cgPath: 'organization.fiscalSponsor.name',
    field: {
      id: 'sponsor_name',
      type: 'text',
      label: 'Fiscal sponsor’s legal name',
      maxLength: 200,
      visibleWhen: FISCALLY_SPONSORED,
      requiredWhen: FISCALLY_SPONSORED,
      cgMapping: 'organization.fiscalSponsor.name',
      blind: true,
    },
  },
  {
    key: 'sponsor_ein',
    label: 'Fiscal sponsor EIN',
    description: 'Shown and required only when the applicant is fiscally sponsored.',
    tags: ['organization', 'fiscal sponsor', 'tax'],
    cgPath: 'organization.fiscalSponsor.ein',
    field: {
      id: 'sponsor_ein',
      type: 'ein',
      label: 'Fiscal sponsor’s EIN',
      help: 'Nine digits, like 12-3456789.',
      visibleWhen: FISCALLY_SPONSORED,
      requiredWhen: FISCALLY_SPONSORED,
      cgMapping: 'organization.fiscalSponsor.ein',
      blind: false,
    },
  },
  {
    key: 'counties_served',
    label: 'Counties served',
    description: 'Alder, Bramble, Cinder, Other.',
    tags: ['geography'],
    field: { id: 'counties_served', type: 'multi_select', label: 'Which counties do you serve?', help: 'Choose all that apply.', required: true, options: COUNTY_OPTIONS, blind: false },
  },
  {
    key: 'contact_name',
    label: 'Primary contact name',
    description: 'First and last name of the main contact.',
    tags: ['contact'],
    cgPath: 'contact.name',
    field: { id: 'contact_name', type: 'name', label: 'Primary contact', required: true, cgMapping: 'contact.name', blind: true },
  },
  {
    key: 'contact_email',
    label: 'Primary contact email',
    description: 'Where we send updates about this application.',
    tags: ['contact'],
    cgPath: 'contact.email',
    field: { id: 'contact_email', type: 'email', label: 'Contact email', required: true, cgMapping: 'contact.email', blind: true },
  },
  {
    key: 'contact_phone',
    label: 'Primary contact phone',
    description: 'Phone number with area code.',
    tags: ['contact'],
    cgPath: 'contact.phone',
    field: { id: 'contact_phone', type: 'phone', label: 'Contact phone', cgMapping: 'contact.phone', blind: true },
  },
  {
    key: 'project_title',
    label: 'Project title',
    description: 'Short project name, up to 100 characters.',
    tags: ['project'],
    cgPath: 'project.title',
    field: { id: 'project_title', type: 'text', label: 'Project title', help: 'A short name for your project.', required: true, maxLength: 100, cgMapping: 'project.title' },
  },
  {
    key: 'project_summary',
    label: 'Project summary',
    description: 'Plain-language summary, up to 150 words.',
    tags: ['project', 'narrative'],
    cgPath: 'project.summary',
    field: {
      id: 'project_summary',
      type: 'long_text',
      label: 'Summarize your project',
      help: 'In a few sentences, tell us what you will do, who it is for, and why it matters.',
      required: true,
      maxWords: 150,
      cgMapping: 'project.summary',
    },
  },
  {
    key: 'age_groups',
    label: 'Age groups served',
    description: '12–14, 15–17, 18–24.',
    tags: ['project', 'youth'],
    field: { id: 'age_groups', type: 'checkbox_group', label: 'Which age groups will your project serve?', help: 'Check all that apply.', required: true, options: AGE_GROUP_OPTIONS },
  },
  {
    key: 'youth_served',
    label: 'Number of youth served',
    description: 'Whole number, at least 1.',
    tags: ['project', 'youth', 'indicator'],
    cgPath: 'project.beneficiaryCount',
    field: {
      id: 'youth_served',
      type: 'number',
      label: 'How many young people will take part?',
      help: 'Your best estimate is fine.',
      required: true,
      integer: true,
      min: 1,
      indicator: 'youth_served',
      cgMapping: 'project.beneficiaryCount',
    },
  },
  {
    key: 'activities',
    label: 'Activities',
    description: 'What participants will do, up to 300 words.',
    tags: ['project', 'narrative'],
    field: {
      id: 'activities',
      type: 'long_text',
      label: 'What activities will young people take part in?',
      help: 'Describe a typical week or session. Include where it happens and who leads it.',
      required: true,
      maxWords: 300,
    },
  },
  {
    key: 'project_start',
    label: 'Project start date',
    description: 'When the funded work begins.',
    tags: ['project', 'dates'],
    cgPath: 'project.startDate',
    field: { id: 'project_start', type: 'date', label: 'Project start date', required: true, cgMapping: 'project.startDate' },
  },
  {
    key: 'project_end',
    label: 'Project end date',
    description: 'When the funded work ends.',
    tags: ['project', 'dates'],
    cgPath: 'project.endDate',
    field: { id: 'project_end', type: 'date', label: 'Project end date', required: true, cgMapping: 'project.endDate' },
  },
  {
    key: 'outcomes',
    label: 'Outcomes',
    description: 'Expected changes for participants, up to 300 words.',
    tags: ['project', 'narrative', 'evaluation'],
    field: {
      id: 'outcomes',
      type: 'long_text',
      label: 'What will be different for young people because of this project?',
      help: 'Name two or three changes you hope to see, and how you will know they happened.',
      required: true,
      maxWords: 300,
    },
  },
  {
    key: 'evaluation_plan',
    label: 'Evaluation plan',
    description: 'How progress will be tracked, up to 250 words.',
    tags: ['project', 'evaluation'],
    field: { id: 'evaluation_plan', type: 'long_text', label: 'How will you track your progress?', required: true, maxWords: 250 },
  },
  {
    key: 'partners',
    label: 'Partners',
    description: 'Partner organizations and their roles.',
    tags: ['project'],
    field: { id: 'partners', type: 'long_text', label: 'Who are your partners, and what will each of them do?', maxWords: 200 },
  },
  {
    key: 'request_amount',
    label: 'Request amount',
    description: 'Amount requested, in dollars.',
    tags: ['budget', 'finance'],
    cgPath: 'funding.requestedAmount',
    field: {
      id: 'request_amount',
      type: 'currency',
      label: 'How much are you requesting?',
      required: true,
      min: 0,
      cgMapping: 'funding.requestedAmount',
      blind: false,
    },
  },
  {
    key: 'total_project_cost',
    label: 'Total project cost',
    description: 'Full cost of the project from all sources.',
    tags: ['budget', 'finance'],
    cgPath: 'funding.totalProjectCost',
    field: { id: 'total_project_cost', type: 'currency', label: 'What is the total cost of the project?', required: true, min: 0, cgMapping: 'funding.totalProjectCost', blind: false },
  },
  {
    key: 'budget_lines',
    label: 'Budget table',
    description: 'Line item / category / amount; the amounts must add up to the request.',
    tags: ['budget', 'finance'],
    field: {
      id: 'budget_lines',
      type: 'repeater_table',
      label: 'Budget',
      help: 'List each cost on its own line. Your lines must add up to the amount you are requesting.',
      required: true,
      minRows: 1,
      maxRows: 30,
      addLabel: 'Add a budget line',
      blind: false,
      columns: [
        { id: 'item', type: 'text', label: 'Line item', required: true, maxLength: 120 },
        { id: 'category', type: 'select', label: 'Category', required: true, options: BUDGET_CATEGORY_OPTIONS },
        { id: 'amount', type: 'currency', label: 'Amount', required: true, min: 0 },
      ],
      sumEquals: { column: 'amount', field: 'request_amount', noun: 'budget lines' },
    },
  },
  {
    key: 'other_funding',
    label: 'Other funding sources',
    description: 'Other secured or pending funding (optional).',
    tags: ['budget', 'finance'],
    field: {
      id: 'other_funding',
      type: 'long_text',
      label: 'What other funding do you have or expect for this project?',
      help: 'Optional. List sources and amounts, and say whether each is secured or pending.',
      maxWords: 200,
      blind: false,
    },
  },
  {
    key: 'budget_file',
    label: 'Budget file',
    description: 'PDF or XLSX, up to 10 MB.',
    tags: ['attachments', 'budget'],
    field: {
      id: 'budget_file',
      type: 'file_upload',
      label: 'Upload your project budget',
      help: 'A PDF or Excel (XLSX) file, up to 10 MB.',
      required: true,
      accept: ['pdf', 'xlsx'],
      maxBytes: 10 * MB,
      blind: false,
    },
  },
  {
    key: 'support_letter',
    label: 'Letter of support',
    description: 'Optional PDF, up to 10 MB.',
    tags: ['attachments'],
    field: {
      id: 'support_letter',
      type: 'file_upload',
      label: 'Letter of support (optional)',
      help: 'A PDF up to 10 MB from a partner, school or community member.',
      accept: ['pdf'],
      maxBytes: 10 * MB,
    },
  },
  {
    key: 'ai_disclosure',
    label: 'AI-assistance disclosure',
    description: 'Required only when the form’s “AI disclosure” setting (flag `aiDisclosure`) is on.',
    tags: ['attachments', 'disclosure'],
    field: {
      id: 'ai_disclosure',
      type: 'long_text',
      label: 'Did you use AI tools to help write this application? If so, tell us how.',
      help: 'Using AI tools is fine and will not affect your score. If you did not use any, write “None.”',
      maxWords: 150,
      requiredWhen: { flag: 'aiDisclosure' },
      reviewerNotes: 'Disclosure is for transparency only. Do not score it.',
    },
  },
  {
    key: 'attestation',
    label: 'Attestation',
    description: 'Statement, checkbox and typed name.',
    tags: ['attestation'],
    field: {
      id: 'attestation',
      type: 'attestation',
      label: 'Confirm and sign',
      statement:
        'I confirm that the information in this application is true and complete to the best of my knowledge, and that I am allowed to submit it for my organization.',
      required: true,
      requireName: true,
    },
  },
  {
    key: 'demographics_note',
    label: 'Communities served (optional)',
    description: 'Optional narrative about the communities and young people served; never scored.',
    tags: ['project', 'demographics'],
    field: {
      id: 'demographics_note',
      type: 'long_text',
      label: 'Tell us about the young people and communities you serve (optional).',
      help: 'Share only what you are comfortable sharing. We use this to understand who our grants reach. It is not scored.',
      maxWords: 200,
      reviewerNotes: 'Context only. Not a scoring criterion.',
    },
  },
  {
    key: 'youth_served_to_date',
    label: 'Youth served to date',
    description: 'Grantee report indicator: young people served so far.',
    tags: ['report', 'indicator', 'youth'],
    field: {
      id: 'youth_served_to_date',
      type: 'number',
      label: 'How many young people have taken part so far?',
      help: 'Count each young person once, even if they came to many sessions.',
      required: true,
      integer: true,
      min: 0,
      indicator: 'youth_served',
    },
  },
  {
    key: 'progress_narrative',
    label: 'Progress narrative',
    description: 'Grantee report: what happened so far, up to 400 words.',
    tags: ['report', 'narrative'],
    field: { id: 'progress_narrative', type: 'long_text', label: 'What have you done so far?', help: 'Share highlights, numbers and a short story if you have one.', required: true, maxWords: 400 },
  },
  {
    key: 'challenges',
    label: 'Challenges',
    description: 'Grantee report: what got in the way and what changed.',
    tags: ['report', 'narrative'],
    field: { id: 'challenges', type: 'long_text', label: 'What challenges came up, and how did you respond?', required: true, maxWords: 300 },
  },
  {
    key: 'budget_to_actual',
    label: 'Budget to actual',
    description: 'Grantee report: budgeted vs. spent by line.',
    tags: ['report', 'budget'],
    field: {
      id: 'budget_to_actual',
      type: 'repeater_table',
      label: 'Budget compared with spending',
      help: 'For each budget line, enter what you planned and what you have spent so far.',
      required: true,
      minRows: 1,
      maxRows: 30,
      addLabel: 'Add a line',
      columns: [
        { id: 'item', type: 'text', label: 'Line item', required: true, maxLength: 120 },
        { id: 'budgeted', type: 'currency', label: 'Budgeted', required: true, min: 0 },
        { id: 'spent', type: 'currency', label: 'Spent so far', required: true, min: 0 },
        { id: 'note', type: 'text', label: 'Note', maxLength: 200 },
      ],
    },
  },
];

/** The default question bank (≥ 25 reusable items). */
export const QUESTION_BANK: readonly QuestionBankItem[] = ITEMS;

/** A fresh copy of a question bank item's field, with optional overrides (e.g. a new id). */
export function instantiateQuestion(key: string, overrides: Partial<FieldInput> = {}): Field {
  const item = ITEMS.find((i) => i.key === key);
  if (!item) throw new Error(`Unknown question bank item "${key}"`);
  return FieldSchema.parse({ ...structuredClone(item.field), ...overrides });
}

function q(key: string, overrides: Record<string, unknown> = {}): FieldInput {
  const item = ITEMS.find((i) => i.key === key);
  if (!item) throw new Error(`Unknown question bank item "${key}"`);
  return { ...structuredClone(item.field), ...overrides } as FieldInput;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Youth Arts Fund 2027 — Letter of Inquiry (the flagship demo form).
 *
 * The AI-assistance disclosure is required only when the form-level flag `aiDisclosure` is on
 * (`requiredWhen: { flag: 'aiDisclosure' }`). Flags are resolved at compile time, so staff flip
 * the switch in form settings and publish a new version. This template ships with it on.
 */
export const YOUTH_ARTS_LOI: FormModel = defineForm({
  version: 1,
  title: 'Youth Arts Fund 2027 — Letter of Inquiry',
  description: 'Tell us about your organization and your project. This takes about 30 minutes. You can save and come back at any time.',
  flags: { aiDisclosure: true },
  pages: [
    {
      id: 'about_org',
      title: 'About your organization',
      elements: [
        q('org_legal_name'),
        q('org_ein'),
        q('fiscally_sponsored'),
        q('sponsor_name'),
        q('sponsor_ein'),
        q('org_annual_budget'),
        q('counties_served'),
      ],
    },
    {
      id: 'project',
      title: 'Your project',
      elements: [q('project_title'), q('project_summary'), q('age_groups'), q('youth_served'), q('activities')],
    },
    {
      id: 'budget',
      title: 'Budget',
      elements: [
        q('request_amount', { help: 'Requests can be from $5,000 to $25,000.', min: 500_000, max: 2_500_000 }),
        q('budget_lines'),
        q('other_funding'),
      ],
    },
    {
      id: 'attachments',
      title: 'Attachments & attestation',
      elements: [
        q('budget_file'),
        q('support_letter'),
        q('ai_disclosure'),
        q('attestation', {
          statement:
            'I confirm that the information in this letter of inquiry is true and complete to the best of my knowledge, and that I am allowed to submit it for my organization.',
        }),
      ],
    },
  ],
});

/** Field ids of the LOI, for the app and e2e tests. */
export const LOI_FIELD_IDS = {
  orgLegalName: 'org_legal_name',
  orgEin: 'org_ein',
  fiscallySponsored: 'fiscally_sponsored',
  sponsorName: 'sponsor_name',
  sponsorEin: 'sponsor_ein',
  annualBudget: 'annual_budget',
  countiesServed: 'counties_served',
  projectTitle: 'project_title',
  projectSummary: 'project_summary',
  ageGroups: 'age_groups',
  youthServed: 'youth_served',
  activities: 'activities',
  requestAmount: 'request_amount',
  budgetLines: 'budget_lines',
  otherFunding: 'other_funding',
  budgetFile: 'budget_file',
  supportLetter: 'support_letter',
  aiDisclosure: 'ai_disclosure',
  attestation: 'attestation',
} as const;

export const FULL_PROPOSAL_TEMPLATE: FormModel = defineForm({
  version: 1,
  title: 'Full proposal',
  description: 'The full application for invited applicants.',
  flags: { aiDisclosure: false },
  pages: [
    {
      id: 'organization',
      title: 'Your organization',
      elements: [
        q('org_legal_name'),
        q('org_ein'),
        q('org_uei'),
        q('org_type'),
        q('org_mission'),
        q('org_address'),
        q('org_website'),
        {
          type: 'section',
          id: 'contact',
          title: 'Primary contact',
          description: 'The person we should contact about this proposal.',
          elements: [q('contact_name'), q('contact_email'), q('contact_phone')],
        },
      ],
    },
    {
      id: 'project',
      title: 'Your project',
      elements: [
        q('project_title'),
        q('project_summary', { type: 'rich_text', maxWords: 500, label: 'Describe your project' }),
        q('project_start'),
        q('project_end'),
        q('age_groups'),
        q('youth_served'),
        q('outcomes'),
        q('evaluation_plan'),
        q('partners'),
        q('demographics_note'),
      ],
    },
    {
      id: 'budget',
      title: 'Budget',
      elements: [
        q('request_amount'),
        q('total_project_cost'),
        q('budget_lines', {
          help: 'List every cost for the whole project, from all funding sources. Your lines must add up to the total project cost.',
          sumEquals: { column: 'amount', field: 'total_project_cost', noun: 'budget lines' },
        }),
        q('other_funding'),
      ],
    },
    {
      id: 'attachments',
      title: 'Attachments & attestation',
      elements: [
        q('budget_file'),
        {
          id: 'financial_statements',
          type: 'file_upload',
          label: 'Most recent financial statements',
          help: 'Your latest audit, review, or board-approved financials. PDF, up to 20 MB.',
          required: true,
          accept: ['pdf'],
          maxBytes: 20 * MB,
        },
        {
          id: 'board_list',
          type: 'file_upload',
          label: 'Board of directors list (optional)',
          help: 'PDF or Word document.',
          accept: ['pdf', 'docx'],
          maxBytes: 10 * MB,
          blind: true,
        },
        q('support_letter', { multiple: true, maxFiles: 3, label: 'Letters of support (optional, up to 3)' }),
        q('ai_disclosure'),
        q('attestation'),
      ],
    },
  ],
});

export const INTERIM_REPORT_TEMPLATE: FormModel = defineForm({
  version: 1,
  title: 'Grantee interim report',
  description: 'A mid-grant check-in. Tell us how things are going. Short answers are fine.',
  pages: [
    {
      id: 'progress',
      title: 'Progress',
      elements: [
        q('progress_narrative'),
        q('youth_served_to_date'),
        {
          id: 'milestone_status',
          type: 'likert_matrix',
          label: 'How is each part of the project going?',
          help: 'Pick the answer that fits best for each row.',
          required: true,
          rows: [
            { id: 'recruitment', label: 'Recruiting participants' },
            { id: 'programming', label: 'Running sessions' },
            { id: 'staffing', label: 'Staffing' },
          ],
          scale: [
            { value: 'behind', label: 'Behind' },
            { value: 'on_track', label: 'On track' },
            { value: 'ahead', label: 'Ahead' },
          ],
        },
      ],
    },
    { id: 'budget', title: 'Budget', elements: [q('budget_to_actual')] },
    {
      id: 'reflection',
      title: 'Challenges & attestation',
      elements: [
        q('challenges'),
        q('attestation', { statement: 'I confirm that this report is accurate to the best of my knowledge.' }),
      ],
    },
  ],
});

export const FINAL_REPORT_TEMPLATE: FormModel = defineForm({
  version: 1,
  title: 'Final report',
  description: 'Wrap up your grant. Tell us what happened and what you learned.',
  pages: [
    {
      id: 'results',
      title: 'Results',
      elements: [
        {
          id: 'outcomes_narrative',
          type: 'long_text',
          label: 'What changed for young people because of this project?',
          required: true,
          maxWords: 500,
        },
        q('youth_served_to_date', { id: 'youth_served_total', label: 'How many young people took part in total?' }),
        {
          id: 'participant_story',
          type: 'long_text',
          label: 'Share a short story about one participant (optional).',
          help: 'Please leave out names and other details that could identify a young person.',
          maxWords: 250,
        },
      ],
    },
    {
      id: 'budget',
      title: 'Budget',
      elements: [
        q('budget_to_actual', { label: 'Final budget compared with spending' }),
        {
          id: 'final_financial_report',
          type: 'file_upload',
          label: 'Final financial report',
          help: 'PDF or Excel (XLSX), up to 10 MB.',
          required: true,
          accept: ['pdf', 'xlsx'],
          maxBytes: 10 * MB,
        },
      ],
    },
    {
      id: 'learning',
      title: 'Learning & attestation',
      elements: [
        { id: 'lessons_learned', type: 'long_text', label: 'What did you learn that you would share with others?', required: true, maxWords: 300 },
        q('attestation', { statement: 'I confirm that this final report is accurate to the best of my knowledge.' }),
      ],
    },
  ],
});

export const GENERAL_OPERATING_TEMPLATE: FormModel = defineForm({
  version: 1,
  title: 'General operating support',
  description: 'A short application for flexible funding.',
  pages: [
    {
      id: 'application',
      title: 'Application',
      elements: [
        q('org_legal_name'),
        q('org_ein'),
        q('org_mission'),
        q('org_annual_budget'),
        q('counties_served'),
        q('request_amount'),
        {
          id: 'use_of_funds',
          type: 'long_text',
          label: 'How would flexible funding help your organization this year?',
          required: true,
          maxWords: 250,
        },
        q('attestation'),
      ],
    },
  ],
});

export type TemplateKind = 'application' | 'loi' | 'report';

export interface FormTemplate {
  key: string;
  name: string;
  description: string;
  /** Matches `forms.kind` / `form_templates.kind`. */
  kind: TemplateKind;
  model: FormModel;
}

export const FORM_TEMPLATES: readonly FormTemplate[] = [
  { key: 'youth_arts_loi_2027', name: YOUTH_ARTS_LOI.title, description: 'Four-page letter of inquiry with a budget table and attestation.', kind: 'loi', model: YOUTH_ARTS_LOI },
  { key: 'full_proposal', name: FULL_PROPOSAL_TEMPLATE.title, description: 'Full application with project plan, budget and attachments.', kind: 'application', model: FULL_PROPOSAL_TEMPLATE },
  { key: 'interim_report', name: INTERIM_REPORT_TEMPLATE.title, description: 'Mid-grant progress, youth served to date and budget to actual.', kind: 'report', model: INTERIM_REPORT_TEMPLATE },
  { key: 'final_report', name: FINAL_REPORT_TEMPLATE.title, description: 'End-of-grant outcomes, totals and lessons learned.', kind: 'report', model: FINAL_REPORT_TEMPLATE },
  { key: 'general_operating', name: GENERAL_OPERATING_TEMPLATE.title, description: 'One-page application for general operating support.', kind: 'application', model: GENERAL_OPERATING_TEMPLATE },
];

/** A deep copy of a template's model, safe to edit. */
export function templateModel(key: string): FormModel {
  const t = FORM_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown form template "${key}"`);
  return structuredClone(t.model);
}
