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
  marketPubkey: string;
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
   * Death is economic: book equity <= dust. */
  trading: {
    /** starting paper book size in USD (the modeled "$500 of SOL"). */
    capitalUsd: number;
    /** cap on total gross exposure (sum of |position value|) in USD. */
    maxGrossExposureUsd: number;
    /** tradable symbols (priced from the real market); SOL is always fetched too. */
    assets: string[];
    /** whether the agent may hold short (negative) positions. */
    allowShort: boolean;
    /** economic death threshold: book equity at/below this (USD) is DEAD. */
    dustUsd: number;
    /** base URL of the price API (default: CoinGecko simple price). */
    priceApiBase: string;
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
    marketPubkey: requiredPubkey('MARKET_PUBKEY'),
    computeProviderPubkey: requiredPubkey('COMPUTE_PROVIDER_PUBKEY'),
    operatorPubkey: envStr('OPERATOR_PUBKEY'),

    models: {
      cheapest: envStr('MODEL_CHEAPEST') ?? 'claude-haiku-4-5',
      cheaper: envStr('MODEL_CHEAPER') ?? 'claude-sonnet-5',
      frontier: envStr('MODEL_FRONTIER') ?? 'claude-opus-5',
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
      capitalUsd: envNum('PAPER_TRADING_CAPITAL_USD', 500),
      maxGrossExposureUsd: envNum(
        'MAX_GROSS_EXPOSURE_USD',
        envNum('PAPER_TRADING_CAPITAL_USD', 500),
      ),
      assets: (
        envStr('TRADING_ASSETS') ??
        'BTC,ETH,SOL,BNB,XRP,ADA,DOGE,AVAX,LINK,DOT,LTC,MATIC,ATOM,UNI,ARB,SUI,JUP,BONK,WIF,PYTH,RENDER,PAXG'
      )
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0),
      allowShort: envBool('ALLOW_SHORT', true),
      dustUsd: envNum('TRADING_DUST_USD', 5),
      priceApiBase:
        envStr('PRICE_API_BASE') ?? 'https://api.coingecko.com/api/v3/simple/price',
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

/**
 * The necessary condition for growth: one task must pay more than the worst-case
 * cost of the cycle that decides to do it. This does NOT guarantee the agent
 * will earn — only that earning is not mathematically self-defeating. The
 * growth-guard test asserts this so a net-negative economy fails the build.
 */
export function worstCaseCycleBurnSol(cfg: Config): number {
  return cfg.economy.solPerUsd * cfg.economy.estimatedMaxCycleCostUsd;
}

export function economyCanGrow(cfg: Config): boolean {
  return cfg.economy.marketTaskRewardSol > worstCaseCycleBurnSol(cfg);
}
