import 'dotenv/config';
import { clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Central configuration. Everything here is loaded once at process start.
 *
 * The single most important invariant in this whole codebase lives in
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
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
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
    normal: string;
    low: string;
    critical: string;
  };

  economy: {
    solPerUsd: number;
    marketTaskRewardSol: number;
  };

  tiers: {
    normalMinSol: number;
    lowMinSol: number;
    dustThresholdSol: number;
  };

  rails: {
    perTxCapSol: number;
    dailyCapSol: number;
    maxTxPerCycle: number;
    maxTxPerDay: number;
    killSwitch: boolean;
  };

  replication: {
    fundSol: number;
    minBalanceSol: number;
  };

  seed: {
    airdropSol: number;
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
      normal: envStr('MODEL_NORMAL') ?? 'claude-opus-5',
      low: envStr('MODEL_LOW') ?? 'claude-sonnet-5',
      critical: envStr('MODEL_CRITICAL') ?? 'claude-haiku-4-5',
    },

    economy: {
      solPerUsd: envNum('SOL_PER_USD', 1.0),
      marketTaskRewardSol: envNum('MARKET_TASK_REWARD_SOL', 0.05),
    },

    tiers: {
      normalMinSol: envNum('TIER_NORMAL_MIN_SOL', 0.5),
      lowMinSol: envNum('TIER_LOW_MIN_SOL', 0.1),
      dustThresholdSol: envNum('DUST_THRESHOLD_SOL', 0.001),
    },

    rails: {
      perTxCapSol: envNum('PER_TX_CAP_SOL', 0.25),
      dailyCapSol: envNum('DAILY_CAP_SOL', 1.0),
      maxTxPerCycle: Math.trunc(envNum('MAX_TX_PER_CYCLE', 2)),
      maxTxPerDay: Math.trunc(envNum('MAX_TX_PER_DAY', 20)),
      killSwitch: envBool('KILL_SWITCH', false),
    },

    replication: {
      fundSol: envNum('REPLICATION_FUND_SOL', 0.1),
      minBalanceSol: envNum('REPLICATION_MIN_BALANCE_SOL', 0.75),
    },

    seed: {
      airdropSol: envNum('SEED_AIRDROP_SOL', 1.0),
    },
  };

  // Sanity: thresholds must be ordered dust < low < normal.
  const { dustThresholdSol, lowMinSol, normalMinSol } = cfg.tiers;
  if (!(dustThresholdSol < lowMinSol && lowMinSol < normalMinSol)) {
    throw new Error(
      `Config error: tier thresholds must satisfy dust(${dustThresholdSol}) < ` +
        `low(${lowMinSol}) < normal(${normalMinSol}).`,
    );
  }
  return cfg;
}
