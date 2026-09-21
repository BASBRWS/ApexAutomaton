import type { Config } from '../config.js';
import { findTask, type Market } from '../market.js';
import type { EarnResult, RevenueAdapter } from './adapter.js';

/**
 * Phase 2 SCAFFOLD — off-chain revenue adapter. Off by default.
 *
 * The intent: earn from a REAL outside source (an API job, a completed bounty,
 * a webhook confirmation, …) and then SETTLE the payout on devnet — so the
 * end-to-end loop stays proven at zero financial risk. Only the settlement is
 * modeled here (via the market); the real off-chain verification is a TODO.
 *
 * Guards:
 *  - refuses to run unless `OFFCHAIN_REVENUE_ENABLED` is set;
 *  - even when enabled, it only settles on devnet — there is deliberately no
 *    path that moves real value.
 */
export class OffchainRevenueAdapter implements RevenueAdapter {
  readonly name = 'offchain';
  readonly movesValue = true;

  constructor(
    private readonly cfg: Config,
    /** devnet settlement backend — the payout is still a devnet transfer. */
    private readonly market: Market,
  ) {}

  async earn(taskId: string | undefined): Promise<EarnResult> {
    if (!this.cfg.features.offchainRevenueEnabled) {
      throw new Error(
        'off-chain revenue adapter is disabled — set OFFCHAIN_REVENUE_ENABLED to enable the scaffold',
      );
    }

    // TODO(phase2): perform or verify the REAL off-chain work here.
    //   e.g. call an external API, confirm a delivered bounty, validate a
    //   signed receipt. Return early (no settlement) if the work is unverified.
    //   This MUST NOT move real value — settlement below stays on devnet.
    const verified = await verifyOffchainWork(taskId);
    if (!verified) {
      throw new Error('off-chain work not verified (scaffold: verification is a TODO)');
    }

    // Settlement remains on devnet, via the modeled market payout.
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

/** SCAFFOLD stub. Replace with a real check against an off-chain source. */
async function verifyOffchainWork(_taskId: string | undefined): Promise<boolean> {
  // Phase 2 placeholder: pretend the work is verified so the devnet settlement
  // path can be exercised. A real implementation returns false when the
  // off-chain deliverable is missing or invalid.
  return true;
}
