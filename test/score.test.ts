import { describe, expect, it } from 'vitest';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { initialScore, updateScore } from '../src/score.js';

const SEED = 1 * LAMPORTS_PER_SOL;

describe('score', () => {
  it('initialises with peak = seed and zero elsewhere', () => {
    const s = initialScore(SEED);
    expect(s.peakBalanceLamports).toBe(SEED);
    expect(s.cumulativeRevenueLamports).toBe(0);
    expect(s.tasksCompleted).toBe(0);
    expect(s.firstDollarAtCycle).toBeNull();
    expect(s.netGrowthLamports).toBe(0);
  });

  it('records first earning cycle and accumulates revenue/burn', () => {
    let s = initialScore(SEED);
    // cycle 1: rest, no revenue, small burn
    s = updateScore(s, {
      cycle: 1,
      balanceLamports: SEED - 1_000_000,
      revenueLamports: 0,
      burnLamports: 1_000_000,
      taskCompleted: false,
    });
    expect(s.firstDollarAtCycle).toBeNull();

    // cycle 2: earn a task
    s = updateScore(s, {
      cycle: 2,
      balanceLamports: SEED + 150_000_000,
      revenueLamports: 200_000_000,
      burnLamports: 1_500_000,
      taskCompleted: true,
    });
    expect(s.firstDollarAtCycle).toBe(2);
    expect(s.cumulativeRevenueLamports).toBe(200_000_000);
    expect(s.tasksCompleted).toBe(1);
  });

  it('tracks peak balance as a high-water mark', () => {
    let s = initialScore(SEED);
    s = updateScore(s, { cycle: 1, balanceLamports: 3 * SEED, revenueLamports: 0, burnLamports: 0, taskCompleted: false });
    s = updateScore(s, { cycle: 2, balanceLamports: SEED, revenueLamports: 0, burnLamports: 0, taskCompleted: false });
    expect(s.peakBalanceLamports).toBe(3 * SEED);
  });

  it('computes net growth relative to seed (can go negative)', () => {
    let s = initialScore(SEED);
    s = updateScore(s, { cycle: 1, balanceLamports: SEED / 2, revenueLamports: 0, burnLamports: SEED / 2, taskCompleted: false });
    expect(s.netGrowthLamports).toBe(SEED / 2 - SEED);
    expect(s.netGrowthLamports).toBeLessThan(0);
  });

  it('margin per task reflects net over tasks (honest about idling)', () => {
    let s = initialScore(SEED);
    // One earning cycle: +200_000_000 revenue, -1_500_000 burn
    s = updateScore(s, { cycle: 1, balanceLamports: SEED, revenueLamports: 200_000_000, burnLamports: 1_500_000, taskCompleted: true });
    const afterOne = s.marginPerTaskLamports;
    expect(afterOne).toBe(200_000_000 - 1_500_000);

    // Then two idle cycles that only burn — margin per task must fall.
    s = updateScore(s, { cycle: 2, balanceLamports: SEED, revenueLamports: 0, burnLamports: 1_500_000, taskCompleted: false });
    s = updateScore(s, { cycle: 3, balanceLamports: SEED, revenueLamports: 0, burnLamports: 1_500_000, taskCompleted: false });
    expect(s.marginPerTaskLamports).toBeLessThan(afterOne);
  });
});
