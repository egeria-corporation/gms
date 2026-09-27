// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import type { LLMProvider, LlmMessage } from '../types';

/** Deterministic stand-in: echoes a summary of the last user message. Output is always labeled as a draft by the UI. */
export class FakeLlm implements LLMProvider {
  readonly name = 'fake-llm' as const;
  async complete(input: { system?: string; messages: LlmMessage[]; maxTokens?: number }): Promise<{ text: string }> {
    const last = [...input.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const digest = createHash('sha256').update(last).digest('hex').slice(0, 8);
    const firstSentence = last.split(/(?<=[.?!])\s/)[0]?.slice(0, 200) ?? '';
    return { text: `Draft response (${digest}): ${firstSentence}` };
  }
}
