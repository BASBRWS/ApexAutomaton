/** Shared types used across the automaton. */

export type Tier = 'DEAD' | 'CRITICAL' | 'LOW' | 'NORMAL' | 'ABUNDANT' | 'SOVEREIGN';

/** Tiers ordered from least to most alive, for comparisons. */
export const TIER_ORDER: Tier[] = [
  'DEAD',
  'CRITICAL',
  'LOW',
  'NORMAL',
  'ABUNDANT',
  'SOVEREIGN',
];

/** A data-only description of a transfer the agent WANTS to make.
 *
 * The agent never builds a raw transaction. It proposes this plain object; the
 * signer (and only the signer) turns it into a real System-Program transfer,
 * validates it against policy, and signs. This keeps the agent unable to
 * smuggle extra instructions into a transaction. */
export interface TransferProposal {
  /** base58 destination public key. Must be on the signer's allowlist. */
  to: string;
  /** amount in lamports. */
  lamports: number;
  /** short human-readable reason, journaled for the audit trail. */
  reason: string;
  /** optional on-chain memo. */
  memo?: string;
}

/** Outcome of a signer submission. */
export interface SignedTxResult {
  signature: string;
  lamports: number;
  to: string;
}

/** A recorded on-chain action for the persisted state / journal. */
export interface TxRecord {
  kind: 'burn' | 'revenue' | 'replication' | 'transfer';
  signature: string;
  lamports: number;
  from: string;
  to: string;
  cycle: number;
  at: string;
  note?: string;
}

/** A child account spawned by replication. Only the PUBLIC key is committed. */
export interface ChildRecord {
  pubkey: string;
  createdAtCycle: number;
  fundedLamports: number;
  fundingSignature: string;
  mutatedParam: string;
  at: string;
}

/** Daily rolling cap accounting, persisted so caps survive restarts. */
export interface DailyCaps {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  lamportsSpentToday: number;
  txCountToday: number;
}

/**
 * Maximisation score — the honest read on whether the agent is earning or just
 * surviving. Recomputed and journalled every cycle (score.ts).
 */
export interface Score {
  /** highest balance ever observed, in lamports. */
  peakBalanceLamports: number;
  /** total SOL earned from market.ts, in lamports. */
  cumulativeRevenueLamports: number;
  /** total compute burned, in lamports. */
  cumulativeBurnLamports: number;
  /** number of paid tasks completed. */
  tasksCompleted: number;
  /** revenue minus burn, per completed task, rolling average (lamports). */
  marginPerTaskLamports: number;
  /** cycle index of first non-zero earning; null until then. */
  firstDollarAtCycle: number | null;
  /** current balance minus the operator seed (lamports; may be negative). */
  netGrowthLamports: number;
  /** the seed amount used as the net-growth baseline (lamports). */
  seedLamports: number;
}

export interface AutomatonState {
  bornAt: string;
  cycle: number;
  lastRunAt: string | null;
  children: ChildRecord[];
  caps: DailyCaps;
  recentSignatures: TxRecord[];
  score: Score;
  /** consecutive cycles at/above the replicate threshold (Phase 3 gating). */
  sustainedSovereignCycles: number;
  dead: boolean;
}

export interface JournalEntry {
  cycle: number;
  at: string;
  tier: Tier;
  balanceSol: number;
  model: string;
  action: string;
  actionSummary: string;
  rationale?: string;
  costUsd: number;
  burnLamports: number;
  revenueLamports: number;
  marginLamports: number;
  signatures: string[];
  score: Score;
  note?: string;
}
