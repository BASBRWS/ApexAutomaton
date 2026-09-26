import fs from 'node:fs';
import { STATE_DIR, VENTURES_FILE } from '../paths.js';
import type { AutonomyEntry, LaunchStep, Venture, VentureBook, VentureStatus } from './types.js';
import { autonomousMetadataUrl } from './autonomy.js';

/**
 * ventures/store.ts — the venture pipeline's persistence AND its pure logic.
 *
 * The pure functions (addProposal, applyDecisions, digest, counts) take the book
 * as data so they are trivially testable without a filesystem. The loop owns one
 * VentureBook per cycle: it loads it, applies human decisions, hands it to the
 * propose_venture tool via the context, then saves it once at the end.
 */

const MAX_OPEN_PROPOSALS = 5; // cap the queue so it stays a decision list, not a firehose.
const MAX_LIVE_PER_CATEGORY = 3; // stop a stream of near-identical products.
const DELIVERABLE_MAX = 6000; // keep a single proposal's deliverable bounded.
const MAX_AUTONOMOUS_PER_DAY = 1;
const MAX_AUTONOMOUS_TOTAL = 10;
// The operator does not want to submit identity documents for a new seller
// account. Check the requested launch action and links, not narrative comparisons
// such as "no KYC" in the thesis: rejecting those wastes an expensive cycle.
const ID_GATED_ROUTES = /\b(?:fiverr|upwork|etsy|kyc|identity verification|identiteitsverificatie|id-verificatie|passport|paspoort|government-issued id|overheids-id)\b/i;
const NEW_SELLER_ACCOUNT = /\b(?:create|open|register|sign\s?up|set\s?up|aanmaken|openen|registreren)\b.{0,100}\b(?:seller|freelancer|merchant|payout|payment|store|shop|gig|account|verkoper|winkel|uitbetaling|betaalrekening)\b/i;

export function emptyVentureBook(): VentureBook {
  return { ventures: [], ledger: {}, seq: 0 };
}

export function loadVentureBook(): VentureBook {
  if (!fs.existsSync(VENTURES_FILE)) return emptyVentureBook();
  const parsed = JSON.parse(fs.readFileSync(VENTURES_FILE, 'utf8')) as Partial<VentureBook>;
  if (!Array.isArray(parsed.ventures) || !parsed.ledger || typeof parsed.seq !== 'number') {
    throw new Error('Invalid venture book. Refusing to replace it with an empty book.');
  }
  return parsed as VentureBook;
}

