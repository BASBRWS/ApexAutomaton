import { describe, expect, it } from 'vitest';
import { guardSoulText } from '../src/memory/guard.js';
import { realizedByAsset } from '../src/memory/lessons.js';
import { soulWithHistory, composeSoul } from '../src/soul.js';

// The notes the weekly evaluator actually wrote at cycle #584.
const NOTES_584 = [
  '- **Doing nothing now costs a life**: month started at 0.00%; <1% = −1 life. You need ~+$4 (2%) to hold 3 lives, ~+$5 (2.5%) on $199 equity to gain one. Target +$5–6 realized this month — a dormant month is not safe.',
  '- **Trade BTC only, no alts**: BTC realized +$13.69 across 5 trades. Alt baskets netted negative from churn — keep the alt ban.',
  '- **Drop the "equity >2.0 SOL" and "3% daily move" gates**: these block every trade and guarantee a bad month. Instead: enter BTC on a clean ≥1% move or pullback after ≥30 cycles since last exit.',
  '- **Size & exits**: one BTC position sized so a winner nets ≥$3; take profit +1.5%, stop −0.75%. Two or three wins should clear the month target.',
  '- **Once the month is +2.6% realized, protect it**: halve size, A+ setups only; stop entirely if it falls back toward +2%.',
  '- **Keep idle cycles cheap**: thinking and churn costs are the real bleed. Between setups, minimal checks.',
].join('\n');

describe('SOUL write guard', () => {
  it('drops goal, life and urgency lines from the #584 notes and keeps the rest', () => {
    const { text, dropped } = guardSoulText(NOTES_584);
    expect(text).not.toMatch(/costs a life|month|target|lives/i);
    expect(text).toContain('Trade BTC only');
    expect(text).toContain('Keep idle cycles cheap');
    expect(dropped.map((d) => d.why)).toEqual(expect.arrayContaining(['lives', 'calendar goal']));
    expect(dropped).toHaveLength(4);
  });

  it('keeps ordinary trading rules, including profit targets in percent', () => {
    const ok = '- Take profit at +1.5% and stop at −0.75%.\n- Rest when no setup has an edge.\n- Avoid alt baskets: they paid fees on every rebalance.';
    expect(guardSoulText(ok)).toEqual({ text: ok, dropped: [] });
  });

  it('catches resting framed as failure and dollar quotas', () => {
    expect(guardSoulText('- Sitting out is a failure of purpose.').dropped).toHaveLength(1);
    expect(guardSoulText('- Resting is not safe right now.').dropped).toHaveLength(1);
    expect(guardSoulText('- Aim for a $5 goal this week.').dropped).toHaveLength(1);
    expect(guardSoulText('- Deadline: act before it is too late.').dropped).toHaveLength(1);
  });

  it('leaves headings and the identity preamble alone', () => {
    const soul = composeSoul('- Rest when no setup has an edge.');
    expect(guardSoulText(soul).text).toBe(soul);
  });
});

describe('verified facts for the evaluator', () => {
  it('sums realized PnL per asset from the trade lessons', () => {
    const lessons = [
      { cycle: 49, at: 'x', kind: 'trade' as const, text: 'rebalance realized XRP +$0.61, BCH +$0.15', pnlUsd: 0.76 },
      { cycle: 84, at: 'x', kind: 'trade' as const, text: 'rebalance realized BTC +$3.27', pnlUsd: 3.27 },
      { cycle: 331, at: 'x', kind: 'trade' as const, text: 'trade realized BTC -$1.21', pnlUsd: -1.21 },
      { cycle: 400, at: 'x', kind: 'milestone' as const, text: 'BTC +$99.00 (not a trade lesson)' },
    ];
    const r = realizedByAsset(lessons);
    expect(r.BTC).toEqual({ pnlUsd: expect.closeTo(2.06, 9), closes: 2, wins: 1 });
    expect(r.XRP!.pnlUsd).toBeCloseTo(0.61, 9);
  });

  it('keeps challenge results out of the SOUL history the decider reads', () => {
    const soul = soulWithHistory(composeSoul('- note'), [
      { cycle: 1, at: 'x', kind: 'trade', text: 'trade realized BTC +$1.00', pnlUsd: 1 },
      { cycle: 2, at: 'x', kind: 'challenge', text: 'month 1: +0.50% — bad month: −1 life' },
    ]);
    expect(soul).toContain('Cycle 1 [trade]');
    expect(soul).not.toMatch(/month 1|life/);
  });
});
