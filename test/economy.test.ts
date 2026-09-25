import { describe, expect, it } from 'vitest';
import { computeCostUsd, equityToSol, tierForEquity } from '../src/economy.js';
import { usdCostOf } from '../src/llm/pricing.js';
import { makeTestConfig } from './helpers.js';

const cfg = makeTestConfig();

describe('compute cost (USD, from token usage)', () => {
  it('prices Opus tokens from the table', () => {
    const cost = computeCostUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(30, 6);
  });

  it('matches the pricing helper and is cheaper on Haiku', () => {
    const usage = { inputTokens: 10_000, outputTokens: 2_000 };
    expect(computeCostUsd('claude-opus-5', usage)).toBe(usdCostOf('claude-opus-5', usage));
    expect(computeCostUsd('claude-haiku-4-5', usage)).toBeLessThan(
      computeCostUsd('claude-opus-5', usage),
    );
  });
});

describe('equity → SOL → tier', () => {
  it('converts USD equity to SOL at the given price', () => {
    expect(equityToSol(300, 150)).toBeCloseTo(2, 6);
    expect(equityToSol(100, 0)).toBe(0); // guards against divide-by-zero
  });

  it('maps a healthy book to a high tier and a tiny book to CRITICAL/DEAD', () => {
    // $500 at SOL=$150 -> ~3.33 SOL -> ABUNDANT
    expect(tierForEquity(500, 150, cfg)).toBe('ABUNDANT');
    // $15 at SOL=$150 -> 0.1 SOL -> LOW boundary
    expect(tierForEquity(15, 150, cfg)).toBe('LOW');
    // dust
    expect(tierForEquity(0.1, 150, cfg)).toBe('DEAD');
  });
  it('measures the SOL goal at the observed price rather than the genesis quote', () => {
    const equityUsd = 216.38;
    expect(equityToSol(equityUsd, 120.97)).toBeCloseTo(1.7887, 3);
    expect(equityToSol(equityUsd, 116.96)).toBeGreaterThan(1.85);
  });
});
