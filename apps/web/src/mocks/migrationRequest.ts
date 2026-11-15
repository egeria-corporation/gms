// SPDX-License-Identifier: AGPL-3.0-only
// The migration request in the browser (mock mode), with the API's rules: the same email text
// (packages/notify/src/migration.ts), the same removal of numbers that look like bank or identity
// numbers, the hidden field, the few seconds before a send, and 3 sends a day per email address
// and 20 a day in all (one browser is one network). apps/web/test/switch-contract.test.ts holds it
// to the real API. Nothing leaves the page: "sent" emails are kept in `sent`.
import { ApiError } from "../api/client.ts";
import type { MigrationRequestApi, MigrationRequestInput, MigrationRequestPreview } from "../api/migrationRequest.ts";
import { NOTE_MAX, PAST_AWARD_OPTIONS, PROGRAM_OPTIONS, SYSTEM_OPTIONS, TIMING_OPTIONS } from "../content/switch.ts";

/** As the API's MIGRATION_REQUEST_LIMITS. */
export const MOCK_MIGRATION_LIMITS = { perEmailPerDay: 3, perAddressPerDay: 20, minSecondsToSubmit: 3, formTokenHours: 24 } as const;
/** As CONSULTING_REQUEST_TO in @gms/notify. */
const TO = "hello@agents.opengrants.io";
const MASK = "[number removed]";

// ---- as @gms/notify (direct-award.ts cleanLine and cleanText, migration.ts stripSensitiveNumbers)
const cleanLine = (v: string) =>
  v
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/g, " ")
    .replace(/\p{Cc}+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
const cleanText = (v: string) =>
  v
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, "\n")
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\t\v\f]+/g, " ")
    .replace(/[^\P{Cc}\n]+/gu, "")
    .replace(/[ ]+\n/g, "\n")
    .trim();
const WORD_BEFORE_NUMBER = /\b(?:rout(?:ing)?|aba|acc(?:oun)?t|a\/c|iban|swift|bic|s{2}n|social[\s_-]*sec(?:urity)?|tin|itin|tax[\s_-]*id|taxpayer|gov(?:ernment)?[\s_-]*id|driver'?s?|licen[cs]e|birth|born|d\.?o\.?b)\b[^\d\n]{0,24}(\d(?:[ ./-]?\d){4,})/gi;
const IDENTITY_SHAPE = /(?<!\d)\d{3}([ -])\d{2}\1\d{4}(?!\d)/g;
const LONG_NUMBER = /(?<!\d)\d(?:[ -]?\d){7,}(?!\d)/g;
export function stripSensitiveNumbers(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text
    .replace(WORD_BEFORE_NUMBER, (match: string, digits: string) => {
      removed++;
      return match.slice(0, match.length - digits.length) + MASK;
    })
    .replace(IDENTITY_SHAPE, () => {
      removed++;
      return MASK;
    })
    .replace(LONG_NUMBER, (match: string) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(match)) return match;
      removed++;
      return MASK;
    });
  return { text: out, removed };
}

const PHRASE: Record<string, string> = { zengine: "Zengine", spreadsheets: "spreadsheets", other: "your current system" };
const label = (options: readonly { value: string; label: string }[], value: string, field: string) => {
  const hit = options.find((o) => o.value === value);
  if (!hit) throw new ApiError(400, "The request body is not valid", [{ code: "invalid_field", field, message: "Choose one of the options" }]);
  return hit.label;
};
const bad = (field: string, message: string) => new ApiError(400, "The request body is not valid", [{ code: "bad_request" }, { code: "invalid_field", field, message }]);

export interface MockMigrationStore {
  sent: { to: string[]; replyTo: string; subject: string; text: string }[];
  counts: Map<string, number>;
}

