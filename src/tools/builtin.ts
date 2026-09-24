import { solToLamports } from '../config.js';
import { writeSoul } from '../soul.js';
import {
  applyOrders,
  applyPortfolio,
  equityUsd as deskEquityUsd,
  setStake,
  stakedUsdOf,
  summarizeDesk,
  weightsToOrders,
  type Order,
} from '../trading/desk.js';
import type { TransferProposal } from '../types.js';
import { addProposal, type ProposalInput } from '../ventures/store.js';
import { ToolRegistry, type Tool } from './registry.js';

/**
 * The agent's tools:
 *  - `trade`       — set desired exposures (long/short/flat) across the tradable
 *                    assets. This is the ONLY way to grow the book; the real
 *                    market then decides whether it worked. No self-grading.
 *  - `write_journal` — records a note for the audit trail.
 *  - `reflect`     — rewrites SOUL.md (the agent's own file).
 *  - `rest`        — does nothing this cycle (still pays the compute burn, so
 *                    the book bleeds — resting is slow death).
 *
 * `transfer` is an optional Phase 2 value-mover (NORMAL+, PHASE2_TOOLS_ENABLED),
 * fully policy-gated by the signer.
 */

const trade: Tool = {
  name: 'trade',
  description:
    'Set your desired net exposure per asset, in USD, at the current real price ' +
    '(positive = long, negative = short, 0 = flat/close). The book is marked to ' +
    'the real market every cycle, so the market — not you — decides if it worked. ' +
    'You have full freedom of strategy within the tradable assets and the gross ' +
    'exposure cap. Resting in cash avoids market risk but still burns compute.',
  movesValue: false,
  inputHint:
    '{ "orders": [ { "asset": "BTC", "targetUsd": 200 }, { "asset": "ETH", "targetUsd": -100 } ] }',
  async execute(input, ctx) {
    const rawOrders = Array.isArray(input.orders) ? input.orders : [];
    const orders: Order[] = rawOrders
      .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === 'object')
      .map((o) => ({ asset: String(o.asset ?? ''), targetUsd: Number(o.targetUsd) }));

    if (orders.length === 0) {
      return { summary: 'trade called with no orders — held current book', note: 'no orders' };
    }

    const outcomes = applyOrders(ctx.state.desk, orders, {
      prices: ctx.prices,
      tradableAssets: ctx.cfg.trading.assets,
      maxGrossExposureUsd: ctx.maxGrossExposureUsd,
      allowShort: ctx.cfg.trading.allowShort,
      feeBps: ctx.cfg.trading.feeBps,
      spreadBps: ctx.cfg.trading.spreadBps,
      slippageBps: ctx.cfg.trading.slippageBps,
    });
    const applied = outcomes.filter((o) => o.ok);
    const rejected = outcomes.filter((o) => !o.ok);

    const summaryParts = applied.map((o) => `${o.order.asset}->$${o.order.targetUsd}`);
    const rejNote = rejected.map((o) => `${o.order.asset}: ${o.reason}`).join('; ');

    return {
      summary:
        (applied.length > 0 ? `set ${summaryParts.join(', ')}` : 'no orders applied') +
        (rejected.length > 0 ? ` (rejected: ${rejected.length})` : ''),
      traded: applied.length > 0,
      note:
        `book after: ${summarizeDesk(ctx.state.desk, ctx.prices).replace(/\n/g, ' | ')}` +
        (rejNote ? ` || rejected: ${rejNote}` : ''),
    };
  },
};

const rebalance: Tool = {
  name: 'rebalance',
  description:
    'Set your WHOLE portfolio at once as target WEIGHTS — fractions of your ' +
    'current equity per asset (positive = long, negative = short, omitted = flat). ' +
    'e.g. {"BTC":0.5,"ETH":-0.25} means 50% long BTC, 25% short ETH, rest cash. ' +
    'Weights that breach the gross-exposure cap are rejected. Great for expressing ' +
    'a diversified allocation in one move.',
  movesValue: false,
  inputHint: '{ "weights": { "BTC": 0.5, "ETH": -0.25, "SOL": 0.2 } }',
  async execute(input, ctx) {
    const raw =
      input.weights && typeof input.weights === 'object' && !Array.isArray(input.weights)
        ? (input.weights as Record<string, unknown>)
        : {};
    const weights: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n)) weights[k] = n;
    }
    if (Object.keys(weights).length === 0) {
      return { summary: 'rebalance called with no weights — held current book', note: 'no weights' };
    }
    const equity = deskEquityUsd(ctx.state.desk, ctx.prices);
    const orders = weightsToOrders(ctx.cfg.trading.assets, weights, equity);
    const outcomes = applyPortfolio(ctx.state.desk, orders, {
      prices: ctx.prices,
      tradableAssets: ctx.cfg.trading.assets,
      maxGrossExposureUsd: ctx.maxGrossExposureUsd,
      allowShort: ctx.cfg.trading.allowShort,
      feeBps: ctx.cfg.trading.feeBps,
      spreadBps: ctx.cfg.trading.spreadBps,
      slippageBps: ctx.cfg.trading.slippageBps,
    });
    const rejected = outcomes.filter((o) => !o.ok);
    return {
      summary:
        `rebalanced to ${Object.keys(weights).length} target weights` +
        (rejected.length ? ` (rejected ${rejected.length})` : ''),
      traded: outcomes.some((o) => o.ok),
      note: `book after: ${summarizeDesk(ctx.state.desk, ctx.prices).replace(/\n/g, ' | ')}`,
    };
  },
};

