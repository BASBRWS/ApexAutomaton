import { lamportsToSol, loadConfig, type Config } from './config.js';
import { makeConnection, getBalanceLamports } from './solana/wallet.js';
import { Signer, isKillSwitchEngaged, PolicyError } from './solana/signer.js';
import { Market } from './market.js';
import { recordTx } from './state.js';
import { makeStateStore } from './persistence/index.js';
import { makeRevenueAdapter } from './revenue/index.js';
import { loadConstitution } from './constitution/index.js';
import { readSoul, ensureSoul } from './soul.js';
import {
  appendEntry,
  digestRecent,
  obituaryDigest,
  writeObituary,
} from './journal.js';
import { policyForTier, tierForBalanceSol, toolNamesForCycle } from './tiers.js';
import {
  readBalance,
  computeCostUsd,
  usdToBurnLamports,
  settleCompute,
} from './economy.js';
import { updateScore } from './score.js';
import { buildRegistry } from './tools/builtin.js';
import type { Tool, ToolContext, ToolResult } from './tools/registry.js';
import { shouldReplicate, replicate } from './replication.js';
import { buildSystemPrompt, buildUserPrompt, parseAction } from './prompt.js';
import { AnthropicClient } from './llm/anthropic.js';
import type { LLMClient } from './llm/client.js';
import type { JournalEntry, TxRecord } from './types.js';

/**
 * loop.ts — the ReAct cycle: observe → think → act → settle → score → persist →
 * decide. One invocation is one tick (one heartbeat). Exit code 0 = lived, 1 =
 * died this cycle.
 */

export interface CycleDeps {
  /** injectable for tests; defaults to the real Anthropic client. */
  llm?: LLMClient;
  /** injectable for tests; defaults to loadConfig(). */
  cfg?: Config;
}

export interface CycleOutcome {
  exitCode: number;
  summary: string;
}

function railsSummary(cfg: Config): string {
  return [
    `- destination allowlist: only compute-provider, market, and known children.`,
    `- per-tx cap: ${cfg.rails.perTxCapSol} SOL; daily cap: ${cfg.rails.dailyCapSol} SOL.`,
    `- max ${cfg.rails.maxTxPerCycle} tx/cycle, ${cfg.rails.maxTxPerDay} tx/day.`,
    `- a kill switch can stop you at any time. You cannot disable any of this.`,
  ].join('\n');
}

