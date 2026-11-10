// SPDX-License-Identifier: AGPL-3.0-only
// The model port. Every assistant function makes exactly one structured call through it, so the
// service layer can swap the Anthropic client for a deterministic fake in tests and on installs
// with the assistant turned off.
import type { z } from "zod";

export interface LlmRequest<T> {
  /** Stable instructions (cacheable). Never contains applicant text. */
  system: string;
  /** The task and its labelled data. */
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface LlmResult<T> {
  output: T;
  tokensIn: number;
  tokensOut: number;
  /** The model that produced the output (a fallback model when the first declined). */
  model: string;
}

export interface LlmClient {
  generate<T>(request: LlmRequest<T>): Promise<LlmResult<T>>;
}

/** The model declined the request (a safety refusal), on every model in the fallback chain. */
export class AssistDeclinedError extends Error {
  constructor(readonly category: string | null) {
    super("The assistant declined this request");
    this.name = "AssistDeclinedError";
  }
}

/** The model could not be reached, was rate limited, or returned something that is not the requested shape. */
export class AssistUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AssistUnavailableError";
  }
}

/**
 * A deterministic stand-in: answers from `respond`, records every request. Token counts are the
 * character counts divided by four, so quota tests have something to add up.
 */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest<unknown>[] = [];
  constructor(
    private readonly respond: (request: LlmRequest<unknown>) => unknown,
    readonly model = "fake-llm",
  ) {}

  async generate<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    this.requests.push(request as LlmRequest<unknown>);
    const output = request.schema.parse(this.respond(request as LlmRequest<unknown>));
    return { output, tokensIn: Math.ceil((request.system.length + request.user.length) / 4), tokensOut: Math.ceil(JSON.stringify(output).length / 4), model: this.model };
  }
}
