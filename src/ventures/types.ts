/**
 * The Venture layer — the agent's reach into the REAL economy.
 *
 * The paper-trading book is a closed survival game against real prices. Ventures
 * are the opposite: the agent hunts BROADLY for any legal way to create real
 * value (a digital product, a piece of content, a service, an arbitrage — the
 * category is free-form on purpose), and it BUILDS the deliverable itself. What
 * it cannot do is cross the money/identity edge: opening an account, accepting a
 * platform's terms, connecting a payment rail, spending real money. Those steps
 * are legally a human's, so every venture waits in an APPROVAL QUEUE for exactly
 * one human decision. Approved ventures' real, reported revenue is then folded
 * back into the book — so the survival score becomes grounded in real value, not
 * only paper marks.
 */

export type VentureStatus =
  /** the agent created and built it; waiting for you at the money/identity edge. */
  | 'proposed'
  /** you approved it; the loop activates it on the next cycle. */
  | 'approved'
  /** live in the real world (you took the human action); may not be earning yet. */
  | 'active'
  /** ended — abandoned by you or the agent (see killCriteria). */
  | 'killed'
  /** you declined it. */
  | 'rejected';

/** The set of statuses a human sets by editing state/ventures.json (the queue). */
export const HUMAN_DECISION_STATUSES: VentureStatus[] = ['approved', 'rejected', 'killed'];

/** One concrete step the human must take at the money/identity edge, with a
 * direct link to the exact page for it where one exists (create the account,
 * connect payout, create + upload the product, publish). This is what turns
 * "approve" into a followable instruction. */
export interface LaunchStep {
  label: string;
  /** direct URL to the right page; http/https only. Omitted when no single page
   * applies (then the label carries the nav path). */
  url?: string;
}

/** What the agent's autonomous monitor observes each cycle for a LIVE venture.
 * It cannot read real sales without credentials, so it watches what it can: the
 * listing is reachable, how long it has been live, and the kill-criteria clock. */
export interface VentureMonitor {
  lastCheckedAt: string;
  /** the live URL responded (HTTP ok) this check. */
  reachable: boolean;
  /** whole days since listedAt. */
  daysLive: number;
  /** true once daysLive has reached the kill window with no reported revenue. */
  killDue: boolean;
  note?: string;
}

export interface Venture {
  id: string;
  createdAtCycle: number;
  at: string;
  /** free-form category (broad scanning), lowercased. e.g. "digital-product",
   * "content", "service", "arbitrage" — whatever the agent judges the venture is. */
  category: string;
  title: string;
  /** why this can make real money, legally. */
  thesis: string;
  /** the ACTUAL thing the agent produced this cycle: a draft, plan, copy, code,
   * a product outline — concrete enough that the human action is the only thing
   * left before it can earn. */
  deliverable: string;
  /** the exact step the human must take at the money/identity edge to launch it
   * (open the account, accept ToS, connect Stripe, publish, ship). A one-line
   * summary; `launchSteps` carries the full, linked checklist. */
  humanAction: string;
  /** the full launch checklist: each human step with a direct link to the right
   * page. This is the "instruction with links" surfaced in the dashboard popup. */
  launchSteps?: LaunchStep[];
  /** honest estimate of the human's out-of-pocket cost to launch, USD. */
  estCostUsd: number;
  /** honest estimate of revenue potential, USD. */
  estRevenueUsd: number;
  /** when to abandon it — a concrete, falsifiable condition. */
  killCriteria: string;
  status: VentureStatus;
  /** the public URL where it is selling, once the human has listed it live. */
  liveUrl?: string;
  /** ISO timestamp the human marked it live (starts the kill-criteria clock). */
  listedAt?: string;
  /** what the agent's autonomous monitor last observed for this live venture. */
  monitor?: VentureMonitor;
  /** real revenue reported for this venture so far, USD (a human edits this). */
  revenueUsd: number;
  /** revenue already folded into the book, so only deltas are added. */
  accountedRevenueUsd: number;
  /** cycle at which a human decision (approve/reject/kill) was applied. */
  decidedAtCycle?: number;
  note?: string;
  /** Operator-approved metadata for a Pump.fun devnet launch. The LLM cannot
   * alter this after approval; the signer only accepts a stored active venture. */
  pumpToken?: { name: string; symbol: string; uri: string; mint?: string; signature?: string };
  /** Approved Metaplex Core devnet asset metadata. The signer owns creation. */
  nftAsset?: { name: string; uri: string; asset?: string; signature?: string };
}

/** Per-category autonomy tracking. The "earn more autonomy" path: once a category
 * has enough clean approvals it becomes auto-eligible — a signal that this kind of
 * venture has proven itself and could later be trusted to go live with less (or no)
 * per-venture approval. Auto-activation itself stays a deliberate, later step. */
export interface AutonomyEntry {
  /** number of ventures of this category a human has approved. */
  approved: number;
  /** number a human has rejected (context for the trust signal). */
  rejected: number;
  /** real revenue booked in this category, USD. */
  earnedUsd: number;
  /** true once `approved` has reached the autonomy threshold. */
  autoEligible: boolean;
}

/** The persisted venture pipeline (state/ventures.json). Committed each cycle
 * alongside the rest of state/, so the queue is plain git — you approve by
 * editing a status, and the diff is the audit trail. */
export interface VentureBook {
  ventures: Venture[];
  ledger: Record<string, AutonomyEntry>;
  /** monotonic id counter. */
  seq: number;
}
