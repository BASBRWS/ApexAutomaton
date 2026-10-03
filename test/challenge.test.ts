import { describe, expect, it } from 'vitest';
import { initChallenge, evaluateChallenge, challengeStatus, bandFor, DEFAULT_LIFE_BANDS } from '../src/challenge.js';

const cfg = { enabled: true, lives: 3, periodDays: 30, bands: DEFAULT_LIFE_BANDS };
const day = (d: number) => new Date(Date.UTC(2026, 9, 3) + d * 86_400_000).toISOString();
/** lives after one month that ends at `endEquity` from a $200 start */
const after = (endEquity: number, lives = 3) =>
  evaluateChallenge({ ...initChallenge(cfg, 200, day(0)), lives }, cfg, endEquity, day(30)).next.lives;

describe('monthly challenge — graded lives', () => {
  it('maps each return band to the agreed life change', () => {
    expect(after(205.2)).toBe(3.5);   // +2.6%  -> +0.5
    expect(after(205)).toBe(3);       // +2.5%  -> ±0 (2.5% itself is not "above")
    expect(after(204)).toBe(3);       // +2.0%  -> ±0
    expect(after(203.9)).toBe(2.75);  // +1.95% -> −0.25
    expect(after(203)).toBe(2.75);    // +1.5%  -> −0.25
    expect(after(202.9)).toBe(2.5);   // +1.45% -> −0.5
    expect(after(202)).toBe(2.5);     // +1.0%  -> −0.5
    expect(after(201.9)).toBe(2);     // +0.95% -> −1
    expect(after(180)).toBe(2);       // −10%   -> −1
  });

  it('is robust to floating point right on a boundary', () => {
    expect(bandFor(204 / 200 - 1, DEFAULT_LIFE_BANDS).delta).toBe(0);
    expect(bandFor(0.0199999999999, DEFAULT_LIFE_BANDS).delta).toBe(0);
  });

  it('keeps the period open until 30 days have passed', () => {
    expect(evaluateChallenge(initChallenge(cfg, 200, day(0)), cfg, 150, day(29.9)).closed).toBeNull();
  });

  it('closes a month, records it and starts the next at the end equity', () => {
    const { next, closed } = evaluateChallenge(initChallenge(cfg, 200, day(0)), cfg, 203, day(30));
    expect(closed).toMatchObject({ period: 1, livesDelta: -0.25, livesAfter: 2.75 });
    expect(next).toMatchObject({ lives: 2.75, period: 2, periodStartEquityUsd: 203, periodStartAt: day(30) });
    expect(next.periodComputeUsd).toBeUndefined();
    expect(next.periodPeakEquityUsd).toBeUndefined();
  });

  it('dies when the lives run out, and never goes below zero', () => {
    expect(after(180, 0.75)).toBe(0);
    expect(after(180, 1)).toBe(0);
    expect(after(202, 0.5)).toBe(0);
  });

  it('closes only one month after a long outage', () => {
    const { next } = evaluateChallenge(initChallenge(cfg, 200, day(0)), cfg, 200, day(95));
    expect(next.lives).toBe(2);
    expect(next.periodStartAt).toBe(day(95));
  });

  it('reports progress, the projected band and the equity lines', () => {
    const s = challengeStatus(initChallenge(cfg, 200, day(0)), cfg, 203, day(10));
    expect(s.daysLeft).toBeCloseTo(20, 6);
    expect(s.projected.delta).toBe(-0.25);
    expect(s.safeEquityUsd).toBeCloseTo(204, 9);
    expect(s.bonusEquityUsd).toBeCloseTo(205, 9);
  });
});
