/** Shared types used across the automaton. */

import type { Desk } from './trading/desk.js';

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
  kind: 'burn' | 'revenue' | 'replication' | 'transfer' | 'heartbeat';
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
 * Trading score — the honest read on whether the agent is actually growing its
 * book against the real market, or just bleeding compute. All in USD (the book's
 * unit); the SOL value is derived for the survival tiers. Journalled each cycle.
 */
export interface Score {
  /** book value at birth (the modeled starting capital), USD. */
  startEquityUsd: number;
  /** latest book equity, USD. */
  equityUsd: number;
  /** highest book equity ever observed, USD. */
  peakEquityUsd: number;
  /** equity minus start (may be negative), USD. */
  netPnlUsd: number;
  /** number of cycles the agent actually traded (adjusted exposure). */
  tradeCycles: number;
  /** total compute burned since birth, USD. */
  cumulativeBurnUsd: number;
  /** cycle index at which net PnL first went positive; null until then. */
  firstProfitAtCycle: number | null;
}

export interface AutomatonState {
  bornAt: string;
  cycle: number;
  lastRunAt: string | null;
  /** the paper trading book (grown against real prices). */
  desk: Desk;
  /** last observed prices (USD/unit), used as a fallback when a fetch fails. */
  lastPrices: Record<string, number>;
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
  /** book equity in SOL terms (for the survival tiers). */
  equitySol: number;
  /** book equity in USD. */
  equityUsd: number;
  model: string;
  action: string;
  actionSummary: string;
  rationale?: string;
  /** real USD cost of this cycle's LLM call (deducted from the book). */
  costUsd: number;
  /** change in book equity this cycle, USD (market move minus burn). */
  cyclePnlUsd: number;
  signatures: string[];
  score: Score;
  note?: string;
}
