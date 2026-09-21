import Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMRequest, LLMResponse } from './client.js';

/**
 * Anthropic implementation of {@link LLMClient}.
 *
 * Notes:
 * - The cheapest tier uses Haiku, which does not support adaptive thinking or
 *   the effort control; we only attach those for models that accept them.
 * - The system prompt is sent as a cached block so repeated cycles are cheaper.
 */
export class AnthropicClient implements LLMClient {
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    // Zero-arg construction resolves ANTHROPIC_API_KEY / auth profile itself.
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const supportsAdaptive = !req.model.includes('haiku');

    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (req.system) {
      params.system = [
        { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
      ];
    }

    if (supportsAdaptive) {
      params.thinking = { type: 'adaptive' };
      if (req.effort) {
        params.output_config = { effort: req.effort };
      }
    }

    const resp = await this.client.messages.create(params);

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return {
      text,
      model: resp.model,
      usage: {
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        cacheReadTokens: resp.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: resp.usage.cache_creation_input_tokens ?? 0,
      },
      stopReason: resp.stop_reason,
    };
  }
}
