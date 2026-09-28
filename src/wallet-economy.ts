/**
 * wallet-economy.ts — the REAL devnet wallet as the trading account.
 *
 * "De wallet is leidend": the wallet is trued up to the book's equity every
 * cycle, so it moves WITH the trades (and with the metabolic cost and venture
 * revenue) instead of sitting apart from them — a trading gain airdrops SOL in,
 * a loss burns SOL out. It is the survival anchor (tier + life/death) and the
 * single number, no paper/wallet mismatch. This is a devnet on-chain SIMULATION:
 * the inflow is faucet SOL, not real profit — real profit needs a real market /
 * mainnet, which is out of scope. This is the pure sizing helper; the loop wires
 * it to the signer (burn, down leg) and the devnet faucet (airdrop, up leg).
 */

/** Solana's canonical incinerator address — SOL sent here is provably burned. */
export const INCINERATOR_ADDRESS = '1nc1nerator11111111111111111111111111111111';

export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * The signed lamports move that reconciles the wallet to the book's equity —
 * the wallet IS the trading account, so each cycle it is trued up to the book:
 *   positive  → airdrop that many lamports IN  (the book grew: a trading gain,
 *               or booked venture revenue),
 *   negative  → burn -that many lamports OUT   (the book shrank: a trading loss,
 *               fees/spread/slippage, or the metabolic cost),
 *   zero      → already aligned, or the reading/price is unusable.
 *
 * The move is capped per cycle in each direction (so a one-off bad reading can
 * only ever nudge the wallet), and the burn (down) leg never spends the wallet
 * below the floor, keeping enough SOL for transaction fees.
 */
export function reconcileLamports(params: {
  bookEquityUsd: number;
  solPriceUsd: number;
  walletLamports: number | null | undefined;
  maxMovePerCycleSol: number;
  floorSol: number;
}): number {
  const { bookEquityUsd, solPriceUsd, walletLamports, maxMovePerCycleSol, floorSol } = params;
  if (!(solPriceUsd > 0)) return 0;
  if (typeof walletLamports !== 'number' || !Number.isFinite(walletLamports) || walletLamports < 0) return 0;
  const targetLamports = Math.max(0, Math.round((bookEquityUsd / solPriceUsd) * LAMPORTS_PER_SOL));
  const cap = Math.max(0, Math.round(maxMovePerCycleSol * LAMPORTS_PER_SOL));
  let move = targetLamports - walletLamports;
  if (move > cap) move = cap;
  if (move < -cap) move = -cap;
  if (move < 0) {
    // Never burn the wallet below the floor (keeps fee headroom).
    const floorLamports = Math.max(0, Math.round(Math.max(0, floorSol) * LAMPORTS_PER_SOL));
    const spendable = Math.max(0, walletLamports - floorLamports);
    if (-move > spendable) move = -spendable;
  }
  return move === 0 ? 0 : Math.trunc(move); // normalise -0 to 0
}
