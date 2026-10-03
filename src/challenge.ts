/**
 * challenge.ts — the monthly return challenge with lives.
 *
 * Every period (default 30 days) the book's return — measured on the scoreboard
 * equity, so compute costs and any venture revenue count — moves the agent's
 * lives along a graded scale (the default bands below): a strong month earns a
 * half life back, a solid month keeps them, a weak month costs a fraction, a bad
 * month a whole life. At zero lives the agent is dead.
 *
 * Periods run on wall-clock time, so an irregular heartbeat neither helps nor
 * hurts. After an outage spanning several period ends, only ONE period is closed
 * per evaluation and the next starts "now": downtime is never charged as a
 * string of failed months.
 */

export interface LifeBand {
  /** lower bound of the band's monthly return (fraction, e.g. 0.02 = 2%). */
  min: number;
  /** true: return must be strictly above `min`; false: at or above. */
  exclusive?: boolean;
  /** lives gained (+) or lost (-) when the month lands in this band. */
  delta: number;
  label: string;
}

/** Highest band first; the last band must catch everything (min -Infinity). */
export const DEFAULT_LIFE_BANDS: LifeBand[] = [
  { min: 0.025, exclusive: true, delta: 0.5, label: 'strong month (>2.5%)' },
  { min: 0.02, delta: 0, label: 'solid month (2–2.5%)' },
  { min: 0.015, delta: -0.25, label: 'weak month (1.5–2%)' },
  { min: 0.01, delta: -0.5, label: 'poor month (1–1.5%)' },
  { min: Number.NEGATIVE_INFINITY, delta: -1, label: 'bad month (<1%)' },
];

export interface ChallengeConfig {
  enabled: boolean;
  /** lives at the start of the challenge. */
  lives: number;
  periodDays: number;
  bands: LifeBand[];
}

export interface ChallengePeriodResult {
  period: number;
  startedAt: string;
  endedAt: string;
  startEquityUsd: number;
  endEquityUsd: number;
  returnPct: number;
  label: string;
  livesDelta: number;
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
  startLives: number;
  period: number;
  daysElapsed: number;
  daysLeft: number;
  returnSoFar: number;
  /** the band the month would land in if it ended now. */
  projected: { label: string; delta: number };
  /** monthly return that keeps all lives, and the one that earns a bonus. */
  safeReturn: number;
  bonusReturn: number;
  /** USD equity needed at period end to keep all lives / to earn the bonus. */
  safeEquityUsd: number;
  bonusEquityUsd: number;
  bands: LifeBand[];
}

const DAY_MS = 86_400_000;
// Tolerance so 204/200-1 = 0.020000000000000018 and 0.0199999999 both read as 2%.
const EPS = 1e-9;

export function initChallenge(cfg: ChallengeConfig, equityUsd: number, now: string): ChallengeState {
  return { lives: cfg.lives, period: 1, periodStartAt: now, periodStartEquityUsd: equityUsd, history: [] };
}

export function periodReturn(ch: ChallengeState, equityUsd: number): number {
  return ch.periodStartEquityUsd > 0 ? equityUsd / ch.periodStartEquityUsd - 1 : 0;
}

export function bandFor(returnPct: number, bands: LifeBand[]): LifeBand {
  for (const b of bands) {
    if (b.exclusive ? returnPct > b.min + EPS : returnPct >= b.min - EPS) return b;
  }
  return bands[bands.length - 1]!;
}

/** Lives are kept to two decimals so repeated quarter-steps never drift. */
function roundLives(x: number): number {
  return Math.round(x * 100) / 100;
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
  const band = bandFor(returnPct, cfg.bands);
  const livesAfter = Math.max(0, roundLives(ch.lives + band.delta));
  const closed: ChallengePeriodResult = {
    period: ch.period,
    startedAt: ch.periodStartAt,
    endedAt: now,
    startEquityUsd: ch.periodStartEquityUsd,
    endEquityUsd: equityUsd,
    returnPct,
    label: band.label,
    livesDelta: band.delta,
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
  const ret = periodReturn(ch, equityUsd);
  const projected = bandFor(ret, cfg.bands);
  const safe = cfg.bands.find((b) => b.delta === 0)?.min ?? 0;
  const bonus = cfg.bands.find((b) => b.delta > 0)?.min ?? safe;
  return {
    lives: ch.lives,
    startLives: cfg.lives,
    period: ch.period,
    daysElapsed: elapsed,
    daysLeft: Math.max(0, cfg.periodDays - elapsed),
    returnSoFar: ret,
    projected: { label: projected.label, delta: projected.delta },
    safeReturn: safe,
    bonusReturn: bonus,
    safeEquityUsd: ch.periodStartEquityUsd * (1 + safe),
    bonusEquityUsd: ch.periodStartEquityUsd * (1 + bonus),
    bands: cfg.bands,
  };
}

/** "−0.25", "+0.5", "±0" — for prompts, lessons and the dashboard. */
export function fmtLivesDelta(d: number): string {
  if (d === 0) return '±0';
  return `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
}
