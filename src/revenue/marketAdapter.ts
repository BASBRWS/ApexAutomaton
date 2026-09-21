import type { Config } from '../config.js';
import { findTask, type Market } from '../market.js';
import type { EarnResult, RevenueAdapter } from './adapter.js';

/**
 * The Phase 1 default revenue source: the modeled market pays the agent a real
 * devnet transfer for a completed task.
 */
export class MarketRevenueAdapter implements RevenueAdapter {
  readonly name = 'market';
  readonly movesValue = true;

  constructor(
    private readonly market: Market,
    private readonly cfg: Config,
  ) {}

  async earn(taskId: string | undefined): Promise<EarnResult> {
    const task = findTask(this.cfg, taskId);
    const payment = await this.market.payForCompletedTask(task);
    return {
      lamports: payment.lamports,
      signature: payment.signature,
      taskId: task.id,
      adapter: this.name,
    };
  }
}
