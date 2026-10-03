import { describe, expect, it } from 'vitest';
import { parseAction, buildSystemPrompt, buildUserPrompt } from '../src/prompt.js';
import { initialScore } from '../src/score.js';
import { policyForTier } from '../src/tiers.js';
import { makeTestConfig } from './helpers.js';
import { DEFAULT_LIFE_BANDS } from '../src/challenge.js';

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
      metabolicDailyPct: 0.96,
      prices: { BTC: 60000 },
      prevPrices: { BTC: 59000 },
      deskSummary: 'cash=$234',
      score: initialScore(234),
      journalDigest: '(none)',
      obituaryDigest: '(none)',
    });
    expect(prompt).toContain('Survival');
    expect(prompt).toContain('You DIE');
    expect(prompt).toMatch(/runway/i);
    expect(prompt).toMatch(/preserve.*to SURVIVE/i);
    // Growth pressure: the metabolic cost makes coasting a losing default.
    expect(prompt).toMatch(/metabolic/i);
    expect(prompt).toMatch(/COASTING IS DEATH/i);
  });

  it('does not describe unavoidable drag on a flat book as losing trades to de-risk', () => {
    const cfg = makeTestConfig();
    const text = buildUserPrompt({
      cycle: 225, tier: 'NORMAL', policy: policyForTier('NORMAL', cfg),
      equityUsd: 213, equitySol: 1.76, dustSol: 0.02, dustUsd: 2.4,
      avgBurnUsd: 0.05, runwayCycles: 3000, metabolicDailyPct: 0.96,
      prices: { BTC: 60000 }, prevPrices: { BTC: 60000 }, deskSummary: 'no positions',
      score: initialScore(234), journalDigest: '(none)', obituaryDigest: '(none)',
      hasOpenPositions: false,
      lossTrend: { level: 'alarm', drawdownPct: 0.09, lossStreak: 10, trailingPnlUsd: -0.7, window: 10 },
    });
    expect(text).toContain('There is no open position to cut');
    expect(text).toContain('does not prove repeated losing trades');
    expect(text).not.toContain('STOP THE BLEED: cut risk now');
  });
});

describe('buildUserPrompt — monthly challenge', () => {
  it('shows lives, progress and compute cost, and drops the metabolism framing when it is off', () => {
    const cfg = makeTestConfig();
    const text = buildUserPrompt({
      cycle: 600, tier: 'NORMAL', policy: policyForTier('NORMAL', cfg),
      equityUsd: 202, equitySol: 1.7, dustSol: 0.02, dustUsd: 2.4,
      avgBurnUsd: 0.03, runwayCycles: 6000, metabolicDailyPct: 0,
      prices: { BTC: 60000 }, prevPrices: { BTC: 60000 }, deskSummary: 'cash=$202',
      score: initialScore(200), journalDigest: '(none)', obituaryDigest: '(none)',
      challenge: {
        lives: 2.75, startLives: 3, maxLives: 4, period: 2, daysElapsed: 10, daysLeft: 20, returnSoFar: 0.01,
        projected: { label: 'poor month (1–1.5%)', delta: -0.5 }, safeReturn: 0.02, bonusReturn: 0.025,
        safeEquityUsd: 204, bonusEquityUsd: 205, bands: DEFAULT_LIFE_BANDS, periodComputeUsd: 0.42,
      },
    });
    expect(text).toContain('Lives: 2.75 (you started with 3; at most 4)');
    expect(text).toContain('poor month (1–1.5%), −0.5 life');
    expect(text).toContain('strong month (>2.5%) +0.5');
    expect(text).toContain('$2.00 short of keeping all lives');
    expect(text).toContain('cost $0.42');
    expect(text).toContain('You DIE');
    expect(text).not.toMatch(/COASTING IS DEATH/);
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

describe('venture autonomy prompt', () => {
  it('offers first-party devnet self-launch only when the route is enabled', () => {
    const args = {
      constitution: '', soul: '', tools: [], railsSummary: '', tradableAssets: ['BTC'],
      maxGrossExposureUsd: 100, yieldApy: 0, venturesEnabled: true,
    };
    expect(buildSystemPrompt(args)).not.toContain('launchMode "autonomous-devnet"');
    const enabled = buildSystemPrompt({ ...args, autonomousDevnetVenturesEnabled: true });
    expect(enabled).toContain('launchMode "autonomous-devnet"');
    expect(enabled).toContain('No human approval');
    expect(enabled).toContain('produces no sales or real revenue');
    expect(enabled).toContain('will not upload a government ID');
    expect(enabled).toContain('Do not propose Fiverr, Upwork, Etsy');
  });
});
