import { describe, expect, it } from 'vitest';
import {
  walletBurnLamports,
  revenueAirdropLamports,
  INCINERATOR_ADDRESS,
  LAMPORTS_PER_SOL,
} from '../src/wallet-economy.js';

describe('walletBurnLamports — real cost of living out of the wallet', () => {
  const base = { metabolicRatePerCycle: 0.0001, floorSol: 0.05, maxBurnPerCycleSol: 0.02 };

  it('burns the metabolic fraction of the real balance', () => {
    // 1.75 SOL * 0.0001 = 0.000175 SOL
    expect(walletBurnLamports({ walletSol: 1.75, ...base })).toBe(Math.floor(0.000175 * LAMPORTS_PER_SOL));
  });

  it('never spends below the floor and never burns a wallet already at/under it', () => {
    expect(walletBurnLamports({ walletSol: 0.05, ...base })).toBe(0);
    expect(walletBurnLamports({ walletSol: 0.04, ...base })).toBe(0);
    // Just above the floor: the burn is clamped to what is spendable above it.
    const justAbove = walletBurnLamports({ walletSol: 0.0500001, ...base });
    expect(justAbove).toBeLessThanOrEqual(Math.floor(0.0000001 * LAMPORTS_PER_SOL) + 1);
  });

  it('caps a single cycle burn at maxBurnPerCycleSol', () => {
    // A huge balance would want to burn a lot; the cap holds it to 0.02 SOL.
    expect(walletBurnLamports({ walletSol: 10_000, ...base })).toBe(Math.floor(0.02 * LAMPORTS_PER_SOL));
  });

  it('returns 0 for a missing/invalid balance or a disabled rate', () => {
    expect(walletBurnLamports({ walletSol: null, ...base })).toBe(0);
    expect(walletBurnLamports({ walletSol: undefined, ...base })).toBe(0);
    expect(walletBurnLamports({ walletSol: NaN, ...base })).toBe(0);
    expect(walletBurnLamports({ walletSol: 1.75, ...base, metabolicRatePerCycle: 0 })).toBe(0);
  });
});

describe('revenueAirdropLamports — real income into the wallet', () => {
  it('converts reported USD revenue to lamports at the SOL price', () => {
    // $117 at SOL=$117 -> exactly 1 SOL
    expect(revenueAirdropLamports({ usd: 117, solPriceUsd: 117 })).toBe(LAMPORTS_PER_SOL);
    // $58.50 at SOL=$117 -> 0.5 SOL
    expect(revenueAirdropLamports({ usd: 58.5, solPriceUsd: 117 })).toBe(Math.floor((58.5 / 117) * LAMPORTS_PER_SOL));
  });

  it('is zero for non-positive revenue or price', () => {
    expect(revenueAirdropLamports({ usd: 0, solPriceUsd: 117 })).toBe(0);
    expect(revenueAirdropLamports({ usd: -5, solPriceUsd: 117 })).toBe(0);
    expect(revenueAirdropLamports({ usd: 5, solPriceUsd: 0 })).toBe(0);
  });
});

describe('incinerator address', () => {
  it('is the canonical Solana burn address', () => {
    expect(INCINERATOR_ADDRESS).toBe('1nc1nerator11111111111111111111111111111111');
  });
});
