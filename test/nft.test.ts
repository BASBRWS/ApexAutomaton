import { describe, expect, it, vi } from 'vitest';
import { createV2, mplCore } from '@metaplex-foundation/mpl-core';
import { createSignerFromKeypair, generateSigner } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { Keypair } from '@solana/web3.js';
import type { ToolContext } from '../src/tools/registry.js';
import { buildRegistry } from '../src/tools/builtin.js';
import { policyForTier, toolNamesForCycle } from '../src/tiers.js';
import { addProposal, emptyVentureBook } from '../src/ventures/store.js';
import { makeTestConfig } from './helpers.js';
import { validateConfig } from '../src/config.js';

describe('Metaplex Core devnet venture', () => {
  const nftAsset = { name: 'Apex Pass', uri: 'https://example.com/pass.json' };

  it('offers creation only for an approved active venture at NORMAL or above', () => {
    const cfg = makeTestConfig({ nft: { enabled: true, maxCreateSol: 0.03 } });
    expect(toolNamesForCycle(policyForTier('NORMAL', cfg), cfg, false, true)).toContain('nft_create');
    expect(toolNamesForCycle(policyForTier('LOW', cfg), cfg, false, true)).not.toContain('nft_create');
    expect(toolNamesForCycle(policyForTier('NORMAL', cfg), cfg, false, false)).not.toContain('nft_create');
    expect(toolNamesForCycle(policyForTier('NORMAL', makeTestConfig()), makeTestConfig(), false, true)).not.toContain('nft_create');
  });

  it('limits the NFT spend independently of the signer transaction cap', () => {
    expect(() => validateConfig(makeTestConfig({ nft: { enabled: true, maxCreateSol: 0.3 } }))).toThrow(/NFT_MAX_CREATE_SOL/);
  });

  it('never calls the signer for an unapproved proposal', async () => {
    const book = emptyVentureBook();
    addProposal(book, { category: 'nft', title: 'Pass', thesis: 'Utility', deliverable: 'Metadata',
      humanAction: 'Approve', estCostUsd: 0, estRevenueUsd: 0, killCriteria: 'No users', nftAsset }, 1, 'now');
    const createNftAsset = vi.fn();
    const ctx = { ventureBook: book, signer: { createNftAsset } } as unknown as ToolContext;
    const tool = buildRegistry().get('nft_create')!;
    expect((await tool.execute({ ventureId: 'v0001' }, ctx)).summary).toMatch(/needs approval/);
    expect(createNftAsset).not.toHaveBeenCalled();
    book.ventures[0]!.status = 'active';
    createNftAsset.mockResolvedValue({ asset: 'asset-address', signature: 'signature', lamports: 1000 });
    expect((await tool.execute({ ventureId: 'v0001' }, ctx)).signatures).toEqual(['signature']);
    expect(book.ventures[0]!.nftAsset?.asset).toBe('asset-address');
  });

  it('builds a Core create instruction with only wallet and asset signers on Node 20', () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const wallet = Keypair.generate();
    const payer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(wallet.secretKey));
    const asset = generateSigner(umi);
    const instruction = createV2(umi, { ...nftAsset, asset, payer, authority: payer }).items[0]!.instruction;
    expect(String(instruction.programId)).toBe('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
    expect([...new Set(instruction.keys.filter((key) => key.isSigner).map((key) => String(key.pubkey)))].sort()).toEqual(
      [wallet.publicKey.toBase58(), String(asset.publicKey)].sort(),
    );
  });
});
