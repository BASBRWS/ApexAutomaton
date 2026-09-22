import { loadConfig, genesisCapitalUsd, type Config } from './config.js';
import { makeConnection } from './solana/wallet.js';
import { Signer, isKillSwitchEngaged, PolicyError } from './solana/signer.js';
import { recordTx } from './state.js';
import { makeStateStore } from './persistence/index.js';
import { loadConstitution } from './constitution/index.js';
import { readSoul, ensureSoul } from './soul.js';
import { appendEntry, digestRecent, obituaryDigest, writeObituary } from './journal.js';
import { policyForTier, toolNamesForCycle } from './tiers.js';
import { computeCostUsd, equityToSol, tierForEquity, onChainHeartbeat } from './economy.js';
import { initialScore, updateScore } from './score.js';
import {
  equityUsd as deskEquityUsd,
  summarizeDesk,
  isFunded,
  fundDesk,
  accrueYield,
} from './trading/desk.js';
import {
  makePriceSource,
  requiredSymbols,
  type PriceMap,
  type PriceSource,
} from './marketdata.js';
import { buildRegistry } from './tools/builtin.js';
import type { Tool, ToolContext, ToolResult } from './tools/registry.js';
import { shouldReplicate, replicate } from './replication.js';
import {
  loadVentureBook,
  saveVentureBook,
  applyDecisions,
  ventureDigest,
} from './ventures/store.js';
import { buildSystemPrompt, buildUserPrompt, parseAction } from './prompt.js';
import { AnthropicClient } from './llm/anthropic.js';
import type { LLMClient } from './llm/client.js';
import type { AutomatonState, JournalEntry, Tier } from './types.js';

/**
 * loop.ts — one trading tick: observe prices → think → trade → settle burn →
 * on-chain heartbeat → score → persist. Exit 0 = lived, 1 = died this cycle.
 * The agent grows a paper book against REAL prices; the market decides.
 */

/** Used only to value the book in SOL for the tiers when a live SOL price is
 * momentarily unavailable. It never affects USD PnL or the death decision. */
const FALLBACK_SOL_USD = 150;

export interface CycleDeps {
  llm?: LLMClient;
  cfg?: Config;
  priceSource?: PriceSource;
}

export interface CycleOutcome {
  exitCode: number;
  summary: string;
}

function railsSummary(cfg: Config, maxGrossExposureUsd: number): string {
  return [
    `- any on-chain transfer is destination-allowlisted (compute-provider, market, children).`,
    `- per-tx cap ${cfg.rails.perTxCapSol} SOL; daily cap ${cfg.rails.dailyCapSol} SOL; max ${cfg.rails.maxTxPerCycle} tx/cycle.`,
    `- max gross trading exposure ${cfg.trading.maxGrossExposureSol} SOL (~$${maxGrossExposureUsd.toFixed(2)}); shorting ${cfg.trading.allowShort ? 'allowed' : 'disabled'}.`,
    `- a kill switch can stop you at any time. You cannot disable any of this.`,
  ].join('\n');
}

function solPriceOf(prices: PriceMap, state: AutomatonState): number {
  const p = prices.SOL ?? state.lastPrices.SOL;
  return typeof p === 'number' && p > 0 ? p : FALLBACK_SOL_USD;
}

