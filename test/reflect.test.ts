import { describe, expect, it } from 'vitest';
import { extractNotes } from '../src/memory/reflect.js';
import { composeSoul, SOUL_IDENTITY } from '../src/soul.js';

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
