import type { Config } from './config.js';
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

/**
 * The survival balance in SOL. The REAL devnet wallet is the anchor: when we
 * have a confirmed on-chain balance it governs life/death and the tier ("de
 * wallet is leidend"). When the RPC read is unavailable (`null`, or a bogus
 * negative/NaN reading) we fall back to the paper book's equity-in-SOL, so a
 * transient RPC failure never mis-declares death or collapses the tier.
 *
 * A confirmed zero balance IS treated as real (a genuinely drained wallet is
 * dead); only an absent/invalid reading falls back.
 */
export function survivalSol(walletSol: number | null | undefined, paperEquitySol: number): number {
  return typeof walletSol === 'number' && Number.isFinite(walletSol) && walletSol >= 0
    ? walletSol
    : paperEquitySol;
}

/** The survival tier, anchored on the real wallet SOL when available. */
export function tierForSurvival(
  walletSol: number | null | undefined,
  paperEquitySol: number,
  cfg: Config,
): Tier {
  return tierForBalanceSol(survivalSol(walletSol, paperEquitySol), cfg);
}

export interface HeartbeatResult {
  signature: string | null;
  lamports: number;
  note: string;
}

/**
 * ON-CHAIN HEARTBEAT: a real, confirmed devnet transaction each cycle, memo-
 * tagging the cycle and current book equity. It is a MEMO-ONLY transaction — it
 * moves no value, so it never creates or funds a destination account and can
 * never hit a rent-exemption error; the agent only pays the tiny tx fee. This is
 * the audit-proof that the agent is alive and running on Solana, visible in any
 * block explorer on the agent's address, and decoupled from the (paper) economic
 * game. Best-effort: a failure (kill switch, empty wallet, RPC hiccup) is noted,
 * not fatal, since the economic life meter is the book.
 */
export async function onChainHeartbeat(params: {
  signer: Signer;
  cfg: Config;
  cycle: number;
  equityUsd: number;
}): Promise<HeartbeatResult> {
  const { signer, cycle, equityUsd } = params;
  const result = await signer.proofOfLife(`hb:cycle:${cycle}:equityUsd:${equityUsd.toFixed(2)}`);
  return {
    signature: result.signature,
    lamports: 0,
    note: `heartbeat ok (memo) ${result.signature.slice(0, 8)}…`,
  };
}
