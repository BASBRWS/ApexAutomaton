import type { Config } from './config.js';

/**
 * marketdata.ts — REAL, read-only market prices. This is the only place the
 * agent touches the outside world's judgement: it does not decide whether a
 * trade was good, the real price does. No funds are ever moved here.
 *
 * Prices are USD per unit. To be robust from CI / cloud IPs (where a single
 * provider often rate-limits or 403s), the default source tries Coinbase first
 * and falls back to CoinGecko, merging whatever each returns.
 */

export type PriceMap = Record<string, number>;

export interface PriceSnapshot {
  at: string;
  /** USD per unit, keyed by uppercase symbol (e.g. { BTC: 65000, SOL: 150 }). */
  prices: PriceMap;
}

export interface PriceSource {
  readonly name: string;
  getPrices(symbols: string[]): Promise<PriceSnapshot>;
}

/** Map trading symbols to CoinGecko ids — a broad, liquid universe. Add any
 * CoinGecko id here and the symbol to TRADING_ASSETS to let the agent trade it. */
export const COINGECKO_IDS: Record<string, string> = {
  // majors
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  TRX: 'tron',
  LINK: 'chainlink',
  DOT: 'polkadot',
  LTC: 'litecoin',
  MATIC: 'matic-network',
  BCH: 'bitcoin-cash',
  ATOM: 'cosmos',
  UNI: 'uniswap',
  AAVE: 'aave',
  ETC: 'ethereum-classic',
  XLM: 'stellar',
  ALGO: 'algorand',
  FIL: 'filecoin',
  // L2 / newer L1s
  ARB: 'arbitrum',
  OP: 'optimism',
  APT: 'aptos',
  SUI: 'sui',
  NEAR: 'near',
  INJ: 'injective-protocol',
  TIA: 'celestia',
  SEI: 'sei-network',
  RENDER: 'render-token',
  HBAR: 'hedera-hashgraph',
  // Solana ecosystem
  JUP: 'jupiter-exchange-solana',
  BONK: 'bonk',
  WIF: 'dogwifcoin',
  PYTH: 'pyth-network',
  JTO: 'jito-governance-token',
  RAY: 'raydium',
  ORCA: 'orca',
  // non-crypto-ish diversifiers (tokenised gold)
  PAXG: 'pax-gold',
  XAUT: 'tether-gold',
  // stablecoins (a place to sit; price ~1)
  USDC: 'usd-coin',
  USDT: 'tether',
};

/** Coinbase spot: one request per symbol, keyless, reliable from most IPs. */
export class CoinbasePriceSource implements PriceSource {
  readonly name = 'coinbase';
  constructor(private readonly base = 'https://api.coinbase.com/v2/prices') {}

  async getPrices(symbols: string[]): Promise<PriceSnapshot> {
    const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
    const prices: PriceMap = {};
    await Promise.all(
      wanted.map(async (sym) => {
        try {
          const res = await fetch(`${this.base}/${sym}-USD/spot`, {
            headers: { accept: 'application/json' },
          });
          if (!res.ok) return;
          const body = (await res.json()) as { data?: { amount?: string } };
          const amt = Number(body?.data?.amount);
          if (Number.isFinite(amt) && amt > 0) prices[sym] = amt;
        } catch {
          /* ignore one symbol; the composite/fallback handles the rest */
        }
      }),
    );
    if (Object.keys(prices).length === 0) throw new Error('coinbase: no usable prices');
    return { at: new Date().toISOString(), prices };
  }
}

/** CoinGecko simple price: one batched request. */
export class CoinGeckoPriceSource implements PriceSource {
  readonly name = 'coingecko';
  constructor(private readonly base: string) {}

