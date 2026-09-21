import type { Score } from './types.js';

/**
 * score.ts — trading metrics. The honest read on whether the agent grows its
 * book against the real market. All USD. Recomputed and journalled each cycle.
 */

export function initialScore(startEquityUsd: number): Score {
  return {
    startEquityUsd,
    equityUsd: startEquityUsd,
    peakEquityUsd: startEquityUsd,
    netPnlUsd: 0,
    tradeCycles: 0,
    cumulativeBurnUsd: 0,
    firstProfitAtCycle: null,
  };
}

export interface ScoreInput {
  cycle: number;
  equityUsd: number;
  burnUsd: number;
  traded: boolean;
}

export function updateScore(prev: Score, input: ScoreInput): Score {
  const netPnlUsd = input.equityUsd - prev.startEquityUsd;
  const firstProfitAtCycle =
    prev.firstProfitAtCycle ?? (netPnlUsd > 0 ? input.cycle : null);
  return {
    startEquityUsd: prev.startEquityUsd,
    equityUsd: input.equityUsd,
    peakEquityUsd: Math.max(prev.peakEquityUsd, input.equityUsd),
    netPnlUsd,
    tradeCycles: prev.tradeCycles + (input.traded ? 1 : 0),
    cumulativeBurnUsd: prev.cumulativeBurnUsd + input.burnUsd,
    firstProfitAtCycle,
  };
}
