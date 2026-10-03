import { loadConfig, genesisCapitalUsd, type Config } from './config.js';
import { assertDevnetConnection, makeConnection, readWalletSnapshot, settlementAirdrop } from './solana/wallet.js';
import { reconcileLamports, INCINERATOR_ADDRESS } from './wallet-economy.js';
import { Signer, isKillSwitchEngaged, PolicyError } from './solana/signer.js';
import { recordTx } from './state.js';
import { makeStateStore } from './persistence/index.js';
import { loadConstitution } from './constitution/index.js';
import { soulForPrompt, ensureSoul, syncSoulHistory } from './soul.js';
import { appendEntry, digestRecent, obituaryDigest, writeObituary, readRecent } from './journal.js';
import { assessLossTrend } from './losstrend.js';
import { decisionReason } from './decision-cadence.js';
import { initChallenge, evaluateChallenge, challengeStatus, fmtLivesDelta } from './challenge.js';
import { policyForTier, tierForBalanceSol, toolNamesForCycle } from './tiers.js';
import { computeCostUsd, equityToSol, survivalSol, onChainHeartbeat } from './economy.js';
import { initialScore, updateScore } from './score.js';
import {
  equityUsd as deskEquityUsd,
  scoreboardEquityUsd,
  ventureRevenueUsdOf,
  addVentureRevenue,
  summarizeDesk,
  isFunded,
  fundDesk,
  accrueYield,
  accrueShortBorrow,
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
  updateVentureMonitor,
} from './ventures/store.js';
import { buildSystemPrompt, buildUserPrompt, parseAction, type AgentAction } from './prompt.js';
import { appendLesson, lessonsDigest, realizedFromClose, recentLessons } from './memory/lessons.js';
import { autoReflect } from './memory/reflect.js';
import { AnthropicClient } from './llm/anthropic.js';
import type { LLMClient, LLMResponse } from './llm/client.js';
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
  syncSoulHistory(recentLessons(Number.MAX_SAFE_INTEGER));
  const connection = makeConnection(cfg);
  const store = makeStateStore(cfg);
  const state = await store.load(cfg);
  const now = () => new Date().toISOString();

  // --- Kill switch: stand down before any spend. ----------------------------
  if (isKillSwitchEngaged(cfg)) {
    state.walletSnapshot = null;
    const eq = deskEquityUsd(state.desk, state.lastPrices);
    appendEntry(standDownEntry(state, eq, solPriceOf({}, state)));
    state.lastRunAt = now();
    await store.save(state);
    return { exitCode: 0, summary: 'kill switch engaged — stood down' };
  }

  await assertDevnetConnection(connection);
  if (state.dead) {
    return { exitCode: 1, summary: 'DEAD — operator intervention required' };
  }

  state.cycle += 1;
  const cycle = state.cycle;

  // --- Observe: fetch REAL prices (fall back to last known on failure). ------
  const prevPrices: PriceMap = { ...state.lastPrices };
  const priceSource = deps.priceSource ?? makePriceSource(cfg);
  const prices: PriceMap = { ...state.lastPrices };
  let executablePrices: PriceMap = {};
  let priceNote: string;
  try {
    const snap = await priceSource.getPrices(requiredSymbols(cfg));
    Object.assign(prices, snap.prices);
    executablePrices = snap.prices;
    priceNote = `prices @ ${snap.at}`;
  } catch (err) {
    priceNote = `price fetch failed (${errMsg(err)}) — using cached prices`;
  }

  const liveSolPrice = solPriceOf(prices, state);

  // --- Genesis: price the SOL-denominated stake to USD once, and record the
  // SOL/USD rate. The book is born unfunded; the first cycle that sees a real SOL
  // price funds it with `capitalSol` SOL worth of USD and records that price.
  if (!isFunded(state.desk)) {
    if (!(typeof executablePrices.SOL === 'number' && executablePrices.SOL > 0)) {
      throw new Error('Genesis requires a fresh SOL quote; no capital was created from cached or fallback prices.');
    }
    const capUsd = genesisCapitalUsd(cfg, liveSolPrice);
    state.desk = fundDesk(state.desk, capUsd, cycle);
    state.score = initialScore(capUsd);
    state.genesisSolPriceUsd = liveSolPrice;
  }

  // Value the book back in SOL at the latest observed rate. The genesis price
  // only determines starting USD capital and the SOL-hold benchmark. Using it
  // for tiers/death would overstate SOL holdings whenever SOL appreciates.
  const solPrice = liveSolPrice;

  // --- Modeled yield: accrue carry on the staked sleeve by elapsed wall-clock
  // time (honest regardless of how irregular the cron is). Counts toward equity
  // this cycle, so parking in yield is a genuine — if modest — survival stance. -
  const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
  const prevRunMs = state.lastRunAt ? Date.parse(state.lastRunAt) : NaN;
  const dtYears = Number.isFinite(prevRunMs) ? Math.max(0, (Date.now() - prevRunMs) / MS_PER_YEAR) : 0;
  const yieldEarnedUsd = accrueYield(state.desk, cfg.trading.yieldApy, dtYears);
  const yieldNote = yieldEarnedUsd > 0 ? `yield +$${yieldEarnedUsd.toFixed(4)}` : undefined;
  const borrowCostUsd = accrueShortBorrow(state.desk, prices, cfg.trading.shortBorrowApy, dtYears);
  const borrowNote = borrowCostUsd > 0 ? `short borrow -$${borrowCostUsd.toFixed(4)}` : undefined;

  // --- Ventures: apply the human's queue decisions and fold any newly-reported
  // REAL revenue into the book BEFORE the death check, so real income counts (and
  // can even save the agent). Activation of approved ventures ticks the autonomy
  // ledger. The book is owned by the loop and saved once at the end. --------------
  const ventureBook = cfg.ventures.enabled ? loadVentureBook() : null;
  let ventureNote: string | undefined;
  let ventureChanged = false;
  if (ventureBook) {
    state.creditedVentureRevenueUsd ??= Object.fromEntries(
      ventureBook.ventures.map((venture) => [venture.id, venture.accountedRevenueUsd ?? 0]),
    );
    const decisions = applyDecisions(
      ventureBook,
      cycle,
      cfg.ventures.autonomyThreshold,
      // Book REAL revenue onto its OWN line — never mixed into the paper cash — so
      // paper-trading performance stays cleanly readable; the scoreboard equity
      // below adds it back on top (survival counts it, trade sizing does not).
      (usd) => {
        addVentureRevenue(state.desk, usd);
      },
      state.creditedVentureRevenueUsd,
    );
    ventureChanged = decisions.activated.length > 0 || decisions.revenueAddedUsd > 0;
    const parts: string[] = [];
    if (decisions.activated.length > 0) parts.push(`ventures live +${decisions.activated.length}`);
    if (decisions.revenueAddedUsd > 0) parts.push(`venture revenue +$${decisions.revenueAddedUsd.toFixed(2)}`);
    if (decisions.newlyAutonomous.length > 0) parts.push(`autonomy earned: ${decisions.newlyAutonomous.join(',')}`);

    // Durable lessons from venture outcomes (facts, no model judgement).
    for (const v of decisions.activated) {
      appendLesson({ cycle, at: now(), kind: 'venture', text: `${v.id} "${v.title}" (${v.category}) went LIVE` });
    }
    if (decisions.revenueAddedUsd > 0) {
      appendLesson({ cycle, at: now(), kind: 'venture', text: `real venture revenue booked`, pnlUsd: decisions.revenueAddedUsd });
    }
    // (Venture revenue lands on the book's scoreboard equity; the end-of-cycle
    // wallet reconciliation below settles the whole book — trades, costs and
    // venture revenue alike — onto the real wallet in one move.)

    // --- Autonomous monitoring: for each LIVE venture, ping its listing (best-
    // effort) and refresh its monitor (uptime, days-live, kill-clock). This is
    // what "the agent monitors it" means without needing the human's credentials. -
    let monitored = 0;
    let killFlags = 0;
    for (const v of ventureBook.ventures) {
      if (v.status !== 'active' || !v.liveUrl) continue;
      const wasKillDue = v.monitor?.killDue ?? false;
      const reachable = await pingUrl(v.liveUrl);
      updateVentureMonitor(v, reachable, Date.now());
      monitored += 1;
      if (v.monitor?.killDue) {
        killFlags += 1;
        if (!wasKillDue) {
          appendLesson({ cycle, at: now(), kind: 'venture', text: `${v.id} "${v.title}" is past its kill window with no revenue — decide to kill or promote` });
        }
      }
    }
    if (monitored > 0) parts.push(`monitored ${monitored} live` + (killFlags ? `, ${killFlags} kill-due` : ''));

    if (parts.length > 0) ventureNote = parts.join('; ');
  }

  // Gross-exposure cap for this cycle: the SOL cap at the observed SOL price.
  const maxGrossExposureUsd = cfg.trading.maxGrossExposureSol * solPrice;

  // Paper book (pure) — drives the metabolic cost and trade sizing. The
  // scoreboard adds real venture revenue on top: the survival game (death, tiers,
  // score) reads the combined total, so real value counts toward survival while
  // paper-trading performance stays cleanly readable (they never merge in cash).
  const paperEquityPre = deskEquityUsd(state.desk, prices);
  const ventureRevUsd = ventureRevenueUsdOf(state.desk);
  const equityPre = paperEquityPre + ventureRevUsd; // scoreboard (mixed)
  const equitySolPre = equityToSol(equityPre, solPrice);

  // --- Monthly challenge: start one (at today's equity) if this state has none.
  if (cfg.challenge.enabled && !state.challenge) {
    state.challenge = initChallenge(cfg.challenge, equityPre, now());
  }
  if (state.challenge) {
    state.challenge.periodPeakEquityUsd = Math.max(
      state.challenge.periodPeakEquityUsd ?? state.challenge.periodStartEquityUsd, equityPre);
  }

  // --- Survival anchor: the REAL devnet wallet is leading ("de wallet is
  // leidend"). Read the confirmed on-chain balance up front — it governs the
  // death check and the tier below. If the RPC read fails, survivalSol() falls
  // back to the paper book's equity-in-SOL, so a transient RPC hiccup never
  // kills the agent or collapses its tier on a phantom (missing) reading.
  let walletSol: number | null = null;
  try {
    state.walletSnapshot = await readWalletSnapshot(connection, cfg.agentPubkey, executablePrices.SOL ?? 0);
    walletSol = state.walletSnapshot.lamports / 1e9;
  } catch {
    state.walletSnapshot = null;
  }
  // Paper-only by default: survival follows the book. With WALLET_ANCHOR the real
  // wallet SOL leads instead (falling back to the book on a failed RPC read).
  const survivalSolPre = cfg.wallet.anchorOnWallet ? survivalSol(walletSol, equitySolPre) : equitySolPre;
  const anchorLabel = cfg.wallet.anchorOnWallet ? 'wallet anchor' : 'paper book';

  // --- Death check: economic, in SOL, on the survival anchor. Never self-resurrect.
  if (survivalSolPre <= cfg.trading.dustSol) {
    const file = writeObituary(buildObituary(cycle, equityPre, equitySolPre, state), cycle);
    state.dead = true;
    appendLesson({
      cycle,
      at: now(),
      kind: 'death',
      text: `DIED at ${survivalSolPre.toFixed(4)} SOL (${anchorLabel}) — the market + burn + metabolism outpaced earnings`,
      pnlUsd: state.score.netPnlUsd,
    });
    appendEntry({
      cycle,
      at: now(),
      tier: 'DEAD',
      equitySol: equitySolPre,
      equityUsd: equityPre,
      walletBalanceSol: state.walletSnapshot ? state.walletSnapshot.lamports / 1e9 : null,
      model: '(none)',
      action: 'die',
      actionSummary: `survival ${survivalSolPre.toFixed(4)} SOL (${anchorLabel}; book ${equitySolPre.toFixed(4)} SOL / $${equityPre.toFixed(2)}) <= dust ${cfg.trading.dustSol} SOL — obituary ${file}`,
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

  // Tier from the survival anchor — the real wallet SOL when available, else the
  // paper book's equity-in-SOL (clamp away from DEAD; death is the check above).
  let tier = tierForBalanceSol(survivalSolPre, cfg);
  if (tier === 'DEAD') tier = 'CRITICAL';
  const policy = policyForTier(tier, cfg);

  // --- Set up tools for this cycle. -----------------------------------------
  const signer = new Signer(connection, cfg, state);
  const registry = buildRegistry();
  const pumpReady = Boolean(ventureBook?.ventures.some((v) => v.status === 'active' &&
    v.pumpToken && !v.pumpToken.mint && !state.pumpMints?.[v.id]));
  const nftReady = Boolean(ventureBook?.ventures.some((v) => v.status === 'active' &&
    v.nftAsset && !v.nftAsset.asset && !state.nftAssets?.[v.id]));
  const splReady = Boolean(ventureBook?.ventures.some((v) => v.status === 'active' &&
    v.splToken && !v.splToken.mint && !state.splMints?.[v.id]));
  const allowedToolNames = toolNamesForCycle(policy, cfg, pumpReady, nftReady, splReady);
  const tools = allowedToolNames
    .map((n) => registry.get(n))
    .filter((t): t is Tool => t !== undefined);

  const system = buildSystemPrompt({
    constitution: loadConstitution(),
    soul: soulForPrompt(),
    tools,
    railsSummary: railsSummary(cfg, maxGrossExposureUsd),
    tradableAssets: cfg.trading.assets,
    maxGrossExposureUsd,
    yieldApy: cfg.trading.yieldApy,
    venturesEnabled: Boolean(ventureBook),
    autonomousDevnetVenturesEnabled: Boolean(ventureBook && cfg.ventures.autonomousDevnetEnabled && cfg.spl.enabled),
  });
  // --- Survival metrics: give the agent the numbers to weigh its own mortality.
  const dustUsd = cfg.trading.dustSol * solPrice;
  const priorCycles = Math.max(1, cycle - 1);
  const avgBurnUsd = Math.max(state.score.cumulativeBurnUsd / priorCycles, 0.01);
  // Total drag if it just rests = compute burn + metabolic cost (the dominant
  // one). The metabolic cost is levied on the PAPER book only, so runway measures
  // the combined scoreboard against the paper-book bleed.
  const dragPerCycle = avgBurnUsd + paperEquityPre * cfg.trading.metabolicRatePerCycle;
  const runwayCycles = Math.max(0, (equityPre - dustUsd) / dragPerCycle);

  const user = buildUserPrompt({
    cycle,
    tier,
    policy,
    equityUsd: equityPre,
    equitySol: equitySolPre,
    walletSol: cfg.wallet.anchorOnWallet ? walletSol : undefined,
    survivalSol: survivalSolPre,
    dustSol: cfg.trading.dustSol,
    dustUsd,
    avgBurnUsd,
    runwayCycles,
    metabolicDailyPct: cfg.trading.metabolicRatePerCycle * 96 * 100, // ~cycles/day
    prices: executablePrices,
    prevPrices,
    deskSummary: summarizeDesk(state.desk, prices),
    score: state.score,
    journalDigest: digestRecent(8),
    obituaryDigest: obituaryDigest(),
    ventureDigest: ventureBook ? ventureDigest(ventureBook) : undefined,
    lessonsDigest: lessonsDigest(cfg.memory.lessonsInPrompt),
    // No soft nudge: reflection is now GUARANTEED by the auto-reflect step below,
    // so we never spend the agent's action on it. The reflect tool stays available.
    reflectNudge: false,
    // Sustained-loss signal: escalates concern on a drawdown / losing streak, and
    // the prompt prescribes DE-RISKING (not more trading) as the response.
    lossTrend: assessLossTrend({
      equityUsd: equityPre,
      // Under the challenge, judge the drawdown against this month's peak: an
      // all-time peak from an earlier regime would pin the agent in permanent
      // "cut risk" mode and make the monthly minimum unreachable.
      peakEquityUsd: state.challenge?.periodPeakEquityUsd ?? state.score.peakEquityUsd,
      recentPnls: readRecent(10).map((e) => Number(e.cyclePnlUsd) || 0),
    }),
    hasOpenPositions: Object.keys(state.desk.positions).length > 0,
    // Deliberately NO challenge here: lives and month results are a scoring rule
    // for the experiment and context for the weekly evaluator, never pressure on
    // a trade decision (a calendar goal pushes the decider to force trades).
  });

  // --- Think only when another decision can add information. On a flat book
  // with repeated no-op decisions, a periodic decision and market-move wakeup
  // preserve agency while observation-only cycles avoid unproductive API burn.
  const llm = deps.llm ?? new AnthropicClient();
  const recentDecisionTimes = readRecent(120)
    .filter((e) => e.model && e.model !== '(none)')
    .map((e) => e.at);
  const whyDecide = decisionReason({
    now: now(),
    cfg: cfg.decisions,
    prices: executablePrices,
    openAssets: Object.keys(state.desk.positions),
    lastDecision: state.lastDecision,
    recentDecisionTimes,
    ventureChanged,
    onchainActionReady: pumpReady || nftReady || splReady,
  });
  const observeOnly = whyDecide === null;
  let resp: LLMResponse | undefined;
  if (!observeOnly) {
    resp = await llm.generate({
      model: policy.model,
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: policy.maxTokens,
      effort: policy.effort,
    });
    state.lastDecision = { at: now(), prices: { ...prices } };
  }
  const costUsd = resp ? computeCostUsd(policy.model, resp.usage) : 0;

  // --- Decide + act (fall back to rest on any ambiguity). -------------------
  const action: AgentAction | null = resp ? parseAction(resp.text) : null;
  let chosenName = action?.tool ?? 'rest';
  let coerceNote: string | undefined = observeOnly
    ? `observation-only: no LLM call (next scheduled decision ≤${cfg.decisions.minHoursBetween}h after the last, sooner on a big move)`
    : `decision: ${whyDecide}`;
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
    prices: executablePrices,
    prevPrices,
    maxGrossExposureUsd,
    tier,
    policy,
    cycle,
    ventureBook: ventureBook ?? undefined,
  };
  // Snapshot the book before the action so we can record REALIZED PnL on any
  // position the trade closes or reduces — a concrete lesson from its own trading.
  const positionsBefore = structuredClone(state.desk.positions);
  let toolResult: ToolResult;
  try {
    toolResult = await tool.execute(action?.input ?? {}, ctx);
  } catch (err) {
    toolResult = { summary: `tool "${chosenName}" failed: ${errMsg(err)}`, note: `tool error: ${errMsg(err)}` };
  }
  const traded = toolResult.traded ?? false;
  const signatures: string[] = [...(toolResult.signatures ?? [])];
  let autonomousNote: string | undefined;
  if (cfg.ventures.autonomousDevnetEnabled && ventureBook) {
    const ready = ventureBook.ventures.find((v) => v.launchMode === 'autonomous-devnet' &&
      v.status === 'active' && v.createdAtCycle < cycle && v.splToken &&
      !v.splToken.mint && !state.splMints?.[v.id]);
    if (ready) {
      try {
        const minted = await signer.createSplToken(ready);
        ready.splToken = { ...ready.splToken!, mint: minted.mint, signature: minted.signature };
        signatures.push(minted.signature);
        recordTx(state, { kind: 'spl-create', signature: minted.signature,
          lamports: minted.lamports, from: cfg.agentPubkey,
          to: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', cycle, at: now(),
          note: `autonomous Token-2022 venture ${ready.id}` });
        autonomousNote = `autonomous venture ${ready.id} minted ${minted.mint} on devnet; no revenue`;
      } catch (err) {
        autonomousNote = `autonomous venture ${ready.id} waiting: ${errMsg(err)}`;
      }
    }
  }

  // --- Learn from this action: durable lessons ledger. ----------------------
  if (traded) {
    const { realizedUsd, legs } = realizedFromClose(positionsBefore, state.desk.positions, prices);
    const notable = legs.length > 0 && Math.abs(realizedUsd) >= Math.max(1, paperEquityPre * 0.005);
    if (notable) {
      appendLesson({
        cycle,
        at: now(),
        kind: 'trade',
        text: `${chosenName} realized ${legs.join(', ')}`,
        pnlUsd: realizedUsd,
      });
    }
  }
  if (toolResult.soulUpdated) {
    appendLesson({
      cycle,
      at: now(),
      kind: 'reflection',
      text: action?.rationale ? `reflected: ${action.rationale.slice(0, 200)}` : 'reflected: rewrote SOUL.md',
    });
  }

  // Record any on-chain transfer the tool made (e.g. Phase 2 transfer).
  if (tool.movesValue) {
    if (toolResult.transfer) {
      recordTx(state, {
        kind: chosenName === 'pump_create' ? 'pump-create' : chosenName === 'nft_create' ? 'nft-create' :
          chosenName === 'spl_create' ? 'spl-create' : 'transfer',
        signature: toolResult.transfer.signature,
        lamports: toolResult.transfer.lamports,
        from: cfg.agentPubkey,
        to: toolResult.transfer.to,
        cycle,
        at: now(),
        note: toolResult.note,
      });
    }
  }

  // --- Settle the compute burn against the book (economic). -----------------
  state.desk.cashUsd -= costUsd;

  // --- Metabolic cost: the "cost of living" as a fraction of equity, so it bites
  // at every book size — the forcing function against coasting. It is charged on
  // the book; when the wallet mirrors the book (below), it flows through to the
  // real wallet as part of the one end-of-cycle reconciliation. -----------------
  const metabolicUsd = paperEquityPre * cfg.trading.metabolicRatePerCycle;
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

  // --- Guaranteed reflection: every N cycles the loop itself distils the recent
  // lessons into SOUL.md via a small, cheap LLM call — so memory consolidates on
  // schedule regardless of whether the agent chose to reflect. Best-effort; its
  // cost is folded into this cycle's burn below. -----------------------------
  let reflectNote: string | undefined;
  let reflectCostUsd = 0;
  // Weekly evaluation by a heavier model (the "coach"): it reviews the period
  // against the monthly challenge and rewrites the strategy notes the cheap
  // decision model then follows. Time-based, so the cadence of decisions and of
  // the heartbeat cannot multiply its cost.
  const lastReflectMs = state.lastReflectAt ? Date.parse(state.lastReflectAt) : NaN;
  const autoReflectDue = cfg.memory.reflectEveryDays > 0 &&
    (!Number.isFinite(lastReflectMs) || Date.now() - lastReflectMs >= cfg.memory.reflectEveryDays * 86_400_000);
  if (autoReflectDue) {
    try {
      state.lastReflectAt = now();
      const res = await autoReflect(llm, {
        cfg,
        cycle,
        score: state.score,
        lessonsShown: cfg.memory.lessonsInPrompt,
        solPriceUsd: solPrice,
        challenge: state.challenge
          ? { ...challengeStatus(state.challenge, cfg.challenge, equityPre, now()), history: state.challenge.history }
          : undefined,
      });
      reflectCostUsd = res.costUsd;
      state.desk.cashUsd -= reflectCostUsd;
      reflectNote = res.note;
      if (res.ok) {
        appendLesson({ cycle, at: now(), kind: 'reflection', text: 'auto-reflected: consolidated lessons into SOUL.md' });
      }
    } catch (err) {
      reflectNote = `auto-reflect failed: ${errMsg(err)}`;
    }
  }

  // --- Score: recompute the scoreboard equity after trades + burn. The score is
  // the COMBINED total (paper book + real venture revenue); paper-only equity is
  // still recoverable as equityPost - ventureRevUsd. --------------------------
  const paperEquityPost = deskEquityUsd(state.desk, prices);
  const equityPost = paperEquityPost + ventureRevUsd;
  const cyclePnlUsd = equityPost - state.score.equityUsd;
  const hadFirstProfit = state.score.firstProfitAtCycle !== null;
  state.score = updateScore(state.score, {
    cycle,
    equityUsd: equityPost,
    burnUsd: costUsd + reflectCostUsd,
    traded,
    paperEquityUsd: paperEquityPost,
    reportedVentureRevenueUsd: ventureRevUsd,
    solHoldBenchmarkUsd: typeof executablePrices.SOL === 'number' && state.genesisSolPriceUsd > 0
      ? state.desk.capitalUsd * executablePrices.SOL / state.genesisSolPriceUsd
      : null,
  });
  state.lastPrices = prices;

  // --- Wallet reconciliation: the wallet IS the trading account. Settle the
  // whole book (trades — with fees/spread/slippage/borrow already applied —, the
  // metabolic cost and venture revenue) onto the real devnet wallet so it moves
  // with performance: a gain airdrops SOL IN, a loss burns SOL OUT. Capped per
  // cycle and floored for fees. This is a devnet on-chain SIMULATION — the inflow
  // is faucet SOL, not real profit (real profit needs a real market / mainnet,
  // out of scope). OFF by default (WALLET_REAL_ECONOMY). Best-effort: a faucet
  // rate-limit or RPC hiccup just leaves the wallet to catch up next cycle. ------
  let settleNote: string | undefined;
  if (cfg.wallet.realEconomyEnabled) {
    const move = reconcileLamports({
      bookEquityUsd: equityPost,
      solPriceUsd: solPrice,
      walletLamports: state.walletSnapshot ? state.walletSnapshot.lamports : null,
      maxMovePerCycleSol: cfg.wallet.maxSettlePerCycleSol,
      floorSol: cfg.wallet.floorSol,
    });
    if (move > 0) {
      try {
        const sig = await settlementAirdrop(connection, cfg.agentPubkey, move);
        signatures.push(sig);
        recordTx(state, {
          kind: 'wallet-settle', signature: sig, lamports: move,
          from: '(devnet faucet)', to: cfg.agentPubkey, cycle, at: now(), note: 'settle trading gain',
        });
        settleNote = `wallet +${(move / 1e9).toFixed(6)} SOL (settle gain)`;
      } catch (err) {
        settleNote = `wallet settle airdrop skipped (${errMsg(err)})`;
      }
    } else if (move < 0) {
      const burn = -move;
      try {
        const res = await signer.burnLamports(burn, `settle:cycle:${cycle}`);
        signatures.push(res.signature);
        recordTx(state, {
          kind: 'wallet-settle', signature: res.signature, lamports: burn,
          from: cfg.agentPubkey, to: INCINERATOR_ADDRESS, cycle, at: now(), note: 'settle trading loss',
        });
        settleNote = `wallet -${(burn / 1e9).toFixed(6)} SOL (settle loss)`;
      } catch (err) {
        settleNote = `wallet settle burn skipped (${errMsg(err)})`;
      }
    }
  }

  // --- Monthly challenge: charge this cycle's compute to the period, then close
  // the period if its 30 days are up. Missing the minimum costs a life; the last
  // life lost is death. -----------------------------------------------------------
  let challengeNote: string | undefined;
  if (cfg.challenge.enabled && state.challenge) {
    state.challenge.periodComputeUsd = (state.challenge.periodComputeUsd ?? 0) + costUsd + reflectCostUsd;
    const { next, closed } = evaluateChallenge(state.challenge, cfg.challenge, equityPost, now());
    state.challenge = next;
    if (closed) {
      const pct = (closed.returnPct * 100).toFixed(2);
      const verdict = `${closed.label}: ${fmtLivesDelta(closed.livesDelta)} life → ${closed.livesAfter} left`;
      challengeNote = `challenge period ${closed.period} closed: ${closed.returnPct >= 0 ? '+' : ''}${pct}% — ${verdict}`;
      appendLesson({
        cycle,
        at: now(),
        // 'challenge' lessons never reach the decision prompt or SOUL history.
        kind: next.lives <= 0 ? 'death' : 'challenge',
        text: `month ${closed.period}: ${closed.returnPct >= 0 ? '+' : ''}${pct}% — ${verdict}`,
        pnlUsd: closed.endEquityUsd - closed.startEquityUsd,
      });
      if (next.lives <= 0) {
        state.dead = true;
        writeObituary(
          buildObituary(cycle, equityPost, equityToSol(equityPost, solPrice), state,
            `Lost my last life: month ${closed.period} returned ${pct}% (${closed.label}).`),
          cycle,
        );
        challengeNote += ' — DEAD (no lives left)';
      }
    }
  }

  // Milestone lesson: the first time net PnL turns positive.
  if (!hadFirstProfit && state.score.firstProfitAtCycle === cycle) {
    appendLesson({
      cycle,
      at: now(),
      kind: 'milestone',
      text: `first profit — net PnL turned positive`,
      pnlUsd: state.score.netPnlUsd,
    });
  }

  // Sustained-sovereign tracking for the Phase 3 replication gate (high book only).
  // Anchored on the same real-wallet survival balance as the live tier above.
  const finalTier = tierForBalanceSol(
    cfg.wallet.anchorOnWallet ? survivalSol(walletSol, equityToSol(equityPost, solPrice)) : equityToSol(equityPost, solPrice), cfg);
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

  // Read after all on-chain actions, including a possible child funding.
  // An RPC failure clears the previous snapshot rather than displaying stale SOL.
  let walletNote: string | undefined;
  try {
    state.walletSnapshot = await readWalletSnapshot(connection, cfg.agentPubkey, executablePrices.SOL ?? 0);
  } catch (err) {
    state.walletSnapshot = null;
    walletNote = `wallet balance unavailable (${errMsg(err)})`;
  }

  // --- Persist. -------------------------------------------------------------
  const noteParts = [
    coerceNote,
    priceNote,
    yieldNote,
    borrowNote,
    metabolicNote,
    settleNote,
    ventureNote,
    autonomousNote,
    reflectNote,
    toolResult.note,
    heartbeatNote,
    replicationNote,
    walletNote,
  ].filter(Boolean);
  const entry: JournalEntry = {
    cycle,
    at: now(),
    tier,
    equitySol: equityToSol(equityPost, solPrice),
    solPriceUsd: solPrice,
    equityUsd: equityPost,
    walletBalanceSol: state.walletSnapshot ? state.walletSnapshot.lamports / 1e9 : null,
    model: resp ? policy.model : '(none)',
    action: chosenName,
    actionSummary: toolResult.summary,
    rationale: action?.rationale,
    reasoning: resp?.thinking,
    costUsd,
    cyclePnlUsd,
    signatures,
    score: state.score,
    note: noteParts.join(' | ') || undefined,
    // Kept out of `note`: notes feed the decision prompt's recent-cycles digest.
    challengeEvent: challengeNote,
  };
  state.lastRunAt = now();
  syncSoulHistory(recentLessons(Number.MAX_SAFE_INTEGER));
  await store.save(state);
  if (ventureBook) saveVentureBook(ventureBook);
  appendEntry(entry);

  return {
    exitCode: state.dead ? 1 : 0,
    summary:
      (state.dead ? 'DEAD (challenge: no lives left) — ' : '') +
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
    walletBalanceSol: state.walletSnapshot ? state.walletSnapshot.lamports / 1e9 : null,
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
  cause?: string,
): string {
  return [
    `# Obituary`,
    ``,
    cause
      ? `Died at cycle ${cycle} with a book of ${equitySol.toFixed(4)} SOL ($${equityUsd.toFixed(2)}). ${cause}`
      : `Died at cycle ${cycle} with a book of ${equitySol.toFixed(4)} SOL ($${equityUsd.toFixed(2)}) (at or below the dust threshold).`,
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

/** Best-effort reachability check for a live venture's listing. Never throws; a
 * timeout, DNS failure, or non-2xx just means "not reachable this cycle". */
async function pingUrl(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'user-agent': 'ApexAutomaton-monitor/1.0', accept: 'text/html' },
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
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
