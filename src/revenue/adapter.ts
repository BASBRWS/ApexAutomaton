/**
 * Phase 2 — the revenue seam. A `RevenueAdapter` is anything that can make the
 * agent earn. The market adapter (devnet payouts) is the Phase 1 default; the
 * off-chain adapter is a scaffold for earning from a REAL outside source while
 * still SETTLING on devnet (never real value). Both declare `movesValue = true`
 * because earning results in an on-chain transaction.
 */

export interface EarnResult {
  /** SOL received, in lamports. */
  lamports: number;
  /** the settling on-chain signature. */
  signature: string;
  /** id of the task that was completed. */
  taskId: string;
  /** which adapter produced this. */
  adapter: string;
}

export interface RevenueAdapter {
  readonly name: string;
  /** true if earning produces an on-chain transaction. */
  readonly movesValue: boolean;
  /** Complete a task (by id, or the adapter's default) and return the payout. */
  earn(taskId: string | undefined): Promise<EarnResult>;
}