export function createMockMigrationRequestApi(opts: { now?: () => number; webBaseUrl?: string; store?: MockMigrationStore } = {}): MigrationRequestApi & { store: MockMigrationStore } {
  const now = opts.now ?? (() => Date.now());
  const store: MockMigrationStore = opts.store ?? { sent: [], counts: new Map() };
  const webBaseUrl = opts.webBaseUrl ?? (typeof window === "undefined" ? "" : window.location.origin);

  function previewOf(raw: MigrationRequestInput): MigrationRequestPreview {
    const name = cleanLine(raw.name ?? "");
    const email = (raw.email ?? "").trim();
    const organization = cleanLine(raw.organization ?? "");
    if (!name || name.length > 200) throw bad("name", "Give your name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw bad("email", "Give a valid email address");
    if (!organization || organization.length > 200) throw bad("organization", "Give your organization's name");
    const systemLabel = label(SYSTEM_OPTIONS, raw.system, "system");
    const programsLabel = label(PROGRAM_OPTIONS, raw.programs, "programs");
    const pastAwardsLabel = label(PAST_AWARD_OPTIONS, raw.pastAwards, "pastAwards");
    const timingLabel = label(TIMING_OPTIONS, raw.timing, "timing");
    const typed = raw.note === undefined ? "" : cleanText(raw.note);
    if (typed.length > NOTE_MAX) throw bad("note", `At most ${NOTE_MAX.toLocaleString("en-US")} characters`);
    const stripped = typed ? stripSensitiveNumbers(typed) : { text: "", removed: 0 };
    const note = stripped.text || null;
    const n = stripped.removed;
    const intro = `${organization} asks for a free migration to the OpenGrants Grant Management System. Reply to this email to reach ${name}.`;
    const facts = [`Name: ${name}`, `Work email: ${email}`, `Organization: ${organization}`, `Current system: ${systemLabel}`, `Programs: ${programsLabel}`, `Past awards: ${pastAwardsLabel}`, `Hoping to move: ${timingLabel}`];
    const removed = n > 0 ? `${n} number${n === 1 ? "" : "s"} that looked like a bank or identity number ${n === 1 ? "was" : "were"} removed from the note before it was sent.` : "";
    const text = [intro, facts.join("\n"), note ? `Note:\n${note}` : "No note.", ...(removed ? [removed] : []), "Sent from the switch pages of OpenGrants GMS."].join("\n\n");
    const page = `${webBaseUrl}/switch${raw.system === "other" ? "" : `/${raw.system}`}`;
    const phrase = PHRASE[raw.system] ?? systemLabel;
    const confirmation = [
      "Hello,",
      `Thank you for asking OpenGrants to help you move from ${phrase} to the OpenGrants Grant Management System. A person at OpenGrants will reply to this address, and migration help can start right away.`,
      "The migration help is free, and so is the GMS. You do not need to do anything else for now.",
      ...(/^https:\/\/[^\s"'<>]+$/.test(page) ? [`What moves over and how: ${page}`] : []),
      "You get this email because this address was entered on the OpenGrants GMS switch page. If that was not you, ignore it: nothing else will be sent.",
    ].join("\n\n");
    return {
      to: TO,
      replyTo: email,
      subject: cleanLine(`Migration request: ${organization} (from ${systemLabel})`),
      text,
      name,
      email,
      organization,
      system: raw.system,
      systemLabel,
      programs: raw.programs,
      programsLabel,
      pastAwards: raw.pastAwards,
      pastAwardsLabel,
      timing: raw.timing,
      timingLabel,
      note,
      numbersRemoved: n,
      confirmation: { to: email, subject: "We received your migration request", text: confirmation },
    };
  }

  return {
    store,
    async form() {
      return { formToken: `mock.${now()}`, minSeconds: MOCK_MIGRATION_LIMITS.minSecondsToSubmit };
    },
    async preview(input) {
      return previewOf(input);
    },
    async send(input) {
      const p = previewOf(input);
      if (input.website?.trim()) throw new ApiError(422, `This request could not be sent. Write to ${TO} instead`, [{ code: "not_sent" }]);
      const issued = /^mock\.(\d+)$/.exec(input.formToken ?? "")?.[1];
      const age = issued ? (now() - Number(issued)) / 1000 : null;
      if (age === null || age > MOCK_MIGRATION_LIMITS.formTokenHours * 3600) throw new ApiError(422, "This form has expired. Reload the page and send it again", [{ code: "form_expired" }, { code: "form_expired", field: "formToken" }]);
      if (age < MOCK_MIGRATION_LIMITS.minSecondsToSubmit) throw new ApiError(422, "That was quick. Wait a few seconds, then send it again", [{ code: "too_fast" }, { code: "too_fast", field: "formToken" }]);
      const day = new Date(now()).toISOString().slice(0, 10);
      const emailKey = `email:${p.email.toLowerCase()}:${day}`;
      const allKey = `all:${day}`;
      if ((store.counts.get(emailKey) ?? 0) >= MOCK_MIGRATION_LIMITS.perEmailPerDay) throw new ApiError(429, `Up to ${MOCK_MIGRATION_LIMITS.perEmailPerDay} requests a day can be sent from one email address`, [{ code: "too_many_requests_for_email" }]);
      if ((store.counts.get(allKey) ?? 0) >= MOCK_MIGRATION_LIMITS.perAddressPerDay) throw new ApiError(429, `Up to ${MOCK_MIGRATION_LIMITS.perAddressPerDay} requests a day can be sent from one network`, [{ code: "too_many_requests" }]);
      store.counts.set(emailKey, (store.counts.get(emailKey) ?? 0) + 1);
      store.counts.set(allKey, (store.counts.get(allKey) ?? 0) + 1);
      store.sent.push({ to: [p.to], replyTo: p.replyTo, subject: p.subject, text: p.text }, { to: [p.email], replyTo: p.to, subject: p.confirmation.subject, text: p.confirmation.text });
      return { sent: true, requestId: crypto.randomUUID(), sentAt: new Date(now()).toISOString(), to: p.to, replyTo: p.replyTo, confirmationSent: true, message: `A person at OpenGrants will reply to ${p.email}. Migration help can start right away.` };
    },
  };
}