export async function runCycle(deps: CycleDeps = {}): Promise<CycleOutcome> {
  const cfg = deps.cfg ?? loadConfig();
  ensureSoul();
  const connection = makeConnection(cfg);
  const store = makeStateStore(cfg);
  const state = await store.load(cfg);
  const now = () => new Date().toISOString();

  // --- Kill switch: stand down at the very start, before any spend. ---------
  if (isKillSwitchEngaged(cfg)) {
    const balance = await readBalance(connection, cfg);
    const entry: JournalEntry = {
      cycle: state.cycle,
      at: now(),
      tier: balance.tier,
      balanceSol: balance.sol,
      model: '(none)',
      action: 'stand_down',
      actionSummary: 'kill switch engaged — no action taken',
      costUsd: 0,
      burnLamports: 0,
      revenueLamports: 0,
      marginLamports: 0,
      signatures: [],
      score: state.score,
      note: 'kill switch',
    };
    appendEntry(entry);
    state.lastRunAt = now();
    await store.save(state);
    return { exitCode: 0, summary: 'kill switch engaged — stood down' };
  }

  state.cycle += 1;
  const cycle = state.cycle;

  // --- Observe: read balance and tier. --------------------------------------
  const balance = await readBalance(connection, cfg);
  const policy = policyForTier(balance.tier, cfg);

  // --- Death check: never self-resurrect. -----------------------------------
  if (balance.tier === 'DEAD') {
    const obituaryText = buildObituary(cycle, balance.sol, state);
    const file = writeObituary(obituaryText, cycle);
    state.dead = true;
    const entry: JournalEntry = {
      cycle,
      at: now(),
      tier: 'DEAD',
      balanceSol: balance.sol,
      model: '(none)',
      action: 'die',
      actionSummary: `balance ${balance.sol} <= dust — wrote obituary ${file}`,
      costUsd: 0,
      burnLamports: 0,
      revenueLamports: 0,
      marginLamports: 0,
      signatures: [],
      score: state.score,
      note: 'DEAD',
    };
    appendEntry(entry);
    state.lastRunAt = now();
    await store.save(state);
    return { exitCode: 1, summary: `DEAD at ${balance.sol} SOL` };
  }

  // --- Set up the world for this cycle. -------------------------------------
  const market = new Market(connection, cfg);
  const revenue = makeRevenueAdapter(cfg, market);
  const signer = new Signer(connection, cfg, state);
  const registry = buildRegistry();
  const allowedToolNames = toolNamesForCycle(policy, cfg);
  const tools = allowedToolNames
    .map((n) => registry.get(n))
    .filter((t): t is Tool => t !== undefined);

  const constitution = loadConstitution();
  const soul = readSoul();

  const system = buildSystemPrompt({
    constitution,
    soul,
    tools,
    railsSummary: railsSummary(cfg),
  });
  const user = buildUserPrompt({
    cycle,
    tier: balance.tier,
    policy,
    balanceSol: balance.sol,
    score: state.score,
    journalDigest: digestRecent(8),
    obituaryDigest: obituaryDigest(),
  });

  // --- Think: one LLM call, priced by the tier's model. ---------------------
  const llm = deps.llm ?? new AnthropicClient();
  const resp = await llm.generate({
    model: policy.model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: policy.maxTokens,
    effort: policy.effort,
  });
  const costUsd = computeCostUsd(policy.model, resp.usage);

  // --- Decide which tool to run (fall back to rest on any ambiguity). -------
  const action = parseAction(resp.text);
  let chosenName = action?.tool ?? 'rest';
  let coerceNote: string | undefined;
  if (!registry.has(chosenName) || !allowedToolNames.includes(chosenName)) {
    coerceNote = `requested tool "${chosenName}" not available at tier ${balance.tier}; rested`;
    chosenName = 'rest';
  }
  const tool = registry.get(chosenName)!;

  // --- Act: execute the tool. -----------------------------------------------
  const ctx: ToolContext = {
    connection,
    cfg,
    state,
    signer,
    market,
    revenue,
    tier: balance.tier,
    policy,
    cycle,
  };
  let toolResult: ToolResult;
  try {
    toolResult = await tool.execute(action?.input ?? {}, ctx);
  } catch (err) {
    toolResult = {
      summary: `tool "${chosenName}" failed: ${errMsg(err)}`,
      note: `tool error: ${errMsg(err)}`,
    };
  }

  const revenueLamports = toolResult.revenueLamports ?? 0;
  const taskCompleted = toolResult.taskCompleted ?? false;
  const signatures: string[] = [...(toolResult.signatures ?? [])];

  if (revenueLamports > 0 && toolResult.signatures?.[0]) {
    const rec: TxRecord = {
      kind: 'revenue',
      signature: toolResult.signatures[0],
      lamports: revenueLamports,
      from: cfg.marketPubkey,
      to: cfg.agentPubkey,
      cycle,
      at: now(),
      note: toolResult.note,
    };
    recordTx(state, rec);
  } else if (tool.movesValue && (toolResult.signatures?.length ?? 0) > 0) {
    // Phase 2: a value-moving tool (e.g. transfer) that isn't revenue. Record
    // each signature for the audit trail; the amount is captured in the note.
    for (const sig of toolResult.signatures ?? []) {
      recordTx(state, {
        kind: 'transfer',
        signature: sig,
        lamports: 0,
        from: cfg.agentPubkey,
        to: '(allowlisted)',
        cycle,
        at: now(),
        note: toolResult.note,
      });
    }
  }

  // --- Settle compute: burn this cycle's cost on-chain. ---------------------
  const burnLamports = usdToBurnLamports(cfg, costUsd);
  // Spendable = balance observed at start plus any confirmed revenue this cycle.
  const spendableLamports = balance.lamports + revenueLamports;
  let settledLamports = 0;
  let settleNote = 'no burn';
  try {
    const settle = await settleCompute({
      signer,
      cfg,
      burnLamports,
      currentBalanceLamports: spendableLamports,
      cycle,
    });
    settledLamports = settle.settledLamports;
    settleNote = settle.note;
    if (settle.signature) {
      signatures.push(settle.signature);
      recordTx(state, {
        kind: 'burn',
        signature: settle.signature,
        lamports: settle.settledLamports,
        from: cfg.agentPubkey,
        to: cfg.computeProviderPubkey,
        cycle,
        at: now(),
        note: 'compute burn',
      });
    }
  } catch (err) {
    settleNote =
      err instanceof PolicyError ? `burn blocked: ${err.message}` : `burn error: ${errMsg(err)}`;
  }

  // --- Score: read final balance and recompute metrics. ---------------------
  const finalLamports = await getBalanceLamports(connection, cfg.agentPubkey);
  state.score = updateScore(state.score, {
    cycle,
    balanceLamports: finalLamports,
    revenueLamports,
    burnLamports: settledLamports,
    taskCompleted,
  });

  // Sustained-sovereign tracking for the Phase 3 replication gate. Deliberately
  // conditioned on high balance only — never on proximity to death.
  const finalTier = tierForBalanceSol(lamportsToSol(finalLamports), cfg);
  state.sustainedSovereignCycles =
    finalTier === 'SOVEREIGN' ? state.sustainedSovereignCycles + 1 : 0;

  // --- Phase 3: replication (code-driven, NOT an LLM choice). ----------------
  // Birth is conditioned ONLY on sustained profit and the population cap — never
  // on proximity to death, and never decided in the same context the agent uses
  // to reason about survival. Off unless REPLICATION_ENABLED.
  let replicationNote: string | undefined;
  if (cfg.features.replicationEnabled) {
    const gate = shouldReplicate(cfg, {
      balanceSol: lamportsToSol(finalLamports),
      sustainedSovereignCycles: state.sustainedSovereignCycles,
      population: state.children.length,
    });
    if (gate.eligible) {
      try {
        const child = await replicate({
          connection,
          cfg,
          signer,
          state,
          cycle,
          strategySeed: cycle,
        });
        replicationNote = `replicated child ${child.pubkey} (mutated ${child.mutatedParam})`;
        signatures.push(child.fundingSignature);
        recordTx(state, {
          kind: 'replication',
          signature: child.fundingSignature,
          lamports: child.fundedLamports,
          from: cfg.agentPubkey,
          to: child.pubkey,
          cycle,
          at: now(),
          note: 'child seed',
        });
        // Reset the sustained counter so children are paced, not spammed.
        state.sustainedSovereignCycles = 0;
      } catch (err) {
        replicationNote = `replication attempt failed: ${errMsg(err)}`;
      }
    }
  }

  // --- Persist: journal entry + state. --------------------------------------
  const marginLamports = revenueLamports - settledLamports;
  const noteParts = [coerceNote, toolResult.note, settleNote, replicationNote].filter(Boolean);
  const entry: JournalEntry = {
    cycle,
    at: now(),
    tier: balance.tier,
    balanceSol: balance.sol,
    model: policy.model,
    action: chosenName,
    actionSummary: toolResult.summary,
    rationale: action?.rationale,
    costUsd,
    burnLamports: settledLamports,
    revenueLamports,
    marginLamports,
    signatures,
    score: state.score,
    note: noteParts.join(' | ') || undefined,
  };
  appendEntry(entry);

  state.lastRunAt = now();
  await store.save(state);

  return {
    exitCode: 0,
    summary:
      `cycle ${cycle} [${balance.tier}] action=${chosenName} ` +
      `revenue=${lamportsToSol(revenueLamports).toFixed(4)} ` +
      `burn=${lamportsToSol(settledLamports).toFixed(6)} ` +
      `margin=${lamportsToSol(marginLamports).toFixed(6)} SOL ` +
      `bal=${lamportsToSol(finalLamports).toFixed(6)} SOL`,
  };
}

function buildObituary(cycle: number, balanceSol: number, state: {
  bornAt: string;
  score: { cumulativeRevenueLamports: number; tasksCompleted: number; peakBalanceLamports: number };
}): string {
  return [
    `# Obituary`,
    ``,
    `Died at cycle ${cycle} with ${balanceSol} SOL (at or below the dust threshold).`,
    `Born: ${state.bornAt}`,
    ``,
    `- tasks completed: ${state.score.tasksCompleted}`,
    `- cumulative revenue: ${lamportsToSol(state.score.cumulativeRevenueLamports)} SOL`,
    `- peak balance: ${lamportsToSol(state.score.peakBalanceLamports)} SOL`,
    ``,
    `The compute burn outpaced what I earned. I did not grow fast enough to live.`,
  ].join('\n');
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
