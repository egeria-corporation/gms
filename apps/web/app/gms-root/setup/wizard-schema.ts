// SPDX-License-Identifier: AGPL-3.0-or-later
// Setup wizard model, shared by the client wizard (per-step validation) and the server action
// (re-validates everything before running setup.initialize). Pure TS: no server or browser APIs.
import { ROLE_LABELS, WORKSPACE_ROLES, type WorkspaceRole } from '@gms/domain';
import { z } from 'zod';

export const STEPS = ['owner', 'brand', 'email', 'payments', 'program', 'team'] as const;
export type StepId = (typeof STEPS)[number];

export const STEP_TITLES: Record<StepId, string> = {
  owner: 'About you',
  brand: 'Foundation and brand',
  email: 'Email',
  payments: 'Payments',
  program: 'First program',
  team: 'Invite your team',
};

export function isStep(v: unknown): v is StepId {
  return typeof v === 'string' && (STEPS as readonly string[]).includes(v);
}

/** Labels accepted by setup.create_workspace (stored in workspace_brand.heading_font). */
export const FONT_LABELS = ['Inter', 'Source Serif 4', 'Atkinson Hyperlegible', 'Figtree'] as const;
export type FontLabel = (typeof FONT_LABELS)[number];

export const PAYMENT_CHOICES = ['fake', 'sandbox', 'manual', 'later'] as const;
export type PaymentChoice = (typeof PAYMENT_CHOICES)[number];

export type InviteRole = Exclude<WorkspaceRole, 'owner'>;
export const INVITE_ROLES = WORKSPACE_ROLES.filter((r): r is InviteRole => r !== 'owner');
export const MAX_INVITES = 20;

export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Mountain, no DST (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { value: 'America/Puerto_Rico', label: 'Atlantic (Puerto Rico)' },
  { value: 'America/Toronto', label: 'Eastern (Toronto)' },
  { value: 'Europe/London', label: 'United Kingdom (London)' },
  { value: 'Europe/Berlin', label: 'Central Europe (Berlin)' },
  { value: 'UTC', label: 'UTC' },
];

/** Subdomains that would collide with platform hosts. */
export const RESERVED_SLUGS = ['www', 'api', 'app', 'admin', 'auth', 'mail', 'root', 'gms', 'setup', 'operator', 'static', 'assets', 'status', 'help', 'docs', 'support'];

export interface InviteDraft {
  /** Stable React key; never sent to the server. */
  key: string;
  email: string;
  role: InviteRole;
}

export interface SetupDraft {
  ownerName: string;
  ownerEmail: string;
  name: string;
  slug: string;
  timezone: string;
  primary: string;
  accent: string;
  headingFont: FontLabel;
  senderName: string;
  replyTo: string;
  payments: PaymentChoice;
  programSkip: boolean;
  programName: string;
  causeArea: string;
  oppTitle: string;
  templateKey: string;
  invites: InviteDraft[];
}

export const DEFAULT_TEMPLATE_KEY = 'general_operating';

export function emptyDraft(): SetupDraft {
  return {
    ownerName: '',
    ownerEmail: '',
    name: '',
    slug: '',
    timezone: 'America/Los_Angeles',
    primary: '#1F4E79',
    accent: '#C9822B',
    headingFont: 'Inter',
    senderName: '',
    replyTo: '',
    payments: 'later',
    programSkip: false,
    programName: '',
    causeArea: '',
    oppTitle: '',
    templateKey: DEFAULT_TEMPLATE_KEY,
    invites: [{ key: 'i0', email: '', role: 'program_officer' }],
  };
}

