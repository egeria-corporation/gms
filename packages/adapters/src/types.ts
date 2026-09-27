// SPDX-License-Identifier: AGPL-3.0-only
// Interfaces for every external dependency. Each has a real implementation and a fake.
// Tests default to fakes; live tests run only when credentials exist.

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export type RailPaymentMethod = 'ach' | 'check' | 'domesticWire' | 'internationalWire';

export interface RailAccount {
  id: string;
  name: string;
  /** Last four digits only. Never full account numbers. */
  mask: string | null;
  kind: string;
  availableCents: number;
  currentCents: number;
  currency: string;
}

export interface RecipientInviteInput {
  contactEmail: string;
  name?: string;
  paymentMethods: RailPaymentMethod[];
  requireTaxDocument: boolean;
  sendEmail: boolean;
  organizationNameOnRequest?: string;
  notes?: string;
  recipientId?: string;
}

export type RecipientInviteStatus = 'created' | 'completed' | 'expired';

export interface RecipientInvite {
  inviteId: string;
  status: RecipientInviteStatus;
  onboardingUrl: string;
  recipientId: string | null;
  contactEmail: string;
  expiresAt?: string | null;
}

export interface SendMoneyInput {
  recipientId: string;
  amountCents: number;
  paymentMethod: RailPaymentMethod;
  idempotencyKey: string;
  note?: string;
  externalMemo?: string;
  /** International wires only. */
  purpose?: string;
}

export type SendMoneyRequestStatus = 'pendingApproval' | 'approved' | 'rejected' | 'cancelled';

export interface SendMoneyRequest {
  requestId: string;
  accountId: string;
  status: SendMoneyRequestStatus;
  amountCents: number;
  recipientId: string;
  idempotencyKey: string;
  transactionId: string | null;
}

export type RailTransactionStatus = 'pending' | 'sent' | 'cancelled' | 'failed' | 'reversed' | 'blocked';

export interface RailTransaction {
  id: string;
  accountId: string;
  /** Negative for money leaving the account. */
  amountCents: number;
  status: RailTransactionStatus;
  counterpartyName: string | null;
  counterpartyId: string | null;
  externalMemo: string | null;
  note: string | null;
  kind: string;
  createdAt: string;
  postedAt: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  raw: Record<string, unknown>;
}

