/**
 * losstrend.ts — a sustained-loss detector, separate from the survival tiers.
 *
 * The tiers only bite near death (a huge buffer above dust), so a slow bleed
 * never alarms the agent. This surfaces a TREND signal instead: how far below its
 * peak it is, how many cycles in a row it has lost, and its trailing PnL. The
 * prompt escalates the tone with the level — and, crucially, prescribes the
 * DISCIPLINED response (cut risk, rest, lean on ventures), never "trade more".
 */

export type LossLevel = 'ok' | 'watch' | 'warn' | 'alarm';

export interface LossTrend {
  /** fraction below the all-time peak equity (0..1). */
  drawdownPct: number;
  /** consecutive most-recent cycles with negative PnL. */
  lossStreak: number;
  /** summed PnL over the trailing window, USD (may be positive). */
  trailingPnlUsd: number;
  /** number of cycles the trailing window covers. */
  window: number;
  level: LossLevel;
}

// Thresholds. Deliberately modest so a real losing trend registers well before
// the survival tiers ever would. Drawdown OR streak can raise the level.
const WATCH_DD = 0.02; // 2% below peak
const WARN_DD = 0.04; // 4%
const ALARM_DD = 0.07; // 7%
const WATCH_STREAK = 2;
const WARN_STREAK = 3;
const ALARM_STREAK = 6;

export function assessLossTrend(args: {
  equityUsd: number;
  peakEquityUsd: number;
  /** recent cycle PnLs, oldest→newest (the current cycle need not be included). */
  recentPnls: number[];
}): LossTrend {
  const peak = args.peakEquityUsd > 0 ? args.peakEquityUsd : args.equityUsd;
  const drawdownPct = peak > 0 ? Math.max(0, (peak - args.equityUsd) / peak) : 0;

  const pnls = args.recentPnls.filter((n) => Number.isFinite(n));
  let lossStreak = 0;
  for (let i = pnls.length - 1; i >= 0; i--) {
    if ((pnls[i] as number) < 0) lossStreak++;
    else break;
  }
  const trailingPnlUsd = pnls.reduce((a, b) => a + b, 0);

  let level: LossLevel = 'ok';
  if (drawdownPct >= WATCH_DD || lossStreak >= WATCH_STREAK) level = 'watch';
  if (drawdownPct >= WARN_DD || lossStreak >= WARN_STREAK) level = 'warn';
  if (drawdownPct >= ALARM_DD || lossStreak >= ALARM_STREAK) level = 'alarm';

  return { drawdownPct, lossStreak, trailingPnlUsd, window: pnls.length, level };
}
