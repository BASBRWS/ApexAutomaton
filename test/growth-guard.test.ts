import { describe, expect, it } from 'vitest';
import { economyCanGrow, worstCaseCycleBurnSol } from '../src/config.js';
import { makeTestConfig } from './helpers.js';

/**
 * The growth guard. Growth is only *possible* when one task pays more than the
 * worst-case cost of the cycle that decides to do it. This is the necessary
 * (not sufficient) condition — but if it fails, the economy is net-negative and
 * the agent can only die more slowly. This test FAILS the build in that case.
 */
describe('growth guard — the economy must be able to grow', () => {
  it('the shipped defaults are net-positive per task', () => {
    const cfg = makeTestConfig();
    expect(economyCanGrow(cfg)).toBe(true);
    // reward (0.2) must exceed worst-case frontier burn (1.0 * 0.08 = 0.08).
    expect(cfg.economy.marketTaskRewardSol).toBeGreaterThan(worstCaseCycleBurnSol(cfg));
  });

  it('flags a net-negative economy (reward <= worst-case burn)', () => {
    const bad = makeTestConfig({
      economy: { solPerUsd: 1.0, marketTaskRewardSol: 0.05, estimatedMaxCycleCostUsd: 0.08 },
    });
    expect(economyCanGrow(bad)).toBe(false);
  });

  it('a high SOL_PER_USD can make an otherwise-fine reward net-negative', () => {
    const bad = makeTestConfig({
      economy: { solPerUsd: 5.0, marketTaskRewardSol: 0.2, estimatedMaxCycleCostUsd: 0.08 },
    });
    // worst-case burn = 5.0 * 0.08 = 0.4 > 0.2 reward
    expect(economyCanGrow(bad)).toBe(false);
  });
});
