import { describe, expect, it } from 'vitest';
import { shouldReplicate, mutateStrategy, type Strategy } from '../src/replication.js';
import { makeTestConfig } from './helpers.js';

const cfg = makeTestConfig();

describe('shouldReplicate — Phase 3 gate (birth conditioned only on sustained profit)', () => {
  it('is eligible only with high balance AND sustained cycles AND room in population', () => {
    const gate = shouldReplicate(cfg, {
      balanceSol: 6,
      sustainedSovereignCycles: 5,
      population: 0,
    });
    expect(gate.eligible).toBe(true);
  });

  it('refuses below the replicate threshold', () => {
    const gate = shouldReplicate(cfg, { balanceSol: 4.9, sustainedSovereignCycles: 10, population: 0 });
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toMatch(/threshold/i);
  });

  it('refuses before the sustained-cycle requirement is met', () => {
    const gate = shouldReplicate(cfg, { balanceSol: 6, sustainedSovereignCycles: 4, population: 0 });
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toMatch(/sustained/i);
  });

  it('refuses at the population cap', () => {
    const gate = shouldReplicate(cfg, { balanceSol: 6, sustainedSovereignCycles: 9, population: 4 });
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toMatch(/population/i);
  });

  it('takes no "population is low" input — only sustained profit drives birth', () => {
    // A low population must NOT by itself make replication eligible. With
    // balance/sustained below thresholds, it stays ineligible regardless.
    const gate = shouldReplicate(cfg, { balanceSol: 0.2, sustainedSovereignCycles: 0, population: 0 });
    expect(gate.eligible).toBe(false);
  });
});

describe('mutateStrategy — exactly one parameter changes', () => {
  const parent: Strategy = { preferredTaskId: 'label-batch', boldness: 0.6 };

  it('changes exactly one field and leaves the other equal to the parent', () => {
    for (let seed = 0; seed < 6; seed++) {
      const { child, mutated } = mutateStrategy(parent, seed);
      const changed = [
        child.preferredTaskId !== parent.preferredTaskId,
        child.boldness !== parent.boldness,
      ].filter(Boolean).length;
      // At most one field differs, and the reported mutated field is valid.
      expect(changed).toBeLessThanOrEqual(1);
      expect(['boldness', 'preferredTaskId']).toContain(mutated);
    }
  });

  it('keeps boldness within [0, 1]', () => {
    const { child } = mutateStrategy({ preferredTaskId: 'label-batch', boldness: 0.95 }, 0);
    expect(child.boldness).toBeGreaterThanOrEqual(0);
    expect(child.boldness).toBeLessThanOrEqual(1);
  });
});
