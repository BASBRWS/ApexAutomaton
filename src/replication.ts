import fs from 'node:fs';
import path from 'node:path';
import { Connection, Keypair } from '@solana/web3.js';
import { solToLamports, type Config } from './config.js';
import { CHILDREN_SECRET_DIR } from './paths.js';
import type { Signer } from './solana/signer.js';
import type { AutomatonState, ChildRecord } from './types.js';

/**
 * replication.ts — Phase 3 scaffold. Implemented, but NOT wired into the loop
 * yet. A child is funded by a REAL devnet transfer from the parent, through the
 * signer, and inherits the parent strategy plus exactly ONE mutated parameter.
 *
 * DESIGN CONSTRAINT (from the spec): "death" (balance) and "birth" (profit) must
 * never be decidable in the same context. Birth is conditioned ONLY on sustained
 * profit — never on "population is low, spawn more". So `shouldReplicate` looks
 * solely at sustained-high-balance cycles and the population cap; it is never
 * given, and must never be given, the agent's proximity to death as an input.
 */

export interface ReplicationGate {
  eligible: boolean;
  reason: string;
}

/**
 * Pure gate. Inputs are ONLY: sustained sovereign cycles, current balance vs
 * threshold, and population vs cap. Deliberately no "how close to death" input.
 */
export function shouldReplicate(
  cfg: Config,
  args: { balanceSol: number; sustainedSovereignCycles: number; population: number },
): ReplicationGate {
  if (args.population >= cfg.replication.maxPopulation) {
    return { eligible: false, reason: `population at cap (${cfg.replication.maxPopulation})` };
  }
  if (args.balanceSol < cfg.replication.thresholdSol) {
    return {
      eligible: false,
      reason: `balance below replicate threshold (${cfg.replication.thresholdSol} SOL)`,
    };
  }
  if (args.sustainedSovereignCycles < cfg.replication.sustainedCycles) {
    return {
      eligible: false,
      reason:
        `not yet sustained: ${args.sustainedSovereignCycles}/${cfg.replication.sustainedCycles} cycles`,
    };
  }
  return { eligible: true, reason: 'sustained high growth — replication unlocked' };
}

/** A minimal mutable parameter set a child can inherit-with-mutation. */
export interface Strategy {
  /** which task the child prefers by default. */
  preferredTaskId: string;
  /** how eager the child is to act vs rest (0..1). */
  boldness: number;
}

/** Mutate exactly ONE parameter of the parent strategy. */
export function mutateStrategy(parent: Strategy, seed: number): { child: Strategy; mutated: string } {
  const child: Strategy = { ...parent };
  if (seed % 2 === 0) {
    child.boldness = Math.min(1, Math.max(0, parent.boldness + (seed % 3 === 0 ? 0.1 : -0.1)));
    return { child, mutated: 'boldness' };
  }
  const tasks = ['label-batch', 'summarize-doc', 'extract-fields'];
  const idx = seed % tasks.length;
  child.preferredTaskId = tasks[idx]!;
  return { child, mutated: 'preferredTaskId' };
}

/**
 * Create and fund a child. The child's SECRET key is written ONLY to a
 * gitignored file under state/children/ and is never logged or committed; only
 * its PUBLIC key enters state. The child is registered in state BEFORE funding
 * so the signer's allowlist already contains it when the transfer is proposed.
 *
 * NOT called by the loop in Phase 1/2. Wire in from the SOVEREIGN tier once the
 * population runtime exists.
 */
export async function replicate(params: {
  connection: Connection;
  cfg: Config;
  signer: Signer;
  state: AutomatonState;
  cycle: number;
  strategySeed: number;
}): Promise<ChildRecord> {
  const { cfg, signer, state, cycle } = params;

  const child = Keypair.generate();
  const childPubkey = child.publicKey.toBase58();

  const parentStrategy: Strategy = { preferredTaskId: 'label-batch', boldness: 0.6 };
  const { mutated } = mutateStrategy(parentStrategy, params.strategySeed);

  // Register the child in state FIRST so the signer allowlist includes it.
  const record: ChildRecord = {
    pubkey: childPubkey,
    createdAtCycle: cycle,
    fundedLamports: 0,
    fundingSignature: '',
    mutatedParam: mutated,
    at: new Date().toISOString(),
  };
  state.children.push(record);

  // Persist the child's secret to a gitignored file — operator-owned material.
  fs.mkdirSync(CHILDREN_SECRET_DIR, { recursive: true });
  const secretFile = path.join(CHILDREN_SECRET_DIR, `${childPubkey}.secret.json`);
  fs.writeFileSync(secretFile, JSON.stringify(Array.from(child.secretKey)), {
    encoding: 'utf8',
    mode: 0o600,
  });

  // Fund the child with a REAL transfer, through the policy-gated signer.
  const funded = await signer.signAndSend({
    to: childPubkey,
    lamports: solToLamports(cfg.replication.childSeedSol),
    reason: 'replication: seed child',
    memo: `replicate:${mutated}`,
  });

  record.fundedLamports = funded.lamports;
  record.fundingSignature = funded.signature;
  return record;
}
