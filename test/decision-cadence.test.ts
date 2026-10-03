import { describe, expect, it } from 'vitest';
import { decisionReason, shouldObserveOnly, type CadenceInput } from '../src/decision-cadence.js';

const cfg = { minHoursBetween: 4, positionMoveTrigger: 0.03, marketMoveTrigger: 0.02, maxPerDay: 6 };
const at = (h: number) => new Date(Date.UTC(2026, 9, 3, 0, 0) + h * 3_600_000).toISOString();

function situation(overrides: Partial<CadenceInput> = {}): CadenceInput {
  return {
    now: at(1),
    cfg,
    prices: { BTC: 100.5, ETH: 200 },
    openAssets: [],
    lastDecision: { at: at(0), prices: { BTC: 100, ETH: 200, PAXG: 3000 } },
    recentDecisionTimes: [at(0)],
    ventureChanged: false,
    onchainActionReady: false,
    ...overrides,
  };
}

describe('decision cadence', () => {
  it('only observes between scheduled decisions on a calm market', () => {
    expect(shouldObserveOnly(situation())).toBe(true);
    expect(decisionReason(situation({ now: at(4) }))).toBe('scheduled');
  });

  it('decides on the very first cycle', () => {
    expect(decisionReason(situation({ lastDecision: undefined }))).toBe('first decision');
  });

  it('wakes early on a big market move or an open position moving', () => {
    expect(decisionReason(situation({ prices: { BTC: 102.5, ETH: 200 } }))).toBe('BTC moved');
    expect(decisionReason(situation({ openAssets: ['PAXG'], prices: { BTC: 100.5, ETH: 200, PAXG: 3100 } }))).toBe('PAXG position moved');
    // an open position that barely moved does not force a paid decision
    expect(shouldObserveOnly(situation({ openAssets: ['PAXG'], prices: { BTC: 100.5, ETH: 200, PAXG: 3010 } }))).toBe(true);
  });

  it('wakes for a venture change or a ready on-chain action', () => {
    expect(decisionReason(situation({ ventureChanged: true }))).toBe('venture changed');
    expect(decisionReason(situation({ onchainActionReady: true }))).toBe('on-chain venture action ready');
  });

  it('never exceeds the daily decision cap, even on a trigger', () => {
    const six = [0, 1, 2, 3, 4, 5].map((h) => at(h - 6));
    expect(shouldObserveOnly(situation({ recentDecisionTimes: six, prices: { BTC: 110, ETH: 200 } }))).toBe(true);
    // decisions older than 24h no longer count
    const old = [0, 1, 2, 3, 4, 5].map((h) => at(h - 30));
    expect(shouldObserveOnly(situation({ recentDecisionTimes: old, prices: { BTC: 110, ETH: 200 } }))).toBe(false);
  });
});
