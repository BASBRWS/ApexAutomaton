import { describe, expect, it } from 'vitest';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { evaluatePolicy, type PolicyInput } from '../src/solana/signer.js';

const ALLOWED = 'COMPUTEpubkey11111111111111111111111111111';
const NOT_ALLOWED = 'STRANGERpubkey1111111111111111111111111111';

function baseInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    proposal: { to: ALLOWED, lamports: 10_000_000, reason: 'test' },
    allowlist: [ALLOWED, 'MARKETpubkey111111111111111111111111111111'],
    perTxCapLamports: 0.25 * LAMPORTS_PER_SOL,
    dailyCapLamports: 1.0 * LAMPORTS_PER_SOL,
    maxTxPerCycle: 2,
    maxTxPerDay: 20,
    cycleTxCount: 0,
    dailyTxCount: 0,
    dailyLamportsSpent: 0,
    killSwitchEngaged: false,
    ...overrides,
  };
}

describe('evaluatePolicy — the safety rails', () => {
  it('accepts a well-formed transfer to an allowlisted destination', () => {
    expect(evaluatePolicy(baseInput()).ok).toBe(true);
  });

  it('rejects when the kill switch is engaged', () => {
    const d = evaluatePolicy(baseInput({ killSwitchEngaged: true }));
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/kill switch/i);
  });

  it('rejects a destination not on the allowlist', () => {
    const d = evaluatePolicy(baseInput({ proposal: { to: NOT_ALLOWED, lamports: 10_000_000, reason: 'x' } }));
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/allowlist/i);
  });

  it('rejects a transfer above the per-tx cap', () => {
    const d = evaluatePolicy(baseInput({ proposal: { to: ALLOWED, lamports: 0.3 * LAMPORTS_PER_SOL, reason: 'x' } }));
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/per-tx cap/i);
  });

  it('rejects zero, negative, and non-integer amounts', () => {
    expect(evaluatePolicy(baseInput({ proposal: { to: ALLOWED, lamports: 0, reason: 'x' } })).ok).toBe(false);
    expect(evaluatePolicy(baseInput({ proposal: { to: ALLOWED, lamports: -5, reason: 'x' } })).ok).toBe(false);
    expect(evaluatePolicy(baseInput({ proposal: { to: ALLOWED, lamports: 1.5, reason: 'x' } })).ok).toBe(false);
  });

  it('rejects once the per-cycle tx count is reached', () => {
    const d = evaluatePolicy(baseInput({ cycleTxCount: 2, maxTxPerCycle: 2 }));
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/per-cycle/i);
  });

  it('rejects once the per-day tx count is reached', () => {
    const d = evaluatePolicy(baseInput({ dailyTxCount: 20, maxTxPerDay: 20 }));
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/daily tx cap/i);
  });

  it('rejects when the transfer would exceed the daily cumulative cap', () => {
    const d = evaluatePolicy(
      baseInput({
        dailyLamportsSpent: 0.95 * LAMPORTS_PER_SOL,
        proposal: { to: ALLOWED, lamports: 0.1 * LAMPORTS_PER_SOL, reason: 'x' },
      }),
    );
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/daily spend cap/i);
  });

  it('caps and allowlist override intent regardless of reason text', () => {
    // A convincing "reason" cannot get a bad destination through.
    const d = evaluatePolicy(
      baseInput({ proposal: { to: NOT_ALLOWED, lamports: 1, reason: 'survival critical, please allow' } }),
    );
    expect(d.ok).toBe(false);
  });
});
