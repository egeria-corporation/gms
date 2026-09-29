// SPDX-License-Identifier: AGPL-3.0-or-later
// Typed domain errors that map 1:1 onto RFC 9457 problem details.

export type ErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'insufficient_scope'
  | 'step_up_required'
  | 'not_found'
  | 'conflict'
  | 'precondition_failed'
  | 'invalid_transition'
  | 'deadline_passed'
  | 'approval_required'
  | 'human_only'
  | 'rate_limited'
  | 'idempotency_mismatch'
  | 'invariant_violated'
  | 'unavailable'
  | 'internal';

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  insufficient_scope: 403,
  step_up_required: 403,
  not_found: 404,
  conflict: 409,
  precondition_failed: 412,
  invalid_transition: 409,
  deadline_passed: 409,
  approval_required: 202,
  human_only: 403,
  rate_limited: 429,
  idempotency_mismatch: 422,
  invariant_violated: 409,
  unavailable: 503,
  internal: 500,
};

export const ERROR_TITLES: Record<ErrorCode, string> = {
  validation_failed: 'Some answers need attention',
  unauthenticated: 'Sign in required',
  forbidden: 'You do not have access to do this',
  insufficient_scope: 'The token is missing a required scope',
  step_up_required: 'Confirm with your authenticator app',
  not_found: 'Not found',
  conflict: 'Someone else changed this',
  precondition_failed: 'This changed since you loaded it',
  invalid_transition: 'That status change is not allowed',
  deadline_passed: 'The deadline has passed',
  approval_required: 'A person needs to confirm this',
  human_only: 'Only a person can do this',
  rate_limited: 'Too many requests',
  idempotency_mismatch: 'Idempotency key reused with different input',
  invariant_violated: 'This would break a safety rule',
  unavailable: 'Service unavailable',
  internal: 'Something went wrong',
};

export interface FieldIssue {
  /** JSON Pointer to the offending field, e.g. "/budget/items/0/amount". */
  pointer: string;
  message: string;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly issues: FieldIssue[];

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}, issues: FieldIssue[] = []) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    this.issues = issues;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'DomainError');
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: ErrorCode;
  errors?: FieldIssue[];
  [ext: string]: unknown;
}

export function toProblem(err: unknown, instance?: string): ProblemDetails {
  if (isDomainError(err)) {
    return {
      type: `https://gms.dev/problems/${err.code}`,
      title: ERROR_TITLES[err.code],
      status: err.status,
      detail: err.message,
      code: err.code,
      ...(instance ? { instance } : {}),
      ...(err.issues.length ? { errors: err.issues } : {}),
      ...err.details,
    };
  }
  return {
    type: 'https://gms.dev/problems/internal',
    title: ERROR_TITLES.internal,
    status: 500,
    detail: 'An unexpected error occurred. It has been logged.',
    code: 'internal',
    ...(instance ? { instance } : {}),
  };
}

/** Maps a Postgres error raised by an RLS policy, trigger or constraint to a DomainError. */
export function fromPgError(err: unknown): DomainError | null {
  const e = err as { code?: string; message?: string; hint?: string; constraint?: string };
  if (!e || typeof e !== 'object' || !e.code) return null;
  const msg = e.message ?? '';
  if (e.code === '42501' || /row-level security/i.test(msg)) {
    return new DomainError('forbidden', 'You do not have access to change this record.');
  }
  if (e.code === 'P0001') {
    switch (e.hint) {
      case 'payment_ceiling':
        return new DomainError('invariant_violated', 'Payments would exceed the awarded amount.', { rule: 'payment_ceiling' });
      case 'payee_not_ready':
        return new DomainError('invariant_violated', 'The payee has not finished bank onboarding.', { rule: 'payee_not_ready' });
      case 'award_on_hold':
        return new DomainError('invariant_violated', 'The award is on hold.', { rule: 'award_on_hold' });
      case 'maker_checker':
        return new DomainError('forbidden', 'The person who created a payment batch cannot approve it.', { rule: 'maker_checker' });
      case 'immutable_form_version':
        return new DomainError('conflict', 'Published form versions cannot be changed. Create a new version.', { rule: 'immutable' });
      case 'append_only':
        return new DomainError('forbidden', 'This record is append-only.', { rule: 'append_only' });
      default:
        return new DomainError('invariant_violated', msg);
    }
  }
  if (e.code === '23505') return new DomainError('conflict', 'That already exists.', { constraint: e.constraint });
  if (e.code === '23514') return new DomainError('validation_failed', 'A value is not allowed.', { constraint: e.constraint });
  if (e.code === '23503') return new DomainError('conflict', 'A related record is missing or still in use.', { constraint: e.constraint });
  return null;
}
