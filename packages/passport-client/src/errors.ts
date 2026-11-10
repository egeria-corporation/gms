// SPDX-License-Identifier: AGPL-3.0-only

export interface PassportErrorDetail {
  code: string;
  field?: string;
  detail?: string;
}

/** A non-2xx answer from Passport, in the CommonGrants error shape (`errors[0].code` is the stable code). */
export class PassportApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: PassportErrorDetail[];

  constructor(status: number, code: string, message: string, details: PassportErrorDetail[] = []) {
    super(message);
    this.name = "PassportApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** `409 credential_version_stale`: the credential changed since it was resolved. Re-resolve and retry once. */
export class CredentialVersionStaleError extends PassportApiError {
  constructor(message: string, details: PassportErrorDetail[] = []) {
    super(409, "credential_version_stale", message, details);
    this.name = "CredentialVersionStaleError";
  }
}

/** Passport could not be reached, timed out, or answered 5xx. Callers report "unknown", never pass or fail. */
export class PassportUnavailableError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "PassportUnavailableError";
    this.status = status;
  }
}

/** The OAuth token endpoint refused the client or the refresh token (RFC 6749 error body). */
export class PassportAuthError extends Error {
  readonly oauthError: string;

  constructor(oauthError: string, message: string) {
    super(message);
    this.name = "PassportAuthError";
    this.oauthError = oauthError;
  }
}

/** A route that Passport does not serve yet was called without its feature flag. */
export class PassportFeatureDisabledError extends Error {
  constructor(feature: string) {
    super(`Passport feature "${feature}" is not enabled`);
    this.name = "PassportFeatureDisabledError";
  }
}

export function isPassportUnavailable(e: unknown): e is PassportUnavailableError {
  return e instanceof PassportUnavailableError;
}

export function toPassportError(status: number, body: unknown): PassportApiError | PassportUnavailableError {
  const b = (body && typeof body === "object" ? body : {}) as { message?: unknown; errors?: unknown };
  const message = typeof b.message === "string" ? b.message : `Passport answered ${status}`;
  if (status >= 500) return new PassportUnavailableError(message, status);
  const details = (Array.isArray(b.errors) ? b.errors : []).filter((d): d is PassportErrorDetail => !!d && typeof d === "object" && typeof (d as PassportErrorDetail).code === "string");
  const code = details[0]?.code ?? `http_${status}`;
  const rest = details.slice(1);
  if (status === 409 && code === "credential_version_stale") return new CredentialVersionStaleError(message, rest);
  return new PassportApiError(status, code, message, rest);
}
