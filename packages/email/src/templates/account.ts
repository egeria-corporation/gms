// SPDX-License-Identifier: AGPL-3.0-or-later
// Sign-in, invites and agent confirmations.

import { formatInZone, ROLE_LABELS, type WorkspaceRole } from '@gms/domain';
import { defineTemplate, FIX, greeting } from './shared';

export interface MagicLinkProps {
  recipientName?: string | null;
  signInUrl: string;
  expiresInMinutes: number;
  /** Optional context about the request, e.g. "Chrome on macOS". */
  requestedFrom?: string | null;
}

export const magicLink = defineTemplate<MagicLinkProps>({
  name: 'Sign-in link',
  description: 'One-time link to sign in without a password.',
  audience: 'anyone',
  previewProps: {
    recipientName: FIX.applicant,
    signInUrl: 'https://halcyon.gms.example/auth/verify?token=preview-only-token',
    expiresInMinutes: 15,
    requestedFrom: 'Firefox on Windows',
  },
  build: (p, { brand }) => ({
    subject: `Your sign-in link for ${brand.displayName}`,
    preheader: `This link works once and expires in ${p.expiresInMinutes} minutes.`,
    reason: `someone asked to sign in to ${brand.displayName} with this email address.`,
    blocks: [
      { type: 'heading', text: 'Sign in to your account' },
      { type: 'paragraph', content: greeting(p.recipientName) },
      { type: 'paragraph', content: 'Use the button below to sign in. You won’t need a password.' },
      { type: 'button', label: 'Sign in', href: p.signInUrl },
      {
        type: 'callout',
        tone: 'info',
        title: `This link expires in ${p.expiresInMinutes} minutes`,
        content: 'It works one time only. If it expires, you can ask for a new one from the sign-in page.',
      },
      {
        type: 'fineprint',
        content: `Didn’t ask for this? You can ignore this email. Nobody can sign in without this link.${
          p.requestedFrom ? ` The request came from ${p.requestedFrom}.` : ''
        }`,
      },
    ],
  }),
});

export interface CollaboratorInviteProps {
  recipientName?: string | null;
  inviterName: string;
  organizationName: string;
  applicationTitle: string;
  opportunityName: string;
  acceptUrl: string;
  expiresAt: string;
  timeZone: string;
}

export const collaboratorInvite = defineTemplate<CollaboratorInviteProps>({
  name: 'Collaborator invite',
  description: 'An applicant invites a teammate to help with an application.',
  audience: 'applicant',
  previewProps: {
    recipientName: 'Jordan Reyes',
    inviterName: FIX.applicant,
    organizationName: FIX.org,
    applicationTitle: FIX.appTitle,
    opportunityName: FIX.opportunity,
    acceptUrl: `${FIX.portal}/invites/accept?token=preview-only-token`,
    expiresAt: '2026-10-11T00:00:00Z',
    timeZone: FIX.tz,
  },
  build: (p, { brand }) => ({
    subject: `${p.inviterName} invited you to work on an application`,
    preheader: `Help ${p.organizationName} with “${p.applicationTitle}” for ${p.opportunityName}.`,
    reason: `${p.inviterName} added this email address as a collaborator on an application to ${brand.displayName}.`,
    blocks: [
      { type: 'heading', text: 'You’re invited to collaborate' },
      { type: 'paragraph', content: greeting(p.recipientName) },
      {
        type: 'paragraph',
        content: [
          `${p.inviterName} at ${p.organizationName} invited you to help with an application to `,
          { text: brand.displayName, bold: true },
          '.',
        ],
      },
      {
        type: 'details',
        rows: [
          { label: 'Application', value: p.applicationTitle },
          { label: 'Opportunity', value: p.opportunityName },
          { label: 'Invite expires', value: formatInZone(p.expiresAt, p.timeZone) },
        ],
      },
      { type: 'button', label: 'Accept the invite', href: p.acceptUrl },
      {
        type: 'list',
        title: 'What happens next',
        items: [
          'You’ll sign in or create an account with this email address.',
          'Then you can read and edit the application together.',
          `Only ${p.organizationName}’s admins can submit it.`,
        ],
      },
      {
        type: 'fineprint',
        content: 'Not expecting this? You can ignore this email and nothing will change.',
      },
    ],
  }),
});