  async getPrices(symbols: string[]): Promise<PriceSnapshot> {
    const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
    const ids = wanted.map((s) => COINGECKO_IDS[s]).filter((id): id is string => Boolean(id));
    if (ids.length === 0) throw new Error(`no CoinGecko ids for: ${wanted.join(', ')}`);
    const url = `${this.base}?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`coingecko ${res.status} ${res.statusText}`);
    const body = (await res.json()) as Record<string, { usd?: number }>;
    const prices: PriceMap = {};
    for (const sym of wanted) {
      const id = COINGECKO_IDS[sym];
      const usd = id ? body[id]?.usd : undefined;
      if (typeof usd === 'number' && Number.isFinite(usd)) prices[sym] = usd;
    }
    if (Object.keys(prices).length === 0) throw new Error('coingecko: no usable prices');
    return { at: new Date().toISOString(), prices };
  }
}

/** Map trading symbols to Yahoo Finance tickers — the world BEYOND crypto:
 * forex, commodities, equities and indices, all priced in USD. Keyless. NOTE:
 * equities/indices only move during their market hours; outside them Yahoo
 * returns the last close, so those positions sit flat (not a bug). Forex and
 * commodity futures trade ~24/5; crypto (the other sources) is 24/7. */
export const YAHOO_TICKERS: Record<string, string> = {
  // Forex — USD per unit of the foreign currency
  EURUSD: 'EURUSD=X',
  GBPUSD: 'GBPUSD=X',
  AUDUSD: 'AUDUSD=X',
  // Commodities
  WTI: 'CL=F', // crude oil
  XAG: 'SI=F', // silver
  COPPER: 'HG=F',
  NATGAS: 'NG=F',
  // Equities & ETFs (US market hours only)
  AAPL: 'AAPL',
  MSFT: 'MSFT',
  NVDA: 'NVDA',
  TSLA: 'TSLA',
  AMZN: 'AMZN',
  SPY: 'SPY', // S&P 500 ETF
  QQQ: 'QQQ', // Nasdaq-100 ETF
};

/** Pure, testable parse of a Yahoo chart response → the current USD price. */
export function parseYahooChartPrice(body: unknown): number | undefined {
  const p = (body as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: unknown } }> } })
    ?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : undefined;
}

/** Yahoo Finance chart endpoint: one keyless request per symbol. Covers forex,
 * commodities, equities and indices — the non-crypto universe. */
export class YahooPriceSource implements PriceSource {
  readonly name = 'yahoo';
  constructor(private readonly base = 'https://query1.finance.yahoo.com/v8/finance/chart') {}

  async getPrices(symbols: string[]): Promise<PriceSnapshot> {
    const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(
      (s) => YAHOO_TICKERS[s],
    );
    if (wanted.length === 0) throw new Error('yahoo: no known tickers in request');
    const prices: PriceMap = {};
    await Promise.all(
      wanted.map(async (sym) => {
        try {
          const ticker = YAHOO_TICKERS[sym]!;
          const url = `${this.base}/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
          const res = await fetch(url, {
            headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (ApexAutomaton)' },
          });
          if (!res.ok) return;
          const price = parseYahooChartPrice(await res.json());
          if (price !== undefined) prices[sym] = price;
        } catch {
          /* ignore one symbol; the composite handles the rest */
        }
      }),
    );
    if (Object.keys(prices).length === 0) throw new Error('yahoo: no usable prices');
    return { at: new Date().toISOString(), prices };
  }
}

/** Tries each source in order for the symbols still missing, merging results. */
export class CompositePriceSource implements PriceSource {
  readonly name = 'composite';
  constructor(private readonly sources: PriceSource[]) {}

  async getPrices(symbols: string[]): Promise<PriceSnapshot> {
    const merged: PriceMap = {};
    let lastErr: unknown;
    for (const src of this.sources) {
      const missing = symbols.filter((s) => !(s.toUpperCase() in merged));
      if (missing.length === 0) break;
      try {
        const snap = await src.getPrices(missing);
        Object.assign(merged, snap.prices);
      } catch (err) {
        lastErr = err;
      }
    }
    if (Object.keys(merged).length === 0) {
      throw lastErr instanceof Error ? lastErr : new Error('all price sources failed');
    }
    return { at: new Date().toISOString(), prices: merged };
  }
}

/** The symbols the loop needs this cycle: the tradable assets plus SOL (used to
 * value the book in SOL for the survival tiers). */
export function requiredSymbols(cfg: Config): string[] {
  return Array.from(new Set([...cfg.trading.assets, 'SOL']));
}

export function makePriceSource(cfg: Config): PriceSource {
  return new CompositePriceSource([
    new CoinbasePriceSource(), // crypto (per-symbol, keyless)
    new CoinGeckoPriceSource(cfg.trading.priceApiBase), // crypto + tokenised gold
    new YahooPriceSource(), // forex, commodities, equities, indices — beyond crypto
  ]);
}
