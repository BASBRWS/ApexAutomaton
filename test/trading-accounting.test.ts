import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { assertDevnetConnection, DEVNET_GENESIS_HASH, sendTransfer } from '../src/solana/wallet.js';
import { Signer } from '../src/solana/signer.js';
import { freshState } from '../src/state.js';
import { makeTestConfig } from './helpers.js';
import { validateConfig } from '../src/config.js';
import { accrueShortBorrow, applyOrders, applyPortfolio, equityUsd, initDesk } from '../src/trading/desk.js';
import { initialScore, updateScore } from '../src/score.js';

describe('audit hardening', () => {
  it('checks the chain identity rather than trusting the RPC URL', async () => {
    await expect(assertDevnetConnection({ getGenesisHash: async () => DEVNET_GENESIS_HASH })).resolves.toBeUndefined();
    await expect(assertDevnetConnection({ getGenesisHash: async () => 'mainnet' })).rejects.toThrow(/not Solana devnet/);
  });

  it('blocks a new value transfer while an earlier signature needs reconciliation', () => {
    const key = Keypair.generate();
    const cfg = makeTestConfig();
    cfg.agentPubkey = key.publicKey.toBase58();
    const state = freshState(cfg);
    state.pendingTransfer = { signature: 'previous-signature', to: cfg.computeProviderPubkey, lamports: 1000, at: 'now' };
    process.env.AGENT_KEYPAIR = JSON.stringify(Array.from(key.secretKey));
    try {
      const signer = new Signer({} as any, cfg, state);
      expect(signer.check({ to: cfg.computeProviderPubkey, lamports: 1000, reason: 'again' }).reason)
        .toMatch(/unreconciled transfer/);
    } finally {
      delete process.env.AGENT_KEYPAIR;
    }
  });

  it('refuses a transaction that was confirmed with an execution error', async () => {
    const sender = Keypair.generate();
    const connection = {
      getLatestBlockhash: async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1 }),
      sendRawTransaction: async () => 'a-signature',
      confirmTransaction: async () => ({ value: { err: { InstructionError: [0, 'Custom'] } } }),
    } as any;
    const tx = new Transaction();
    tx.feePayer = sender.publicKey;
    tx.add({ programId: PublicKey.default, keys: [], data: Buffer.alloc(0) });
    const signed: string[] = [];
    await expect(sendTransfer(connection, tx, [sender], (signature) => signed.push(signature))).rejects.toThrow(/failed/);
    expect(signed).toHaveLength(1);
    expect(signed[0]).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('deducts realistic fill friction and elapsed short borrow from the paper book', () => {
    const desk = initDesk(500, 0);
    const result = applyOrders(desk, [{ asset: 'BTC', targetUsd: -100 }], {
      prices: { BTC: 100 }, tradableAssets: ['BTC'], maxGrossExposureUsd: 500,
      allowShort: true, feeBps: 10, spreadBps: 5, slippageBps: 5,
    });
    expect(result[0]!.ok).toBe(true);
    expect(equityUsd(desk, { BTC: 100 })).toBeLessThan(500);
    expect(accrueShortBorrow(desk, { BTC: 100 }, 0.08, 1)).toBeCloseTo(8);
    expect(equityUsd(desk, { BTC: 100 })).toBeLessThan(492);
  });

  it('rejects an oversized rebalance without changing any position', () => {
    const desk = initDesk(500, 0);
    const before = structuredClone(desk);
    const result = applyPortfolio(desk, [
      { asset: 'BTC', targetUsd: 400 }, { asset: 'ETH', targetUsd: 200 },
    ], { prices: { BTC: 100, ETH: 100 }, tradableAssets: ['BTC', 'ETH'], maxGrossExposureUsd: 500, allowShort: true });
    expect(result.every((r) => !r.ok)).toBe(true);
    expect(desk).toEqual(before);
  });

  it('allows a rebalance with absent quotes for untouched zero positions', () => {
    const desk = initDesk(500, 0);
    const result = applyPortfolio(desk, [
      { asset: 'BTC', targetUsd: 100 }, { asset: 'ETH', targetUsd: 0 },
    ], { prices: { BTC: 100 }, tradableAssets: ['BTC', 'ETH'], maxGrossExposureUsd: 500, allowShort: true });
    expect(result.every((r) => r.ok)).toBe(true);
  });

  it('separates paper results, reported revenue and the holding benchmark', () => {
    const score = updateScore(initialScore(200), {
      cycle: 1, equityUsd: 235, paperEquityUsd: 195, reportedVentureRevenueUsd: 40,
      solHoldBenchmarkUsd: 220, burnUsd: 1, traded: true,
    });
    expect(score.paperEquityUsd).toBe(195);
    expect(score.reportedVentureRevenueUsd).toBe(40);
    expect(score.paperAlphaVsSolUsd).toBe(-25);
  });

  it('rejects replication until offspring can independently run', () => {
    const cfg = makeTestConfig();
    cfg.features.replicationEnabled = true;
    expect(() => validateConfig(cfg)).toThrow(/independent runtime/);
  });
});