export interface StaffInviteProps {
  recipientName?: string | null;
  inviterName: string;
  role: WorkspaceRole;
  acceptUrl: string;
  expiresAt: string;
  timeZone: string;
}

export const staffInvite = defineTemplate<StaffInviteProps>({
  name: 'Team invite',
  description: 'A workspace admin invites someone to the foundation’s GMS workspace.',
  audience: 'staff',
  previewProps: {
    recipientName: 'Samuel Lee',
    inviterName: FIX.owner,
    role: 'program_officer',
    acceptUrl: `${FIX.staff}/invites/accept?token=preview-only-token`,
    expiresAt: '2026-10-04T17:00:00Z',
    timeZone: FIX.tz,
  },
  build: (p, { brand }) => {
    const role = ROLE_LABELS[p.role];
    return {
      subject: `Join ${brand.displayName} on GMS`,
      preheader: `${p.inviterName} invited you to join the team as ${role}.`,
      reason: `${p.inviterName} invited this email address to the ${brand.displayName} workspace.`,
      blocks: [
        { type: 'heading', text: `Join the ${brand.displayName} team` },
        { type: 'paragraph', content: greeting(p.recipientName) },
        {
          type: 'paragraph',
          content: [`${p.inviterName} invited you to join the team as `, { text: role, bold: true }, '.'],
        },
        {
          type: 'details',
          rows: [
            { label: 'Role', value: role },
            { label: 'Invite expires', value: formatInZone(p.expiresAt, p.timeZone) },
          ],
        },
        { type: 'button', label: 'Accept and join', href: p.acceptUrl },
        {
          type: 'list',
          title: 'What happens next',
          items: [
            'You’ll sign in with this email address.',
            'Some roles need two-step sign-in. If yours does, we’ll help you set it up.',
            'After that, you’ll land on your team’s home page.',
          ],
        },
        {
          type: 'fineprint',
          content: 'Not expecting this? You can ignore this email. The invite will expire on its own.',
        },
      ],
    };
  },
});

export interface AgentConfirmationRequestProps {
  recipientName?: string | null;
  /** The agent's display name, e.g. "Grant Assistant". */
  agentName: string;
  /** Who runs the agent, if known, e.g. "Connected by Maya Chen". */
  agentOperator?: string | null;
  /** Exact, plain summary of the action the agent wants to take. */
  actionSummary: string;
  actionDetails?: { label: string; value: string }[];
  requestedAt: string;
  expiresAt: string;
  timeZone: string;
  /** Signed, expiring link into GMS where the person reviews and confirms. */
  confirmUrl: string;
}