export function saveVentureBook(book: VentureBook): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const temporary = `${VENTURES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(book, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, VENTURES_FILE);
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
  pumpToken?: unknown;
  nftAsset?: unknown;
  splToken?: unknown;
  launchMode?: unknown;
}

function validMetadataUri(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length > 200) return null;
  const uri = raw.trim();
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' && u.hostname && !u.username && !u.password ? uri : null;
  } catch { return null; }
}

export function validNftAsset(raw: unknown): { name: string; uri: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  const uri = validMetadataUri(v.uri);
  return name && Buffer.byteLength(name) <= 32 && uri ? { name, uri } : null;
}

export function validPumpToken(raw: unknown): { name: string; symbol: string; uri: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.name !== 'string' || typeof v.symbol !== 'string' || typeof v.uri !== 'string') return null;
  const name = v.name.trim();
  const symbol = v.symbol.trim();
  const uri = v.uri.trim();
  if (!name || Buffer.byteLength(name) > 32 || !/^[A-Z0-9]{2,10}$/.test(symbol) || uri.length > 200) return null;
  return validMetadataUri(uri) ? { name, symbol, uri } : null;
}

export function validSplToken(raw: unknown): { name: string; symbol: string; uri: string; decimals: number } | null {
  const token = validPumpToken(raw);
  if (!token || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const decimals = (raw as Record<string, unknown>).decimals;
  return typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 9
    ? { ...token, decimals } : null;
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
  const autonomous = input.launchMode === 'autonomous-devnet';
  if (input.launchMode !== undefined && !autonomous) {
    return { ok: false, reason: 'unsupported autonomous launch mode' };
  }
  const launchText = [input.title, input.humanAction,
    ...(sanitizeLaunchSteps(input.launchSteps)?.flatMap((step) => [step.label, step.url ?? '']) ?? [])]
    .filter((part): part is string => typeof part === 'string').join(' ');
  if (ID_GATED_ROUTES.test(launchText) || NEW_SELLER_ACCOUNT.test(launchText)) {
    return { ok: false, reason: 'operator declined new seller ID onboarding; use an existing channel without new verification' };
  }
  if (!autonomous && openProposalCount(book) >= MAX_OPEN_PROPOSALS) {
    return {
      ok: false,
      reason: `queue full (${MAX_OPEN_PROPOSALS} proposals awaiting your decision) — no new proposal added`,
    };
  }
  if (autonomous && (!input.splToken || input.pumpToken || input.nftAsset)) {
    return { ok: false, reason: 'autonomous launch only supports first-party Token-2022 devnet mints' };
  }
  if (autonomous && book.ventures.filter((v) => v.launchMode === 'autonomous-devnet').length >= MAX_AUTONOMOUS_TOTAL) {
    return { ok: false, reason: 'autonomous devnet venture limit reached' };
  }
  if (autonomous && book.ventures.some((v) => v.launchMode === 'autonomous-devnet' && v.at.slice(0, 10) === at.slice(0, 10))) {
    return { ok: false, reason: `only ${MAX_AUTONOMOUS_PER_DAY} autonomous devnet venture per UTC day` };
  }
  const title = input.title?.trim();
  const deliverable = input.deliverable?.trim();
  const humanAction = autonomous ? 'No operator action for this devnet experiment.' : input.humanAction?.trim();
  if (!title || !deliverable || !humanAction) {
    return { ok: false, reason: 'proposal needs at least a title, a deliverable, and a humanAction' };
  }
  const pumpToken = input.pumpToken === undefined ? undefined : validPumpToken(input.pumpToken);
  const nftAsset = input.nftAsset === undefined ? undefined : validNftAsset(input.nftAsset);
  const rawSpl = autonomous && input.splToken && typeof input.splToken === 'object' && !Array.isArray(input.splToken)
    ? { ...input.splToken, uri: autonomousMetadataUrl(`v${String(book.seq + 1).padStart(4, '0')}`) }
    : input.splToken;
  const splToken = rawSpl === undefined ? undefined : validSplToken(rawSpl);
  if (input.pumpToken !== undefined && !pumpToken) {
    return { ok: false, reason: 'invalid Pump.fun token metadata (HTTPS URI, name <=32 bytes, symbol 2-10 A-Z/0-9)' };
  }
  if (input.nftAsset !== undefined && !nftAsset) {
    return { ok: false, reason: 'invalid NFT metadata (HTTPS URI and name <=32 bytes)' };
  }
  if (rawSpl !== undefined && !splToken) {
    return { ok: false, reason: 'invalid Token-2022 metadata (HTTPS URI, name <=32 bytes, symbol 2-10 A-Z/0-9, decimals 0-9)' };
  }
  if ([pumpToken, nftAsset, splToken].filter(Boolean).length > 1) {
    return { ok: false, reason: 'one venture may create only one on-chain asset type' };
  }
  const category = slug(input.category || 'other');
  if (book.ventures.filter((v) => v.category === category &&
    (v.status === 'proposed' || v.status === 'approved' || v.status === 'active')).length >= MAX_LIVE_PER_CATEGORY) {
    return { ok: false, reason: `category ${category} already has ${MAX_LIVE_PER_CATEGORY} active or pending ventures; explore another market` };
  }
  book.seq += 1;
  const venture: Venture = {
    id: `v${String(book.seq).padStart(4, '0')}`,
    createdAtCycle: cycle,
    at,
    category,
    title: title.slice(0, 160),
    thesis: (input.thesis ?? '').trim().slice(0, 1200),
    deliverable: deliverable.slice(0, DELIVERABLE_MAX),
    humanAction: humanAction.slice(0, 800),
    launchSteps: sanitizeLaunchSteps(input.launchSteps),
    estCostUsd: cleanNum(input.estCostUsd),
    estRevenueUsd: cleanNum(input.estRevenueUsd),
    killCriteria: (input.killCriteria ?? '').trim().slice(0, 600),
    status: 'proposed',
    ...(autonomous ? { launchMode: 'autonomous-devnet' as const } : {}),
    ...(pumpToken ? { pumpToken } : {}),
    ...(nftAsset ? { nftAsset } : {}),
    ...(splToken ? { splToken } : {}),
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
  creditedRevenueUsd?: Record<string, number>,
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
      const previouslyCredited = creditedRevenueUsd?.[v.id] ?? cleanNum(v.accountedRevenueUsd);
      const unaccounted = cleanNum(v.revenueUsd) - previouslyCredited;
      if (unaccounted > 0) {
        foldRevenue(unaccounted);
        v.accountedRevenueUsd = cleanNum(v.revenueUsd);
        if (creditedRevenueUsd) creditedRevenueUsd[v.id] = v.accountedRevenueUsd;
        revenueAddedUsd += unaccounted;
        ensureLedger(book, v.category).earnedUsd += unaccounted;
      }
    }
  }

  if (creditedRevenueUsd) {
    const byCategory: Record<string, number> = {};
    for (const v of book.ventures) {
      byCategory[v.category] = (byCategory[v.category] ?? 0) + (creditedRevenueUsd[v.id] ?? 0);
    }
    for (const [category, credited] of Object.entries(byCategory)) {
      const ledger = ensureLedger(book, category);
      ledger.earnedUsd = Math.max(ledger.earnedUsd, credited);
    }
  }

  return { activated, rejected, revenueAddedUsd, newlyAutonomous };
}

/** Days a live venture may run without revenue before the monitor flags it due
 * for the kill decision (matches the agents' usual 60-day kill criterion). */
export const DEFAULT_KILL_DAYS = 60;

export function findVenture(book: VentureBook, id: string): Venture | undefined {
  return book.ventures.find((v) => v.id === id);
}

export interface MarkLiveResult {
  ok: boolean;
  reason?: string;
  venture?: Venture;
}

/** The human pressed "mark live": the venture is now selling in the real world.
 * Sets it active, records the public URL and the moment it went live (which starts
 * the kill-criteria clock) and ticks the category's autonomy ledger the first time.
 * Re-marking an already-live venture just updates the URL. */
export function markLive(
  book: VentureBook,
  id: string,
  liveUrl: string,
  cycle: number,
  at: string,
  autonomyThreshold = 10,
): MarkLiveResult {
  const v = findVenture(book, id);
  if (!v) return { ok: false, reason: `no venture with id ${id}` };
  if ((v.pumpToken || v.nftAsset || v.splToken) && v.status === 'proposed') {
    return { ok: false, reason: 'approve on-chain metadata in ventures.json before marking this venture live' };
  }
  const url =
    typeof liveUrl === 'string' && /^https?:\/\//i.test(liveUrl.trim())
      ? liveUrl.trim().slice(0, 400)
      : undefined;
  const firstTime = v.status !== 'active';
  v.status = 'active';
  if (url) v.liveUrl = url;
  if (firstTime || !v.listedAt) {
    v.listedAt = at;
    v.decidedAtCycle = cycle;
    const entry = ensureLedger(book, v.category);
    entry.approved += 1;
    if (!entry.autoEligible && entry.approved >= autonomyThreshold) entry.autoEligible = true;
  }
  return { ok: true, venture: v };
}

/** Update one live venture's monitor observation (pure). `reachable` is the
 * result of the loop's URL ping; daysLive/killDue are derived from listedAt. */
export function updateVentureMonitor(
  v: Venture,
  reachable: boolean,
  nowMs: number,
  killDays = DEFAULT_KILL_DAYS,
): void {
  const listedMs = v.listedAt ? Date.parse(v.listedAt) : NaN;
  const daysLive = Number.isFinite(listedMs) ? Math.max(0, Math.floor((nowMs - listedMs) / 86400000)) : 0;
  const hasRevenue = cleanNum(v.revenueUsd) > 0;
  const killDue = daysLive >= killDays && !hasRevenue;
  v.monitor = {
    lastCheckedAt: new Date(nowMs).toISOString(),
    reachable,
    daysLive,
    killDue,
    note: killDue
      ? `${daysLive}d live, no revenue — past the ${killDays}d kill window`
      : `${daysLive}d live${reachable ? '' : ' — listing UNREACHABLE'}`,
  };
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
    const mon =
      v.status === 'active' && v.monitor
        ? ` [${v.monitor.daysLive}d live${v.monitor.reachable ? '' : ', UNREACHABLE'}${v.monitor.killDue ? ', KILL-DUE' : ''}]`
        : '';
    return `${v.id} [${STATUS_LABEL[v.status]}] (${v.category}) ${v.title}${money}${mon}`;
  });
  const auto = Object.entries(book.ledger)
    .filter(([, e]) => e.autoEligible)
    .map(([c]) => c);
  if (auto.length > 0) lines.push(`autonomy-earned categories: ${auto.join(', ')}`);
  const waiting = openProposalCount(book);
  lines.push(`${waiting}/${MAX_OPEN_PROPOSALS} proposals awaiting your approval; active ventures do not count against this queue.`);
  const crowded = Object.entries(
    book.ventures.filter((v) => ['proposed', 'approved', 'active'].includes(v.status))
      .reduce<Record<string, number>>((a, v) => ({ ...a, [v.category]: (a[v.category] ?? 0) + 1 }), {}),
  ).filter(([, count]) => count >= MAX_LIVE_PER_CATEGORY).map(([category]) => category);
  if (crowded.length) lines.push(`category slots full: ${crowded.join(', ')}; research a different user need or protocol.`);
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
