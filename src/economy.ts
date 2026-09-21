import { lamportsToSol, type Config } from './config.js';
import { usdCostOf, type TokenUsage } from './llm/pricing.js';
import { tierForBalanceSol } from './tiers.js';
import type { Signer } from './solana/signer.js';
import type { Tier } from './types.js';

/**
 * economy.ts — the bridge between the real world (USD spent on tokens, USD value
 * of the trading book) and the survival tiers (denominated in SOL), plus the
 * real on-chain heartbeat that keeps the Solana loop genuinely exercised.
 */

/** Real USD cost of a cycle's LLM usage — deducted from the book each cycle. */
export function computeCostUsd(model: string, usage: TokenUsage): number {
  return usdCostOf(model, usage);
}

/** Book equity (USD) expressed in SOL, for the survival tiers. */
export function equityToSol(equityUsd: number, solPriceUsd: number): number {
  if (!(solPriceUsd > 0)) return 0;
  return equityUsd / solPriceUsd;
}

export function tierForEquity(
  equityUsd: number,
  solPriceUsd: number,
  cfg: Config,
): Tier {
  return tierForBalanceSol(equityToSol(equityUsd, solPriceUsd), cfg);
}

/** A fixed, tiny heartbeat transfer so every cycle really touches Solana. */
const HEARTBEAT_LAMPORTS = 1000;

export interface HeartbeatResult {
  signature: string | null;
  lamports: number;
  note: string;
}

/**
 * ON-CHAIN HEARTBEAT: a tiny real devnet transfer to the compute-provider,
 * memo-tagging the cycle and current book equity. This is the audit-proof that
 * the agent is alive and running on Solana — decoupled from the (paper) economic
 * game, funded by the operator seed. Best-effort: a failure (kill switch, empty
 * wallet) is noted, not fatal, since the economic life meter is the book.
 */
export async function onChainHeartbeat(params: {
  signer: Signer;
  cfg: Config;
  cycle: number;
  equityUsd: number;
}): Promise<HeartbeatResult> {
  const { signer, cfg, cycle, equityUsd } = params;
  const result = await signer.signAndSend({
    to: cfg.computeProviderPubkey,
    lamports: HEARTBEAT_LAMPORTS,
    reason: 'on-chain heartbeat',
    memo: `hb:cycle:${cycle}:equityUsd:${equityUsd.toFixed(2)}`,
  });
  return {
    signature: result.signature,
    lamports: result.lamports,
    note: `heartbeat ${lamportsToSol(result.lamports)} SOL`,
  };
}
