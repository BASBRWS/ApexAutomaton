import { describe, expect, it } from 'vitest';
import { extractNotes } from '../src/memory/reflect.js';
import { composeSoul, preserveSoulHistory, soulForPrompt, soulWithHistory, SOUL_IDENTITY } from '../src/soul.js';

describe('auto-reflect note extraction', () => {
  it('keeps plain bullet points', () => {
    const out = extractNotes('- rotate into gold on crypto drawdowns\n- avoid overtrading tiny alts');
    expect(out).toBe('- rotate into gold on crypto drawdowns\n- avoid overtrading tiny alts');
  });

  it('strips a code fence the model may add', () => {
    const out = extractNotes('```markdown\n- keep gross exposure low near death\n```');
    expect(out).toBe('- keep gross exposure low near death');
  });

  it('drops a repeated "## Strategy notes" header', () => {
    const out = extractNotes('## Strategy notes\n- stake when the book is large');
    expect(out).toBe('- stake when the book is large');
  });
});

describe('composeSoul', () => {
  it('preserves the fixed identity and inserts the notes', () => {
    const soul = composeSoul('- lesson one\n- lesson two');
    expect(soul.startsWith(SOUL_IDENTITY)).toBe(true);
    expect(soul).toContain('## Strategy notes');
    expect(soul).toContain('- lesson one');
  });

  it('falls back to the empty placeholder for blank notes', () => {
    expect(composeSoul('   ')).toContain('(empty —');
  });
});

describe('SOUL factual history', () => {
  const facts = [
    { cycle: 84, at: 'now', kind: 'trade' as const, text: 'BTC realized gain', pnlUsd: 3.27 },
    { cycle: 96, at: 'now', kind: 'reflection' as const, text: 'auto-reflected' },
    { cycle: 125, at: 'now', kind: 'trade' as const, text: 'BTC realized gain', pnlUsd: 4.61 },
    { cycle: 180, at: 'now', kind: 'venture' as const, text: 'real venture revenue booked', pnlUsd: 5 },
  ];

  it('backfills factual outcomes and remains idempotent', () => {
    const first = soulWithHistory(composeSoul('- watch costs'), facts);
    expect(first).toContain('Cycle 84 [trade]: BTC realized gain (+$3.27)');
    expect(first).not.toContain('auto-reflected');
    expect(soulWithHistory(first, facts)).toBe(first);
    expect(soulWithHistory(first, [...facts, {
      cycle: 181, at: 'now', kind: 'venture', text: 'new customer paid', pnlUsd: 10,
    }])).toContain('Cycle 181 [venture]: new customer paid (+$10.00)');
  });

  it('keeps historical facts when strategy is rewritten and bounds the prompt', () => {
    const oldSoul = soulWithHistory(composeSoul('- old strategy'), facts);
    const revised = preserveSoulHistory(composeSoul('- new strategy'), oldSoul);
    expect(revised).toContain('- new strategy');
    expect(revised).not.toContain('- old strategy');
    expect(revised).toContain('Cycle 84 [trade]');
    const prompt = soulForPrompt(1, revised);
    expect(prompt).toContain('Cycle 180 [venture]');
    expect(prompt).not.toContain('Cycle 84 [trade]');
  });
});
