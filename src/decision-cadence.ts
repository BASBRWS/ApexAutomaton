import type { PriceMap } from './marketdata.js';

/**
 * Decision cadence — when the agent may buy a model decision.
 *
 * Every model call is real money charged to the book, and the heartbeat ticks
 * every ~15 minutes, so deciding every tick costs more than a realistic monthly
 * return. Instead the loop observes every tick (prices, yield, the challenge)
 * and buys a decision only when it is worth it:
 *   - on schedule: at most once per `minHoursBetween` hours;
 *   - early, when an OPEN position moved >= positionMoveTrigger, or BTC/ETH moved
 *     >= marketMoveTrigger since the last decision, or a venture changed / an
 *     on-chain venture action is ready;
 *   - never more than `maxPerDay` decisions in a rolling 24h, triggers included.
 */

export interface DecisionCadenceConfig {
  minHoursBetween: number;
  positionMoveTrigger: number;
  marketMoveTrigger: number;
  maxPerDay: number;
}

export interface CadenceInput {
  now: string;
  cfg: DecisionCadenceConfig;
  prices: PriceMap;
  openAssets: string[];
  lastDecision?: { at: string; prices: PriceMap };
  /** timestamps of model decisions already taken (any order; older ones ignored). */
  recentDecisionTimes: string[];
  ventureChanged: boolean;
  onchainActionReady: boolean;
}

const HOUR_MS = 3_600_000;

function moved(now: number | undefined, then: number | undefined, threshold: number): boolean {
  if (!(typeof now === 'number' && now > 0 && typeof then === 'number' && then > 0)) return false;
  return Math.abs(now / then - 1) >= threshold;
}

/** The reason a decision is due, or null when this tick should only observe. */
export function decisionReason(args: CadenceInput): string | null {
  const nowMs = Date.parse(args.now);
  const dayAgo = nowMs - 24 * HOUR_MS;
  const decidedToday = args.recentDecisionTimes.filter((t) => {
    const ms = Date.parse(t);
    return Number.isFinite(ms) && ms > dayAgo && ms <= nowMs;
  }).length;
  if (decidedToday >= args.cfg.maxPerDay) return null;

  const last = args.lastDecision;
  const lastMs = last ? Date.parse(last.at) : NaN;
  if (!last || !Number.isFinite(lastMs)) return 'first decision';
  if (nowMs - lastMs >= args.cfg.minHoursBetween * HOUR_MS) return 'scheduled';
  if (args.ventureChanged) return 'venture changed';
  if (args.onchainActionReady) return 'on-chain venture action ready';
  for (const asset of args.openAssets) {
    if (moved(args.prices[asset], last.prices[asset], args.cfg.positionMoveTrigger)) return `${asset} position moved`;
  }
  for (const asset of ['BTC', 'ETH']) {
    if (moved(args.prices[asset], last.prices[asset], args.cfg.marketMoveTrigger)) return `${asset} moved`;
  }
  return null;
}

export function shouldObserveOnly(args: CadenceInput): boolean {
  return decisionReason(args) === null;
}