export const agentConfirmationRequest = defineTemplate<AgentConfirmationRequestProps>({
  name: 'Agent confirmation request',
  description: 'An AI agent asked to do something on your behalf that needs your confirmation.',
  audience: 'anyone',
  previewProps: {
    recipientName: FIX.applicant,
    agentName: 'Grant Assistant',
    agentOperator: 'Connected by Maya Chen on Sep 20, 2026',
    actionSummary: `Submit the application “${FIX.appTitle}” to ${FIX.opportunity}.`,
    actionDetails: [
      { label: 'Application', value: FIX.appTitle },
      { label: 'Requested amount', value: '$25,000.00' },
    ],
    requestedAt: '2026-09-27T18:04:00Z',
    expiresAt: '2026-09-28T18:04:00Z',
    timeZone: FIX.tz,
    confirmUrl: 'https://halcyon.gms.example/confirm/act_preview?sig=preview-only-signature',
  },
  build: (p, { brand }) => ({
    subject: `Confirm: ${p.agentName} wants to act for you`,
    preheader: `Nothing happens until you confirm inside ${brand.displayName}’s portal.`,
    reason: `an AI agent connected to your account asked to take an action that needs your OK.`,
    blocks: [
      { type: 'heading', text: 'An AI agent is waiting for your OK' },
      { type: 'paragraph', content: greeting(p.recipientName) },
      {
        type: 'paragraph',
        content: [
          { text: p.agentName, bold: true },
          ` asked to do this for you${p.agentOperator ? ` (${p.agentOperator})` : ''}:`,
        ],
      },
      { type: 'quote', attribution: 'The exact action', text: p.actionSummary },
      ...(p.actionDetails?.length ? [{ type: 'details' as const, rows: p.actionDetails }] : []),
      {
        type: 'callout',
        tone: 'warning',
        title: 'Nothing happens until you confirm',
        content:
          'You’ll review the full details and confirm inside GMS. Replying to this email does not confirm anything.',
      },
      { type: 'button', label: 'Review and decide', href: p.confirmUrl },
      {
        type: 'details',
        rows: [
          { label: 'Asked at', value: formatInZone(p.requestedAt, p.timeZone) },
          { label: 'Link expires', value: formatInZone(p.expiresAt, p.timeZone) },
        ],
      },
      {
        type: 'fineprint',
        content:
          'This link is signed for you and stops working when it expires. If you don’t recognize this agent, don’t confirm. You can remove its access from your account settings.',
      },
    ],
  }),
});

export interface DeploymentRequestProps {
  foundationName: string;
  workspaceSlug: string;
  requesterName: string;
  contactEmail: string;
  kind: 'custom_domain' | 'dedicated' | 'other';
  desiredDomain?: string | null;
  details: string;
  requestedAt: string;
  timeZone: string;
  /** The tenant's page in the operator console. */
  operatorUrl: string;
}

const DEPLOYMENT_KIND_LABELS: Record<DeploymentRequestProps['kind'], string> = {
  custom_domain: 'Their own domain',
  dedicated: 'A dedicated deployment',
  other: 'Something else',
};

export const deploymentRequest = defineTemplate<DeploymentRequestProps>({
  name: 'Custom deployment request',
  description: 'Sent to the platform team when a foundation asks for its own domain or a dedicated deployment.',
  audience: 'staff',
  previewProps: {
    foundationName: 'Halcyon Ridge Foundation',
    workspaceSlug: 'halcyon',
    requesterName: FIX.owner,
    contactEmail: 'helen@halcyonridge.example',
    kind: 'custom_domain',
    desiredDomain: 'grants.halcyonridge.example',
    details: 'We would like applicants to see our own domain in their browser and in our emails.',
    requestedAt: '2026-09-28T17:00:00Z',
    timeZone: FIX.tz,
    operatorUrl: 'https://gms.example/operator/preview-workspace',
  },
  build: (p) => ({
    subject: `Custom deployment request: ${p.foundationName}`,
    preheader: `${p.requesterName} asked for ${DEPLOYMENT_KIND_LABELS[p.kind].toLowerCase()}.`,
    reason: `${p.foundationName} filed a custom deployment request in GMS settings.`,
    blocks: [
      { type: 'heading', text: `${p.foundationName} asked for a custom deployment` },
      {
        type: 'details',
        rows: [
          { label: 'Foundation', value: `${p.foundationName} (${p.workspaceSlug})` },
          { label: 'Asked for', value: DEPLOYMENT_KIND_LABELS[p.kind] },
          ...(p.desiredDomain ? [{ label: 'Domain', value: p.desiredDomain }] : []),
          { label: 'Requested by', value: p.requesterName },
          { label: 'Contact', value: p.contactEmail },
          { label: 'Requested', value: formatInZone(p.requestedAt, p.timeZone) },
        ],
      },
      { type: 'paragraph', content: p.details },
      { type: 'button', label: 'Open in the operator console', href: p.operatorUrl },
      { type: 'fineprint', content: `Reply to ${p.contactEmail} to follow up.` },
    ],
  }),
});
