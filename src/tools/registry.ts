import type { Connection } from '@solana/web3.js';
import type { Config } from '../config.js';
import type { Market } from '../market.js';
import type { PriceMap } from '../marketdata.js';
import type { RevenueAdapter } from '../revenue/adapter.js';
import type { Signer } from '../solana/signer.js';
import type { AutomatonState, Tier } from '../types.js';
import type { TierPolicy } from '../tiers.js';
import type { VentureBook } from '../ventures/types.js';

/**
 * Pluggable tool registry. Each tool declares a name, a description, an input
 * hint (surfaced to the LLM), and `movesValue` — true if executing it results
 * in an on-chain transaction. The loop only ever offers the agent the tools its
 * current tier allows.
 */

export interface ToolContext {
  connection: Connection;
  cfg: Config;
  state: AutomatonState;
  signer: Signer;
  /** legacy modeled market/revenue seam — unused by the trading loop. */
  market?: Market;
  revenue?: RevenueAdapter;
  /** real market prices this cycle (USD/unit), for the trade tool. */
  prices: PriceMap;
  /** gross-exposure cap in USD for THIS cycle (the SOL cap × live SOL price). */
  maxGrossExposureUsd: number;
  tier: Tier;
  policy: TierPolicy;
  cycle: number;
  /** the venture pipeline for this cycle, owned by the loop. The propose_venture
   * tool mutates it; the loop persists it once at the end of the cycle. */
  ventureBook?: VentureBook;
}

export interface ToolResult {
  /** short, human-readable summary of what happened. */
  summary: string;
  /** SOL earned this action, in lamports (0 if none). */
  revenueLamports?: number;
  /** whether a paid task was completed (feeds the score). */
  taskCompleted?: boolean;
  /** on-chain signatures produced by the action. */
  signatures?: string[];
  /** whether SOUL.md was rewritten. */
  soulUpdated?: boolean;
  /** whether the agent adjusted its market exposure this cycle (feeds score). */
  traded?: boolean;
  /** free-form note recorded in the journal entry. */
  note?: string;
}

export interface Tool {
  name: string;
  description: string;
  /** true if executing this tool proposes/produces an on-chain transaction. */
  movesValue: boolean;
  /** short description of the accepted input, shown to the LLM. */
  inputHint: string;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Only the tools whose names are allowed by the given tier policy. */
  availableFor(policy: TierPolicy): Tool[] {
    return policy.tools
      .map((n) => this.tools.get(n))
      .filter((t): t is Tool => t !== undefined);
  }
}
