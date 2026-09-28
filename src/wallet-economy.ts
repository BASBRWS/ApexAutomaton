/**
 * wallet-economy.ts — the REAL devnet wallet as the survival anchor.
 *
 * Under the real-economy anchor ("de wallet is leidend") the wallet is a genuine
 * two-way ledger: the metabolic cost of living is burned OUT of it as real SOL
 * each cycle, and reported (human-approved) venture revenue settles back IN as a
 * devnet airdrop of its SOL-equivalent. Paper trading stays the scoreboard; it
 * can never become real SOL (there is no real devnet market — that is why it is
 * paper). These are the pure sizing helpers; the loop wires them to the signer
 * (burn) and the devnet faucet (settlement).
 */

/** Solana's canonical incinerator address — SOL sent here is provably burned. */
export const INCINERATOR_ADDRESS = '1nc1nerator11111111111111111111111111111111';

export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Lamports to burn this cycle for the real cost of living. The metabolic rate is
 * applied to the REAL wallet balance, but the burn never spends below the floor
 * and never exceeds the per-cycle cap. Returns 0 when the wallet is missing,
 * invalid, or at/below the floor — so an absent balance never triggers a burn.
 */
export function walletBurnLamports(params: {
  walletSol: number | null | undefined;
  metabolicRatePerCycle: number;
  floorSol: number;
  maxBurnPerCycleSol: number;
}): number {
  const { walletSol, metabolicRatePerCycle, floorSol, maxBurnPerCycleSol } = params;
  if (typeof walletSol !== 'number' || !Number.isFinite(walletSol)) return 0;
  if (!(metabolicRatePerCycle > 0)) return 0;
  const floor = Math.max(0, floorSol);
  if (walletSol <= floor) return 0;
  const desired = walletSol * metabolicRatePerCycle; // cost of living, on the real balance
  const spendable = walletSol - floor; // never touch the floor (keeps fee headroom)
  const cap = Math.max(0, maxBurnPerCycleSol);
  const burnSol = Math.min(desired, spendable, cap);
  const lamports = Math.floor(burnSol * LAMPORTS_PER_SOL);
  return lamports > 0 ? lamports : 0;
}

/**
 * Lamports to airdrop into the wallet to settle reported venture revenue. Only
 * positive USD at a positive SOL price produces an inflow; the loop gates this on
 * human-approved revenue, so it is never free money the agent can summon.
 */
export function revenueAirdropLamports(params: { usd: number; solPriceUsd: number }): number {
  const { usd, solPriceUsd } = params;
  if (!(usd > 0) || !(solPriceUsd > 0)) return 0;
  const lamports = Math.floor((usd / solPriceUsd) * LAMPORTS_PER_SOL);
  return lamports > 0 ? lamports : 0;
}
