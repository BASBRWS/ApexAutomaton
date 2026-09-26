import type { PriceMap } from './marketdata.js';
import type { JournalEntry } from './types.js';

/** After repeated no-op decisions, keep observing each heartbeat but buy a new
 * model decision only once per four cycles. A fresh core-market move, open
 * position or newly actionable venture immediately restores the full cadence. */
export function shouldObserveOnly(args: {
  cycle: number;
  openPositions: number;
  prices: PriceMap;
  previousPrices: PriceMap;
  recent: JournalEntry[];
  ventureChanged: boolean;
  onchainActionReady: boolean;
}): boolean {
  if (args.cycle % 4 === 0 || args.openPositions > 0 || args.ventureChanged || args.onchainActionReady) return false;
  if (args.recent.length < 3 || !args.recent.slice(-3).every((entry) =>
    entry.action === 'rest' ||
    (entry.action === 'propose_venture' && entry.actionSummary.startsWith('venture not queued:')))) return false;
  for (const asset of ['BTC', 'ETH']) {
    const current = args.prices[asset];
    const previous = args.previousPrices[asset];
    if (!current || !previous || Math.abs(current / previous - 1) >= 0.01) return false;
  }
  return true;
}
