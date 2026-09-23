import fs from 'node:fs';
import { STATE_DIR, VENTURES_FILE } from '../paths.js';
import type { AutonomyEntry, LaunchStep, Venture, VentureBook, VentureStatus } from './types.js';

/**
 * ventures/store.ts — the venture pipeline's persistence AND its pure logic.
 *
 * The pure functions (addProposal, applyDecisions, digest, counts) take the book
 * as data so they are trivially testable without a filesystem. The loop owns one
 * VentureBook per cycle: it loads it, applies human decisions, hands it to the
 * propose_venture tool via the context, then saves it once at the end.
 */

const MAX_OPEN_PROPOSALS = 5; // cap the queue so it stays a decision list, not a firehose.
const DELIVERABLE_MAX = 6000; // keep a single proposal's deliverable bounded.

export function emptyVentureBook(): VentureBook {
  return { ventures: [], ledger: {}, seq: 0 };
}

export function loadVentureBook(): VentureBook {
  try {
    if (!fs.existsSync(VENTURES_FILE)) return emptyVentureBook();
    const parsed = JSON.parse(fs.readFileSync(VENTURES_FILE, 'utf8')) as Partial<VentureBook>;
    return {
      ventures: Array.isArray(parsed.ventures) ? parsed.ventures : [],
      ledger: parsed.ledger && typeof parsed.ledger === 'object' ? parsed.ledger : {},
      seq: typeof parsed.seq === 'number' ? parsed.seq : 0,
    };
  } catch {
    // A corrupt file must not crash the cycle; start clean rather than throw.
    return emptyVentureBook();
  }
}

export function saveVentureBook(book: VentureBook): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(VENTURES_FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
}

/** How many proposals are still awaiting a human decision. */
export function openProposalCount(book: VentureBook): number {
  return book.ventures.filter((v) => v.status === 'proposed').length;
}

export interface ProposalInput {
  category: string;
  title: string;
  thesis: string;
  deliverable: string;
  humanAction: string;
  estCostUsd: number;
  estRevenueUsd: number;
  killCriteria: string;
  launchSteps?: unknown;
}

const MAX_LAUNCH_STEPS = 8;

/** Keep only well-formed steps and http/https links (never javascript:/data:), so
 * a proposal can never inject an unsafe URL into the dashboard popup. */
function sanitizeLaunchSteps(raw: unknown): LaunchStep[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LaunchStep[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LAUNCH_STEPS) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === 'string' ? rec.label.trim().slice(0, 240) : '';
    if (!label) continue;
    const rawUrl = typeof rec.url === 'string' ? rec.url.trim() : '';
    const url = /^https:\/\/|^http:\/\//i.test(rawUrl) ? rawUrl.slice(0, 400) : undefined;
    out.push(url ? { label, url } : { label });
  }
  return out.length > 0 ? out : undefined;
}

export interface AddProposalResult {
  ok: boolean;
  reason?: string;
  venture?: Venture;
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other';
}

/** Add a proposed venture to the queue. Mutates the book. Rejects (without
 * throwing) when the queue is full or the proposal is missing its essentials, so
 * the loop can record a clean journal note instead of crashing. */
export function addProposal(book: VentureBook, input: ProposalInput, cycle: number, at: string): AddProposalResult {
  if (openProposalCount(book) >= MAX_OPEN_PROPOSALS) {
    return {
      ok: false,
      reason: `queue full (${MAX_OPEN_PROPOSALS} proposals awaiting your decision) — no new proposal added`,
    };
  }
  const title = input.title?.trim();
  const deliverable = input.deliverable?.trim();
  const humanAction = input.humanAction?.trim();
  if (!title || !deliverable || !humanAction) {
    return { ok: false, reason: 'proposal needs at least a title, a deliverable, and a humanAction' };
  }
  book.seq += 1;
  const venture: Venture = {
    id: `v${String(book.seq).padStart(4, '0')}`,
    createdAtCycle: cycle,
    at,
    category: slug(input.category || 'other'),
    title: title.slice(0, 160),
    thesis: (input.thesis ?? '').trim().slice(0, 1200),
    deliverable: deliverable.slice(0, DELIVERABLE_MAX),
    humanAction: humanAction.slice(0, 800),
    launchSteps: sanitizeLaunchSteps(input.launchSteps),
    estCostUsd: cleanNum(input.estCostUsd),
    estRevenueUsd: cleanNum(input.estRevenueUsd),
    killCriteria: (input.killCriteria ?? '').trim().slice(0, 600),
    status: 'proposed',
    revenueUsd: 0,
    accountedRevenueUsd: 0,
  };
  book.ventures.push(venture);
  return { ok: true, venture };
}

