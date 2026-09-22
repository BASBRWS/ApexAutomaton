import { describe, expect, it } from 'vitest';
import { initDesk, accrueYield, setStake, equityUsd, stakedUsdOf } from '../src/trading/desk.js';

describe('real-yield sleeve', () => {
  it('starts empty and stakes cash 1:1', () => {
    const d = initDesk(500, 0);
    expect(stakedUsdOf(d)).toBe(0);
    const res = setStake(d, 200);
    expect(res.ok).toBe(true);
    expect(d.cashUsd).toBeCloseTo(300, 9);
    expect(d.stakedUsd).toBe(200);
    // Staking moves capital, so total equity is unchanged at the moment of staking.
    expect(equityUsd(d, {})).toBeCloseTo(500, 9);
  });

  it('unstakes back to cash when target is lower (0 = all)', () => {
    const d = initDesk(500, 0);
    setStake(d, 200);
    const res = setStake(d, 0);
    expect(res.ok).toBe(true);
    expect(d.stakedUsd).toBe(0);
    expect(d.cashUsd).toBeCloseTo(500, 9);
  });

  it('cannot stake more liquid capital than it has', () => {
    const d = initDesk(100, 0);
    const res = setStake(d, 250);
    expect(res.ok).toBe(false);
    expect(d.stakedUsd).toBe(0);
    expect(d.cashUsd).toBe(100);
  });

  it('accrues yield by elapsed time on the staked balance only', () => {
    const d = initDesk(500, 0);
    setStake(d, 100);
    // One full year at 5% APY on $100 staked = $5.
    const earned = accrueYield(d, 0.05, 1);
    expect(earned).toBeCloseTo(5, 9);
    expect(d.stakedUsd).toBeCloseTo(105, 9);
    // Cash is untouched; equity rises by exactly the yield earned.
    expect(d.cashUsd).toBeCloseTo(400, 9);
    expect(equityUsd(d, {})).toBeCloseTo(505, 9);
  });

  it('is a no-op with nothing staked, zero apy, or non-positive time', () => {
    const d = initDesk(500, 0);
    expect(accrueYield(d, 0.05, 1)).toBe(0); // nothing staked
    setStake(d, 100);
    expect(accrueYield(d, 0, 1)).toBe(0); // no rate
    expect(accrueYield(d, 0.05, 0)).toBe(0); // no time
    expect(d.stakedUsd).toBe(100);
  });

  it('yield at a small book is tiny next to a per-cycle burn (honest, not a cheat)', () => {
    const d = initDesk(117, 0);
    setStake(d, 117);
    // ~10 minutes of 5% APY on the whole 1-SOL book.
    const tenMinYears = 10 / (365 * 24 * 60);
    const earned = accrueYield(d, 0.05, tenMinYears);
    expect(earned).toBeLessThan(0.001); // << a ~$0.006-0.03 compute burn
  });
});
