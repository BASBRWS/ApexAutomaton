import type { Connection } from '@solana/web3.js';
import { lamportsToSol, solToLamports, type Config } from './config.js';
import { getBalanceLamports } from './solana/wallet.js';
import { usdCostOf, type TokenUsage } from './llm/pricing.js';
import { tierForBalanceSol } from './tiers.js';
import type { Signer } from './solana/signer.js';
import type { SignedTxResult, Tier } from './types.js';

/**
 * economy.ts — the bridge between the real world (USD spent on tokens) and the
 * on-chain life meter (SOL). It reads balance, prices compute, converts USD to
 * a SOL burn, and settles that burn as a real transfer to the compute-provider.
 */

export interface BalanceReading {
  lamports: number;
  sol: number;
  tier: Tier;
}

export async function readBalance(
  connection: Connection,
  cfg: Config,
): Promise<BalanceReading> {
  const lamports = await getBalanceLamports(connection, cfg.agentPubkey);
  const sol = lamportsToSol(lamports);
  return { lamports, sol, tier: tierForBalanceSol(sol, cfg) };
}

/** Real USD cost of a cycle's LLM usage. */
export function computeCostUsd(model: string, usage: TokenUsage): number {
  return usdCostOf(model, usage);
}

/** Convert a USD compute cost into a lamport burn at the fixed SOL_PER_USD. */
export function usdToBurnLamports(cfg: Config, usd: number): number {
  return solToLamports(usd * cfg.economy.solPerUsd);
}

export interface SettleResult {
  attemptedLamports: number;
  settledLamports: number;
  signature: string | null;
  note: string;
}

/**
 * SETTLE COMPUTE (cycle step 7): send the cycle's compute burn from the agent
 * wallet to the compute-provider account — a real devnet transaction. This is
 * the pressure that makes survival cost something.
 *
 * Near death the burn may exceed what remains; we never overdraw. If the burn
 * cannot be paid in full we settle what we safely can (leaving a fee buffer)
 * and note it — the next balance read will likely tip the agent into DEAD.
 */
export async function settleCompute(params: {
  signer: Signer;
  cfg: Config;
  burnLamports: number;
  currentBalanceLamports: number;
  cycle: number;
}): Promise<SettleResult> {
  const { signer, cfg, burnLamports, currentBalanceLamports } = params;

  if (burnLamports <= 0) {
    return { attemptedLamports: 0, settledLamports: 0, signature: null, note: 'no burn' };
  }

  // Keep a small buffer for the transaction fee so we never fail on overdraw.
  const FEE_BUFFER_LAMPORTS = 5000;
  const spendable = Math.max(0, currentBalanceLamports - FEE_BUFFER_LAMPORTS);
  const toSettle = Math.min(burnLamports, spendable);

  if (toSettle <= 0) {
    return {
      attemptedLamports: burnLamports,
      settledLamports: 0,
      signature: null,
      note: 'insufficient balance to settle compute burn',
    };
  }

  const result: SignedTxResult = await signer.signAndSend({
    to: cfg.computeProviderPubkey,
    lamports: toSettle,
    reason: 'compute burn (cost of thinking)',
    memo: `burn:cycle:${params.cycle}`,
  });

  return {
    attemptedLamports: burnLamports,
    settledLamports: result.lamports,
    signature: result.signature,
    note: toSettle < burnLamports ? 'partial settle (near death)' : 'settled',
  };
}
