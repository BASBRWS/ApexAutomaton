import { describe, expect, it } from 'vitest';
import {
  addProposal,
  applyDecisions,
  emptyVentureBook,
  openProposalCount,
  pipelineCounts,
  ventureDigest,
  markLive,
  updateVentureMonitor,
  findVenture,
  type ProposalInput,
} from '../src/ventures/store.js';

function proposal(over: Partial<ProposalInput> = {}): ProposalInput {
  return {
    category: 'Digital Product',
    title: 'Notion budget template',
    thesis: 'Cheap to make, evergreen demand.',
    deliverable: 'A full Notion template spec with sections and formulas.',
    humanAction: 'Publish it on Gumroad under your account and connect Stripe.',
    estCostUsd: 0,
    estRevenueUsd: 40,
    killCriteria: 'No sale in 30 days.',
    ...over,
  };
}

describe('venture proposals', () => {
  it('queues a valid proposal as "proposed" and slugs the category', () => {
    const book = emptyVentureBook();
    const res = addProposal(book, proposal(), 3, 'now');
    expect(res.ok).toBe(true);
    expect(res.venture?.status).toBe('proposed');
    expect(res.venture?.category).toBe('digital-product');
    expect(res.venture?.id).toBe('v0001');
    expect(openProposalCount(book)).toBe(1);
  });

  it('rejects a proposal missing a deliverable or human action', () => {
    const book = emptyVentureBook();
    expect(addProposal(book, proposal({ deliverable: '  ' }), 1, 'now').ok).toBe(false);
    expect(addProposal(book, proposal({ humanAction: '' }), 1, 'now').ok).toBe(false);
    expect(book.ventures).toHaveLength(0);
  });

  it('keeps well-formed launch steps and drops unsafe/invalid URLs', () => {
    const book = emptyVentureBook();
    const res = addProposal(book, proposal({
      launchSteps: [
        { label: 'Create a Gumroad account', url: 'https://gumroad.com/signup' },
        { label: 'Publish' }, // no url is fine
        { label: 'Evil', url: 'javascript:alert(1)' }, // unsafe → url stripped, label kept
        { label: '' }, // no label → dropped
        { url: 'https://x.com' }, // no label → dropped
      ],
    }), 1, 'now');
    const steps = res.venture?.launchSteps ?? [];
    expect(steps).toHaveLength(3);
    expect(steps[0]).toEqual({ label: 'Create a Gumroad account', url: 'https://gumroad.com/signup' });
    expect(steps[1]).toEqual({ label: 'Publish' });
    expect(steps[2]).toEqual({ label: 'Evil' }); // javascript: URL removed, no url key
  });

  it('leaves launchSteps undefined when none are valid or none given', () => {
    const book = emptyVentureBook();
    expect(addProposal(book, proposal(), 1, 'now').venture?.launchSteps).toBeUndefined();
    expect(addProposal(book, proposal({ launchSteps: 'nope' }), 2, 'now').venture?.launchSteps).toBeUndefined();
  });

  it('caps the number of open proposals so the queue stays a decision list', () => {
    const book = emptyVentureBook();
    for (let i = 0; i < 5; i++) expect(addProposal(book, proposal({ category: `category-${i}` }), i, 'now').ok).toBe(true);
    const sixth = addProposal(book, proposal(), 6, 'now');
    expect(sixth.ok).toBe(false);
    expect(sixth.reason).toMatch(/queue full/i);
  });

  it('requires valid metadata and approval for a Pump.fun venture', () => {
    const book = emptyVentureBook();
    expect(addProposal(book, proposal({ category: 'pumpfun', pumpToken: {
      name: 'Apex Test', symbol: 'APEX', uri: 'https://example.com/apex.json',
    } }), 1, 'now').venture?.pumpToken).toEqual({
      name: 'Apex Test', symbol: 'APEX', uri: 'https://example.com/apex.json',
    });
    expect(addProposal(book, proposal({ category: 'pumpfun', pumpToken: {
      name: 'Bad', symbol: 'BAD', uri: 'http://example.com/metadata.json',
    } }), 2, 'now').ok).toBe(false);
    expect(markLive(book, 'v0001', 'https://example.com/listing', 2, 'now').reason).toMatch(/approve Pump.fun metadata/);
  });

  it('limits open and active ventures per category to force broader exploration', () => {
    const book = emptyVentureBook();
    for (let i = 0; i < 3; i++) expect(addProposal(book, proposal({ title: `Idea ${i}` }), i, 'now').ok).toBe(true);
    expect(addProposal(book, proposal({ title: 'Another template' }), 4, 'now').reason).toMatch(/another market/);
    expect(addProposal(book, proposal({ category: 'defi-app' }), 5, 'now').ok).toBe(true);
  });
});

