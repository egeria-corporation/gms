// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { AnthropicLlm, ANTHROPIC_DEFAULT_MODEL, LlmError } from '../src/llm/anthropic';
import { OpenAiLlm } from '../src/llm/openai';
import { StubBilling } from '../src/billing/stub';

type Call = { url: string; headers: Headers; body: Record<string, unknown> };

function mockFetch(responses: Response[], calls: Call[]) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return responses.shift()!;
  };
}

describe('AnthropicLlm', () => {
  it('calls the Messages API and joins text blocks', async () => {
    const calls: Call[] = [];
    const llm = new AnthropicLlm({
      apiKey: 'sk-ant-test',
      model: undefined,
      fetch: mockFetch([new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }] }))], calls),
    });
    const r = await llm.complete({ system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 50 });
    expect(r.text).toBe('Hello there');
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.headers.get('x-api-key')).toBe('sk-ant-test');
    expect(calls[0]!.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(calls[0]!.body).toMatchObject({ model: process.env.GMS_LLM_MODEL ?? ANTHROPIC_DEFAULT_MODEL, max_tokens: 50, system: 'Be brief.' });
  });

  it('retries 529/5xx and raises typed errors without the key', async () => {
    const calls: Call[] = [];
    const llm = new AnthropicLlm({
      apiKey: 'sk-ant-secret',
      model: 'm',
      sleep: async () => {},
      fetch: mockFetch(
        [new Response('{}', { status: 529 }), new Response(JSON.stringify({ error: { message: 'bad key sk-ant-secret' } }), { status: 401 })],
        calls,
      ),
    });
    const err = (await llm.complete({ messages: [{ role: 'user', content: 'x' }] }).catch((e: unknown) => e)) as LlmError;
    expect(err).toBeInstanceOf(LlmError);
    expect(err.status).toBe(401);
    expect(err.message).not.toContain('sk-ant-secret');
    expect(calls).toHaveLength(2);
  });
});

describe('OpenAiLlm', () => {
  it('calls chat completions on a configurable base URL', async () => {
    const calls: Call[] = [];
    const llm = new OpenAiLlm({
      apiKey: 'sk-test',
      model: 'local-model',
      baseUrl: 'http://127.0.0.1:8080/v1/',
      fetch: mockFetch([new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Draft' } }] }))], calls),
    });
    expect((await llm.complete({ system: 'S', messages: [{ role: 'user', content: 'Q' }] })).text).toBe('Draft');
    expect(calls[0]!.url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer sk-test');
    expect(calls[0]!.body.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'Q' },
    ]);
  });
});

describe('StubBilling', () => {
  it('reports an active self-hosted plan', async () => {
    expect(await new StubBilling().planFor('ws')).toEqual({ plan: process.env.GMS_DEFAULT_PLAN ?? 'self_hosted', status: 'active' });
  });
});
