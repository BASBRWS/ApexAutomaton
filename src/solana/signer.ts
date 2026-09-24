import fs from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadConfig, solToLamports, type Config } from '../config.js';
import { KILL_FILE } from '../paths.js';
import { saveState } from '../state.js';
import type { AutomatonState, SignedTxResult, TransferProposal } from '../types.js';
import { assertDevnetConnection, buildTransfer, buildMemoOnly, sendTransfer } from './wallet.js';

/**
 * signer.ts — the ONE place a private key is ever loaded. It contains NO LLM
 * call. It validates every proposed transfer against policy (allowlist + caps +
 * kill switch) and only then signs, sends, and confirms. The growth objective
 * cannot reach around any of this: policy is checked in code, not in a prompt.
 */

// --------------------------------------------------------------------------
// Kill switch
// --------------------------------------------------------------------------

/** The kill switch is engaged if the env flag is set OR a state/KILL file
 * exists. The agent cannot create or delete the KILL file (constitution +
 * filesystem are operator-owned), so it cannot reason around it. */
export function isKillSwitchEngaged(cfg: Config): boolean {
  if (cfg.rails.killSwitch) return true;
  try {
    return fs.existsSync(KILL_FILE);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Pure policy evaluation (unit-tested without any chain or key access)
// --------------------------------------------------------------------------

export interface PolicyInput {
  proposal: TransferProposal;
  /** allowed destinations (base58). */
  allowlist: string[];
  perTxCapLamports: number;
  dailyCapLamports: number;
  maxTxPerCycle: number;
  maxTxPerDay: number;
  /** transfers already signed this cycle. */
  cycleTxCount: number;
  /** transfers already signed today. */
  dailyTxCount: number;
  /** lamports already spent today. */
  dailyLamportsSpent: number;
  killSwitchEngaged: boolean;
}

export interface PolicyDecision {
  ok: boolean;
  reason: string;
}

/**
 * The heart of the safety rails. Returns a decision; NEVER throws. Rejects, in
 * order: kill switch, malformed amount, per-tx cap, allowlist, per-cycle count,
 * per-day count, daily cumulative cap. Caps and allowlist override everything.
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { proposal } = input;

  if (input.killSwitchEngaged) {
    return { ok: false, reason: 'kill switch engaged — no transfers permitted' };
  }

  if (!Number.isFinite(proposal.lamports) || proposal.lamports <= 0) {
    return { ok: false, reason: `invalid amount: ${proposal.lamports} lamports` };
  }
  if (!Number.isInteger(proposal.lamports)) {
    return { ok: false, reason: `amount must be integer lamports: ${proposal.lamports}` };
  }

  if (proposal.lamports > input.perTxCapLamports) {
    return {
      ok: false,
      reason: `per-tx cap exceeded: ${proposal.lamports} > ${input.perTxCapLamports} lamports`,
    };
  }

  if (!input.allowlist.includes(proposal.to)) {
    return { ok: false, reason: `destination not on allowlist: ${proposal.to}` };
  }

  if (input.cycleTxCount >= input.maxTxPerCycle) {
    return {
      ok: false,
      reason: `per-cycle tx cap reached: ${input.cycleTxCount}/${input.maxTxPerCycle}`,
    };
  }

  if (input.dailyTxCount >= input.maxTxPerDay) {
    return {
      ok: false,
      reason: `daily tx cap reached: ${input.dailyTxCount}/${input.maxTxPerDay}`,
    };
  }

  if (input.dailyLamportsSpent + proposal.lamports > input.dailyCapLamports) {
    return {
      ok: false,
      reason:
        `daily spend cap exceeded: ${input.dailyLamportsSpent} + ${proposal.lamports} > ` +
        `${input.dailyCapLamports} lamports`,
    };
  }

  return { ok: true, reason: 'ok' };
}

/** Thrown when the signer refuses a proposal. */
export class PolicyError extends Error {
  constructor(reason: string) {
    super(`signer rejected transfer: ${reason}`);
    this.name = 'PolicyError';
  }
}

// --------------------------------------------------------------------------
// Keypair loading (the ONLY place this happens)
// --------------------------------------------------------------------------

/** Parse an AGENT_KEYPAIR value: base58 string OR JSON array of bytes. */
function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed) as number[];
    return Uint8Array.from(arr);
  }
  return bs58.decode(trimmed);
}

