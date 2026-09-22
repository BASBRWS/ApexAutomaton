import { describe, expect, it } from 'vitest';
import {
  addProposal,
  applyDecisions,
  emptyVentureBook,
  openProposalCount,
  pipelineCounts,
  ventureDigest,
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

  it('caps the number of open proposals so the queue stays a decision list', () => {
    const book = emptyVentureBook();
    for (let i = 0; i < 5; i++) expect(addProposal(book, proposal(), i, 'now').ok).toBe(true);
    const sixth = addProposal(book, proposal(), 6, 'now');
    expect(sixth.ok).toBe(false);
    expect(sixth.reason).toMatch(/queue full/i);
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
