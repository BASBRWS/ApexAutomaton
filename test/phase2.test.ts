import { describe, expect, it } from 'vitest';
import { makeStateStore, FileStateStore, FirestoreStateStore } from '../src/persistence/index.js';
import { makeRevenueAdapter, MarketRevenueAdapter, OffchainRevenueAdapter } from '../src/revenue/index.js';
import { toolNamesForCycle, policyForTier } from '../src/tiers.js';
import { taskCatalog } from '../src/market.js';
import { makeTestConfig } from './helpers.js';
import type { Market } from '../src/market.js';

const cfg = makeTestConfig();
const fakeMarket = {} as unknown as Market;

describe('Phase 2 — state store selection', () => {
  it('defaults to the file store', () => {
    expect(makeStateStore(cfg)).toBeInstanceOf(FileStateStore);
  });

  it('selects the Firestore scaffold when a project id is configured', () => {
    const withFs = makeTestConfig({
      firestore: { enabled: true, projectId: 'demo', collection: 'automaton', documentId: 'state' },
    });
    expect(makeStateStore(withFs)).toBeInstanceOf(FirestoreStateStore);
  });

  it('Firestore scaffold refuses to load/save (not implemented)', async () => {
    const withFs = makeTestConfig({
      firestore: { enabled: true, projectId: 'demo', collection: 'automaton', documentId: 'state' },
    });
    const store = makeStateStore(withFs);
    await expect(store.load(withFs)).rejects.toThrow(/scaffold|not implemented/i);
  });
});

describe('Phase 2 — revenue adapter selection', () => {
  it('defaults to the market adapter', () => {
    expect(makeRevenueAdapter(cfg, fakeMarket)).toBeInstanceOf(MarketRevenueAdapter);
  });

  it('selects the off-chain adapter when enabled', () => {
    const withOffchain = makeTestConfig({
      features: { ...cfg.features, offchainRevenueEnabled: true },
    });
    expect(makeRevenueAdapter(withOffchain, fakeMarket)).toBeInstanceOf(OffchainRevenueAdapter);
  });

  it('off-chain adapter refuses to earn when the feature is disabled', async () => {
    const adapter = new OffchainRevenueAdapter(cfg, fakeMarket);
    await expect(adapter.earn(undefined)).rejects.toThrow(/disabled/i);
  });
});

describe('Phase 2 — tool availability', () => {
  it('does not offer transfer when extra tools are disabled', () => {
    const names = toolNamesForCycle(policyForTier('NORMAL', cfg), cfg);
    expect(names).not.toContain('transfer');
  });

  it('offers transfer at NORMAL+ when extra tools are enabled', () => {
    const enabled = makeTestConfig({ features: { ...cfg.features, extraToolsEnabled: true } });
    expect(toolNamesForCycle(policyForTier('NORMAL', enabled), enabled)).toContain('transfer');
    expect(toolNamesForCycle(policyForTier('SOVEREIGN', enabled), enabled)).toContain('transfer');
  });

  it('never offers transfer at survival tiers, even when enabled', () => {
    const enabled = makeTestConfig({ features: { ...cfg.features, extraToolsEnabled: true } });
    expect(toolNamesForCycle(policyForTier('CRITICAL', enabled), enabled)).not.toContain('transfer');
    expect(toolNamesForCycle(policyForTier('LOW', enabled), enabled)).not.toContain('transfer');
  });
});

describe('Phase 2 — richer task catalog keeps the growth invariant', () => {
  it('every task reward is at least the configured base (so reward > burn holds)', () => {
    const base = cfg.economy.marketTaskRewardSol;
    for (const task of taskCatalog(cfg)) {
      expect(task.rewardSol).toBeGreaterThanOrEqual(base);
    }
  });
});
