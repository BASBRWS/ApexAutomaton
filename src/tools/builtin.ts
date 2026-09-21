import { solToLamports } from '../config.js';
import { writeSoul } from '../soul.js';
import {
  applyOrders,
  equityUsd as deskEquityUsd,
  summarizeDesk,
  weightsToOrders,
  type Order,
} from '../trading/desk.js';
import type { TransferProposal } from '../types.js';
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
      maxGrossExposureUsd: ctx.cfg.trading.maxGrossExposureUsd,
      allowShort: ctx.cfg.trading.allowShort,
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
    const outcomes = applyOrders(ctx.state.desk, orders, {
      prices: ctx.prices,
      tradableAssets: ctx.cfg.trading.assets,
      maxGrossExposureUsd: ctx.cfg.trading.maxGrossExposureUsd,
      allowShort: ctx.cfg.trading.allowShort,
    });
    const rejected = outcomes.filter((o) => !o.ok);
    return {
      summary:
        `rebalanced to ${Object.keys(weights).length} target weights` +
        (rejected.length ? ` (rejected ${rejected.length})` : ''),
      traded: true,
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
      note: `transfer: ${reason}`,
    };
  },
};

export function buildRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(trade)
    .register(rebalance)
    .register(writeJournal)
    .register(reflect)
    .register(rest)
    .register(transfer);
}

export const BUILTIN_TOOLS = [trade, rebalance, writeJournal, reflect, rest, transfer];
