import fs from 'node:fs';
import { createRequire } from 'node:module';
import bs58 from 'bs58';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createV2, mplCore } from '@metaplex-foundation/mpl-core';
import { createSignerFromKeypair, generateSigner } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { loadConfig, solToLamports, type Config } from '../config.js';
import { KILL_FILE } from '../paths.js';
import { saveState } from '../state.js';
import type { AutomatonState, SignedTxResult, TransferProposal } from '../types.js';
import type { Venture } from '../ventures/types.js';
import { validNftAsset, validPumpToken, validSplToken } from '../ventures/store.js';
import { buildSplMintTx, splMintSpace } from './spl-mint.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
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
    super(`signer rejected action: ${reason}`);
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

  /** Mint one SOL-paired Pump.fun token for an approved venture. The signer
   * constructs the instruction itself; no LLM-supplied instruction is accepted.
   * Preflight checks the wallet debit against both protocol and general caps. */
  async createPumpToken(venture: Venture): Promise<{ mint: string; signature: string; lamports: number }> {
    await assertDevnetConnection(this.connection);
    if (!this.cfg.pump.enabled) throw new PolicyError('Pump.fun devnet feature disabled');
    if (venture.status !== 'active' || !venture.pumpToken) throw new PolicyError('venture is not approved for a Pump.fun launch');
    const metadata = validPumpToken(venture.pumpToken);
    if (!metadata) throw new PolicyError('invalid approved token metadata');
    if (venture.pumpToken.mint || this.state.pumpMints?.[venture.id]) throw new PolicyError('venture already minted');
    if (this.state.pendingTransfer) throw new PolicyError('unreconciled signed transaction');
    const date = new Date().toISOString().slice(0, 10);
    if (Object.values(this.state.pumpMints ?? {}).some((mint) => mint.at.startsWith(date))) {
      throw new PolicyError('one Pump.fun launch per UTC day');
    }
    // The SDK's ESM build imports CommonJS Anchor named exports on Node 20.
    // Its published CommonJS entry works on the supported Node versions.
    const pumpRequire = createRequire(import.meta.url);
    const { PUMP_PROGRAM_ID, PUMP_SDK } = pumpRequire('@pump-fun/pump-sdk') as typeof import('@pump-fun/pump-sdk');
    const mint = Keypair.generate();
    const ix = await PUMP_SDK.createV2Instruction({
      mint: mint.publicKey, user: this.keypair.publicKey, creator: this.keypair.publicKey,
      ...metadata, mayhemMode: false, holderReward: false,
    });
    if (!ix.programId.equals(PUMP_PROGRAM_ID) ||
        ix.keys.some((k) => k.isSigner && !k.pubkey.equals(mint.publicKey) && !k.pubkey.equals(this.keypair.publicKey))) {
      throw new PolicyError('unexpected Pump.fun instruction or signer');
    }
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix);
    tx.feePayer = this.keypair.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const balanceBefore = await this.connection.getBalance(this.keypair.publicKey, 'confirmed');
    const simulation = await this.connection.simulateTransaction(tx, [this.keypair, mint], [this.keypair.publicKey]);
    if (simulation.value.err) throw new PolicyError(`Pump.fun simulation failed: ${JSON.stringify(simulation.value.err)}`);
    const balanceAfter = simulation.value.accounts?.[0]?.lamports;
    if (typeof balanceAfter !== 'number' || balanceAfter > balanceBefore) {
      throw new PolicyError('Pump.fun simulation did not return a usable wallet balance');
    }
    // Reserve 100,000 lamports for network fees and fee variation. The program is fixed,
    // and an uncertain confirmation always blocks new value actions.
    const debit = balanceBefore - balanceAfter + 100_000;
    const decision = evaluatePolicy({
      ...this.buildPolicyInput({ to: PUMP_PROGRAM_ID.toBase58(), lamports: debit, reason: `Pump.fun ${venture.id}` }),
      allowlist: [PUMP_PROGRAM_ID.toBase58()],
    });
    if (!decision.ok) throw new PolicyError(decision.reason);
    if (debit > solToLamports(this.cfg.pump.maxCreateSol)) throw new PolicyError('Pump.fun creation exceeds protocol cap');
    const signature = await sendTransfer(this.connection, tx, [this.keypair, mint], (signed) => {
      this.state.pendingTransfer = {
        signature: signed, to: PUMP_PROGRAM_ID.toBase58(), lamports: debit, at: new Date().toISOString(),
      };
      saveState(this.state);
    });
    this.state.caps.txCountToday += 1;
    this.state.caps.lamportsSpentToday += debit;
    this.cycleTxCount += 1;
    this.state.pumpMints ??= {};
    this.state.pumpMints[venture.id] = { mint: mint.publicKey.toBase58(), signature, at: new Date().toISOString() };
    delete this.state.pendingTransfer;
    saveState(this.state);
    return { mint: mint.publicKey.toBase58(), signature, lamports: debit };
  }

  /** Create exactly one Metaplex Core asset for an operator-approved venture.
   * The SDK only constructs an instruction; web3.js signs through this class. */
  async createNftAsset(venture: Venture): Promise<{ asset: string; signature: string; lamports: number }> {
    await assertDevnetConnection(this.connection);
    if (!this.cfg.nft.enabled) throw new PolicyError('NFT devnet feature disabled');
    if (venture.status !== 'active' || !venture.nftAsset) throw new PolicyError('venture is not approved for NFT creation');
    const metadata = validNftAsset(venture.nftAsset);
    if (!metadata) throw new PolicyError('invalid approved NFT metadata');
    if (venture.nftAsset.asset || this.state.nftAssets?.[venture.id]) throw new PolicyError('venture already minted');
    if (this.state.pendingTransfer) throw new PolicyError('unreconciled signed transaction');

    const program = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
    const umi = createUmi(this.cfg.rpcUrl).use(mplCore());
    const payer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(this.keypair.secretKey));
    const assetSigner = generateSigner(umi);
    const builder = createV2(umi, { ...metadata, asset: assetSigner, payer, authority: payer });
    if (builder.items.length !== 1) throw new PolicyError('unexpected NFT instruction count');
    const generated = builder.items[0]!.instruction;
    if (String(generated.programId) !== program.toBase58() ||
        generated.keys.some((key) => key.isSigner &&
          String(key.pubkey) !== this.keypair.publicKey.toBase58() && String(key.pubkey) !== String(assetSigner.publicKey))) {
      throw new PolicyError('unexpected NFT program or signer');
    }
    const ix = new TransactionInstruction({
      programId: program,
      keys: generated.keys.map((key) => ({ pubkey: new PublicKey(String(key.pubkey)), isSigner: key.isSigner, isWritable: key.isWritable })),
      data: Buffer.from(generated.data),
    });
    const assetKeypair = Keypair.fromSecretKey(assetSigner.secretKey);
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ix);
    tx.feePayer = this.keypair.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const balanceBefore = await this.connection.getBalance(this.keypair.publicKey, 'confirmed');
    const simulation = await this.connection.simulateTransaction(tx, [this.keypair, assetKeypair], [this.keypair.publicKey]);
    if (simulation.value.err) throw new PolicyError(`NFT simulation failed: ${JSON.stringify(simulation.value.err)}`);
    const balanceAfter = simulation.value.accounts?.[0]?.lamports;
    if (typeof balanceAfter !== 'number' || balanceAfter > balanceBefore) {
      throw new PolicyError('NFT simulation did not return a usable wallet balance');
    }
    const debit = balanceBefore - balanceAfter + 100_000;
    const destination = program.toBase58();
    const decision = evaluatePolicy({
      ...this.buildPolicyInput({ to: destination, lamports: debit, reason: `NFT ${venture.id}` }),
      allowlist: [destination],
    });
    if (!decision.ok) throw new PolicyError(decision.reason);
    if (debit > solToLamports(this.cfg.nft.maxCreateSol)) throw new PolicyError('NFT creation exceeds protocol cap');
    const signature = await sendTransfer(this.connection, tx, [this.keypair, assetKeypair], (signed) => {
      this.state.pendingTransfer = { signature: signed, to: destination, lamports: debit, at: new Date().toISOString() };
      saveState(this.state);
    });
    this.cycleTxCount += 1;
    this.state.caps.txCountToday += 1;
    this.state.caps.lamportsSpentToday += debit;
    this.state.nftAssets ??= {};
    this.state.nftAssets[venture.id] = { asset: assetKeypair.publicKey.toBase58(), signature, at: new Date().toISOString() };
    delete this.state.pendingTransfer;
    saveState(this.state);
    return { asset: assetKeypair.publicKey.toBase58(), signature, lamports: debit };
  }

  /** Create a zero-supply Token-2022 mint with metadata embedded on-chain. */
  async createSplToken(venture: Venture): Promise<{ mint: string; signature: string; lamports: number }> {
    await assertDevnetConnection(this.connection);
    if (!this.cfg.spl.enabled) throw new PolicyError('Token-2022 devnet feature disabled');
    if (venture.status !== 'active' || !venture.splToken) throw new PolicyError('venture is not approved for Token-2022 creation');
    const metadata = validSplToken(venture.splToken);
    if (!metadata) throw new PolicyError('invalid approved Token-2022 metadata');
    if (venture.splToken.mint || this.state.splMints?.[venture.id]) throw new PolicyError('venture already minted');
    if (this.state.pendingTransfer) throw new PolicyError('unreconciled signed transaction');

    const mint = Keypair.generate();
    const { rentSpace } = splMintSpace(metadata, mint.publicKey, this.keypair.publicKey);
    const rent = await this.connection.getMinimumBalanceForRentExemption(rentSpace, 'confirmed');
    const tx = buildSplMintTx(metadata, mint.publicKey, this.keypair.publicKey, rent);
    tx.feePayer = this.keypair.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const balanceBefore = await this.connection.getBalance(this.keypair.publicKey, 'confirmed');
    const simulation = await this.connection.simulateTransaction(tx, [this.keypair, mint], [this.keypair.publicKey]);
    if (simulation.value.err) throw new PolicyError(`Token-2022 simulation failed: ${JSON.stringify(simulation.value.err)}`);
    const balanceAfter = simulation.value.accounts?.[0]?.lamports;
    if (typeof balanceAfter !== 'number' || balanceAfter > balanceBefore) {
      throw new PolicyError('Token-2022 simulation did not return a usable wallet balance');
    }
    const debit = balanceBefore - balanceAfter + 100_000;
    const destination = TOKEN_2022_PROGRAM_ID.toBase58();
    const decision = evaluatePolicy({
      ...this.buildPolicyInput({ to: destination, lamports: debit, reason: `Token-2022 ${venture.id}` }),
      allowlist: [destination],
    });
    if (!decision.ok) throw new PolicyError(decision.reason);
    if (debit > solToLamports(this.cfg.spl.maxCreateSol)) throw new PolicyError('Token-2022 creation exceeds protocol cap');
    const signature = await sendTransfer(this.connection, tx, [this.keypair, mint], (signed) => {
      this.state.pendingTransfer = { signature: signed, to: destination, lamports: debit, at: new Date().toISOString() };
      saveState(this.state);
    });
    this.cycleTxCount += 1;
    this.state.caps.txCountToday += 1;
    this.state.caps.lamportsSpentToday += debit;
    this.state.splMints ??= {};
    this.state.splMints[venture.id] = { mint: mint.publicKey.toBase58(), signature, at: new Date().toISOString() };
    delete this.state.pendingTransfer;
    saveState(this.state);
    return { mint: mint.publicKey.toBase58(), signature, lamports: debit };
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
