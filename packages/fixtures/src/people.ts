// SPDX-License-Identifier: AGPL-3.0-or-later
// The named demo people. Every person and address is fictional; emails use the reserved .example TLD.
import { createHash } from 'node:crypto';
import type { WorkspaceRole } from '@gms/domain';

export type DemoWorkspace = 'halcyon' | 'marigold' | 'sunbeam';

export interface DemoUser {
  /** Stable key used by tests, e.g. 'helen'. */
  key: string;
  email: string;
  name: string;
  /** Workspace role, or 'applicant' for people who only use the applicant portal. */
  role: WorkspaceRole | 'applicant';
  workspace: DemoWorkspace | null;
  title: string;
}

const REVIEWERS: [string, string][] = [
  ['samuel', 'Dr. Samuel Okafor'],
  ['lena', 'Lena Marsh'],
  ['tomas', 'Tomas Ibarra'],
  ['priscilla', 'Priscilla Hwang'],
  ['owen', 'Owen Castellanos'],
  ['beatrice', 'Beatrice Nwosu'],
  ['farid', 'Farid Haddad'],
  ['colette', 'Colette Durand'],
  ['jun', 'Jun Takahashi'],
  ['rosalind', 'Rosalind Kerr'],
  ['mateo', 'Mateo Villanueva'],
  ['harriet', 'Harriet Osei'],
];

function reviewerEmail(name: string): string {
  const parts = name.replace(/^Dr\.\s+/, '').toLowerCase().split(/\s+/);
  return `${parts[0]}.${parts[parts.length - 1]}@reviewers.example`;
}

export const DEMO_USERS: readonly DemoUser[] = [
  // Halcyon Ridge Foundation staff
  { key: 'helen', email: 'helen@halcyonridge.example', name: 'Helen Ortiz', role: 'owner', workspace: 'halcyon', title: 'Executive Director' },
  { key: 'jordan', email: 'jordan@halcyonridge.example', name: 'Jordan Ellis', role: 'program_officer', workspace: 'halcyon', title: 'Program Officer' },
  { key: 'priya', email: 'priya@halcyonridge.example', name: 'Priya Natarajan', role: 'finance', workspace: 'halcyon', title: 'Finance Director' },
  { key: 'marcus', email: 'marcus@halcyonridge.example', name: 'Marcus Webb', role: 'finance', workspace: 'halcyon', title: 'Controller' },
  { key: 'nora', email: 'nora@halcyonridge.example', name: 'Nora Bishop', role: 'auditor', workspace: 'halcyon', title: 'External Auditor' },
  // Board
  { key: 'ruth', email: 'ruth@halcyonridge.example', name: 'Ruth Alvarez', role: 'board', workspace: 'halcyon', title: 'Board Chair' },
  { key: 'dennis', email: 'dennis@halcyonridge.example', name: 'Dennis Achterberg', role: 'board', workspace: 'halcyon', title: 'Board Treasurer' },
  { key: 'mei', email: 'mei@halcyonridge.example', name: 'Mei Lindqvist', role: 'board', workspace: 'halcyon', title: 'Board Member' },
  // External reviewers (12)
  ...REVIEWERS.map(([key, name]) => ({
    key,
    email: reviewerEmail(name),
    name,
    role: 'reviewer' as const,
    workspace: 'halcyon' as const,
    title: 'Community Reviewer',
  })),
  // Marigold Street Fund
  { key: 'rosa', email: 'rosa@marigoldstreet.example', name: 'Rosa Delgado', role: 'owner', workspace: 'marigold', title: 'Director' },
  { key: 'kwame', email: 'kwame@marigoldstreet.example', name: 'Kwame Mensah', role: 'program_officer', workspace: 'marigold', title: 'Organizing Grants Lead' },
  { key: 'ines', email: 'ines@marigoldstreet.example', name: 'Ines Farrow', role: 'finance', workspace: 'marigold', title: 'Operations Manager' },
  // Sunbeam Test Fund (contrast test brand)
  { key: 'sam', email: 'sam@sunbeamtest.example', name: 'Sam Rivera', role: 'owner', workspace: 'sunbeam', title: 'Administrator' },
  // Applicants
  { key: 'maya', email: 'maya@eastside-youth-music.example', name: 'Maya Chen', role: 'applicant', workspace: null, title: 'Executive Director, Eastside Youth Music Collective' },
  { key: 'theo', email: 'theo@lumen-literacy.example', name: 'Theo Vance', role: 'applicant', workspace: null, title: 'Project Director, Lumen Literacy Project' },
  { key: 'ada', email: 'ada@cedar-hollow-pantry.example', name: 'Ada Brennan', role: 'applicant', workspace: null, title: 'Coordinator, Cedar Hollow Food Pantry' },
];

export function demoUser(key: string): DemoUser {
  const u = DEMO_USERS.find((x) => x.key === key);
  if (!u) throw new Error(`unknown demo user: ${key}`);
  return u;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * DEV-ONLY TOTP secret for a demo user (base32, derived from the email). Anyone can recompute these,
 * which is the point: E2E tests and local demos sign in with `totpNow(secret)`. Test auth mode only.
 */
export function demoTotpSecret(email: string): string {
  return base32(createHash('sha256').update(`gms-demo-totp:v1:${email.toLowerCase()}`).digest().subarray(0, 20));
}

/** Everyone with a workspace role gets a verified authenticator factor with a known secret. */
export const DEMO_TOTP_SECRETS: Readonly<Record<string, string>> = Object.fromEntries(
  DEMO_USERS.filter((u) => u.workspace !== null).map((u) => [u.email, demoTotpSecret(u.email)]),
);