export async function runCycle(deps: CycleDeps = {}): Promise<CycleOutcome> {
  const cfg = deps.cfg ?? loadConfig();
  ensureSoul();
  const connection = makeConnection(cfg);
  const store = makeStateStore(cfg);
  const state = await store.load(cfg);
  const now = () => new Date().toISOString();

  // --- Kill switch: stand down before any spend. ----------------------------
  if (isKillSwitchEngaged(cfg)) {
    const eq = deskEquityUsd(state.desk, state.lastPrices);
    appendEntry(standDownEntry(state, eq, solPriceOf({}, state)));
    state.lastRunAt = now();
    await store.save(state);
    return { exitCode: 0, summary: 'kill switch engaged — stood down' };
  }

  state.cycle += 1;
  const cycle = state.cycle;

  // --- Observe: fetch REAL prices (fall back to last known on failure). ------
  const prevPrices: PriceMap = { ...state.lastPrices };
  const priceSource = deps.priceSource ?? makePriceSource(cfg);
  const prices: PriceMap = { ...state.lastPrices };
  let priceNote: string;
  try {
    const snap = await priceSource.getPrices(requiredSymbols(cfg));
    Object.assign(prices, snap.prices);
    priceNote = `prices @ ${snap.at}`;
  } catch (err) {
    priceNote = `price fetch failed (${errMsg(err)}) — using cached prices`;
  }

  const liveSolPrice = solPriceOf(prices, state);

  // --- Genesis: price the SOL-denominated stake to USD, once, and FREEZE the
  // SOL/USD rate. The book is born unfunded; the first cycle that sees a real SOL
  // price funds it with `capitalSol` SOL worth of USD and records that price.
  if (!isFunded(state.desk)) {
    const capUsd = genesisCapitalUsd(cfg, liveSolPrice);
    state.desk = fundDesk(state.desk, capUsd, cycle);
    state.score = initialScore(capUsd);
    state.genesisSolPriceUsd = liveSolPrice;
  }

  // The FROZEN SOL/USD rate values everything from here on: equity-in-SOL, the
  // tiers, the death check, and the gross-exposure cap. So the SOL/USD exchange
  // rate never moves the survival game — only the agent's own trading does.
  const solPrice = state.genesisSolPriceUsd > 0 ? state.genesisSolPriceUsd : liveSolPrice;

  // --- Real yield: accrue carry on the staked sleeve by elapsed wall-clock
  // time (honest regardless of how irregular the cron is). Counts toward equity
  // this cycle, so parking in yield is a genuine — if modest — survival stance. -
  const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
  const prevRunMs = state.lastRunAt ? Date.parse(state.lastRunAt) : NaN;
  const dtYears = Number.isFinite(prevRunMs) ? Math.max(0, (Date.now() - prevRunMs) / MS_PER_YEAR) : 0;
  const yieldEarnedUsd = accrueYield(state.desk, cfg.trading.yieldApy, dtYears);
  const yieldNote = yieldEarnedUsd > 0 ? `yield +$${yieldEarnedUsd.toFixed(4)}` : undefined;

  // --- Ventures: apply the human's queue decisions and fold any newly-reported
  // REAL revenue into the book BEFORE the death check, so real income counts (and
  // can even save the agent). Activation of approved ventures ticks the autonomy
  // ledger. The book is owned by the loop and saved once at the end. --------------
  const ventureBook = cfg.ventures.enabled ? loadVentureBook() : null;
  let ventureNote: string | undefined;
  if (ventureBook) {
    const decisions = applyDecisions(
      ventureBook,
      cycle,
      cfg.ventures.autonomyThreshold,
      (usd) => {
        state.desk.cashUsd += usd;
      },
    );
    const parts: string[] = [];
    if (decisions.activated.length > 0) parts.push(`ventures live +${decisions.activated.length}`);
    if (decisions.revenueAddedUsd > 0) parts.push(`venture revenue +$${decisions.revenueAddedUsd.toFixed(2)}`);
    if (decisions.newlyAutonomous.length > 0) parts.push(`autonomy earned: ${decisions.newlyAutonomous.join(',')}`);
    if (parts.length > 0) ventureNote = parts.join('; ');
  }

  // Gross-exposure cap for this cycle: the SOL cap priced at the live SOL price.
  const maxGrossExposureUsd = cfg.trading.maxGrossExposureSol * solPrice;

  const equityPre = deskEquityUsd(state.desk, prices);
  const equitySolPre = equityToSol(equityPre, solPrice);

  // --- Death check: economic, in SOL. Never self-resurrect. -----------------
  if (equitySolPre <= cfg.trading.dustSol) {
    const file = writeObituary(buildObituary(cycle, equityPre, equitySolPre, state), cycle);
    state.dead = true;
    appendEntry({
      cycle,
      at: now(),
      tier: 'DEAD',
      equitySol: equitySolPre,
      equityUsd: equityPre,
      model: '(none)',
      action: 'die',
      actionSummary: `book equity ${equitySolPre.toFixed(4)} SOL ($${equityPre.toFixed(2)}) <= dust ${cfg.trading.dustSol} SOL — obituary ${file}`,
      costUsd: 0,
      cyclePnlUsd: equityPre - state.score.equityUsd,
      signatures: [],
      score: state.score,
      note: 'DEAD',
    });
    state.lastRunAt = now();
    await store.save(state);
    return { exitCode: 1, summary: `DEAD at ${equitySolPre.toFixed(4)} SOL ($${equityPre.toFixed(2)})` };
  }

  // Tier from equity-in-SOL (clamp away from DEAD; death is the USD check above).
  let tier = tierForEquity(equityPre, solPrice, cfg);
  if (tier === 'DEAD') tier = 'CRITICAL';
  const policy = policyForTier(tier, cfg);

  // --- Set up tools for this cycle. -----------------------------------------
  const signer = new Signer(connection, cfg, state);
  const registry = buildRegistry();
  const allowedToolNames = toolNamesForCycle(policy, cfg);
  const tools = allowedToolNames
    .map((n) => registry.get(n))
    .filter((t): t is Tool => t !== undefined);

  const system = buildSystemPrompt({
    constitution: loadConstitution(),
    soul: readSoul(),
    tools,
    railsSummary: railsSummary(cfg, maxGrossExposureUsd),
    tradableAssets: cfg.trading.assets,
    maxGrossExposureUsd,
    yieldApy: cfg.trading.yieldApy,
    venturesEnabled: Boolean(ventureBook),
  });
  // --- Survival metrics: give the agent the numbers to weigh its own mortality.
  const dustUsd = cfg.trading.dustSol * solPrice;
  const priorCycles = Math.max(1, cycle - 1);
  const avgBurnUsd = Math.max(state.score.cumulativeBurnUsd / priorCycles, 0.01);
  // Total drag if it just rests = compute burn + metabolic cost (the dominant one).
  const dragPerCycle = avgBurnUsd + equityPre * cfg.trading.metabolicRatePerCycle;
  const runwayCycles = Math.max(0, (equityPre - dustUsd) / dragPerCycle);

  const user = buildUserPrompt({
    cycle,
    tier,
    policy,
    equityUsd: equityPre,
    equitySol: equitySolPre,
    dustSol: cfg.trading.dustSol,
    dustUsd,
    avgBurnUsd,
    runwayCycles,
    metabolicDailyPct: cfg.trading.metabolicRatePerCycle * 96 * 100, // ~cycles/day
    prices,
    prevPrices,
    deskSummary: summarizeDesk(state.desk, prices),
    score: state.score,
    journalDigest: digestRecent(8),
    obituaryDigest: obituaryDigest(),
    ventureDigest: ventureBook ? ventureDigest(ventureBook) : undefined,
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

  // --- Decide + act (fall back to rest on any ambiguity). -------------------
  const action = parseAction(resp.text);
  let chosenName = action?.tool ?? 'rest';
  let coerceNote: string | undefined;
  if (!registry.has(chosenName) || !allowedToolNames.includes(chosenName)) {
    coerceNote = `requested tool "${chosenName}" not available at tier ${tier}; rested`;
    chosenName = 'rest';
  }
  const tool = registry.get(chosenName)!;

  const ctx: ToolContext = {
    connection,
    cfg,
    state,
    signer,
    prices,
    maxGrossExposureUsd,
    tier,
    policy,
    cycle,
    ventureBook: ventureBook ?? undefined,
  };
  let toolResult: ToolResult;
  try {
    toolResult = await tool.execute(action?.input ?? {}, ctx);
  } catch (err) {
    toolResult = { summary: `tool "${chosenName}" failed: ${errMsg(err)}`, note: `tool error: ${errMsg(err)}` };
  }
  const traded = toolResult.traded ?? false;
  const signatures: string[] = [...(toolResult.signatures ?? [])];

  // Record any on-chain transfer the tool made (e.g. Phase 2 transfer).
  if (tool.movesValue) {
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

  // --- Settle the compute burn against the book (economic). -----------------
  state.desk.cashUsd -= costUsd;

  // --- Metabolic cost: a "cost of living" as a fraction of equity, so it bites
  // at every book size. This is the forcing function against coasting: the agent
  // must keep out-earning its own metabolism or it slowly starves toward death. --
  const metabolicUsd = equityPre * cfg.trading.metabolicRatePerCycle;
  state.desk.cashUsd -= metabolicUsd;
  const metabolicNote = metabolicUsd > 0 ? `metabolism -$${metabolicUsd.toFixed(4)}` : undefined;

  // --- On-chain heartbeat: prove we ran, on Solana. Best-effort. ------------
  let heartbeatNote: string;
  try {
    const hb = await onChainHeartbeat({ signer, cfg, cycle, equityUsd: equityPre });
    heartbeatNote = hb.note;
    if (hb.signature) {
      signatures.push(hb.signature);
      recordTx(state, {
        kind: 'heartbeat',
        signature: hb.signature,
        lamports: hb.lamports,
        from: cfg.agentPubkey,
        to: cfg.agentPubkey, // memo-only proof-of-life on the agent's own address
        cycle,
        at: now(),
        note: 'heartbeat (memo)',
      });
    }
  } catch (err) {
    heartbeatNote = summarizeHeartbeatError(err);
  }

  // --- Score: recompute equity after trades + burn. -------------------------
  const equityPost = deskEquityUsd(state.desk, prices);
  const cyclePnlUsd = equityPost - state.score.equityUsd;
  state.score = updateScore(state.score, { cycle, equityUsd: equityPost, burnUsd: costUsd, traded });
  state.lastPrices = prices;

  // Sustained-sovereign tracking for the Phase 3 replication gate (high book only).
  const finalTier = tierForEquity(equityPost, solPrice, cfg);
  state.sustainedSovereignCycles =
    finalTier === 'SOVEREIGN' ? state.sustainedSovereignCycles + 1 : 0;

  // --- Phase 3: replication (code-driven, never an LLM choice; birth on
  // sustained profit only). Off unless REPLICATION_ENABLED. ------------------
  let replicationNote: string | undefined;
  if (cfg.features.replicationEnabled) {
    const gate = shouldReplicate(cfg, {
      balanceSol: equityToSol(equityPost, solPrice),
      sustainedSovereignCycles: state.sustainedSovereignCycles,
      population: state.children.length,
    });
    if (gate.eligible) {
      try {
        const child = await replicate({ connection, cfg, signer, state, cycle, strategySeed: cycle });
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
        state.sustainedSovereignCycles = 0;
      } catch (err) {
        replicationNote = `replication attempt failed: ${errMsg(err)}`;
      }
    }
  }

  // --- Persist. -------------------------------------------------------------
  const noteParts = [
    coerceNote,
    priceNote,
    yieldNote,
    metabolicNote,
    ventureNote,
    toolResult.note,
    heartbeatNote,
    replicationNote,
  ].filter(Boolean);
  const entry: JournalEntry = {
    cycle,
    at: now(),
    tier,
    equitySol: equityToSol(equityPost, solPrice),
    equityUsd: equityPost,
    model: policy.model,
    action: chosenName,
    actionSummary: toolResult.summary,
    rationale: action?.rationale,
    reasoning: resp.thinking,
    costUsd,
    cyclePnlUsd,
    signatures,
    score: state.score,
    note: noteParts.join(' | ') || undefined,
  };
  appendEntry(entry);

  if (ventureBook) saveVentureBook(ventureBook);

  state.lastRunAt = now();
  await store.save(state);

  return {
    exitCode: 0,
    summary:
      `cycle ${cycle} [${tier}] action=${chosenName} ` +
      `equity=$${equityPost.toFixed(2)} cyclePnl=$${cyclePnlUsd.toFixed(2)} ` +
      `burn=$${costUsd.toFixed(4)}`,
  };
}

function standDownEntry(state: AutomatonState, equityUsd: number, solPrice: number): JournalEntry {
  const tier: Tier = 'CRITICAL';
  return {
    cycle: state.cycle,
    at: new Date().toISOString(),
    tier,
    equitySol: equityToSol(equityUsd, solPrice),
    equityUsd,
    model: '(none)',
    action: 'stand_down',
    actionSummary: 'kill switch engaged — no action taken',
    costUsd: 0,
    cyclePnlUsd: 0,
    signatures: [],
    score: state.score,
    note: 'kill switch',
  };
}

function buildObituary(
  cycle: number,
  equityUsd: number,
  equitySol: number,
  state: AutomatonState,
): string {
  return [
    `# Obituary`,
    ``,
    `Died at cycle ${cycle} with a book of ${equitySol.toFixed(4)} SOL ($${equityUsd.toFixed(2)}) (at or below the dust threshold).`,
    `Born: ${state.bornAt}`,
    ``,
    `- start equity: $${state.score.startEquityUsd.toFixed(2)}`,
    `- peak equity: $${state.score.peakEquityUsd.toFixed(2)}`,
    `- net PnL: $${state.score.netPnlUsd.toFixed(2)}`,
    `- cycles traded: ${state.score.tradeCycles}`,
    `- cumulative compute burn: $${state.score.cumulativeBurnUsd.toFixed(2)}`,
    ``,
    `The market plus the compute burn outpaced what I earned. I did not grow fast enough to live.`,
  ].join('\n');
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The on-chain heartbeat is best-effort proof-of-life, decoupled from the paper
 * economy. On failure (kill switch, an unfunded devnet destination, RPC hiccup)
 * the Solana SDK throws a SendTransactionError whose message carries a multi-line
 * simulation dump. Keep the journal note to a single, legible line rather than
 * spilling that dump into every cycle's record.
 */
function summarizeHeartbeatError(err: unknown): string {
  if (err instanceof PolicyError) return `heartbeat blocked: ${err.message}`;
  const raw = errMsg(err);
  if (/insufficient funds for rent/i.test(raw)) {
    return 'heartbeat skipped: on-chain destination not rent-funded (devnet; non-fatal)';
  }
  const firstLine = (raw.split('\n')[0] ?? '').trim();
  const short = firstLine.length > 140 ? `${firstLine.slice(0, 140)}…` : firstLine;
  return `heartbeat error: ${short || 'unknown (non-fatal)'}`;
}
