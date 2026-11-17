// SPDX-License-Identifier: AGPL-3.0-only
// Mail port. Production uses Resend's HTTP API; tests and local development use the in-memory fake.

/** A file sent with an email: `content` is the file's bytes in base64, as Resend's `attachments` take them. */
export interface MailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

/**
 * The most an email's attachments may weigh, decoded: well under Resend's 40 MB per email (counted
 * after base64, which adds a third). A larger package is downloaded instead (send-package.ts).
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** The decoded size of base64 content, without decoding it. */
export const base64Bytes = (content: string): number => {
  const clean = content.replace(/\s/g, "");
  return Math.floor((clean.length * 3) / 4) - (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0);
};

export interface OutboundEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Sent as Resend's `Idempotency-Key`: a retry with the same key never sends twice. */
  idempotencyKey?: string;
  tags?: { name: string; value: string }[];
  /** Files sent with the email; only a mailer with `sendsAttachments = true` passes them on. */
  attachments?: MailAttachment[];
}

export interface Mailer {
  send(email: OutboundEmail): Promise<{ id: string }>;
}

export class MailerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MailerError";
  }
}

export class ResendMailer implements Mailer {
  /** Passes `attachments` on to Resend (send-package.ts sends a package only through such a mailer). */
  readonly sendsAttachments = true;

  constructor(
    private readonly apiKey: string,
    // A wrapper, not `fetch` itself: called as `this.fetchImpl(...)`, the platform's `fetch` throws
    // "Illegal invocation" on Cloudflare Workers (packages/passport-client has the same note).
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly baseUrl = "https://api.resend.com",
  ) {}

  async send(email: OutboundEmail): Promise<{ id: string }> {
    const files = email.attachments ?? [];
    if (files.reduce((n, a) => n + base64Bytes(a.content), 0) > MAX_ATTACHMENT_BYTES) throw new MailerError(`The attachments are larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB; download the package instead.`, 413, false);
    const res = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...(email.idempotencyKey ? { "idempotency-key": email.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: email.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        ...(email.headers ? { headers: email.headers } : {}),
        ...(email.tags ? { tags: email.tags } : {}),
        // Resend's attachment objects: filename, base64 content, and content_type when given.
        ...(files.length ? { attachments: files.map((a) => ({ filename: a.filename, content: a.content, ...(a.contentType ? { content_type: a.contentType } : {}) })) } : {}),
      }),
    });
    if (!res.ok) {
      // The response body can echo recipient addresses; keep it out of the error and the logs.
      throw new MailerError(`Resend refused the send (HTTP ${res.status}).`, res.status, res.status === 429 || res.status >= 500);
    }
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new MailerError("Resend returned no message id.", res.status, true);
    return { id: body.id };
  }
}

export class MemoryMailer implements Mailer {
  /** Keeps attachments with what it records, as Resend would send them. Tests may switch it off. */
  sendsAttachments = true;
  readonly sent: (OutboundEmail & { id: string })[] = [];
  private readonly byKey = new Map<string, string>();
  /** Set to make the next send throw, to exercise retries. */
  failNext: Error | null = null;

  async send(email: OutboundEmail): Promise<{ id: string }> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    if (email.idempotencyKey) {
      const existing = this.byKey.get(email.idempotencyKey);
      if (existing) return { id: existing };
    }
    const id = `msg_${this.sent.length + 1}`;
    this.sent.push({ ...email, id });
    if (email.idempotencyKey) this.byKey.set(email.idempotencyKey, id);
    return { id };
  }
}
