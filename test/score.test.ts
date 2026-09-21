import { describe, expect, it } from 'vitest';
import { initialScore, updateScore } from '../src/score.js';

describe('trading score', () => {
  it('initialises at the starting equity with zero PnL', () => {
    const s = initialScore(500);
    expect(s.startEquityUsd).toBe(500);
    expect(s.equityUsd).toBe(500);
    expect(s.peakEquityUsd).toBe(500);
    expect(s.netPnlUsd).toBe(0);
    expect(s.firstProfitAtCycle).toBeNull();
  });

  it('tracks peak equity as a high-water mark', () => {
    let s = initialScore(500);
    s = updateScore(s, { cycle: 1, equityUsd: 560, burnUsd: 0.01, traded: true });
    s = updateScore(s, { cycle: 2, equityUsd: 520, burnUsd: 0.01, traded: true });
    expect(s.peakEquityUsd).toBe(560);
    expect(s.equityUsd).toBe(520);
  });

  it('records the first profitable cycle and accumulates burn', () => {
    let s = initialScore(500);
    s = updateScore(s, { cycle: 1, equityUsd: 498, burnUsd: 0.02, traded: false });
    expect(s.firstProfitAtCycle).toBeNull();
    expect(s.netPnlUsd).toBe(-2);
    s = updateScore(s, { cycle: 2, equityUsd: 510, burnUsd: 0.02, traded: true });
    expect(s.firstProfitAtCycle).toBe(2);
    expect(s.netPnlUsd).toBe(10);
    expect(s.cumulativeBurnUsd).toBeCloseTo(0.04, 6);
    expect(s.tradeCycles).toBe(1);
  });

  it('net PnL can be negative (the market took the book)', () => {
    let s = initialScore(500);
    s = updateScore(s, { cycle: 1, equityUsd: 300, burnUsd: 0.01, traded: true });
    expect(s.netPnlUsd).toBe(-200);
  });
});