export interface RailEvent {
  id: string;
  type: string;
  resourceType: 'transaction' | 'account' | 'other';
  resourceId: string;
  occurredAt: string;
  /** JSON Merge Patch describing changed fields (Mercury Events API semantics). */
  mergePatch: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface WebhookRegistration {
  webhookId: string;
  /** Returned only once at creation; store it in the SecretStore immediately. */
  secret: string;
}

export interface PaymentRail {
  readonly name: 'mercury' | 'fake-mercury' | 'manual';
  readonly environment: 'fake' | 'sandbox' | 'production' | 'none';
  listAccounts(): Promise<RailAccount[]>;
  createRecipientInvite(input: RecipientInviteInput): Promise<RecipientInvite>;
  getRecipientInvite(inviteId: string): Promise<RecipientInvite>;
  requestSendMoney(accountId: string, input: SendMoneyInput): Promise<SendMoneyRequest>;
  getSendMoneyRequest(accountId: string, requestId: string): Promise<SendMoneyRequest>;
  getTransaction(accountId: string, transactionId: string): Promise<RailTransaction>;
  listTransactions(accountId: string, opts?: { start?: string; end?: string }): Promise<RailTransaction[]>;
  updateTransaction(accountId: string, transactionId: string, patch: { note?: string; category?: string }): Promise<void>;
  uploadTransactionAttachment(
    accountId: string,
    transactionId: string,
    file: { fileName: string; contentType: string; data: Uint8Array },
  ): Promise<void>;
  listEvents(opts?: { since?: string; limit?: number }): Promise<RailEvent[]>;
  createWebhook(input: { url: string; eventTypes: string[] }): Promise<WebhookRegistration>;
  /** Verifies a webhook signature. Must use a constant-time comparison and a timestamp window. */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, secret: string, now?: Date): boolean;
  parseWebhook(rawBody: string): RailEvent;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
export interface MailMessage {
  to: string;
  from: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  workspaceId?: string | null;
  tags?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface MailResult {
  provider: 'resend' | 'smtp' | 'dev-outbox';
  messageId: string;
}

export interface Mailer {
  readonly name: MailResult['provider'];
  send(msg: MailMessage): Promise<MailResult>;
  /** Verifies an inbound provider webhook (delivery/bounce events). */
  verifyWebhook?(rawBody: string, headers: Record<string, string | undefined>, secret: string): boolean;
}

// ---------------------------------------------------------------------------
// Storage (private buckets, short-lived signed URLs)
// ---------------------------------------------------------------------------
export type Bucket = 'applications' | 'org-documents' | 'brand' | 'exports' | 'agreements' | 'reports';

export interface SignedUpload {
  url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  expiresAt: string;
  path: string;
}

export interface StoredObject {
  size: number;
  contentType: string;
}

export interface Storage {
  readonly name: 'supabase-storage' | 'local-filesystem';
  createSignedUploadUrl(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; maxBytes: number; expiresInSeconds?: number },
  ): Promise<SignedUpload>;
  createSignedDownloadUrl(bucket: Bucket, key: string, opts?: { expiresInSeconds?: number; fileName?: string }): Promise<string>;
  put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Uint8Array | null>;
  head(bucket: Bucket, key: string): Promise<StoredObject | null>;
  delete(bucket: Bucket, key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------
export interface ScanResult {
  status: 'clean' | 'infected' | 'not_scanned';
  signature?: string;
}

export interface Scanner {
  readonly name: 'clamav' | 'noop';
  scan(data: Uint8Array): Promise<ScanResult>;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
export interface SecretStore {
  readonly name: 'supabase-vault' | 'aes-256-gcm';
  /** Stores a secret and returns an opaque reference (safe to keep in a table column). */
  put(name: string, value: string, opts?: { workspaceId?: string | null }): Promise<string>;
  get(ref: string): Promise<string | null>;
  delete(ref: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// LLM (optional features only)
// ---------------------------------------------------------------------------
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMProvider {
  readonly name: 'anthropic' | 'openai' | 'fake-llm';
  complete(input: { system?: string; messages: LlmMessage[]; maxTokens?: number }): Promise<{ text: string }>;
}

// ---------------------------------------------------------------------------
// Diligence sources (importers)
// ---------------------------------------------------------------------------
export interface IrsRecord {
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  subsection: string | null;
  foundationCode: string | null;
  deductibility: string | null;
  status: 'active' | 'revoked' | 'unknown';
  rulingDate: string | null;
  pub78: boolean;
  ntee: string | null;
}

export interface SanctionsRecord {
  uid: string;
  name: string;
  entryType: string | null;
  programs: string[];
  remarks: string | null;
}

export interface DiligenceSource {
  readonly name: 'irs-ofac' | 'fixtures';
  irsRecords(): AsyncIterable<IrsRecord>;
  sanctionsRecords(): AsyncIterable<SanctionsRecord>;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, opts: CookieOptions): void;
  delete(name: string): void;
  /** All request cookies (used by Supabase SSR, which stores sessions in chunked cookies). */
  getAll?(): { name: string; value: string }[];
}

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
  domain?: string;
}

export interface Session {
  userId: string;
  email: string;
  aal: 'aal1' | 'aal2';
  sessionId: string;
  expiresAt: string;
  /** Verified claims to pass to RLS (withRls). */
  claims: { sub: string; role: 'authenticated'; email: string; aal: 'aal1' | 'aal2'; session_id: string; [k: string]: unknown };
}

export interface TotpFactor {
  id: string;
  status: 'unverified' | 'verified';
  friendlyName: string | null;
}

export interface AuthAdapter {
  readonly name: 'supabase-auth' | 'test-auth';
  /** Sends a magic sign-in link; the link lands on `${origin}/auth/callback`. */
  sendMagicLink(input: { email: string; redirectTo: string; workspaceId?: string | null; brandName?: string }): Promise<void>;
  /** Exchanges the callback params for a session and sets cookies. Returns null for expired/invalid links. */
  handleCallback(params: URLSearchParams, cookies: CookieJar): Promise<Session | null>;
  getSession(cookies: CookieJar): Promise<Session | null>;
  signOut(cookies: CookieJar): Promise<void>;
  listFactors(cookies: CookieJar): Promise<TotpFactor[]>;
  enrollTotp(cookies: CookieJar, friendlyName?: string): Promise<{ factorId: string; secret: string; otpauthUri: string }>;
  /** Verifies a TOTP code and upgrades the session to aal2. */
  verifyTotp(cookies: CookieJar, factorId: string, code: string): Promise<Session | null>;
  /** Admin: ensure a user exists (used by invitations, seeds, setup). Returns the user id. */
  ensureUser(input: { email: string; fullName?: string }): Promise<string>;
  /** Admin/testing: produce a sign-in link without sending email. Never exposed in production UI. */
  generateLink?(email: string, redirectTo: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Billing (operator console, stub)
// ---------------------------------------------------------------------------
export interface BillingAdapter {
  readonly name: 'stub' | 'stripe';
  planFor(workspaceId: string): Promise<{ plan: string; status: 'active' | 'trialing' | 'past_due' | 'none' }>;
}
