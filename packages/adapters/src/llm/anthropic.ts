// SPDX-License-Identifier: AGPL-3.0-or-later
// Anthropic Messages API via fetch. Used only by optional features (drafting, summaries); output is always
// labeled as a draft by the UI and applicant text is quoted/labeled by the caller.
import { fetchWithRetry, isRecord, readJson, redact, type FetchLike } from '../http';
import type { LLMProvider, LlmMessage } from '../types';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5';

export class LlmError extends Error {
  constructor(
    readonly provider: 'anthropic' | 'openai',
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class AnthropicLlm implements LLMProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly opts: AnthropicOptions;

  constructor(opts: AnthropicOptions) {
    if (!opts.apiKey) throw new Error('ANTHROPIC_API_KEY is missing');
    this.#apiKey = opts.apiKey;
    this.model = opts.model ?? process.env.GMS_LLM_MODEL ?? ANTHROPIC_DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.opts = opts;
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, model: this.model };
  }

  async complete(input: { system?: string; messages: LlmMessage[]; maxTokens?: number }): Promise<{ text: string }> {
    const apiKey = this.#apiKey;
    const body = {
      model: this.model,
      max_tokens: input.maxTokens ?? 1024,
      ...(input.system ? { system: input.system } : {}),
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    const res = await fetchWithRetry(
      `${this.baseUrl}/v1/messages`,
      () => ({
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { fetch: this.fetchImpl, sleep: this.opts.sleep, timeoutMs: this.opts.timeoutMs ?? 120_000 },
    );
    const json = await readJson(res);
    if (!res.ok) {
      const err = isRecord(json) && isRecord(json.error) && typeof json.error.message === 'string' ? json.error.message : `status ${res.status}`;
      throw new LlmError('anthropic', res.status, `Anthropic request failed: ${redact(err, [apiKey])}`);
    }
    const content = isRecord(json) && Array.isArray(json.content) ? json.content : [];
    const text = content
      .filter((b): b is { type: 'text'; text: string } => isRecord(b) && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return { text };
  }
}
