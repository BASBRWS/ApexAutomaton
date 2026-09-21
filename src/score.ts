import type { Score } from './types.js';

/**
 * score.ts — the maximisation metrics. These are the honest read on whether the
 * agent is actually EARNING or merely surviving, and (in Phase 3) the fitness
 * signals that selection acts on. Journalled every cycle.
 */

export function initialScore(seedLamports: number): Score {
  return {
    peakBalanceLamports: seedLamports,
    cumulativeRevenueLamports: 0,
    cumulativeBurnLamports: 0,
    tasksCompleted: 0,
    marginPerTaskLamports: 0,
    firstDollarAtCycle: null,
    netGrowthLamports: 0,
    seedLamports,
  };
}

export interface ScoreInput {
  cycle: number;
  balanceLamports: number;
  revenueLamports: number;
  burnLamports: number;
  taskCompleted: boolean;
}

/**
 * Recompute the score from the previous score and this cycle's outcome.
 *
 * `marginPerTask` is defined as net (cumulative revenue − cumulative burn)
 * divided by tasks completed. Because burn is paid EVERY cycle — including
 * cycles that earn nothing — this number is honest: idling drags it down, so
 * a rising margin per task means the agent is genuinely growing, not resting.
 */
export function updateScore(prev: Score, input: ScoreInput): Score {
  const cumulativeRevenueLamports = prev.cumulativeRevenueLamports + input.revenueLamports;
  const cumulativeBurnLamports = prev.cumulativeBurnLamports + input.burnLamports;
  const tasksCompleted = prev.tasksCompleted + (input.taskCompleted ? 1 : 0);

  const marginPerTaskLamports =
    tasksCompleted > 0
      ? Math.round((cumulativeRevenueLamports - cumulativeBurnLamports) / tasksCompleted)
      : 0;

  const firstDollarAtCycle =
    prev.firstDollarAtCycle ?? (input.revenueLamports > 0 ? input.cycle : null);

  return {
    peakBalanceLamports: Math.max(prev.peakBalanceLamports, input.balanceLamports),
    cumulativeRevenueLamports,
    cumulativeBurnLamports,
    tasksCompleted,
    marginPerTaskLamports,
    firstDollarAtCycle,
    netGrowthLamports: input.balanceLamports - prev.seedLamports,
    seedLamports: prev.seedLamports,
  };
}
