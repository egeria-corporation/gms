// SPDX-License-Identifier: AGPL-3.0-only
// The Anthropic Messages API behind the LlmClient port, through the official SDK.
//
// - One request per call, structured output validated against the caller's Zod schema.
// - Thinking is adaptive (the model's default); depth is set with `effort`.
// - A safety refusal first falls back server-side (`fallbacks: "default"`); a refusal by the whole
//   chain surfaces as AssistDeclinedError, never as an empty draft.
// - The system prompt is the cacheable prefix; applicant text only ever appears in the user turn.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AssistDeclinedError, AssistUnavailableError, type LlmClient, type LlmDocument, type LlmRequest, type LlmResult } from "./llm.ts";

/** Used when ASSISTANT_MODEL is not set. */
export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5-5";

export interface AnthropicLlmOptions {
  apiKey: string;
  /** ASSISTANT_MODEL; defaults to {@link DEFAULT_ASSISTANT_MODEL}. */
  model?: string | null;
  effort?: "low" | "medium" | "high";
  /** Injected in tests; the platform `fetch` otherwise. */
  fetch?: typeof fetch;
}

/** A document content block: a PDF as base64, or plain text. Citations stay off (they cannot be combined with structured output). */
function documentBlock(d: LlmDocument) {
  const title = d.title ? { title: d.title.slice(0, 200) } : {};
  return d.kind === "pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: d.base64 }, ...title }
    : { type: "document" as const, source: { type: "text" as const, media_type: "text/plain" as const, data: d.text }, ...title };
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: "low" | "medium" | "high";

  constructor(options: AnthropicLlmOptions) {
    // Workers require `fetch` to be called unbound.
    const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    this.client = new Anthropic({ apiKey: options.apiKey, fetch: doFetch, maxRetries: 2, timeout: 120_000 });
    this.model = options.model?.trim() || DEFAULT_ASSISTANT_MODEL;
    this.effort = options.effort ?? "medium";
  }

  async generate<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    let message;
    try {
      message = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: request.maxTokens ?? 16_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: request.documents?.length ? [...request.documents.map(documentBlock), { type: "text" as const, text: request.user }] : request.user }],
        output_config: { effort: this.effort, format: betaZodOutputFormat(request.schema) },
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new AssistUnavailableError("The assistant is busy. Try again in a moment", true);
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AssistUnavailableError("The assistant's API key was not accepted", false);
      if (e instanceof Anthropic.BadRequestError) throw new AssistUnavailableError("The assistant could not process this request", false);
      if (e instanceof Anthropic.APIConnectionError) throw new AssistUnavailableError("The assistant could not be reached", true);
      if (e instanceof Anthropic.APIError) throw new AssistUnavailableError("The assistant is unavailable right now", (e.status ?? 500) >= 500);
      throw e;
    }
    if (message.stop_reason === "refusal") throw new AssistDeclinedError(message.stop_details?.category ?? null);
    if (message.stop_reason === "max_tokens") throw new AssistUnavailableError("The draft was cut off before it finished. Try a shorter input", false);
    if (message.parsed_output === null || message.parsed_output === undefined) throw new AssistUnavailableError("The assistant returned a draft in an unexpected shape", true);
    const usage = message.usage;
    const tokensIn = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    return { output: message.parsed_output as T, tokensIn, tokensOut: usage.output_tokens, model: message.model };
  }
}
