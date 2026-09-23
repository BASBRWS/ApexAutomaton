import { describe, expect, it } from 'vitest';
import { realizedFromClose } from '../src/memory/lessons.js';

describe('realizedFromClose — learning from trade outcomes', () => {
  it('realizes a full long close at profit', () => {
    const r = realizedFromClose({ BTC: { units: 1, entryPriceUsd: 100 } }, {}, { BTC: 120 });
    expect(r.realizedUsd).toBeCloseTo(20);
    expect(r.legs).toEqual(['BTC +$20.00']);
  });

  it('realizes a partial reduction in the same direction', () => {
    const r = realizedFromClose(
      { BTC: { units: 2, entryPriceUsd: 100 } },
      { BTC: { units: 0.5 } },
      { BTC: 110 },
    );
    // closed 1.5 units at +10 = +15
    expect(r.realizedUsd).toBeCloseTo(15);
  });

  it('realizes a short close at profit (price fell)', () => {
    const r = realizedFromClose({ ETH: { units: -1, entryPriceUsd: 100 } }, {}, { ETH: 80 });
    expect(r.realizedUsd).toBeCloseTo(20);
  });

  it('realizes a loss', () => {
    const r = realizedFromClose({ BTC: { units: 1, entryPriceUsd: 100 } }, {}, { BTC: 90 });
    expect(r.realizedUsd).toBeCloseTo(-10);
    expect(r.legs[0]).toBe('BTC -$10.00');
  });

  it('on a sign flip, realizes the entire prior leg', () => {
    const r = realizedFromClose(
      { BTC: { units: 1, entryPriceUsd: 100 } },
      { BTC: { units: -0.5 } },
      { BTC: 120 },
    );
    expect(r.realizedUsd).toBeCloseTo(20);
  });

  it('realizes nothing when a position grows or is unchanged', () => {
    expect(realizedFromClose({ BTC: { units: 1, entryPriceUsd: 100 } }, { BTC: { units: 2 } }, { BTC: 120 }).realizedUsd).toBe(0);
    expect(realizedFromClose({ BTC: { units: 1, entryPriceUsd: 100 } }, { BTC: { units: 1 } }, { BTC: 120 }).realizedUsd).toBe(0);
  });

  it('sums realized across several closed legs', () => {
    const r = realizedFromClose(
      { BTC: { units: 1, entryPriceUsd: 100 }, ETH: { units: -2, entryPriceUsd: 50 } },
      {},
      { BTC: 110, ETH: 45 },
    );
    // BTC +10, ETH short 2 units, price 45<50 → -2*(45-50)=+10
    expect(r.realizedUsd).toBeCloseTo(20);
    expect(r.legs).toHaveLength(2);
  });
});