describe('venture decisions + revenue folding', () => {
  it('activates approved ventures and ticks the autonomy ledger', () => {
    const book = emptyVentureBook();
    addProposal(book, proposal(), 1, 'now');
    book.ventures[0]!.status = 'approved'; // the human approves by editing the queue

    let folded = 0;
    const out = applyDecisions(book, 5, 10, (usd) => (folded += usd));
    expect(book.ventures[0]!.status).toBe('active');
    expect(book.ventures[0]!.decidedAtCycle).toBe(5);
    expect(out.activated).toHaveLength(1);
    expect(book.ledger['digital-product']!.approved).toBe(1);
    expect(folded).toBe(0); // no revenue reported yet
  });

  it('folds only the newly-reported revenue delta into the book, once', () => {
    const book = emptyVentureBook();
    addProposal(book, proposal(), 1, 'now');
    book.ventures[0]!.status = 'approved';
    applyDecisions(book, 2, 10, () => {});

    // Human reports $25 of real revenue.
    book.ventures[0]!.revenueUsd = 25;
    let folded = 0;
    const first = applyDecisions(book, 3, 10, (usd) => (folded += usd));
    expect(folded).toBe(25);
    expect(first.revenueAddedUsd).toBe(25);
    expect(book.ledger['digital-product']!.earnedUsd).toBe(25);

    // Running again with no new revenue folds nothing (delta only).
    const second = applyDecisions(book, 4, 10, (usd) => (folded += usd));
    expect(second.revenueAddedUsd).toBe(0);
    expect(folded).toBe(25);

    // Human reports more; only the delta ($15) is folded.
    book.ventures[0]!.revenueUsd = 40;
    applyDecisions(book, 5, 10, (usd) => (folded += usd));
    expect(folded).toBe(40);
  });

  it('uses the persisted credit ledger after a state save when the venture file was not saved', () => {
    const book = emptyVentureBook();
    addProposal(book, proposal(), 1, 'now');
    book.ventures[0]!.status = 'active';
    book.ventures[0]!.revenueUsd = 25;
    const oldVentureFile = structuredClone(book);
    const credits: Record<string, number> = {};
    let folded = 0;
    applyDecisions(book, 2, 10, (usd) => { folded += usd; }, credits);
    expect(credits.v0001).toBe(25);
    applyDecisions(oldVentureFile, 3, 10, (usd) => { folded += usd; }, credits);
    expect(folded).toBe(25);
    expect(oldVentureFile.ledger['digital-product']!.earnedUsd).toBe(25);
  });

  it('never folds revenue for a venture that was never activated', () => {
    const book = emptyVentureBook();
    addProposal(book, proposal(), 1, 'now');
    book.ventures[0]!.revenueUsd = 999; // reported while still just "proposed"
    let folded = 0;
    applyDecisions(book, 2, 10, (usd) => (folded += usd));
    expect(folded).toBe(0);
  });

  it('flags a category autonomy-eligible after enough approvals', () => {
    const book = emptyVentureBook();
    for (let i = 0; i < 3; i++) {
      addProposal(book, proposal(), i, 'now');
      book.ventures[i]!.status = 'approved';
      applyDecisions(book, 10 + i, 3, () => {});
    }
    expect(book.ledger['digital-product']!.approved).toBe(3);
    expect(book.ledger['digital-product']!.autoEligible).toBe(true);
  });
});

describe('mark live + autonomous monitoring', () => {
  function liveBook() {
    const book = emptyVentureBook();
    addProposal(book, proposal(), 1, 'now');
    return book;
  }

  it('marks a venture live: active, records url + listedAt, ticks the ledger', () => {
    const book = liveBook();
    const res = markLive(book, 'v0001', 'https://gumroad.com/l/abc', 9, '2026-01-01T00:00:00.000Z');
    expect(res.ok).toBe(true);
    const v = findVenture(book, 'v0001')!;
    expect(v.status).toBe('active');
    expect(v.liveUrl).toBe('https://gumroad.com/l/abc');
    expect(v.listedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(book.ledger['digital-product']!.approved).toBe(1);
  });

  it('rejects an unknown id and ignores a non-http url', () => {
    const book = liveBook();
    expect(markLive(book, 'nope', 'https://x.com', 1, 'now').ok).toBe(false);
    markLive(book, 'v0001', 'javascript:alert(1)', 1, 'now');
    expect(findVenture(book, 'v0001')!.liveUrl).toBeUndefined(); // unsafe url dropped
    expect(findVenture(book, 'v0001')!.status).toBe('active');   // still activated
  });

  it('computes days-live and flags kill-due only past the window without revenue', () => {
    const book = liveBook();
    const listed = '2026-01-01T00:00:00.000Z';
    markLive(book, 'v0001', 'https://gumroad.com/l/abc', 1, listed);
    const v = findVenture(book, 'v0001')!;

    // 10 days in, reachable, no revenue → not kill-due yet
    updateVentureMonitor(v, true, Date.parse('2026-01-11T00:00:00.000Z'), 60);
    expect(v.monitor!.daysLive).toBe(10);
    expect(v.monitor!.reachable).toBe(true);
    expect(v.monitor!.killDue).toBe(false);

    // 61 days in, still no revenue → kill-due
    updateVentureMonitor(v, true, Date.parse('2026-03-03T00:00:00.000Z'), 60);
    expect(v.monitor!.killDue).toBe(true);

    // but revenue reported cancels the kill flag
    v.revenueUsd = 12;
    updateVentureMonitor(v, true, Date.parse('2026-03-03T00:00:00.000Z'), 60);
    expect(v.monitor!.killDue).toBe(false);
  });
});

describe('venture digest + counts', () => {
  it('summarizes the pipeline and surfaces what awaits the human', () => {
    const book = emptyVentureBook();
    addProposal(book, proposal({ title: 'Alpha' }), 1, 'now');
    const digest = ventureDigest(book);
    expect(digest).toMatch(/Alpha/);
    expect(digest).toMatch(/awaiting your approval/i);
    expect(pipelineCounts(book)).toEqual({ proposed: 1, active: 0, totalRevenueUsd: 0 });
  });
});
