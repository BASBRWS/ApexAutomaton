import { describe, expect, it } from 'vitest';
import {
  initDesk,
  applyOrders,
  equityUsd,
  grossExposureUsd,
  netPnlUsd,
  type ApplyContext,
} from '../src/trading/desk.js';

const ctx = (prices: Record<string, number>): ApplyContext => ({
  prices,
  tradableAssets: ['BTC', 'ETH'],
  maxGrossExposureUsd: 500,
  allowShort: true,
});

describe('trading desk', () => {
  it('starts all in cash with equity = capital', () => {
    const d = initDesk(500, 0);
    expect(d.cashUsd).toBe(500);
    expect(equityUsd(d, { BTC: 60000 })).toBe(500);
    expect(netPnlUsd(d, {})).toBe(0);
  });

  it('going long moves cash into a position, equity unchanged at entry', () => {
    const d = initDesk(500, 0);
    applyOrders(d, [{ asset: 'BTC', targetUsd: 200 }], ctx({ BTC: 60000 }));
    expect(d.cashUsd).toBeCloseTo(300, 6);
    expect(equityUsd(d, { BTC: 60000 })).toBeCloseTo(500, 6);
    expect(grossExposureUsd(d, { BTC: 60000 })).toBeCloseTo(200, 6);
  });

  it('profits when a long asset rises', () => {
    const d = initDesk(500, 0);
    applyOrders(d, [{ asset: 'BTC', targetUsd: 200 }], ctx({ BTC: 60000 }));
    // +10% move
    expect(equityUsd(d, { BTC: 66000 })).toBeCloseTo(520, 6);
    expect(netPnlUsd(d, { BTC: 66000 })).toBeCloseTo(20, 6);
  });

  it('profits from a short when the asset falls', () => {
    const d = initDesk(500, 0);
    applyOrders(d, [{ asset: 'ETH', targetUsd: -100 }], ctx({ ETH: 3000 }));
    expect(d.cashUsd).toBeCloseTo(600, 6); // short adds proceeds to cash
    // ETH falls 10% -> short gains $10
    expect(equityUsd(d, { ETH: 2700 })).toBeCloseTo(510, 6);
  });

  it('closing (target 0) realises the position back into cash', () => {
    const d = initDesk(500, 0);
    applyOrders(d, [{ asset: 'BTC', targetUsd: 200 }], ctx({ BTC: 60000 }));
    applyOrders(d, [{ asset: 'BTC', targetUsd: 0 }], ctx({ BTC: 66000 }));
    expect(d.positions.BTC).toBeUndefined();
    expect(d.cashUsd).toBeCloseTo(520, 6);
    expect(equityUsd(d, { BTC: 66000 })).toBeCloseTo(520, 6);
  });

  it('rejects orders that breach the gross-exposure cap', () => {
    const d = initDesk(500, 0);
    const out = applyOrders(d, [{ asset: 'BTC', targetUsd: 600 }], ctx({ BTC: 60000 }));
    expect(out[0]!.ok).toBe(false);
    expect(out[0]!.reason).toMatch(/gross exposure cap/i);
    expect(d.positions.BTC).toBeUndefined();
  });

  it('rejects untradable assets, missing prices, and shorts when disabled', () => {
    const d = initDesk(500, 0);
    expect(applyOrders(d, [{ asset: 'DOGE', targetUsd: 100 }], ctx({ BTC: 1 }))[0]!.ok).toBe(false);
    expect(applyOrders(d, [{ asset: 'BTC', targetUsd: 100 }], ctx({}))[0]!.ok).toBe(false);
    const noShort: ApplyContext = { ...ctx({ BTC: 60000 }), allowShort: false };
    expect(applyOrders(d, [{ asset: 'BTC', targetUsd: -100 }], noShort)[0]!.ok).toBe(false);
  });

  it('gross exposure counts both longs and shorts', () => {
    const d = initDesk(500, 0);
    applyOrders(
      d,
      [
        { asset: 'BTC', targetUsd: 150 },
        { asset: 'ETH', targetUsd: -150 },
      ],
      ctx({ BTC: 60000, ETH: 3000 }),
    );
    expect(grossExposureUsd(d, { BTC: 60000, ETH: 3000 })).toBeCloseTo(300, 6);
  });
});
