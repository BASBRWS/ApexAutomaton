import { describe, expect, it } from 'vitest';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { usdToBurnLamports, computeCostUsd, settleCompute } from '../src/economy.js';
import { usdCostOf } from '../src/llm/pricing.js';
import { makeTestConfig } from './helpers.js';

const cfg = makeTestConfig();

describe('pricing → USD cost', () => {
  it('prices Opus tokens from the table', () => {
    // 1M input @ $5 + 1M output @ $25 = $30
    const cost = usdCostOf('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(30, 6);
  });

  it('prices Haiku cheaper than Opus for identical usage', () => {
    const usage = { inputTokens: 10_000, outputTokens: 2_000 };
    expect(usdCostOf('claude-haiku-4-5', usage)).toBeLessThan(usdCostOf('claude-opus-5', usage));
  });

  it('computeCostUsd matches the pricing helper', () => {
    const usage = { inputTokens: 4_000, outputTokens: 1_500 };
    expect(computeCostUsd('claude-opus-5', usage)).toBe(usdCostOf('claude-opus-5', usage));
  });
});

describe('usdToBurnLamports', () => {
  it('converts USD to lamports via SOL_PER_USD', () => {
    // $0.05 * 1.0 SOL/USD = 0.05 SOL
    expect(usdToBurnLamports(cfg, 0.05)).toBe(Math.round(0.05 * LAMPORTS_PER_SOL));
  });

  it('doubles when SOL_PER_USD doubles', () => {
    const cfg2 = makeTestConfig({ economy: { ...cfg.economy, solPerUsd: 2.0 } });
    expect(usdToBurnLamports(cfg2, 0.05)).toBe(2 * usdToBurnLamports(cfg, 0.05));
  });
});

describe('settleCompute — near-death guard', () => {
  it('settles nothing (and never touches the signer) when balance < fee buffer', async () => {
    const signer = {
      signAndSend: () => {
        throw new Error('signer must not be called when nothing is spendable');
      },
    } as unknown as Parameters<typeof settleCompute>[0]['signer'];

    const res = await settleCompute({
      signer,
      cfg,
      burnLamports: 1_000_000,
      currentBalanceLamports: 100, // below the 5000-lamport fee buffer
      cycle: 1,
    });
    expect(res.settledLamports).toBe(0);
    expect(res.signature).toBeNull();
  });

  it('reports no burn when burnLamports is zero', async () => {
    const signer = {} as unknown as Parameters<typeof settleCompute>[0]['signer'];
    const res = await settleCompute({
      signer,
      cfg,
      burnLamports: 0,
      currentBalanceLamports: 1_000_000,
      cycle: 1,
    });
    expect(res.settledLamports).toBe(0);
    expect(res.signature).toBeNull();
  });
});
