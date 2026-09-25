import { describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { PUMP_PROGRAM_ID, PUMP_SDK } from '@pump-fun/pump-sdk';
import type { ToolContext } from '../src/tools/registry.js';
import { buildRegistry as registry } from '../src/tools/builtin.js';
import { policyForTier, toolNamesForCycle } from '../src/tiers.js';
import { addProposal, emptyVentureBook } from '../src/ventures/store.js';
import { makeTestConfig } from './helpers.js';
import { validateConfig } from '../src/config.js';

describe('Pump.fun devnet venture', () => {
  const token = { name: 'Apex Devnet', symbol: 'APEX', uri: 'https://example.com/apex.json' };

  it('offers execution only for an active approved venture when enabled', () => {
    const cfg = makeTestConfig({ pump: { enabled: true, maxCreateSol: 0.05 } });
    const policy = policyForTier('NORMAL', cfg);
    expect(toolNamesForCycle(policy, cfg, false)).not.toContain('pump_create');
    expect(toolNamesForCycle(policy, cfg, true)).toContain('pump_create');
    expect(toolNamesForCycle(policyForTier('LOW', cfg), cfg, true)).not.toContain('pump_create');
    expect(toolNamesForCycle(policy, makeTestConfig(), true)).not.toContain('pump_create');
  });

  it('refuses a Pump.fun cap higher than the ordinary transfer cap', () => {
    const cfg = makeTestConfig({ pump: { enabled: true, maxCreateSol: 0.3 } });
    expect(() => validateConfig(cfg)).toThrow(/PUMP_MAX_CREATE_SOL/);
    expect(() => validateConfig(makeTestConfig({ pump: { enabled: false, maxCreateSol: 0.3 } })))
      .not.toThrow();
  });

  it('never calls the signer for a proposal without approval', async () => {
    const book = emptyVentureBook();
    addProposal(book, {
      category: 'pumpfun', title: 'Token test', thesis: 'Devnet experiment',
      deliverable: 'Metadata and launch plan', humanAction: 'Approve the devnet launch',
      estCostUsd: 0, estRevenueUsd: 0, killCriteria: 'After test', pumpToken: token,
    }, 1, 'now');
    const createPumpToken = vi.fn();
    const context = { ventureBook: book, signer: { createPumpToken } } as unknown as ToolContext;
    const tool = registry().get('pump_create')!;
    expect((await tool.execute({ ventureId: 'v0001' }, context)).summary).toMatch(/needs approval/);
    expect(createPumpToken).not.toHaveBeenCalled();
    book.ventures[0]!.status = 'active';
    createPumpToken.mockResolvedValue({ mint: 'mint-address', signature: 'signature', lamports: 1000 });
    expect((await tool.execute({ ventureId: 'v0001' }, context)).signatures).toEqual(['signature']);
    expect(book.ventures[0]!.pumpToken?.mint).toBe('mint-address');
  });

  it('builds the current official Pump instruction with only wallet and mint signers', async () => {
    const wallet = Keypair.generate();
    const mint = Keypair.generate();
    const ix = await PUMP_SDK.createV2Instruction({
      mint: mint.publicKey, user: wallet.publicKey, creator: wallet.publicKey,
      ...token, mayhemMode: false, holderReward: false,
    });
    expect(ix.programId.equals(PUMP_PROGRAM_ID)).toBe(true);
    expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()).sort()).toEqual(
      [wallet.publicKey.toBase58(), mint.publicKey.toBase58()].sort(),
    );
  });
});
