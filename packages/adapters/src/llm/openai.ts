// SPDX-License-Identifier: AGPL-3.0-or-later
// OpenAI-compatible Chat Completions via fetch (OPENAI_API_KEY, optional OPENAI_BASE_URL for compatible
// servers such as local inference gateways). Optional features only.
import { fetchWithRetry, isRecord, readJson, redact, type FetchLike } from '../http';
import type { LLMProvider, LlmMessage } from '../types';
import { LlmError } from './anthropic';

export const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';

export interface OpenAiOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class OpenAiLlm implements LLMProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly opts: OpenAiOptions;

  constructor(opts: OpenAiOptions) {
    if (!opts.apiKey) throw new Error('OPENAI_API_KEY is missing');
    this.#apiKey = opts.apiKey;
    this.model = opts.model ?? process.env.GMS_LLM_MODEL ?? OPENAI_DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.opts = opts;
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, model: this.model, baseUrl: this.baseUrl };
  }

  async complete(input: { system?: string; messages: LlmMessage[]; maxTokens?: number }): Promise<{ text: string }> {
    const apiKey = this.#apiKey;
    const messages = [
      ...(input.system ? [{ role: 'system', content: input.system }] : []),
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const res = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      () => ({
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages, max_tokens: input.maxTokens ?? 1024 }),
      }),
      { fetch: this.fetchImpl, sleep: this.opts.sleep, timeoutMs: this.opts.timeoutMs ?? 120_000 },
    );
    const json = await readJson(res);
    if (!res.ok) {
      const err = isRecord(json) && isRecord(json.error) && typeof json.error.message === 'string' ? json.error.message : `status ${res.status}`;
      throw new LlmError('openai', res.status, `OpenAI-compatible request failed: ${redact(err, [apiKey])}`);
    }
    const choice = isRecord(json) && Array.isArray(json.choices) ? json.choices[0] : undefined;
    const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : '';
    return { text: typeof content === 'string' ? content : '' };
  }
}
