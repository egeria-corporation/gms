// SPDX-License-Identifier: AGPL-3.0-only
// Mail port. Production uses Resend's HTTP API; tests and local development use the in-memory fake.

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
  constructor(
    private readonly apiKey: string,
    // A wrapper, not `fetch` itself: called as `this.fetchImpl(...)`, the platform's `fetch` throws
    // "Illegal invocation" on Cloudflare Workers (packages/passport-client has the same note).
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly baseUrl = "https://api.resend.com",
  ) {}

  async send(email: OutboundEmail): Promise<{ id: string }> {
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
