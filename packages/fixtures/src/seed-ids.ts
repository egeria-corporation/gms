// SPDX-License-Identifier: AGPL-3.0-or-later
// Stable identifiers tests can rely on. Every id is derived from a name (see ids.ts), so it is the same on
// every run. Workspace ids are created by the setup action, so tests should look workspaces up by slug.
import { sid } from './ids';

const ALWAYS_OPEN_SLUG = 'neighborhood-food-security-rapid-response-2027';
const FLAGSHIP_SLUG = 'youth-arts-fund-2027';
const MAYA_EMAIL = 'maya@eastside-youth-music.example';

const mayaAwardApplicationId = sid('application:halcyon:yaf2025:eastside-youth-music-collective');
const mayaAwardId = sid(`award:${mayaAwardApplicationId}`);

/** Deterministic user id for a demo email. */
export function userId(email: string): string {
  return sid(`user:${email.toLowerCase()}`);
}

export const SEED_IDS = {
  workspaces: { halcyon: 'halcyon', marigold: 'marigold', sunbeam: 'sunbeam' },
  flagship: {
    slug: FLAGSHIP_SLUG,
    opportunityId: sid(`opportunity:halcyon:${FLAGSHIP_SLUG}`),
    loiCompetitionId: sid(`competition:halcyon:${FLAGSHIP_SLUG}:1`),
    fullProposalCompetitionId: sid(`competition:halcyon:${FLAGSHIP_SLUG}:2`),
    loiFormId: sid('form:halcyon:yaf-2027-loi'),
    loiFormVersionId: sid('form-version:halcyon:yaf-2027-loi:1'),
  },
  alwaysOpen: {
    slug: ALWAYS_OPEN_SLUG,
    opportunityId: sid(`opportunity:halcyon:${ALWAYS_OPEN_SLUG}`),
    competitionId: sid(`competition:halcyon:${ALWAYS_OPEN_SLUG}:1`),
    formId: sid('form:halcyon:rapid-response'),
  },
  marigoldOpportunity: { slug: 'organizing-small-grants-2027', opportunityId: sid('opportunity:marigold:organizing-small-grants-2027') },
  sunbeamOpportunity: { slug: 'community-mini-grants-2027', opportunityId: sid('opportunity:sunbeam:community-mini-grants-2027') },
  programs: {
    youthArts: sid('program:halcyon:yaf'),
    foodSecurity: sid('program:halcyon:nfs'),
    capacity: sid('program:halcyon:cbg'),
  },
  maya: {
    email: MAYA_EMAIL,
    userId: userId(MAYA_EMAIL),
    orgId: sid('org:eastside-youth-music-collective'),
    /** Her in-progress flagship LOI, drafted by her Grant Writer Assistant (submission awaits her confirmation). */
    flagshipLoiApplicationId: sid('application:halcyon:flagship:eastside-youth-music-collective'),
    awardApplicationId: mayaAwardApplicationId,
    awardId: mayaAwardId,
    upcomingReportRequirementId: sid(`report-req:${mayaAwardId}:year2-interim`),
  },
  orgs: {
    eastside: sid('org:eastside-youth-music-collective'),
    lumen: sid('org:lumen-literacy-project'),
    cedarHollow: sid('org:cedar-hollow-food-pantry'),
    oldMill: sid('org:old-mill-arts-guild'),
  },
  bank: {
    connectionId: sid('bank-connection:halcyon'),
    operatingAccountId: sid('bank-account:halcyon:operating'),
    youthArtsAccountId: sid('bank-account:halcyon:youth-arts'),
  },
  /** Created by Priya Natarajan; under the second-approval threshold, so Marcus Webb alone can approve it. */
  batchAwaitingApprovalId: sid('batch:await'),
  draftBatchId: sid('batch:draft'),
  currentDocketId: sid('docket:current'),
  intakeAgentClientId: sid('agent:halcyon-intake'),
} as const;
