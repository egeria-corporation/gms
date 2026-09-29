// SPDX-License-Identifier: AGPL-3.0-or-later
// Fictional sample props for every document (preview routes and tests).

import { splitInstallments } from '@gms/domain';
import type { Brand } from './brand';
import type { Installment, ReportingRequirement } from './components';
import type { ApplicationPacketProps } from './documents/application-packet';
import type { AwardLetterProps, AwardTerms, GrantAgreementProps } from './documents/awards';
import type { BoardBookProps } from './documents/board-book';
import type { RemittanceAdviceProps } from './documents/remittance';

const TZ = 'America/Los_Angeles';
const [first, second] = splitInstallments(2_500_000, 2) as [number, number];

export const previewBrand: Brand = {
  displayName: 'Halcyon Ridge Foundation',
  logoUrl: null,
  primaryColor: '#1f6f5c',
  accentColor: '#e0a526',
  sourceUrl: 'https://github.com/egeria-corporation/gms',
};

const installments: Installment[] = [
  {
    label: 'Payment 1 of 2',
    dueDate: '2027-03-01',
    condition: 'After the agreement is signed',
    amountCents: first,
  },
  {
    label: 'Payment 2 of 2',
    dueDate: '2027-09-15',
    condition: 'After the interim report is accepted',
    amountCents: second,
  },
];

const reporting: ReportingRequirement[] = [
  {
    name: 'Interim report',
    dueDate: '2027-08-31',
    description: 'Progress so far, attendance numbers, and spending to date.',
  },
  {
    name: 'Final report',
    dueDate: '2028-03-31',
    description: 'Outcomes, stories from students, and a final budget.',
  },
];

const terms: AwardTerms = {
  awardReference: 'HRF-2027-014',
  opportunityName: 'Youth Arts Fund 2027',
  projectTitle: 'After-School Strings Program',
  amountCents: 2_500_000,
  currency: 'USD',
  periodStart: '2027-03-01',
  periodEnd: '2028-02-29',
  purpose:
    'To support free after-school violin, viola and cello lessons for 60 students in grades 3 to 8, including an instrument lending library and two public recitals.',
  installments,
  conditions: [
    'Use the funds only for the purpose described above.',
    'Tell the Foundation in writing about any major change to the project, budget or key staff.',
    'Return any funds not spent on the project by the end of the grant period.',
  ],
  reportingRequirements: reporting,
};

const awardLetter: AwardLetterProps = {
  ...terms,
  letterDate: '2027-02-15',
  foundationAddress: ['1200 Ridgeline Avenue, Suite 300', 'Portland, OR 97201'],
  recipient: {
    name: 'Maya Chen',
    title: 'Executive Director',
    organizationName: 'Eastside Youth Music Collective',
    address: ['418 Alder Street', 'Portland, OR 97214'],
  },
  message: 'We are proud to support your students and look forward to hearing them play.',
  signatory: { name: 'Helen Ortiz', title: 'Executive Director' },
  timeZone: TZ,
};

const agreement: GrantAgreementProps = {
  ...terms,
  agreementDate: '2027-02-20',
  foundation: {
    legalName: 'Halcyon Ridge Foundation',
    address: ['1200 Ridgeline Avenue, Suite 300', 'Portland, OR 97201'],
    ein: '00-0000001',
  },
  grantee: {
    legalName: 'Eastside Youth Music Collective',
    address: ['418 Alder Street', 'Portland, OR 97214'],
    ein: '00-0000042',
  },
  terms: [
    {
      heading: 'Use of funds',
      body: 'The Grantee will use the grant only for the purpose in this agreement and will keep records of how it was spent for at least three years.',
    },
    {
      heading: 'Reports',
      body: 'The Grantee will submit the reports listed above through the Foundation’s grantee portal by their due dates.',
    },
    {
      heading: 'Changes and ending the grant',
      body: 'Either party may end this agreement with 30 days’ written notice. The Foundation may pause payments if reports are overdue.',
    },
    {
      heading: 'Electronic signatures',
      body: 'The parties agree that typed electronic signatures on this agreement are binding, just like handwritten ones.',
    },
  ],
  signatures: [
    {
      party: 'For the grantee',
      organizationName: 'Eastside Youth Music Collective',
      signerName: 'Maya Chen',
      signerTitle: 'Executive Director',
      signature: {
        typedName: 'Maya Chen',
        signedAt: '2027-02-21T19:12:44Z',
        ipAddress: '203.0.113.24',
        documentHash: '5f2b8c1e9a7d4036b1c2e8f09a6d3b7e4c1f0a9d8e7b6c5a4f3e2d1c0b9a8f7e',
      },
    },
    {
      party: 'For the foundation',
      organizationName: 'Halcyon Ridge Foundation',
      signerName: 'Helen Ortiz',
      signerTitle: 'Executive Director',
      signature: null,
    },
  ],
  timeZone: TZ,
};

