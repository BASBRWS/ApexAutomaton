import { describe, expect, it } from 'vitest';
import {
  CompositePriceSource,
  parseYahooChartPrice,
  YAHOO_TICKERS,
  type PriceSnapshot,
  type PriceSource,
} from '../src/marketdata.js';

describe('Yahoo (beyond-crypto) price parsing', () => {
  it('extracts regularMarketPrice from a chart response', () => {
    const body = { chart: { result: [{ meta: { regularMarketPrice: 187.42 } }] } };
    expect(parseYahooChartPrice(body)).toBe(187.42);
  });

  it('returns undefined for missing/invalid/zero prices', () => {
    expect(parseYahooChartPrice({})).toBeUndefined();
    expect(parseYahooChartPrice({ chart: { result: [] } })).toBeUndefined();
    expect(parseYahooChartPrice({ chart: { result: [{ meta: { regularMarketPrice: 0 } }] } })).toBeUndefined();
    expect(parseYahooChartPrice({ chart: { result: [{ meta: { regularMarketPrice: 'x' } }] } })).toBeUndefined();
  });

  it('covers forex, commodities and equities (distinct asset classes)', () => {
    expect(YAHOO_TICKERS.EURUSD).toBe('EURUSD=X'); // forex
    expect(YAHOO_TICKERS.WTI).toBe('CL=F'); // commodity
    expect(YAHOO_TICKERS.AAPL).toBe('AAPL'); // equity
  });
});

function fake(name: string, prices: Record<string, number>, fail = false): PriceSource {
  return {
    name,
    async getPrices(symbols): Promise<PriceSnapshot> {
      if (fail) throw new Error(`${name} down`);
      const out: Record<string, number> = {};
      for (const s of symbols) if (s.toUpperCase() in prices) out[s.toUpperCase()] = prices[s.toUpperCase()]!;
      if (Object.keys(out).length === 0) throw new Error(`${name}: nothing`);
      return { at: 'now', prices: out };
    },
  };
}

describe('CompositePriceSource', () => {
  it('uses the first source when it has everything', async () => {
    const src = new CompositePriceSource([
      fake('a', { BTC: 60000, ETH: 3000, SOL: 150 }),
      fake('b', { BTC: 1, ETH: 1, SOL: 1 }),
    ]);
    const snap = await src.getPrices(['BTC', 'ETH', 'SOL']);
    expect(snap.prices).toEqual({ BTC: 60000, ETH: 3000, SOL: 150 });
  });

  it('falls back to the second source for symbols the first is missing', async () => {
    const src = new CompositePriceSource([
      fake('a', { BTC: 60000 }),
      fake('b', { ETH: 3000, SOL: 150 }),
    ]);
    const snap = await src.getPrices(['BTC', 'ETH', 'SOL']);
    expect(snap.prices).toEqual({ BTC: 60000, ETH: 3000, SOL: 150 });
  });

  it('survives a failing source and still returns what it can', async () => {
    const src = new CompositePriceSource([
      fake('a', {}, true),
      fake('b', { BTC: 60000, SOL: 150 }),
    ]);
    const snap = await src.getPrices(['BTC', 'SOL']);
    expect(snap.prices).toEqual({ BTC: 60000, SOL: 150 });
  });

  it('throws only when every source fails', async () => {
    const src = new CompositePriceSource([fake('a', {}, true), fake('b', {}, true)]);
    await expect(src.getPrices(['BTC'])).rejects.toThrow();
  });
});