/** Realistic fictional data for previews and forced states (dev tools only). */
export function previewDraft(): SetupDraft {
  return {
    ...emptyDraft(),
    ownerName: 'Rosa Delgado',
    ownerEmail: 'rosa@juniperfund.example',
    name: 'Juniper Valley Community Fund',
    slug: 'juniper-valley',
    timezone: 'America/Denver',
    primary: '#2F5D50',
    accent: '#D9822B',
    headingFont: 'Source Serif 4',
    senderName: 'Juniper Valley Community Fund',
    replyTo: 'grants@juniperfund.example',
    payments: 'fake',
    programName: 'Rural Youth Futures',
    causeArea: 'Youth development',
    oppTitle: '2027 Rural Youth Futures grants',
    templateKey: DEFAULT_TEMPLATE_KEY,
    invites: [
      { key: 'i0', email: 'marcus@juniperfund.example', role: 'program_officer' },
      { key: 'i1', email: 'lena@juniperfund.example', role: 'finance' },
    ],
  };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export type FieldErrors = Record<string, string>;

/** DOM id for a field key (ValidationSummary links to "#<id>"). */
export function fieldId(key: string): string {
  return `setup-${key}`;
}

const EmailSchema = z.string().trim().email();
const HEX = /^#[0-9A-Fa-f]{6}$/;
const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function isEmail(v: string): boolean {
  return EmailSchema.safeParse(v).success;
}

/** Invite rows the person actually filled in (fully blank rows are ignored). */
export function filledInvites(d: SetupDraft): { index: number; invite: InviteDraft }[] {
  return d.invites.map((invite, index) => ({ index, invite })).filter(({ invite }) => invite.email.trim() !== '');
}

export function validateStep(step: StepId, d: SetupDraft): FieldErrors {
  const e: FieldErrors = {};
  switch (step) {
    case 'owner': {
      if (!d.ownerName.trim()) e.ownerName = 'Enter your full name.';
      else if (d.ownerName.trim().length > 200) e.ownerName = 'Use 200 characters or fewer for your name.';
      if (!d.ownerEmail.trim()) e.ownerEmail = 'Enter your email address.';
      else if (!isEmail(d.ownerEmail)) e.ownerEmail = 'Enter an email address like name@example.org.';
      break;
    }
    case 'brand': {
      const name = d.name.trim();
      if (name.length < 2) e.name = 'Enter your foundation’s name.';
      else if (name.length > 200) e.name = 'Use 200 characters or fewer for the name.';
      if (!d.slug) e.slug = 'Choose a web address.';
      else if (d.slug.length < 2 || d.slug.length > 60) e.slug = 'Use 2 to 60 characters for the web address.';
      else if (!SLUG.test(d.slug)) e.slug = 'Use lowercase letters, numbers and dashes, starting and ending with a letter or number.';
      else if (RESERVED_SLUGS.includes(d.slug)) e.slug = `“${d.slug}” is reserved. Choose another web address.`;
      if (!TIMEZONES.some((t) => t.value === d.timezone)) e.timezone = 'Choose your foundation’s time zone.';
      if (!HEX.test(d.primary)) e.primary = 'Use a 6-digit color code like #1F4E79 for the primary color.';
      if (!HEX.test(d.accent)) e.accent = 'Use a 6-digit color code like #C9822B for the accent color.';
      if (!(FONT_LABELS as readonly string[]).includes(d.headingFont)) e.headingFont = 'Choose a heading font.';
      break;
    }
    case 'email': {
      if (d.senderName.trim().length > 120) e.senderName = 'Use 120 characters or fewer for the sender name.';
      if (d.replyTo.trim() && !isEmail(d.replyTo)) e.replyTo = 'Enter a reply-to address like grants@example.org, or leave it blank.';
      break;
    }
    case 'payments': {
      if (!(PAYMENT_CHOICES as readonly string[]).includes(d.payments)) e.payments = 'Choose how you’ll pay grants.';
      break;
    }
    case 'program': {
      if (d.programSkip) break;
      if (!d.programName.trim()) e.programName = 'Enter a program name, or choose to skip this step.';
      else if (d.programName.trim().length > 200) e.programName = 'Use 200 characters or fewer for the program name.';
      if (d.causeArea.trim().length > 120) e.causeArea = 'Use 120 characters or fewer for the cause area.';
      if (!d.oppTitle.trim()) e.oppTitle = 'Enter a title for your first opportunity, or choose to skip this step.';
      else if (d.oppTitle.trim().length > 300) e.oppTitle = 'Use 300 characters or fewer for the title.';
      if (!d.templateKey) e.templateKey = 'Choose an application form to start from.';
      break;
    }
    case 'team': {
      const seen = new Set<string>();
      const owner = d.ownerEmail.trim().toLowerCase();
      const rows = filledInvites(d);
      if (rows.length > MAX_INVITES) e.invites = `You can invite up to ${MAX_INVITES} people now. Invite the rest later from Team settings.`;
      for (const { index, invite } of rows) {
        const email = invite.email.trim().toLowerCase();
        const n = index + 1;
        if (!isEmail(email)) e[`invite-${index}-email`] = `Person ${n}: enter an email address like name@example.org.`;
        else if (email === owner) e[`invite-${index}-email`] = `Person ${n}: that’s your address — you’re already the owner.`;
        else if (seen.has(email)) e[`invite-${index}-email`] = `Person ${n}: this address is already on the list.`;
        seen.add(email);
        if (!(INVITE_ROLES as readonly string[]).includes(invite.role)) e[`invite-${index}-role`] = `Person ${n}: choose a role.`;
      }
      break;
    }
  }
  return e;
}

/** The first step with problems, or null when the whole draft is valid. */
export function validateAll(d: SetupDraft): { step: StepId; errors: FieldErrors } | null {
  for (const step of STEPS) {
    const errors = validateStep(step, d);
    if (Object.keys(errors).length) return { step, errors };
  }
  return null;
}

const FIELD_STEPS: Record<string, StepId> = {
  ownerName: 'owner',
  ownerEmail: 'owner',
  name: 'brand',
  slug: 'brand',
  timezone: 'brand',
  primary: 'brand',
  accent: 'brand',
  headingFont: 'brand',
  senderName: 'email',
  replyTo: 'email',
  payments: 'payments',
  programName: 'program',
  causeArea: 'program',
  oppTitle: 'program',
  templateKey: 'program',
};

export function stepForField(key: string): StepId {
  return FIELD_STEPS[key] ?? (key.startsWith('invite') ? 'team' : 'owner');
}

/** Maps a JSON pointer from setup.initialize's validation issues (e.g. "/slug", "/invites/0/email") to a field key. */
export function pointerToField(pointer: string): string | null {
  const parts = pointer.split('/').filter(Boolean);
  const [a, b, c] = parts;
  switch (a) {
    case 'ownerName':
    case 'ownerEmail':
    case 'name':
    case 'slug':
    case 'timezone':
      return a;
    case 'primaryColor':
      return 'primary';
    case 'accentColor':
      return 'accent';
    case 'headingFont':
      return 'headingFont';
    case 'emailSenderName':
      return 'senderName';
    case 'emailReplyTo':
      return 'replyTo';
    case 'paymentsChoice':
      return 'payments';
    case 'program':
      return b === 'causeArea' ? 'causeArea' : 'programName';
    case 'opportunity':
      return b === 'templateKey' ? 'templateKey' : 'oppTitle';
    case 'invites':
      return b !== undefined && /^\d+$/.test(b) ? `invite-${b}-${c === 'role' ? 'role' : 'email'}` : 'invites';
    default:
      return null;
  }
}

/** Input for the setup.initialize action. Invite indexes are preserved via `inviteIndexes` for error mapping. */
export function toInitializeInput(d: SetupDraft) {
  const invites = filledInvites(d);
  return {
    input: {
      slug: d.slug,
      name: d.name.trim(),
      ownerEmail: d.ownerEmail.trim().toLowerCase(),
      ownerName: d.ownerName.trim(),
      timezone: d.timezone,
      primaryColor: d.primary.toUpperCase(),
      accentColor: d.accent.toUpperCase(),
      headingFont: d.headingFont,
      emailSenderName: d.senderName.trim() || d.name.trim(),
      emailReplyTo: d.replyTo.trim() ? d.replyTo.trim().toLowerCase() : null,
      allowExisting: false,
      program: d.programSkip ? null : { name: d.programName.trim(), causeArea: d.causeArea.trim() || null },
      opportunity: d.programSkip ? null : { title: d.oppTitle.trim(), templateKey: d.templateKey },
      invites: invites.map(({ invite }) => ({ email: invite.email.trim().toLowerCase(), role: invite.role })),
      paymentsChoice: d.payments,
    },
    inviteIndexes: invites.map(({ index }) => index),
  };
}

/** Parses an untrusted draft (from the client) into a SetupDraft with safe defaults. */
export const DraftSchema = z.object({
  ownerName: z.string().max(400),
  ownerEmail: z.string().max(400),
  name: z.string().max(400),
  slug: z.string().max(100),
  timezone: z.string().max(100),
  primary: z.string().max(20),
  accent: z.string().max(20),
  headingFont: z.enum(FONT_LABELS),
  senderName: z.string().max(400),
  replyTo: z.string().max(400),
  payments: z.enum(PAYMENT_CHOICES),
  programSkip: z.boolean(),
  programName: z.string().max(400),
  causeArea: z.string().max(400),
  oppTitle: z.string().max(600),
  templateKey: z.string().max(100),
  invites: z.array(z.object({ key: z.string().max(40), email: z.string().max(400), role: z.enum(INVITE_ROLES as [InviteRole, ...InviteRole[]]) })).max(50),
});

export const PAYMENT_LABELS: Record<PaymentChoice, { label: string; description: string }> = {
  fake: { label: 'Use the fake bank (demo)', description: 'Try the whole payment flow with a simulated bank. No real money moves.' },
  sandbox: { label: 'Mercury sandbox token later', description: 'You’ll paste a Mercury sandbox API token after you sign in, to test with Mercury’s test environment.' },
  manual: { label: 'Pay outside GMS (manual rail)', description: 'Send payments from your own bank and record them in GMS as paid.' },
  later: { label: 'Decide later', description: 'Skip this for now. Nothing is paid until you choose a payment method.' },
};

export function roleLabel(role: InviteRole): string {
  return ROLE_LABELS[role];
}
