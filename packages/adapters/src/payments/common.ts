// SPDX-License-Identifier: AGPL-3.0-only
// Errors, safety guards and concurrency helpers shared by the payment rails.

/** An error from the Mercury API (or the fake, which mirrors its semantics). Never carries the API token. */
export class MercuryApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly path: string;
  readonly retryable: boolean;

  constructor(input: { status: number; code: string; message: string; path: string }) {
    super(`Mercury API ${input.status} ${input.code} on ${input.path}: ${input.message}`);
    this.name = 'MercuryApiError';
    this.status = input.status;
    this.code = input.code;
    this.path = input.path;
    this.retryable = input.status === 429 || input.status >= 500;
  }
}

/** Thrown when a rail is configured in a way the safety rails forbid (e.g. production without explicit opt-in). */
export class RailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RailConfigurationError';
  }
}

export type MercuryEnvironment = 'sandbox' | 'production';

/**
 * Production Mercury moves real money. It is refused unless BOTH MERCURY_ENV=production and
 * GMS_ALLOW_MERCURY_PRODUCTION=true are set for the process.
 */
export function assertMercuryEnvironmentAllowed(environment: string, env: NodeJS.ProcessEnv = process.env): asserts environment is MercuryEnvironment {
  if (environment === 'sandbox') return;
  if (environment === 'production') {
    if (env.MERCURY_ENV === 'production' && env.GMS_ALLOW_MERCURY_PRODUCTION === 'true') return;
    throw new RailConfigurationError(
      'Mercury production is disabled. Set MERCURY_ENV=production and GMS_ALLOW_MERCURY_PRODUCTION=true to allow real money movement.',
    );
  }
  throw new RailConfigurationError(`unknown Mercury environment: ${environment}`);
}

/** In-process keyed mutex: callers with the same key run strictly one after another (FIFO). */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Number of keys with work queued or running (for tests/metrics). */
  get size(): number {
    return this.tails.size;
  }
}

export function validateSendMoneyInput(input: { amountCents: number; idempotencyKey: string; recipientId: string }): void {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new RangeError('amountCents must be a positive integer');
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 255) throw new RangeError('idempotencyKey is required (≤255 chars)');
  if (!input.recipientId) throw new RangeError('recipientId is required');
}
