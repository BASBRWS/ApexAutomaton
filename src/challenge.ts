/**
 * challenge.ts — the monthly return challenge with lives.
 *
 * The agent must grow its book by at least `minReturn` (default 2%) per period
 * (default 30 days), measured on the scoreboard equity — so compute costs and
 * any venture revenue count. `targetReturn` (default 2.8%) is the stretch goal.
 * Missing the minimum costs one life; at zero lives the agent is dead.
 *
 * A period is measured by wall-clock time, so an irregular heartbeat neither
 * helps nor hurts. If the heartbeat was down across several period boundaries,
 * only ONE period is closed per evaluation and the next starts "now": operator
 * downtime is never charged as a string of failed months.
 */

export interface ChallengeConfig {
  enabled: boolean;
  /** lives at the start of the challenge. */
  lives: number;
  periodDays: number;
  /** minimum period return (fraction) to keep all lives, e.g. 0.02 = 2%. */
  minReturn: number;
  /** stretch target (fraction), e.g. 0.028 = 2.8%. */
  targetReturn: number;
}

export interface ChallengePeriodResult {
  period: number;
  startedAt: string;
  endedAt: string;
  startEquityUsd: number;
  endEquityUsd: number;
  returnPct: number;
  /** 'target' (>= stretch), 'pass' (>= minimum) or 'fail' (below minimum: -1 life). */
  outcome: 'target' | 'pass' | 'fail';
  livesAfter: number;
}

export interface ChallengeState {
  lives: number;
  /** 1-based index of the running period. */
  period: number;
  periodStartAt: string;
  periodStartEquityUsd: number;
  /** highest equity seen in the running period (the loss-trend reference). */
  periodPeakEquityUsd?: number;
  /** model (compute) spend charged to the book during the running period. */
  periodComputeUsd?: number;
  history: ChallengePeriodResult[];
}

export interface ChallengeStatus {
  lives: number;
  maxLives: number;
  period: number;
  daysElapsed: number;
  daysLeft: number;
  returnSoFar: number;
  minReturn: number;
  targetReturn: number;
  /** USD equity needed at period end for the minimum / the stretch target. */
  minEquityUsd: number;
  targetEquityUsd: number;
}

const DAY_MS = 86_400_000;

export function initChallenge(cfg: ChallengeConfig, equityUsd: number, now: string): ChallengeState {
  return { lives: cfg.lives, period: 1, periodStartAt: now, periodStartEquityUsd: equityUsd, history: [] };
}

export function periodReturn(ch: ChallengeState, equityUsd: number): number {
  return ch.periodStartEquityUsd > 0 ? equityUsd / ch.periodStartEquityUsd - 1 : 0;
}

export function outcomeFor(returnPct: number, cfg: ChallengeConfig): ChallengePeriodResult['outcome'] {
  if (returnPct >= cfg.targetReturn) return 'target';
  if (returnPct >= cfg.minReturn) return 'pass';
  return 'fail';
}

/**
 * Close the running period if its time is up. Pure: returns the next state and
 * the closed period (or null when the period is still running). The caller
 * treats `next.lives <= 0` as death.
 */
export function evaluateChallenge(
  ch: ChallengeState,
  cfg: ChallengeConfig,
  equityUsd: number,
  now: string,
): { next: ChallengeState; closed: ChallengePeriodResult | null } {
  const startMs = Date.parse(ch.periodStartAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs) || nowMs - startMs < cfg.periodDays * DAY_MS) {
    return { next: ch, closed: null };
  }
  const returnPct = periodReturn(ch, equityUsd);
  const outcome = outcomeFor(returnPct, cfg);
  const livesAfter = outcome === 'fail' ? Math.max(0, ch.lives - 1) : ch.lives;
  const closed: ChallengePeriodResult = {
    period: ch.period,
    startedAt: ch.periodStartAt,
    endedAt: now,
    startEquityUsd: ch.periodStartEquityUsd,
    endEquityUsd: equityUsd,
    returnPct,
    outcome,
    livesAfter,
  };
  return {
    next: {
      lives: livesAfter,
      period: ch.period + 1,
      periodStartAt: now,
      periodStartEquityUsd: equityUsd,
      history: [...ch.history, closed],
    },
    closed,
  };
}

export function challengeStatus(ch: ChallengeState, cfg: ChallengeConfig, equityUsd: number, now: string): ChallengeStatus {
  const elapsed = Math.max(0, (Date.parse(now) - Date.parse(ch.periodStartAt)) / DAY_MS);
  return {
    lives: ch.lives,
    maxLives: cfg.lives,
    period: ch.period,
    daysElapsed: elapsed,
    daysLeft: Math.max(0, cfg.periodDays - elapsed),
    returnSoFar: periodReturn(ch, equityUsd),
    minReturn: cfg.minReturn,
    targetReturn: cfg.targetReturn,
    minEquityUsd: ch.periodStartEquityUsd * (1 + cfg.minReturn),
    targetEquityUsd: ch.periodStartEquityUsd * (1 + cfg.targetReturn),
  };
}
