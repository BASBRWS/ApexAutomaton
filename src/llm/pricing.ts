/**
 * Model price table (USD per 1,000,000 tokens). Used to convert real token
 * usage into a real USD cost, which economy.ts then converts to an on-chain
 * SOL burn. Prices are Anthropic first-party API rates; keep them in sync with
 * https://docs.anthropic.com/en/docs/about-claude/pricing when they change.
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
  /** USD per 1M cache-read tokens (~0.1x input); optional. */
  cacheReadPerMTok?: number;
  /** USD per 1M cache-write tokens (~1.25x input); optional. */
  cacheWritePerMTok?: number;
}

export const PRICE_TABLE: Record<string, ModelPrice> = {
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
};

/** Conservative fallback used when a model id is not in the table. */
export const FALLBACK_PRICE: ModelPrice = {
  inputPerMTok: 5,
  outputPerMTok: 25,
  cacheReadPerMTok: 0.5,
  cacheWritePerMTok: 6.25,
};

export function priceFor(model: string): ModelPrice {
  return PRICE_TABLE[model] ?? FALLBACK_PRICE;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Real USD cost of one LLM call, from its token usage and model. */
export function usdCostOf(model: string, usage: TokenUsage): number {
  const p = priceFor(model);
  const input = (usage.inputTokens * p.inputPerMTok) / 1_000_000;
  const output = (usage.outputTokens * p.outputPerMTok) / 1_000_000;
  const cacheRead =
    ((usage.cacheReadTokens ?? 0) * (p.cacheReadPerMTok ?? p.inputPerMTok)) / 1_000_000;
  const cacheWrite =
    ((usage.cacheCreationTokens ?? 0) * (p.cacheWritePerMTok ?? p.inputPerMTok)) / 1_000_000;
  return input + output + cacheRead + cacheWrite;
}
