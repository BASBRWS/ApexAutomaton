import { describe, expect, it } from 'vitest';
import { parseAction, buildUserPrompt } from '../src/prompt.js';
import { initialScore } from '../src/score.js';
import { policyForTier } from '../src/tiers.js';
import { makeTestConfig } from './helpers.js';

describe('buildUserPrompt — survival framing', () => {
  it('foregrounds survival: dust, runway, and the grow-or-preserve question', () => {
    const cfg = makeTestConfig();
    const prompt = buildUserPrompt({
      cycle: 7,
      tier: 'NORMAL',
      policy: policyForTier('NORMAL', cfg),
      equityUsd: 234,
      equitySol: 2,
      dustSol: cfg.trading.dustSol,
      dustUsd: cfg.trading.dustSol * 117,
      avgBurnUsd: 0.015,
      runwayCycles: 15000,
      prices: { BTC: 60000 },
      prevPrices: { BTC: 59000 },
      deskSummary: 'cash=$234',
      score: initialScore(234),
      journalDigest: '(none)',
      obituaryDigest: '(none)',
    });
    expect(prompt).toContain('Survival');
    expect(prompt).toContain('You DIE');
    expect(prompt).toContain('runway');
    expect(prompt).toMatch(/preserve to SURVIVE/i);
  });
});

describe('parseAction — tolerant action extraction', () => {
  it('parses a fenced json block', () => {
    const text = 'Here is my choice:\n```json\n{"tool":"do_task","input":{"taskId":"label-batch"},"rationale":"earn"}\n```';
    const a = parseAction(text);
    expect(a?.tool).toBe('do_task');
    expect(a?.input.taskId).toBe('label-batch');
    expect(a?.rationale).toBe('earn');
  });

  it('parses a bare object with surrounding prose', () => {
    const text = 'I will do a task. {"tool":"do_task","input":{}} Thanks.';
    expect(parseAction(text)?.tool).toBe('do_task');
  });

  it('handles nested braces in the object', () => {
    const text = '{"tool":"reflect","input":{"soul":"# SOUL\\n{notes}"},"rationale":"x"}';
    const a = parseAction(text);
    expect(a?.tool).toBe('reflect');
    expect(typeof a?.input.soul).toBe('string');
  });

  it('returns null when there is no object (loop falls back to rest)', () => {
    expect(parseAction('no json here at all')).toBeNull();
  });

  it('returns null when tool is missing', () => {
    expect(parseAction('{"input":{}}')).toBeNull();
  });

  it('defaults input to an empty object when absent', () => {
    const a = parseAction('{"tool":"rest"}');
    expect(a?.tool).toBe('rest');
    expect(a?.input).toEqual({});
  });
});