const packet: ApplicationPacketProps = {
  opportunityName: 'Youth Arts Fund 2027',
  applicationTitle: 'After-School Strings Program',
  referenceNumber: 'YAF27-0042',
  statusLabel: 'Under review',
  submittedAt: '2026-11-18T22:41:07Z',
  timeZone: TZ,
  requestedAmountCents: 2_500_000,
  currency: 'USD',
  organization: {
    name: 'Eastside Youth Music Collective',
    legalName: 'Eastside Youth Music Collective',
    ein: '00-0000042',
    address: ['418 Alder Street', 'Portland, OR 97214'],
    website: 'https://eastside-youth-music.example',
    mission:
      'We give every young person on the east side a chance to learn, play and perform music, free of charge.',
    annualBudgetCents: 48_000_000,
    contactName: 'Maya Chen',
    contactEmail: 'maya@eastside-youth-music.example',
  },
  answers: [
    { section: 'Project overview', label: 'Project title', value: 'After-School Strings Program' },
    {
      section: 'Project overview',
      label: 'Describe your project in a few sentences.',
      value:
        'Free string lessons three afternoons a week at two partner schools.\nStudents borrow instruments from our lending library and perform in two public recitals each year.',
    },
    { section: 'Project overview', label: 'How many young people will take part?', value: '60' },
    { section: 'Budget', label: 'Amount requested', value: '$25,000.00' },
    {
      section: 'Budget',
      label: 'How will you spend the grant?',
      value: 'Teaching artist fees: $15,000\nInstrument repairs and strings: $6,000\nRecital costs: $4,000',
    },
    { section: 'Budget', label: 'Other funding sources', value: '' },
    {
      section: 'Impact',
      label: 'How will you know the project worked?',
      value:
        'We track attendance, teacher-rated progress each term, and a short survey of students and families.',
    },
  ],
  attachments: [
    { name: 'Project budget.xlsx', section: 'Budget', sizeBytes: 48_213 },
    { name: 'IRS determination letter.pdf', section: 'Organization', sizeBytes: 612_904 },
    { name: 'Recital photos.zip', section: 'Impact', sizeBytes: 8_402_112 },
  ],
  eligibility: [
    { rule: 'Registered 501(c)(3) nonprofit', result: 'pass' },
    { rule: 'Serves youth in the Portland metro area', result: 'pass' },
    { rule: 'Annual budget under $2M', result: 'pass', detail: '$480,000' },
    { rule: 'No open grant from the same fund', result: 'review', detail: 'Prior grant closed in 2025' },
  ],
  generatedAt: '2026-12-01T17:00:00Z',
};

const remittance: RemittanceAdviceProps = {
  paymentId: 'PAY-2027-0314',
  payer: {
    name: 'Halcyon Ridge Foundation',
    address: ['1200 Ridgeline Avenue, Suite 300', 'Portland, OR 97201'],
  },
  payee: {
    organizationName: 'Eastside Youth Music Collective',
    attention: 'Maya Chen',
    address: ['418 Alder Street', 'Portland, OR 97214'],
  },
  paymentDate: '2027-03-02',
  amountCents: first,
  currency: 'USD',
  method: 'ach',
  awardReference: 'HRF-2027-014',
  installmentLabel: 'Payment 1 of 2',
  memo: 'Youth Arts Fund 2027 — first installment',
  bankReference: 'TRC-000000-4471',
};

const boardBook: BoardBookProps = {
  meetingTitle: 'Youth Arts Fund 2027 docket',
  meetingDate: '2027-02-10',
  meetingLocation: 'Ridgeline Room and video call',
  preparedBy: 'Priya Natarajan, Program Officer',
  currency: 'USD',
  availableCents: 10_000_000,
  agenda: [
    { time: '4:00 PM', item: 'Welcome and conflict-of-interest check', presenter: 'Helen Ortiz' },
    { time: '4:10 PM', item: 'Youth Arts Fund overview', presenter: 'Priya Natarajan' },
    { time: '4:25 PM', item: 'Discussion and vote on recommendations', presenter: 'Board chair' },
    { time: '5:15 PM', item: 'Next steps and close' },
  ],
  recommendations: [
    {
      referenceNumber: 'YAF27-0042',
      applicationTitle: 'After-School Strings Program',
      organizationName: 'Eastside Youth Music Collective',
      opportunityName: 'Youth Arts Fund 2027',
      summary:
        'Free string lessons for 60 students at two partner schools, with an instrument lending library and two public recitals.',
      requestedCents: 2_500_000,
      recommendedCents: 2_500_000,
      reviewScore: { average: 4.6, max: 5, reviewerCount: 3 },
      criteria: [
        { name: 'Community need', average: 4.7, max: 5 },
        { name: 'Program design', average: 4.5, max: 5 },
        { name: 'Budget clarity', average: 4.3, max: 5 },
      ],
      reviewerComments: [
        { reviewer: 'Reviewer 1', excerpt: 'Clear plan and a strong track record with this age group.' },
        { reviewer: 'Reviewer 3', excerpt: 'The lending library removes a real barrier for families.' },
      ],
      staffNote: 'Recommend full funding. Site visit in October went well.',
    },
    {
      referenceNumber: 'YAF27-0057',
      applicationTitle: 'Murals on Main',
      organizationName: 'Northgate Community Arts',
      opportunityName: 'Youth Arts Fund 2027',
      summary: 'Teens design and paint three public murals with a lead artist over the summer.',
      requestedCents: 4_000_000,
      recommendedCents: 3_000_000,
      reviewScore: { average: 4.1, max: 5, reviewerCount: 3 },
      reviewerComments: [
        { reviewer: 'Reviewer 2', excerpt: 'Great youth voice; the materials budget looks high.' },
      ],
      staffNote: 'Recommend partial funding; materials line reduced.',
    },
  ],
};

export const previewProps = {
  award_letter: awardLetter,
  agreement,
  application_packet: packet,
  remittance,
  board_book: boardBook,
};
