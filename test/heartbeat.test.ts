import { describe, expect, it } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { buildMemoOnly, buildTransfer } from '../src/solana/wallet.js';

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const agent = PublicKey.default; // structural test — any valid pubkey works

describe('on-chain heartbeat: memo-only proof-of-life', () => {
  it('builds a single memo instruction that moves NO value', () => {
    const tx = buildMemoOnly({ feePayer: agent, memo: 'hb:cycle:1:equityUsd:117.56' });
    expect(tx.instructions).toHaveLength(1);
    const ix = tx.instructions[0]!;
    // It is the SPL Memo program, not a SystemProgram transfer.
    expect(ix.programId.toBase58()).toBe(MEMO_PROGRAM);
    expect(ix.programId.equals(SystemProgram.programId)).toBe(false);
    // No account is touched (a memo has no keys) — so no destination, no rent.
    expect(ix.keys).toHaveLength(0);
    expect(tx.feePayer?.equals(agent)).toBe(true);
  });

  it('carries the memo bytes', () => {
    const tx = buildMemoOnly({ feePayer: agent, memo: 'proof-of-life' });
    expect(tx.instructions[0]!.data.toString('utf8')).toBe('proof-of-life');
  });

  it('by contrast, a transfer DOES include a SystemProgram instruction', () => {
    const tx = buildTransfer({ from: agent, to: agent, lamports: 1000 });
    expect(tx.instructions.some((ix) => ix.programId.equals(SystemProgram.programId))).toBe(true);
  });
});
