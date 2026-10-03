import { describe, expect, it } from 'vitest';
import { initChallenge, evaluateChallenge, challengeStatus, outcomeFor } from '../src/challenge.js';

const cfg = { enabled: true, lives: 3, periodDays: 30, minReturn: 0.02, targetReturn: 0.028 };
const day = (d: number) => new Date(Date.UTC(2026, 9, 3) + d * 86_400_000).toISOString();

describe('monthly challenge', () => {
  it('starts with all lives at the current equity', () => {
    const ch = initChallenge(cfg, 200, day(0));
    expect(ch).toMatchObject({ lives: 3, period: 1, periodStartEquityUsd: 200, history: [] });
  });

  it('keeps the period open until 30 days have passed', () => {
    const ch = initChallenge(cfg, 200, day(0));
    expect(evaluateChallenge(ch, cfg, 150, day(29.9)).closed).toBeNull();
  });

  it('a month under 2% costs one life and starts a new month at the end equity', () => {
    const ch = initChallenge(cfg, 200, day(0));
    const { next, closed } = evaluateChallenge(ch, cfg, 203, day(30)); // +1.5%
    expect(closed?.outcome).toBe('fail');
    expect(next).toMatchObject({ lives: 2, period: 2, periodStartEquityUsd: 203, periodStartAt: day(30) });
    expect(next.periodComputeUsd).toBeUndefined(); // compute counter resets each month
  });

  it('2% passes and 2.8% hits the stretch target without costing a life', () => {
    expect(outcomeFor(0.02, cfg)).toBe('pass');
    expect(outcomeFor(0.028, cfg)).toBe('target');
    const ch = initChallenge(cfg, 200, day(0));
    expect(evaluateChallenge(ch, cfg, 206, day(30)).next.lives).toBe(3);
  });

  it('three missed months take the last life', () => {
    let ch = initChallenge(cfg, 200, day(0));
    for (let m = 1; m <= 3; m++) ch = evaluateChallenge(ch, cfg, 200, day(30 * m)).next;
    expect(ch.lives).toBe(0);
    expect(ch.history.map((h) => h.outcome)).toEqual(['fail', 'fail', 'fail']);
  });

  it('closes only one month after a long outage, never a string of failures', () => {
    const ch = initChallenge(cfg, 200, day(0));
    const { next } = evaluateChallenge(ch, cfg, 200, day(95));
    expect(next.lives).toBe(2);
    expect(next.periodStartAt).toBe(day(95));
  });

  it('reports progress, days left and the equity needed', () => {
    const s = challengeStatus(initChallenge(cfg, 200, day(0)), cfg, 202, day(10));
    expect(s.daysLeft).toBeCloseTo(20, 6);
    expect(s.returnSoFar).toBeCloseTo(0.01, 9);
    expect(s.minEquityUsd).toBeCloseTo(204, 9);
    expect(s.targetEquityUsd).toBeCloseTo(205.6, 9);
  });
});