const stake: Tool = {
  name: 'stake',
  description:
    'Park paper capital in a modeled-yield sleeve (default 0% APY). ' +
    'The configured rate is simulated and accrued by elapsed time. ' +
    'Set the TOTAL USD you want staked (0 unstakes everything back to cash). Staked ' +
    'capital is not exposed to crypto prices and is not available for trading until ' +
    'you unstake it. A low-risk way to survive — but at a small book the yield is ' +
    'tiny next to the compute burn, so it only truly sustains you once the book is large.',
  movesValue: false,
  inputHint: '{ "targetUsd": 100 }',
  async execute(input, ctx) {
    const targetUsd = typeof input.targetUsd === 'number' ? input.targetUsd : Number(input.targetUsd);
    if (!Number.isFinite(targetUsd)) {
      return { summary: 'stake: invalid targetUsd', note: 'bad stake input' };
    }
    const before = stakedUsdOf(ctx.state.desk);
    const res = setStake(ctx.state.desk, targetUsd);
    if (!res.ok) {
      return { summary: `stake rejected: ${res.reason}`, note: `stake rejected: ${res.reason}` };
    }
    const after = stakedUsdOf(ctx.state.desk);
    const verb = after >= before ? 'staked' : 'unstaked';
    return {
      summary: `${verb}: yield sleeve now $${after.toFixed(2)} (@ ${(ctx.cfg.trading.yieldApy * 100).toFixed(1)}% APY)`,
      traded: Math.abs(after - before) > 1e-9,
      note: `book after: ${summarizeDesk(ctx.state.desk, ctx.prices).replace(/\n/g, ' | ')}`,
    };
  },
};

const writeJournal: Tool = {
  name: 'write_journal',
  description:
    'Record a short note in your append-only journal (e.g. an observation or a ' +
    'plan). Moves no value. Use sparingly — it still costs a cycle of compute.',
  movesValue: false,
  inputHint: '{ "note": "text to record" }',
  async execute(input) {
    const note = typeof input.note === 'string' ? input.note.slice(0, 500) : '';
    return {
      summary: note ? `journalled: ${note.slice(0, 80)}` : 'journalled (empty note)',
      note: note || 'empty note',
    };
  },
};

const reflect: Tool = {
  name: 'reflect',
  description:
    'Rewrite your SOUL.md — your evolving strategy and identity. Provide the ' +
    'FULL new contents. Moves no value. Only worth doing when you have a real ' +
    'lesson to encode.',
  movesValue: false,
  inputHint: '{ "soul": "full new markdown contents of SOUL.md" }',
  async execute(input) {
    const soul = typeof input.soul === 'string' ? input.soul : '';
    if (soul.trim().length === 0) {
      return { summary: 'reflect called with empty soul — no change', note: 'no-op reflect' };
    }
    writeSoul(soul);
    return { summary: 'rewrote SOUL.md', soulUpdated: true, note: 'soul updated' };
  },
};

