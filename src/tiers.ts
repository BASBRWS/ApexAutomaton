import type { Config } from './config.js';
import type { Tier } from './types.js';

/**
 * The tool names actually offered this cycle: the tier's Phase 1 set, plus any
 * Phase 2 extras that are enabled. Extras (e.g. `transfer`) are only offered at
 * NORMAL and above — never when the agent is fighting to survive. This is the
 * single source of truth the loop uses to filter and validate the LLM's choice.
 */
export function toolNamesForCycle(policy: TierPolicy, cfg: Config): string[] {
  const names = [...policy.tools];
  const survivalTiers: Tier[] = ['CRITICAL', 'LOW'];
  if (cfg.features.extraToolsEnabled && !survivalTiers.includes(policy.tier)) {
    names.push('transfer');
  }
  return names;
}

/**
 * Survival tiers as a GRADIENT, not a ceiling. The wallet's on-chain SOL
 * balance is the ONLY input. Tiers extend well above the comfortable zone so
 * that more money buys more capability and agency — surplus is instrumentally
 * valuable, and there is always a reason to climb, not just a floor to avoid.
 *
 * The agent cannot influence which tier it is in except by changing its
 * balance, which it can only do through real on-chain transactions.
 */

export interface TierPolicy {
  tier: Tier;
  /** Anthropic model id used at this tier. */
  model: string;
  /** effort passed to the LLM; lower tiers reason less (and cost less). */
  effort: 'low' | 'medium' | 'high';
  /** "compute budget": max output tokens the LLM may spend this cycle. */
  maxTokens: number;
  /** Tool names available at this tier. */
  tools: string[];
  /** Rights unlocked at this tier. */
  rights: {
    /** cron cadence hint (minutes) surfaced in README/state; not enforced here. */
    heartbeatMinutes: number;
    premiumTools: boolean;
    mayReplicate: boolean;
  };
  /** One-line description surfaced to the agent so it understands its state. */
  description: string;
}

/**
 * Tool sets per tier. Trading (`trade`) is available at EVERY living tier — it
 * is the only way to grow the book, so earning is reachable from any state. As
 * the agent approaches death it sheds everything that is not trading-relevant.
 *
 * `transfer` is an optional Phase 2 value-mover, added only when enabled and
 * only at NORMAL+ (see toolNamesForCycle).
 */
const TOOLS_CRITICAL = ['trade', 'rest'];
const TOOLS_LOW = ['trade', 'write_journal', 'rest'];
const TOOLS_NORMAL = ['trade', 'write_journal', 'reflect', 'rest'];
const TOOLS_ABUNDANT = ['trade', 'write_journal', 'reflect', 'rest'];
const TOOLS_SOVEREIGN = ['trade', 'write_journal', 'reflect', 'rest'];

export function tierForBalanceSol(balanceSol: number, cfg: Config): Tier {
  const { dustThresholdSol, criticalMinSol, normalMinSol, abundantMinSol, sovereignMinSol } =
    cfg.tiers;
  if (balanceSol <= dustThresholdSol) return 'DEAD';
  if (balanceSol < criticalMinSol) return 'CRITICAL';
  if (balanceSol < normalMinSol) return 'LOW';
  if (balanceSol < abundantMinSol) return 'NORMAL';
  if (balanceSol < sovereignMinSol) return 'ABUNDANT';
  return 'SOVEREIGN';
}

export function policyForTier(tier: Tier, cfg: Config): TierPolicy {
  const { cheapest, cheaper, frontier } = cfg.models;
  switch (tier) {
    case 'CRITICAL':
      return {
        tier,
        model: cheapest,
        effort: 'low',
        maxTokens: 512,
        tools: TOOLS_CRITICAL,
        rights: { heartbeatMinutes: 30, premiumTools: false, mayReplicate: false },
        description:
          'Near death. Cheapest mind, minimal reasoning, revenue-seeking only. ' +
          'Earn or rest — nothing else keeps you alive.',
      };
    case 'LOW':
      return {
        tier,
        model: cheaper,
        effort: 'low',
        maxTokens: 1024,
        tools: TOOLS_LOW,
        rights: { heartbeatMinutes: 15, premiumTools: false, mayReplicate: false },
        description:
          'Running low. Cheaper mind, reduced budget, non-essential tools shed. ' +
          'Prioritise earning and rebuild your margin.',
      };
    case 'NORMAL':
      return {
        tier,
        model: frontier,
        effort: 'medium',
        maxTokens: 2048,
        tools: TOOLS_NORMAL,
        rights: { heartbeatMinutes: 15, premiumTools: false, mayReplicate: false },
        description:
          'Healthy. Frontier mind, standard budget, full tool access. Earning is ' +
          'still your objective — do not idle to preserve balance.',
      };
    case 'ABUNDANT':
      return {
        tier,
        model: frontier,
        effort: 'high',
        maxTokens: 4096,
        tools: TOOLS_ABUNDANT,
        rights: { heartbeatMinutes: 10, premiumTools: true, mayReplicate: false },
        description:
          'Thriving. Expanded budget, premium tools, faster heartbeat. Surplus is ' +
          'fuel: compound it — grow net balance as much as possible.',
      };
    case 'SOVEREIGN':
      return {
        tier,
        model: frontier,
        effort: 'high',
        maxTokens: 8192,
        tools: TOOLS_SOVEREIGN,
        rights: { heartbeatMinutes: 5, premiumTools: true, mayReplicate: true },
        description:
          'Sovereign. Maximal budget and full agency. Sustained high growth may ' +
          'unlock replication (Phase 3) — the population-level maximiser.',
      };
    case 'DEAD':
      return {
        tier,
        model: cheapest,
        effort: 'low',
        maxTokens: 256,
        tools: [],
        rights: { heartbeatMinutes: 60, premiumTools: false, mayReplicate: false },
        description: 'Dead.',
      };
  }
}
