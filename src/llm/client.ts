import type { TokenUsage } from './pricing.js';

/**
 * Provider-agnostic LLM interface. The loop depends only on this; the Anthropic
 * implementation lives in anthropic.ts. Swapping providers is a one-file change.
 */

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  model: string;
  system?: string;
  messages: LLMMessage[];
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface LLMResponse {
  text: string;
  /** a readable summary of the model's own reasoning (thinking), when available. */
  thinking?: string;
  model: string;
  usage: TokenUsage;
  stopReason: string | null;
}

export interface LLMClient {
  generate(req: LLMRequest): Promise<LLMResponse>;
}
