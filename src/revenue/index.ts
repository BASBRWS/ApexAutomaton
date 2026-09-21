import type { Config } from '../config.js';
import type { Market } from '../market.js';
import type { RevenueAdapter } from './adapter.js';
import { MarketRevenueAdapter } from './marketAdapter.js';
import { OffchainRevenueAdapter } from './offchainAdapter.js';

export type { EarnResult, RevenueAdapter } from './adapter.js';
export { MarketRevenueAdapter } from './marketAdapter.js';
export { OffchainRevenueAdapter } from './offchainAdapter.js';

/**
 * Pick the revenue adapter for this cycle. Defaults to the devnet market. The
 * off-chain scaffold is used only when explicitly enabled (Phase 2), and even
 * then it settles on devnet.
 */
export function makeRevenueAdapter(cfg: Config, market: Market): RevenueAdapter {
  if (cfg.features.offchainRevenueEnabled) {
    return new OffchainRevenueAdapter(cfg, market);
  }
  return new MarketRevenueAdapter(market, cfg);
}
