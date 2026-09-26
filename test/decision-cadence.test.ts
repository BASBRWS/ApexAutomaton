import { describe, expect, it } from 'vitest';
import { shouldObserveOnly } from '../src/decision-cadence.js';
import type { JournalEntry } from '../src/types.js';

const rest = { action: 'rest', actionSummary: 'rested (no action taken)' } as JournalEntry;
const rejected = { action: 'propose_venture', actionSummary: 'venture not queued: operator declined ID' } as JournalEntry;
const accepted = { action: 'propose_venture', actionSummary: 'proposed venture v0011' } as JournalEntry;

function situation(overrides: Partial<Parameters<typeof shouldObserveOnly>[0]> = {}) {
  return {
    cycle: 225,
    openPositions: 0,
    prices: { BTC: 101, ETH: 200 },
    previousPrices: { BTC: 100.5, ETH: 200 },
    recent: [rest, rejected, rest],
    ventureChanged: false,
    onchainActionReady: false,
    ...overrides,
  };
}

describe('decision cadence', () => {
  it('avoids a model call after three no-op decisions on a calm flat book', () => {
    expect(shouldObserveOnly(situation())).toBe(true);
    expect(shouldObserveOnly(situation({ cycle: 228 }))).toBe(false);
  });

  it('wakes immediately for a market move, position or actionable venture', () => {
    expect(shouldObserveOnly(situation({ prices: { BTC: 102, ETH: 200 } }))).toBe(false);
    expect(shouldObserveOnly(situation({ openPositions: 1 }))).toBe(false);
    expect(shouldObserveOnly(situation({ ventureChanged: true }))).toBe(false);
    expect(shouldObserveOnly(situation({ onchainActionReady: true }))).toBe(false);
    expect(shouldObserveOnly(situation({ prices: { BTC: 101 } }))).toBe(false);
  });

  it('keeps deciding after a successful venture or too little history', () => {
    expect(shouldObserveOnly(situation({ recent: [rest, accepted, rest] }))).toBe(false);
    expect(shouldObserveOnly(situation({ recent: [rest, rejected] }))).toBe(false);
  });
});
