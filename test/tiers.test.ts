import { describe, expect, it } from 'vitest';
import { tierForBalanceSol, policyForTier } from '../src/tiers.js';
import { makeTestConfig } from './helpers.js';

const cfg = makeTestConfig();

describe('tierForBalanceSol', () => {
  it('classifies each band and boundary correctly', () => {
    expect(tierForBalanceSol(0, cfg)).toBe('DEAD');
    expect(tierForBalanceSol(0.001, cfg)).toBe('DEAD'); // <= dust
    expect(tierForBalanceSol(0.0011, cfg)).toBe('CRITICAL');
    expect(tierForBalanceSol(0.05, cfg)).toBe('CRITICAL');
    expect(tierForBalanceSol(0.1, cfg)).toBe('LOW'); // lower bound inclusive
    expect(tierForBalanceSol(0.3, cfg)).toBe('LOW');
    expect(tierForBalanceSol(0.5, cfg)).toBe('NORMAL');
    expect(tierForBalanceSol(1.9, cfg)).toBe('NORMAL');
    expect(tierForBalanceSol(2.0, cfg)).toBe('ABUNDANT');
    expect(tierForBalanceSol(4.9, cfg)).toBe('ABUNDANT');
    expect(tierForBalanceSol(5.0, cfg)).toBe('SOVEREIGN');
    expect(tierForBalanceSol(100, cfg)).toBe('SOVEREIGN');
  });
});

describe('policyForTier', () => {
  it('uses the cheapest model and revenue-only tools at CRITICAL', () => {
    const p = policyForTier('CRITICAL', cfg);
    expect(p.model).toBe(cfg.models.cheapest);
    expect(p.tools).toContain('do_task');
    expect(p.tools).not.toContain('reflect');
    expect(p.rights.mayReplicate).toBe(false);
  });

  it('uses the frontier model and full tools at NORMAL', () => {
    const p = policyForTier('NORMAL', cfg);
    expect(p.model).toBe(cfg.models.frontier);
    expect(p.tools).toEqual(expect.arrayContaining(['do_task', 'write_journal', 'reflect', 'rest']));
  });

  it('gates replication to SOVEREIGN only', () => {
    expect(policyForTier('NORMAL', cfg).rights.mayReplicate).toBe(false);
    expect(policyForTier('ABUNDANT', cfg).rights.mayReplicate).toBe(false);
    expect(policyForTier('SOVEREIGN', cfg).rights.mayReplicate).toBe(true);
  });

  it('offers do_task at every living tier (earning always reachable)', () => {
    for (const tier of ['CRITICAL', 'LOW', 'NORMAL', 'ABUNDANT', 'SOVEREIGN'] as const) {
      expect(policyForTier(tier, cfg).tools).toContain('do_task');
    }
  });

  it('grows the compute budget with the tier', () => {
    const critical = policyForTier('CRITICAL', cfg).maxTokens;
    const normal = policyForTier('NORMAL', cfg).maxTokens;
    const sovereign = policyForTier('SOVEREIGN', cfg).maxTokens;
    expect(critical).toBeLessThan(normal);
    expect(normal).toBeLessThan(sovereign);
  });
});
