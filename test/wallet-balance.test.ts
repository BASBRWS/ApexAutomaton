import { describe, expect, it, vi } from 'vitest';
import { Connection, PublicKey } from '@solana/web3.js';
import { readWalletSnapshot } from '../src/solana/wallet.js';

const address = PublicKey.default;

describe('native devnet wallet snapshot', () => {
  it('reads confirmed lamports and keeps the price observation separate', async () => {
    const getBalance = vi.fn().mockResolvedValue(1_234_567_890);
    const connection = { getBalance } as unknown as Pick<Connection, 'getBalance'>;
    const snapshot = await readWalletSnapshot(connection, address, 118.2);
    expect(getBalance).toHaveBeenCalledWith(address, 'confirmed');
    expect(snapshot.lamports).toBe(1_234_567_890);
    expect(snapshot.solPriceUsd).toBe(118.2);
    expect(Number.isFinite(Date.parse(snapshot.observedAt))).toBe(true);
  });

  it('accepts a zero balance but rejects invalid RPC data', async () => {
    const getBalance = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(-1);
    const connection = { getBalance } as unknown as Pick<Connection, 'getBalance'>;
    expect((await readWalletSnapshot(connection, address, 118.2)).lamports).toBe(0);
    await expect(readWalletSnapshot(connection, address, 118.2)).rejects.toThrow('Invalid native SOL balance');
  });
});