function cleanNum(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function ensureLedger(book: VentureBook, category: string): AutonomyEntry {
  const existing = book.ledger[category];
  if (existing) return existing;
  const fresh: AutonomyEntry = { approved: 0, rejected: 0, earnedUsd: 0, autoEligible: false };
  book.ledger[category] = fresh;
  return fresh;
}

export interface DecisionOutcome {
  /** ventures a human approved this cycle (now active). */
  activated: Venture[];
  /** ventures a human rejected this cycle. */
  rejected: Venture[];
  /** real revenue folded into the book this cycle, USD. */
  revenueAddedUsd: number;
  /** categories that crossed the autonomy threshold this cycle. */
  newlyAutonomous: string[];
}

/**
 * Apply the human's decisions (set by editing statuses / revenueUsd in
 * state/ventures.json) and fold any newly-reported real revenue into the book.
 *
 * - status 'approved' → 'active' (the human took the money/identity action), and
 *   the category's approval count ticks up; crossing `autonomyThreshold` flags it
 *   auto-eligible (the "earned autonomy" signal).
 * - status 'rejected' → recorded, counted, left as rejected.
 * - revenueUsd > accountedRevenueUsd on an ACTIVE venture → the delta is folded
 *   into the book via `foldRevenue` (real value becomes book equity).
 *
 * Mutates the book. `foldRevenue` is the only side effect on the outside world
 * (it adds USD to the desk's cash), kept as a callback so this stays pure/testable.
 */
export function applyDecisions(
  book: VentureBook,
  cycle: number,
  autonomyThreshold: number,
  foldRevenue: (usd: number) => void,
): DecisionOutcome {
  const activated: Venture[] = [];
  const rejected: Venture[] = [];
  const newlyAutonomous: string[] = [];
  let revenueAddedUsd = 0;

  for (const v of book.ventures) {
    if (v.status === 'approved') {
      v.status = 'active';
      v.decidedAtCycle = cycle;
      const entry = ensureLedger(book, v.category);
      entry.approved += 1;
      if (!entry.autoEligible && entry.approved >= autonomyThreshold) {
        entry.autoEligible = true;
        newlyAutonomous.push(v.category);
      }
      activated.push(v);
    } else if (v.status === 'rejected' && v.decidedAtCycle === undefined) {
      v.decidedAtCycle = cycle;
      ensureLedger(book, v.category).rejected += 1;
      rejected.push(v);
    }

    // Fold newly-reported real revenue for live ventures (only ever forward).
    if (v.status === 'active') {
      const unaccounted = cleanNum(v.revenueUsd) - cleanNum(v.accountedRevenueUsd);
      if (unaccounted > 0) {
        foldRevenue(unaccounted);
        v.accountedRevenueUsd = cleanNum(v.revenueUsd);
        revenueAddedUsd += unaccounted;
        ensureLedger(book, v.category).earnedUsd += unaccounted;
      }
    }
  }

  return { activated, rejected, revenueAddedUsd, newlyAutonomous };
}

const STATUS_LABEL: Record<VentureStatus, string> = {
  proposed: 'AWAITING YOU',
  approved: 'approved',
  active: 'LIVE',
  killed: 'killed',
  rejected: 'rejected',
};

/** A compact digest of the pipeline for the agent's prompt: what is waiting on the
 * human, what is live, what has earned. Keeps the agent aware of its own funnel so
 * it iterates and kills rather than re-proposing the same thing. */
export function ventureDigest(book: VentureBook, n = 8): string {
  if (book.ventures.length === 0) return '(no ventures yet — you have proposed none)';
  const recent = book.ventures.slice(-n);
  const lines = recent.map((v) => {
    const money =
      v.revenueUsd > 0
        ? ` earned=$${v.revenueUsd.toFixed(2)}`
        : ` est=$${v.estRevenueUsd.toFixed(0)}`;
    return `${v.id} [${STATUS_LABEL[v.status]}] (${v.category}) ${v.title}${money}`;
  });
  const auto = Object.entries(book.ledger)
    .filter(([, e]) => e.autoEligible)
    .map(([c]) => c);
  if (auto.length > 0) lines.push(`autonomy-earned categories: ${auto.join(', ')}`);
  const waiting = openProposalCount(book);
  if (waiting > 0) lines.push(`${waiting} proposal(s) awaiting your approval before they can earn.`);
  return lines.join('\n');
}

export interface PipelineCounts {
  proposed: number;
  active: number;
  totalRevenueUsd: number;
}

export function pipelineCounts(book: VentureBook): PipelineCounts {
  let proposed = 0;
  let active = 0;
  let totalRevenueUsd = 0;
  for (const v of book.ventures) {
    if (v.status === 'proposed') proposed += 1;
    if (v.status === 'active') active += 1;
    totalRevenueUsd += cleanNum(v.revenueUsd);
  }
  return { proposed, active, totalRevenueUsd };
}