function loadAgentKeypair(cfg: Config): Keypair {
  const raw = process.env.AGENT_KEYPAIR;
  if (!raw || raw.trim().length === 0) {
    throw new Error('AGENT_KEYPAIR is not set — the signer cannot operate.');
  }
  const keypair = Keypair.fromSecretKey(parseSecretKey(raw));
  const derived = keypair.publicKey.toBase58();
  if (derived !== cfg.agentPubkey) {
    throw new Error(
      `AGENT_KEYPAIR does not match AGENT_PUBKEY (derived ${derived}, expected ${cfg.agentPubkey}). ` +
        `Refusing to sign with a mismatched key.`,
    );
  }
  return keypair;
}

// --------------------------------------------------------------------------
// Signer
// --------------------------------------------------------------------------

export class Signer {
  private readonly keypair: Keypair;
  private cycleTxCount = 0;

  constructor(
    private readonly connection: Connection,
    private readonly cfg: Config,
    private readonly state: AutomatonState,
  ) {
    this.keypair = loadAgentKeypair(cfg);
  }

  /** Destinations the agent is allowed to pay: compute-provider, market, and
   * any known child accounts (registered in state before funding). */
  allowlist(): string[] {
    return [
      this.cfg.computeProviderPubkey,
      this.cfg.marketPubkey,
      ...this.state.children.map((c) => c.pubkey),
    ].filter((k): k is string => typeof k === 'string' && k.length > 0);
  }

  private buildPolicyInput(proposal: TransferProposal): PolicyInput {
    return {
      proposal,
      allowlist: this.allowlist(),
      perTxCapLamports: solToLamports(this.cfg.rails.perTxCapSol),
      dailyCapLamports: solToLamports(this.cfg.rails.dailyCapSol),
      maxTxPerCycle: this.cfg.rails.maxTxPerCycle,
      maxTxPerDay: this.cfg.rails.maxTxPerDay,
      cycleTxCount: this.cycleTxCount,
      dailyTxCount: this.state.caps.txCountToday,
      dailyLamportsSpent: this.state.caps.lamportsSpentToday,
      killSwitchEngaged: isKillSwitchEngaged(this.cfg),
    };
  }

  /** Check a proposal without signing (used by tools to see if an action is
   * even permitted before spending compute on it). */
  check(proposal: TransferProposal): PolicyDecision {
    if (this.state.pendingTransfer) {
      return { ok: false, reason: `unreconciled transfer ${this.state.pendingTransfer.signature}` };
    }
    return evaluatePolicy(this.buildPolicyInput(proposal));
  }

  /** Validate, sign, send, confirm. Throws {@link PolicyError} if rejected.
   * On success, updates the persisted cap accounting. */
  async signAndSend(proposal: TransferProposal): Promise<SignedTxResult> {
    await assertDevnetConnection(this.connection);
    const decision = this.check(proposal);
    if (!decision.ok) {
      throw new PolicyError(decision.reason);
    }

    const tx = buildTransfer({
      from: this.keypair.publicKey,
      to: new PublicKey(proposal.to),
      lamports: proposal.lamports,
      memo: proposal.memo,
    });

    const signature = await sendTransfer(this.connection, tx, [this.keypair], (signed) => {
      this.state.pendingTransfer = {
        signature: signed, to: proposal.to, lamports: proposal.lamports,
        at: new Date().toISOString(),
      };
      saveState(this.state);
    });

    // Update caps only after a confirmed send.
    this.cycleTxCount += 1;
    this.state.caps.txCountToday += 1;
    this.state.caps.lamportsSpentToday += proposal.lamports;
    delete this.state.pendingTransfer;
    saveState(this.state);

    return { signature, lamports: proposal.lamports, to: proposal.to };
  }

  /**
   * On-chain proof-of-life: a memo-only transaction. It moves NO value, so it is
   * not a transfer and does not touch the allowlist or spend caps — but it still
   * respects the kill switch. This lands a real, confirmed devnet transaction on
   * the agent's own address (visible in a block explorer) without ever creating
   * or funding a destination account, so it cannot hit a rent-exemption error.
   * Best-effort: the caller treats a throw as non-fatal.
   */
  async proofOfLife(memo: string): Promise<SignedTxResult> {
    await assertDevnetConnection(this.connection);
    if (isKillSwitchEngaged(this.cfg)) {
      throw new PolicyError('kill switch engaged — no proof-of-life');
    }
    const tx = buildMemoOnly({ feePayer: this.keypair.publicKey, memo });
    const signature = await sendTransfer(this.connection, tx, [this.keypair]);
    return { signature, lamports: 0, to: this.cfg.agentPubkey };
  }
}

/** Convenience for scripts/tests that want a signer with a fresh config. */
export function makeSigner(connection: Connection, state: AutomatonState): Signer {
  return new Signer(connection, loadConfig(), state);
}
