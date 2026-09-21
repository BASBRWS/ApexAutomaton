import bs58 from 'bs58';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { solToLamports, type Config } from './config.js';
import { buildTransfer, sendTransfer } from './solana/wallet.js';

/**
 * market.ts — models the "outside world". A separate devnet account pays the
 * agent SOL for completed tasks. This is the ONLY source of revenue: the agent
 * cannot call the faucet, so without the market there is no scarcity to
 * optimise against and nothing to grow.
 *
 * The market's secret key is loaded ONLY here, and only to sign inbound
 * payments to the agent. It is never exposed to the agent or the LLM.
 */

export interface MarketTask {
  id: string;
  title: string;
  description: string;
  /** payout in SOL for completing this task. */
  rewardSol: number;
}

/**
 * A small catalog of modeled tasks. Phase 1 keeps these abstract and safe: the
 * "work" is not real, only the payment is. Rewards default to the configured
 * flat reward so the growth-guard invariant (reward > cycle burn) holds; a
 * per-task multiplier lets some tasks be worth more without breaking that.
 */
export function taskCatalog(cfg: Config): MarketTask[] {
  const base = cfg.economy.marketTaskRewardSol;
  return [
    {
      id: 'label-batch',
      title: 'Label a batch of records',
      description: 'Classify a small modeled batch of records into categories.',
      rewardSol: base,
    },
    {
      id: 'summarize-doc',
      title: 'Summarize a document',
      description: 'Produce a short modeled summary of a supplied document.',
      rewardSol: base,
    },
    {
      id: 'extract-fields',
      title: 'Extract structured fields',
      description: 'Pull a set of modeled fields from semi-structured text.',
      rewardSol: base,
    },
  ];
}

export function findTask(cfg: Config, id: string | undefined): MarketTask {
  const catalog = taskCatalog(cfg);
  if (id) {
    const match = catalog.find((t) => t.id === id);
    if (match) return match;
  }
  // Default to the first task if none/unknown requested.
  return catalog[0]!;
}

function loadMarketKeypair(): Keypair {
  const raw = process.env.MARKET_KEYPAIR;
  if (!raw || raw.trim().length === 0) {
    throw new Error('MARKET_KEYPAIR is not set — the market cannot pay the agent.');
  }
  const trimmed = raw.trim();
  const secret = trimmed.startsWith('[')
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : bs58.decode(trimmed);
  return Keypair.fromSecretKey(secret);
}

export interface MarketPayment {
  signature: string;
  lamports: number;
  task: MarketTask;
}

export class Market {
  private readonly keypair: Keypair;

  constructor(
    private readonly connection: Connection,
    private readonly cfg: Config,
  ) {
    this.keypair = loadMarketKeypair();
    if (this.keypair.publicKey.toBase58() !== cfg.marketPubkey) {
      throw new Error(
        `MARKET_KEYPAIR does not match MARKET_PUBKEY ` +
          `(derived ${this.keypair.publicKey.toBase58()}, expected ${cfg.marketPubkey}).`,
      );
    }
  }

  /**
   * Pay the agent for a completed task — a REAL devnet transfer from the market
   * account to the agent wallet. Signed by the market, not the agent, so it is
   * outside the agent's signer policy (revenue is inbound).
   */
  async payForCompletedTask(task: MarketTask): Promise<MarketPayment> {
    const lamports = solToLamports(task.rewardSol);
    const tx = buildTransfer({
      from: this.keypair.publicKey,
      to: new PublicKey(this.cfg.agentPubkey),
      lamports,
      memo: `market:reward:${task.id}`,
    });
    const signature = await sendTransfer(this.connection, tx, [this.keypair]);
    return { signature, lamports, task };
  }
}
