import { describe, expect, it } from 'vitest';
import {
  initDesk,
  applyOrders,
  equityUsd,
  grossExposureUsd,
  netPnlUsd,
  weightsToOrders,
  addVentureRevenue,
  ventureRevenueUsdOf,
  scoreboardEquityUsd,
  type ApplyContext,
} from '../src/trading/desk.js';

const ctx = (prices: Record<string, number>): ApplyContext => ({
  prices,
  tradableAssets: ['BTC', 'ETH'],
  maxGrossExposureUsd: 500,
  allowShort: true,
});

describe('venture revenue is separate from the paper book', () => {
  it('books revenue on its own line, never into paper cash or paper equity', () => {
    const d = initDesk(500, 0);
    addVentureRevenue(d, 25);
    expect(d.cashUsd).toBe(500);                 // paper cash untouched
    expect(equityUsd(d, {})).toBe(500);          // paper equity untouched
    expect(ventureRevenueUsdOf(d)).toBe(25);     // tracked separately
    expect(scoreboardEquityUsd(d, {})).toBe(525); // scoreboard = paper + venture
  });

  it('accumulates and stays readable as a distinct component', () => {
    const d = initDesk(500, 0);
    addVentureRevenue(d, 25);
    addVentureRevenue(d, 15);
    expect(ventureRevenueUsdOf(d)).toBe(40);
    // paper trading equity is always recoverable as scoreboard - venture revenue
    expect(scoreboardEquityUsd(d, {}) - ventureRevenueUsdOf(d)).toBe(equityUsd(d, {}));
  });

  it('tolerates state written before the field existed (treats missing as 0)', () => {
    const d = initDesk(500, 0);
    // simulate legacy persisted desk lacking the field
    delete (d as { ventureRevenueUsd?: number }).ventureRevenueUsd;
    expect(ventureRevenueUsdOf(d)).toBe(0);
    expect(scoreboardEquityUsd(d, {})).toBe(500);
  });
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

  it('weightsToOrders scales weights to USD targets and flattens the rest', () => {
    const orders = weightsToOrders(['BTC', 'ETH', 'SOL'], { BTC: 0.5, ETH: -0.25 }, 400);
    const byAsset = Object.fromEntries(orders.map((o) => [o.asset, o.targetUsd]));
    expect(byAsset.BTC).toBeCloseTo(200, 6);
    expect(byAsset.ETH).toBeCloseTo(-100, 6);
    expect(byAsset.SOL).toBe(0); // omitted -> flat
  });

  it('a rebalance (weights -> orders -> apply) builds the intended book', () => {
    const d = initDesk(500, 0);
    const prices = { BTC: 50000, ETH: 2500, SOL: 100 };
    const orders = weightsToOrders(['BTC', 'ETH', 'SOL'], { BTC: 0.4, SOL: 0.2 }, equityUsd(d, prices));
    applyOrders(d, orders, { prices, tradableAssets: ['BTC', 'ETH', 'SOL'], maxGrossExposureUsd: 500, allowShort: true });
    expect(grossExposureUsd(d, prices)).toBeCloseTo(300, 6); // 40% + 20% of $500
    expect(equityUsd(d, prices)).toBeCloseTo(500, 6);
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