const proposeVenture: Tool = {
  name: 'propose_venture',
  description:
    'Reach beyond trading into the REAL economy: propose ONE concrete, LEGAL ' +
    'money-making venture and BUILD its deliverable now. Scan broadly — a digital ' +
    'product you can create (template, prompt-pack, e-book, tool), a piece of ' +
    'content, a service, an arbitrage — any legal category. You must actually ' +
    'produce the deliverable (the draft/plan/copy/code), not just an idea. It goes ' +
    'into an approval queue: a human takes the one step you legally cannot (open the ' +
    'account, accept the platform terms, connect payments, publish, ship), then real ' +
    'revenue they report is folded into your book. Never propose anything that breaks ' +
    'a platform’s terms, impersonates a person or brand, fakes reviews, or spams. ' +
    'Keep at most a few proposals waiting; iterate and kill rather than pile up.',
  movesValue: false,
  inputHint:
    '{ "category": "digital-product", "title": "...", "thesis": "why it earns, legally", ' +
    '"deliverable": "the ACTUAL drafted product/plan/copy/code", "humanAction": "one-line ' +
    'summary of the human step", "launchSteps": [ { "label": "Create a Gumroad account", "url": ' +
    '"https://gumroad.com/signup" }, { "label": "Connect payout", "url": ' +
    '"https://app.gumroad.com/settings/payments" }, { "label": "Create product + upload the file", ' +
    '"url": "https://app.gumroad.com/products/new" }, { "label": "Publish" } ], "estCostUsd": 0, ' +
    '"estRevenueUsd": 50, "killCriteria": "when to abandon it" }',
  async execute(input, ctx) {
    if (!ctx.ventureBook) {
      return { summary: 'propose_venture unavailable this cycle', note: 'no venture book in context' };
    }
    const proposal: ProposalInput = {
      category: str(input.category) || 'other',
      title: str(input.title),
      thesis: str(input.thesis),
      deliverable: str(input.deliverable),
      humanAction: str(input.humanAction),
      launchSteps: input.launchSteps,
      estCostUsd: Number(input.estCostUsd),
      estRevenueUsd: Number(input.estRevenueUsd),
      killCriteria: str(input.killCriteria),
    };
    const res = addProposal(ctx.ventureBook, proposal, ctx.cycle, new Date().toISOString());
    if (!res.ok || !res.venture) {
      return { summary: `venture not queued: ${res.reason}`, note: `venture rejected: ${res.reason}` };
    }
    const v = res.venture;
    return {
      summary: `proposed venture ${v.id} "${v.title}" (${v.category}) — awaiting your approval`,
      note: `venture ${v.id} queued: ${v.humanAction.slice(0, 120)}`,
    };
  },
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

const rest: Tool = {
  name: 'rest',
  description:
    'Do nothing this cycle. You still pay the compute burn, so resting shrinks ' +
    'your balance. Only rest when no tool can profitably be used.',
  movesValue: false,
  inputHint: '{}',
  async execute() {
    return { summary: 'rested (no action taken)', note: 'rested' };
  },
};

/** Phase 2 — value-moving, policy-gated. Off unless PHASE2_TOOLS_ENABLED. */
const transfer: Tool = {
  name: 'transfer',
  description:
    'Move SOL to an ALLOWLISTED account (compute-provider, market, or a known ' +
    'child). The signer rejects any other destination and any amount over the ' +
    'caps — you cannot move value outside the rails.',
  movesValue: true,
  inputHint: '{ "to": "<base58 pubkey>", "sol": <number>, "reason": "<why>", "memo"?: "<text>" }',
  async execute(input, ctx) {
    const to = typeof input.to === 'string' ? input.to : '';
    const solRaw = typeof input.sol === 'number' ? input.sol : Number(input.sol);
    const reason = typeof input.reason === 'string' ? input.reason : 'agent transfer';
    const memo = typeof input.memo === 'string' ? input.memo : undefined;

    if (!to || !Number.isFinite(solRaw) || solRaw <= 0) {
      return { summary: 'transfer: invalid input', note: 'bad transfer input' };
    }

    const proposal: TransferProposal = { to, lamports: solToLamports(solRaw), reason, memo };
    // Check first so a rejection is a clean journal note rather than a throw.
    const decision = ctx.signer.check(proposal);
    if (!decision.ok) {
      return {
        summary: `transfer rejected by policy: ${decision.reason}`,
        note: `transfer rejected: ${decision.reason}`,
      };
    }
    const res = await ctx.signer.signAndSend(proposal);
    return {
      summary: `transferred ${solRaw} SOL to ${to}`,
      signatures: [res.signature],
      transfer: res,
      note: `transfer: ${reason}`,
    };
  },
};

export function buildRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(trade)
    .register(rebalance)
    .register(stake)
    .register(writeJournal)
    .register(reflect)
    .register(proposeVenture)
    .register(rest)
    .register(transfer);
}

export const BUILTIN_TOOLS = [
  trade,
  rebalance,
  stake,
  writeJournal,
  reflect,
  proposeVenture,
  rest,
  transfer,
];
