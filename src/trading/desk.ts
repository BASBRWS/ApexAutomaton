import type { PriceMap } from '../marketdata.js';

/**
 * desk.ts — a pure paper-trading book. The agent grows this against REAL prices;
 * no real assets or funds exist. Positions are marked to market every cycle, so
 * the book's equity just moves with the real market — nobody grades the agent,
 * the price does.
 *
 * Semantics are TARGET-based: an order says "I want $X of net exposure to this
 * asset" (negative = short, 0 = flat). The engine computes the trade to get
 * there at the current price and moves cash accordingly.
 */

export interface Position {
  /** signed units held (negative = short). */
  units: number;
  /** price at which the current position was (re)opened, for reporting. */
  entryPriceUsd: number;
}

export interface Desk {
  /** uninvested USD (may go negative = leverage/debt). */
  cashUsd: number;
  /** positions keyed by uppercase symbol. */
  positions: Record<string, Position>;
  /** starting book size, for net-PnL reporting. */
  capitalUsd: number;
  openedAtCycle: number;
}

export interface Order {
  asset: string;
  /** desired net exposure in USD (signed). 0 closes the position. */
  targetUsd: number;
}

export interface OrderOutcome {
  order: Order;
  ok: boolean;
  reason: string;
}

export interface ApplyContext {
  prices: PriceMap;
  tradableAssets: string[];
  maxGrossExposureUsd: number;
  allowShort: boolean;
}

export function initDesk(capitalUsd: number, cycle: number): Desk {
  return { cashUsd: capitalUsd, positions: {}, capitalUsd, openedAtCycle: cycle };
}

/**
 * An unfunded book: no cash, no capital baseline yet. The stake is denominated
 * in SOL, so it cannot be priced to USD until a real SOL price is known; the
 * loop funds this at genesis (its first priced cycle) via {@link fundDesk}.
 */
export function initUnfundedDesk(): Desk {
  return { cashUsd: 0, positions: {}, capitalUsd: 0, openedAtCycle: -1 };
}

/** Fund a genesis book with its USD capital baseline (the SOL stake, priced). */
export function fundDesk(desk: Desk, capitalUsd: number, cycle: number): Desk {
  return { ...desk, cashUsd: capitalUsd, capitalUsd, openedAtCycle: cycle };
}

/** True once the book has been funded at genesis (a real capital baseline set). */
export function isFunded(desk: Desk): boolean {
  return desk.openedAtCycle >= 0 && desk.capitalUsd > 0;
}

function markPrice(prices: PriceMap, asset: string, fallback: number): number {
  const p = prices[asset];
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : fallback;
}

export function positionValueUsd(desk: Desk, asset: string, prices: PriceMap): number {
  const pos = desk.positions[asset];
  if (!pos) return 0;
  return pos.units * markPrice(prices, asset, pos.entryPriceUsd);
}

/** Total book value in USD: cash plus the marked value of every position. */
export function equityUsd(desk: Desk, prices: PriceMap): number {
  let eq = desk.cashUsd;
  for (const asset of Object.keys(desk.positions)) {
    eq += positionValueUsd(desk, asset, prices);
  }
  return eq;
}

/** Sum of absolute position values — the capital the agent has at risk. */
export function grossExposureUsd(desk: Desk, prices: PriceMap): number {
  let gross = 0;
  for (const asset of Object.keys(desk.positions)) {
    gross += Math.abs(positionValueUsd(desk, asset, prices));
  }
  return gross;
}

export function netPnlUsd(desk: Desk, prices: PriceMap): number {
  return equityUsd(desk, prices) - desk.capitalUsd;
}

/** Move one asset's exposure to `targetUsd` at the current price (mutates). */
function setTarget(desk: Desk, asset: string, targetUsd: number, price: number): void {
  const prev = desk.positions[asset];
  const prevUnits = prev?.units ?? 0;
  const currentValue = prevUnits * price;
  const delta = targetUsd - currentValue; // >0 buys, <0 sells/shorts
  desk.cashUsd -= delta;
  const newUnits = targetUsd / price;
  if (Math.abs(newUnits) < 1e-12) {
    delete desk.positions[asset];
    return;
  }
  const signFlipOrOpen = prevUnits === 0 || Math.sign(prevUnits) !== Math.sign(newUnits);
  desk.positions[asset] = {
    units: newUnits,
    entryPriceUsd: signFlipOrOpen ? price : (prev?.entryPriceUsd ?? price),
  };
}

