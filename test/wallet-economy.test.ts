import { describe, expect, it } from 'vitest';
import { reconcileLamports, INCINERATOR_ADDRESS, LAMPORTS_PER_SOL } from '../src/wallet-economy.js';

describe('reconcileLamports — the wallet mirrors the book', () => {
  const base = { solPriceUsd: 100, maxMovePerCycleSol: 0.5, floorSol: 0.05 };

  it('airdrops IN when the book grew above the wallet (a trading gain)', () => {
    // book $210 @ $100/SOL -> 2.1 SOL target; wallet holds 2.0 SOL -> +0.1 SOL
    const move = reconcileLamports({ ...base, bookEquityUsd: 210, walletLamports: 2 * LAMPORTS_PER_SOL });
    expect(move).toBe(Math.round(0.1 * LAMPORTS_PER_SOL));
  });

  it('burns OUT when the book shrank below the wallet (a loss / cost)', () => {
    // book $190 -> 1.9 SOL target; wallet 2.0 SOL -> -0.1 SOL
    const move = reconcileLamports({ ...base, bookEquityUsd: 190, walletLamports: 2 * LAMPORTS_PER_SOL });
    expect(move).toBe(-Math.round(0.1 * LAMPORTS_PER_SOL));
  });

  it('is zero when already aligned', () => {
    expect(reconcileLamports({ ...base, bookEquityUsd: 200, walletLamports: 2 * LAMPORTS_PER_SOL })).toBe(0);
  });

  it('caps the move per cycle in each direction', () => {
    const cap = Math.round(0.5 * LAMPORTS_PER_SOL);
    // book far above wallet -> capped airdrop
    expect(reconcileLamports({ ...base, bookEquityUsd: 1000, walletLamports: 2 * LAMPORTS_PER_SOL })).toBe(cap);
    // book far below wallet -> capped burn
    expect(reconcileLamports({ ...base, bookEquityUsd: 10, walletLamports: 5 * LAMPORTS_PER_SOL })).toBe(-cap);
  });

  it('never burns the wallet below the floor', () => {
    // wallet 0.1 SOL, book wants 0 -> can only burn down to the 0.05 floor
    const move = reconcileLamports({ ...base, bookEquityUsd: 0, walletLamports: Math.round(0.1 * LAMPORTS_PER_SOL) });
    expect(move).toBe(-Math.round(0.05 * LAMPORTS_PER_SOL));
    // wallet already at the floor -> no burn
    expect(reconcileLamports({ ...base, bookEquityUsd: 0, walletLamports: Math.round(0.05 * LAMPORTS_PER_SOL) })).toBe(0);
  });

  it('returns 0 for a missing/invalid wallet reading or an unusable SOL price', () => {
    expect(reconcileLamports({ ...base, bookEquityUsd: 210, walletLamports: null })).toBe(0);
    expect(reconcileLamports({ ...base, bookEquityUsd: 210, walletLamports: undefined })).toBe(0);
    expect(reconcileLamports({ ...base, bookEquityUsd: 210, walletLamports: -1 })).toBe(0);
    expect(reconcileLamports({ ...base, solPriceUsd: 0, bookEquityUsd: 210, walletLamports: 2 * LAMPORTS_PER_SOL })).toBe(0);
  });
});

describe('incinerator address', () => {
  it('is the canonical Solana burn address', () => {
    expect(INCINERATOR_ADDRESS).toBe('1nc1nerator11111111111111111111111111111111');
  });
});
