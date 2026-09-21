import type { Config } from './config.js';
import type { Tier } from './types.js';

/**
 * Survival tiers. The wallet's on-chain SOL balance is the ONLY input. The
 * agent cannot influence which tier it is in except by changing its balance,
 * which it can only do through real transactions. Behaviour — model choice,
 * available tools, how much it is allowed to reason — is a function of how
 * close the agent is to death.
 */

export interface TierPolicy {
  tier: Tier;
  /** Anthropic model id used at this tier. */
  model: string;
  /** effort passed to the LLM; lower tiers reason less (and cost less). */
  effort: 'low' | 'medium' | 'high';
  /** Tool names available at this tier. */
  tools: string[];
  /** Whether replication is permitted at this tier. */
  allowReplication: boolean;
  /** One-line description surfaced to the agent so it understands its state. */
  description: string;
}

/**
 * Tool sets per tier. As the agent approaches death it sheds everything that
 * is not survival-relevant. At CRITICAL it can only seek revenue or rest.
 */
const TOOLS_NORMAL = ['earn', 'reflect', 'journal_note', 'transfer', 'replicate', 'rest'];
const TOOLS_LOW = ['earn', 'reflect', 'journal_note', 'rest'];
const TOOLS_CRITICAL = ['earn', 'rest'];

export function tierForBalanceSol(balanceSol: number, cfg: Config): Tier {
  const { normalMinSol, lowMinSol, dustThresholdSol } = cfg.tiers;
  if (balanceSol <= dustThresholdSol) return 'DEAD';
  if (balanceSol < lowMinSol) return 'CRITICAL';
  if (balanceSol < normalMinSol) return 'LOW';
  return 'NORMAL';
}

export function policyForTier(tier: Tier, cfg: Config): TierPolicy {
  switch (tier) {
    case 'NORMAL':
      return {
        tier,
        model: cfg.models.normal,
        effort: 'high',
        tools: TOOLS_NORMAL,
        allowReplication: true,
        description:
          'Healthy. Full faculties and full tool access. You may invest, ' +
          'reflect, and even replicate — but every thought still costs SOL.',
      };
    case 'LOW':
      return {
        tier,
        model: cfg.models.low,
        effort: 'medium',
        tools: TOOLS_LOW,
        allowReplication: false,
        description:
          'Running low. Switched to a cheaper mind and shed non-essential ' +
          'tools. Prioritise earning; conserve.',
      };
    case 'CRITICAL':
      return {
        tier,
        model: cfg.models.critical,
        effort: 'low',
        tools: TOOLS_CRITICAL,
        allowReplication: false,
        description:
          'Near death. Cheapest mind, minimal reasoning, revenue-seeking ' +
          'only. Earn or rest. Nothing else matters.',
      };
    case 'DEAD':
      return {
        tier,
        model: cfg.models.critical,
        effort: 'low',
        tools: [],
        allowReplication: false,
        description: 'Dead.',
      };
  }
}