/**
 * Apply a set of target orders. Never throws. Each order is validated on its
 * own; an order that would breach the gross-exposure cap (given everything else
 * held) is rejected, not clamped. Returns the per-order outcomes.
 */
export function applyOrders(desk: Desk, orders: Order[], ctx: ApplyContext): OrderOutcome[] {
  const outcomes: OrderOutcome[] = [];
  const tradable = new Set(ctx.tradableAssets.map((a) => a.toUpperCase()));

  for (const raw of orders) {
    const asset = (raw.asset ?? '').toUpperCase();
    const targetUsd = Number(raw.targetUsd);
    const order: Order = { asset, targetUsd };

    if (!tradable.has(asset)) {
      outcomes.push({ order, ok: false, reason: `not a tradable asset: ${asset}` });
      continue;
    }
    const price = ctx.prices[asset];
    if (!(typeof price === 'number' && Number.isFinite(price) && price > 0)) {
      outcomes.push({ order, ok: false, reason: `no price for ${asset}` });
      continue;
    }
    if (!Number.isFinite(targetUsd)) {
      outcomes.push({ order, ok: false, reason: `invalid target: ${raw.targetUsd}` });
      continue;
    }
    if (targetUsd < 0 && !ctx.allowShort) {
      outcomes.push({ order, ok: false, reason: 'shorting is disabled' });
      continue;
    }

    // Prospective gross if we applied this order (other positions unchanged).
    let prospectiveGross = Math.abs(targetUsd);
    for (const other of Object.keys(desk.positions)) {
      if (other === asset) continue;
      prospectiveGross += Math.abs(positionValueUsd(desk, other, ctx.prices));
    }
    if (prospectiveGross > ctx.maxGrossExposureUsd + 1e-6) {
      outcomes.push({
        order,
        ok: false,
        reason: `gross exposure cap: ${prospectiveGross.toFixed(2)} > ${ctx.maxGrossExposureUsd} USD`,
      });
      continue;
    }

    setTarget(desk, asset, targetUsd, price);
    outcomes.push({ order, ok: true, reason: 'applied' });
  }
  return outcomes;
}

/**
 * Convert target portfolio WEIGHTS (fractions of equity, signed) into absolute
 * target-USD orders for every tradable asset. Assets not named get weight 0, so
 * a rebalance also flattens what you dropped. e.g. { BTC: 0.5, ETH: -0.25 }.
 */
export function weightsToOrders(
  tradableAssets: string[],
  weights: Record<string, number>,
  equityUsd: number,
): Order[] {
  const w: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) {
    const n = Number(v);
    if (Number.isFinite(n)) w[k.toUpperCase()] = n;
  }
  return tradableAssets.map((a) => ({
    asset: a.toUpperCase(),
    targetUsd: (w[a.toUpperCase()] ?? 0) * equityUsd,
  }));
}

/** A compact, human/LLM-readable snapshot of the book at the given prices. */
export function summarizeDesk(desk: Desk, prices: PriceMap): string {
  const lines: string[] = [];
  lines.push(`cash=$${desk.cashUsd.toFixed(2)}`);
  const assets = Object.keys(desk.positions);
  if (assets.length === 0) {
    lines.push('positions: (none — all in cash)');
  } else {
    for (const a of assets) {
      const pos = desk.positions[a]!;
      const price = markPrice(prices, a, pos.entryPriceUsd);
      const value = pos.units * price;
      lines.push(
        `${a}: ${value >= 0 ? 'long' : 'short'} $${Math.abs(value).toFixed(2)} ` +
          `(entry $${pos.entryPriceUsd.toFixed(2)}, now $${price.toFixed(2)})`,
      );
    }
  }
  lines.push(`equity=$${equityUsd(desk, prices).toFixed(2)} (net $${netPnlUsd(desk, prices).toFixed(2)})`);
  return lines.join('\n');
}
