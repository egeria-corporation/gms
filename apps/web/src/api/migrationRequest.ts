// SPDX-License-Identifier: AGPL-3.0-only
// "Request a free migration" on the switch pages: the form token, the preview and the send. These
// calls never carry a token, signed in or not: the request is a person's, from the page, and the
// API refuses API and agent tokens on these routes. `createMockMigrationRequestApi`
// (mocks/migrationRequest.ts) implements the same interface in the browser.
import { ApiError } from "./client.ts";

export type MigrationSystem = "good-grants" | "submittable" | "surveymonkey-apply" | "foundant" | "zengine" | "fluxx" | "smartsimple" | "cybergrants" | "openwater" | "spreadsheets" | "other";
export type MigrationPrograms = "1" | "2-5" | "6-20" | "21+" | "unsure";
export type MigrationPastAwards = "0-99" | "100-999" | "1000-9999" | "10000+" | "unsure";
export type MigrationTiming = "asap" | "3-months" | "6-months" | "12-months" | "exploring";

export interface MigrationRequestInput {
  name: string;
  email: string;
  organization: string;
  system: MigrationSystem;
  programs: MigrationPrograms;
  pastAwards: MigrationPastAwards;
  timing: MigrationTiming;
  note?: string;
  /** The hidden field: always empty from a person. */
  website?: string;
  /** From `form()`, when the form was shown. Needed to send. */
  formToken?: string;
}

/** Exactly what will be sent: the request to OpenGrants and the confirmation to the person. */
export interface MigrationRequestPreview {
  to: string;
  replyTo: string;
  subject: string;
  /** The email's text, as sent. */
  text: string;
  name: string;
  email: string;
  organization: string;
  system: MigrationSystem;
  systemLabel: string;
  programs: MigrationPrograms;
  programsLabel: string;
  pastAwards: MigrationPastAwards;
  pastAwardsLabel: string;
  timing: MigrationTiming;
  timingLabel: string;
  /** With numbers that look like bank or identity numbers removed; null when there is no note. */
  note: string | null;
  numbersRemoved: number;
  confirmation: { to: string; subject: string; text: string };
}

export interface MigrationRequestSent {
  sent: boolean;
  requestId: string;
  sentAt: string;
  to: string;
  replyTo: string;
  /** False when only the confirmation could not be sent; the request reached OpenGrants. */
  confirmationSent: boolean;
  message: string;
}

export interface MigrationRequestApi {
  /** A token that records when the form was shown; a send needs it to be a few seconds old. */
  form(): Promise<{ formToken: string; minSeconds: number }>;
  /** Nothing is sent or counted. */
  preview(input: MigrationRequestInput): Promise<MigrationRequestPreview>;
  /** Rejects with 422 (hidden field, too fast, form expired), 429 (daily limits) or 503 (no mail). */
  send(input: MigrationRequestInput): Promise<MigrationRequestSent>;
}

/** The API's `{ code, field, detail }` entries, with `detail` as `message` so the form can show it under its field. */
const problems = (errors: unknown[]): unknown[] => errors.map((e) => (e && typeof e === "object" && typeof (e as { detail?: unknown }).detail === "string" && (e as { message?: unknown }).message === undefined ? { ...e, message: (e as { detail: string }).detail } : e));

export function createHttpMigrationRequestApi(opts: { baseUrl: string; fetch?: typeof fetch }): MigrationRequestApi {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, problems(json.errors ?? []));
    return json.data as T;
  }
  return {
    form: () => call("GET", "/gms/migration-requests/form"),
    preview: (input) => call("POST", "/gms/migration-requests/preview", input),
    send: (input) => call("POST", "/gms/migration-requests", input),
  };
}
