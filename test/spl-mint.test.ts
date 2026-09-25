import { describe, expect, it, vi } from 'vitest';
import { Keypair, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { buildSplMintTx, splMintSpace } from '../src/solana/spl-mint.js';
import { buildRegistry } from '../src/tools/builtin.js';
import type { ToolContext } from '../src/tools/registry.js';
import { addProposal, emptyVentureBook } from '../src/ventures/store.js';
import { policyForTier, toolNamesForCycle } from '../src/tiers.js';
import { validateConfig } from '../src/config.js';
import { makeTestConfig } from './helpers.js';

describe('Token-2022 venture', () => {
  const metadata = { name: 'Apex Credit', symbol: 'CREDIT', uri: 'https://example.com/credit.json', decimals: 6 };

  it('gates the mint at NORMAL+ and limits protocol spend', () => {
    const cfg = makeTestConfig({ spl: { enabled: true, maxCreateSol: 0.03 } });
    expect(toolNamesForCycle(policyForTier('NORMAL', cfg), cfg, false, false, true)).toContain('spl_create');
    expect(toolNamesForCycle(policyForTier('LOW', cfg), cfg, false, false, true)).not.toContain('spl_create');
    expect(toolNamesForCycle(policyForTier('NORMAL', cfg), cfg)).not.toContain('spl_create');
    expect(() => validateConfig(makeTestConfig({ spl: { enabled: true, maxCreateSol: 0.3 } }))).toThrow(/SPL_MAX_CREATE_SOL/);
  });

  it('does not call the signer before approval', async () => {
    const book = emptyVentureBook();
    addProposal(book, { category: 'spl', title: 'Credit', thesis: 'Test', deliverable: 'Metadata',
      humanAction: 'Approve', estCostUsd: 0, estRevenueUsd: 0, killCriteria: 'No users', splToken: metadata }, 1, 'now');
    const createSplToken = vi.fn();
    const ctx = { ventureBook: book, signer: { createSplToken } } as unknown as ToolContext;
    const tool = buildRegistry().get('spl_create')!;
    expect((await tool.execute({ ventureId: 'v0001' }, ctx)).summary).toMatch(/needs approval/);
    expect(createSplToken).not.toHaveBeenCalled();
    book.ventures[0]!.status = 'active';
    createSplToken.mockResolvedValue({ mint: 'mint-address', signature: 'signature', lamports: 1000 });
    expect((await tool.execute({ ventureId: 'v0001' }, ctx)).signatures).toEqual(['signature']);
    expect(book.ventures[0]!.splToken?.mint).toBe('mint-address');
  });

  it('builds only fixed System and Token-2022 instructions with wallet and mint signers', () => {
    const wallet = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const { allocatedSpace, rentSpace } = splMintSpace(metadata, mint, wallet);
    expect(rentSpace).toBeGreaterThan(allocatedSpace);
    const instructions = buildSplMintTx(metadata, mint, wallet, 10_000_000).instructions;
    expect(instructions).toHaveLength(4);
    expect(instructions.map((ix) => ix.programId.toBase58())).toEqual([
      SystemProgram.programId.toBase58(), ...Array(3).fill(TOKEN_2022_PROGRAM_ID.toBase58()),
    ]);
    expect([...new Set(instructions.flatMap((ix) => ix.keys.filter((key) => key.isSigner).map((key) => key.pubkey.toBase58())))].sort())
      .toEqual([wallet.toBase58(), mint.toBase58()].sort());
  });
});
