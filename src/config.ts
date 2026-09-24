import 'dotenv/config';
import { clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Central configuration. Loaded once at process start.
 *
 * The single most important invariant in this codebase lives in
 * {@link assertDevnet}: there is NO code path that reaches mainnet-beta. Any
 * attempt to point the RPC at mainnet throws and the process exits.
 */

function envStr(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
}

function envNum(name: string, fallback: number): number {
  const raw = envStr(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Config error: ${name}=${raw} is not a finite number`);
  }
  return n;
}

function envBool(name: string, fallback = false): boolean {
  const raw = envStr(name);
  if (raw === undefined) return fallback;
  const l = raw.toLowerCase();
  return l === '1' || l === 'true' || l === 'yes';
}

function requiredPubkey(name: string): string {
  const v = envStr(name);
  if (v === undefined) {
    throw new Error(
      `Config error: ${name} is required (a base58 Solana public key). See .env.example.`,
    );
  }
  return v;
}

/**
 * HARD LOCK to devnet. Called for every RPC URL the process would ever use.
 * Rejects mainnet outright; requires a recognizably-devnet (or local) endpoint.
 */
export function assertDevnet(url: string): void {
  const lowered = url.toLowerCase();
  if (lowered.includes('mainnet')) {
    throw new Error(
      `FATAL: mainnet endpoints are forbidden by design. Got: ${url}. ` +
        `Apex Automaton is hard-locked to devnet; there is no mainnet code path.`,
    );
  }
  const isDevnetLike =
    lowered.includes('devnet') ||
    lowered.includes('localhost') ||
    lowered.includes('127.0.0.1');
  if (!isDevnetLike) {
    throw new Error(
      `FATAL: RPC endpoint must be devnet (or a local validator). Got: ${url}.`,
    );
  }
}

function resolveRpcUrl(): string {
  const fromEnv = envStr('SOLANA_RPC_URL');
  const url = fromEnv ?? clusterApiUrl('devnet');
  assertDevnet(url);
  return url;
}

export const solToLamports = (sol: number): number =>
  Math.round(sol * LAMPORTS_PER_SOL);
export const lamportsToSol = (lamports: number): number =>
  lamports / LAMPORTS_PER_SOL;

export interface Config {
  cluster: 'devnet';
  rpcUrl: string;

  agentPubkey: string;
  /** optional: only used by the legacy modeled market (seed:market). */
  marketPubkey: string | undefined;
  computeProviderPubkey: string;
  operatorPubkey: string | undefined;

  models: {
    cheapest: string;
    cheaper: string;
    frontier: string;
  };

  economy: {
    solPerUsd: number;
    marketTaskRewardSol: number;
    estimatedMaxCycleCostUsd: number;
  };

  /** Lower bound (inclusive) of each tier, in SOL. See tiers.ts. */
  tiers: {
    dustThresholdSol: number;
    criticalMinSol: number;
    normalMinSol: number;
    abundantMinSol: number;
    sovereignMinSol: number;
  };

  rails: {
    perTxCapSol: number;
    dailyCapSol: number;
    maxTxPerCycle: number;
    maxTxPerDay: number;
    killSwitch: boolean;
  };

  replication: {
    thresholdSol: number;
    sustainedCycles: number;
    childSeedSol: number;
    maxPopulation: number;
  };

  seed: {
    airdropSol: number;
    marketAirdropSol: number;
  };

  /** Trading layer — the agent grows a paper book against REAL market prices.
   * No real funds are ever at risk; the devnet layer stays the on-chain proof.
   * The whole game is denominated in SOL: the stake is a number of SOL, priced
   * to USD at genesis with the live SOL price, and death is economic (book
   * equity, in SOL, at/below dust). */
  trading: {
    /** starting paper book size, in SOL (the modeled "1 SOL of capital"). It is
     * priced to USD once, at genesis, using the live SOL/USD price. */
    capitalSol: number;
    /** optional explicit USD stake. When set, it overrides the SOL stake (the
     * book starts at exactly this many USD instead of `capitalSol` × SOL price). */
    capitalUsdOverride: number | undefined;
    /** cap on total gross exposure (sum of |position value|), in SOL. Converted
     * to USD each cycle at the live SOL price. */
    maxGrossExposureSol: number;
    /** tradable symbols (priced from the real market); SOL is always fetched too. */
    assets: string[];
    /** whether the agent may hold short (negative) positions. */
    allowShort: boolean;
    /** Simulated execution costs in basis points, each charged on traded notional. */
    feeBps: number;
    spreadBps: number;
    slippageBps: number;
    /** Simulated annual borrow cost on open shorts. */
    shortBorrowApy: number;
    /** economic death threshold: book equity at/below this (in SOL) is DEAD. */
    dustSol: number;
    /** real annual yield (as a fraction, e.g. 0.05 = 5% APY) earned on capital
     * the agent PARKS in the yield sleeve — a real, non-directional carry it can
     * choose instead of trading. Accrued by wall-clock time, so it is honest and
     * modest: it only becomes a survival path once the book is large. 0 disables. */
    yieldApy: number;
    /** metabolic cost per cycle, as a FRACTION OF EQUITY (e.g. 0.0001 = 0.01%/cycle
     * ≈ ~1%/day at 15-min cycles). A "cost of living" that scales with the book, so
     * it bites at every size — the agent must out-earn its own metabolism or it
     * slowly starves. This is the forcing function against coasting on a small gain.
     * 0 disables. */
    metabolicRatePerCycle: number;
    /** base URL of the price API (default: CoinGecko simple price). */
    priceApiBase: string;
  };

  /** Memory / learning: a durable lessons ledger fed back each cycle, plus a
   * periodic nudge to consolidate lessons into SOUL.md via the reflect tool. */
  memory: {
    /** nudge the agent to reflect every N cycles (0 disables the periodic nudge). */
    reflectEveryCycles: number;
    /** how many recent lessons to show in the prompt. */
    lessonsInPrompt: number;
  };

  /** The Venture layer — the agent's reach into the REAL economy (opportunity
   * scanning + building, gated by a human approval queue). Additive: the paper
   * survival game is unchanged when disabled. */
  ventures: {
    /** expose the propose_venture tool and the pipeline in the prompt. */
    enabled: boolean;
    /** approvals of one category needed before it is flagged "autonomy-earned". */
    autonomyThreshold: number;
  };

  /** Phase 2/3 feature flags. All default OFF — Phase 1 behaviour is unchanged
   * unless these are explicitly enabled. */
  features: {
    /** Phase 3: allow code-driven replication at the SOVEREIGN tier. */
    replicationEnabled: boolean;
    /** Phase 2: use the off-chain revenue adapter (still devnet-settled). */
    offchainRevenueEnabled: boolean;
    /** Phase 2: expose the extra value-moving tools (e.g. transfer). */
    extraToolsEnabled: boolean;
  };

  /** Phase 2: optional Firestore state backend. Enabled when a project id is
   * present; otherwise the committed file store is used. */
  firestore: {
    enabled: boolean;
    projectId: string | undefined;
    collection: string;
    documentId: string;
  };
}

export function loadConfig(): Config {
  const cfg: Config = {
    cluster: 'devnet',
    rpcUrl: resolveRpcUrl(),

    agentPubkey: requiredPubkey('AGENT_PUBKEY'),
    // Optional now — the trading loop does not use the modeled market.
    marketPubkey: envStr('MARKET_PUBKEY'),
    computeProviderPubkey: requiredPubkey('COMPUTE_PROVIDER_PUBKEY'),
    operatorPubkey: envStr('OPERATOR_PUBKEY'),

    models: {
      cheapest: envStr('MODEL_CHEAPEST') ?? 'claude-haiku-4-5',
      cheaper: envStr('MODEL_CHEAPER') ?? 'claude-sonnet-5',
      frontier: envStr('MODEL_FRONTIER') ?? 'claude-opus-5-5',
    },

    economy: {
      solPerUsd: envNum('SOL_PER_USD', 1.0),
      marketTaskRewardSol: envNum('MARKET_TASK_REWARD_SOL', 0.2),
      estimatedMaxCycleCostUsd: envNum('ESTIMATED_MAX_CYCLE_COST_USD', 0.08),
    },

    tiers: {
      dustThresholdSol: envNum('DUST_THRESHOLD_SOL', 0.001),
      criticalMinSol: envNum('TIER_CRITICAL_MIN_SOL', 0.1),
      normalMinSol: envNum('TIER_NORMAL_MIN_SOL', 0.5),
      abundantMinSol: envNum('TIER_ABUNDANT_MIN_SOL', 2.0),
      sovereignMinSol: envNum('TIER_SOVEREIGN_MIN_SOL', 5.0),
    },

    rails: {
      perTxCapSol: envNum('PER_TX_CAP_SOL', 0.25),
      dailyCapSol: envNum('DAILY_CAP_SOL', 1.0),
      maxTxPerCycle: Math.trunc(envNum('MAX_TX_PER_CYCLE', 2)),
      maxTxPerDay: Math.trunc(envNum('MAX_TX_PER_DAY', 20)),
      killSwitch: envBool('KILL_SWITCH', false),
    },

    replication: {
      thresholdSol: envNum('REPLICATE_THRESHOLD_SOL', 5.0),
      sustainedCycles: Math.trunc(envNum('REPLICATE_SUSTAINED_CYCLES', 5)),
      // Default kept <= PER_TX_CAP_SOL so funding a child is a normal, capped
      // transfer the signer will accept. Caps override replication, always.
      childSeedSol: envNum('CHILD_SEED_SOL', 0.1),
      maxPopulation: Math.trunc(envNum('MAX_POPULATION', 4)),
    },

    seed: {
      airdropSol: envNum('SEED_AIRDROP_SOL', 1.0),
      marketAirdropSol: envNum('MARKET_SEED_AIRDROP_SOL', 2.0),
    },

    trading: {
      capitalSol: envNum('PAPER_TRADING_CAPITAL_SOL', 2.0),
      capitalUsdOverride:
        envStr('PAPER_TRADING_CAPITAL_USD') === undefined
          ? undefined
          : envNum('PAPER_TRADING_CAPITAL_USD', 0),
      maxGrossExposureSol: envNum(
        'MAX_GROSS_EXPOSURE_SOL',
        envNum('PAPER_TRADING_CAPITAL_SOL', 2.0),
      ),
      // SOL is deliberately NOT tradable: the game is denominated in SOL (priced
      // once at genesis), so letting the agent trade SOL invites meta-gaming its
      // own score. It is still priced for that one-time genesis conversion.
      assets: (
        envStr('TRADING_ASSETS') ??
        // A broad, multi-asset-class universe, all priced from REAL markets:
        //   crypto (Coinbase/CoinGecko) · gold · forex · commodities · equities (Yahoo).
        'BTC,ETH,BNB,XRP,ADA,DOGE,AVAX,TRX,LINK,DOT,LTC,BCH,ATOM,UNI,AAVE,ARB,OP,SUI,APT,NEAR,INJ,TIA,RENDER,JUP,BONK,WIF,PYTH,ORCA,' +
        'PAXG,EURUSD,GBPUSD,AUDUSD,WTI,XAG,COPPER,NATGAS,AAPL,MSFT,NVDA,TSLA,AMZN,SPY,QQQ'
      )
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0),
      allowShort: envBool('ALLOW_SHORT', true),
      feeBps: envNum('TRADING_FEE_BPS', 10),
      spreadBps: envNum('TRADING_SPREAD_BPS', 5),
      slippageBps: envNum('TRADING_SLIPPAGE_BPS', 5),
      shortBorrowApy: envNum('SHORT_BORROW_APY', 0.08),
      dustSol: envNum('TRADING_DUST_SOL', 0.02),
      yieldApy: envNum('YIELD_APY', 0),
      metabolicRatePerCycle: envNum('METABOLIC_RATE_PER_CYCLE', 0.0001),
      priceApiBase:
        envStr('PRICE_API_BASE') ?? 'https://api.coingecko.com/api/v3/simple/price',
    },

    memory: {
      reflectEveryCycles: Math.trunc(envNum('REFLECT_EVERY_CYCLES', 12)),
      lessonsInPrompt: Math.trunc(envNum('LESSONS_IN_PROMPT', 8)),
    },

    ventures: {
      enabled: envBool('VENTURES_ENABLED', true),
      autonomyThreshold: Math.trunc(envNum('VENTURE_AUTONOMY_THRESHOLD', 10)),
    },

    features: {
      replicationEnabled: envBool('REPLICATION_ENABLED', false),
      offchainRevenueEnabled: envBool('OFFCHAIN_REVENUE_ENABLED', false),
      extraToolsEnabled: envBool('PHASE2_TOOLS_ENABLED', false),
    },

    firestore: {
      enabled: envStr('FIRESTORE_PROJECT_ID') !== undefined,
      projectId: envStr('FIRESTORE_PROJECT_ID'),
      collection: envStr('FIRESTORE_COLLECTION') ?? 'automaton',
      documentId: envStr('FIRESTORE_DOCUMENT_ID') ?? 'state',
    },
  };

  validateConfig(cfg);
  return cfg;
}

/** Structural checks that must hold for the tier gradient to make sense. */
export function validateConfig(cfg: Config): void {
  if (cfg.features.replicationEnabled) {
    throw new Error('Replication is disabled until children have an independent runtime and measurable strategy.');
  }
  if (cfg.trading.capitalSol <= 0 || cfg.trading.dustSol < 0 || cfg.trading.maxGrossExposureSol <= 0 ||
      [cfg.trading.feeBps, cfg.trading.spreadBps, cfg.trading.slippageBps, cfg.trading.shortBorrowApy, cfg.trading.yieldApy].some((n) => !Number.isFinite(n) || n < 0) ||
      cfg.trading.spreadBps + cfg.trading.slippageBps >= 10_000) {
    throw new Error('Config error: invalid trading capital, caps, execution costs, or yield.');
  }
  const { dustThresholdSol, criticalMinSol, normalMinSol, abundantMinSol, sovereignMinSol } =
    cfg.tiers;
  const ordered =
    dustThresholdSol < criticalMinSol &&
    criticalMinSol < normalMinSol &&
    normalMinSol < abundantMinSol &&
    abundantMinSol < sovereignMinSol;
  if (!ordered) {
    throw new Error(
      `Config error: tier thresholds must be strictly increasing: dust(${dustThresholdSol}) < ` +
        `critical(${criticalMinSol}) < normal(${normalMinSol}) < abundant(${abundantMinSol}) < ` +
        `sovereign(${sovereignMinSol}).`,
    );
  }
}

/** Legacy task-market arithmetic. The trading loop does not use this as a growth guarantee. */
export function worstCaseCycleBurnSol(cfg: Config): number {
  return cfg.economy.solPerUsd * cfg.economy.estimatedMaxCycleCostUsd;
}

export function economyCanGrow(cfg: Config): boolean {
  return cfg.economy.marketTaskRewardSol > worstCaseCycleBurnSol(cfg);
}

/**
 * Genesis book size in USD. The stake is SOL-denominated, so we price it to USD
 * exactly once — at birth — with the live SOL/USD price. A fixed-USD override
 * (PAPER_TRADING_CAPITAL_USD) short-circuits this. Used by the loop the first
 * time it sees a real price, to fund the freshly-created (unfunded) book.
 */
export function genesisCapitalUsd(cfg: Config, solPriceUsd: number): number {
  if (cfg.trading.capitalUsdOverride !== undefined) return cfg.trading.capitalUsdOverride;
  return cfg.trading.capitalSol * (solPriceUsd > 0 ? solPriceUsd : 0);
}
