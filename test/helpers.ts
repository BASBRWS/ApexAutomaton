import type { Config } from '../src/config.js';

/** A complete Config for tests, independent of process.env. Mirrors the
 * shipped defaults so tests double as a check on those defaults. */
export function makeTestConfig(overrides: Partial<Config> = {}): Config {
  const base: Config = {
    cluster: 'devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    agentPubkey: 'AGENTpubkey1111111111111111111111111111111',
    marketPubkey: 'MARKETpubkey111111111111111111111111111111',
    computeProviderPubkey: 'COMPUTEpubkey11111111111111111111111111111',
    operatorPubkey: 'OPERATORpubkey1111111111111111111111111111',
    models: {
      cheapest: 'claude-haiku-4-5',
      cheaper: 'claude-sonnet-5',
      frontier: 'claude-opus-5',
    },
    economy: {
      solPerUsd: 1.0,
      marketTaskRewardSol: 0.2,
      estimatedMaxCycleCostUsd: 0.08,
    },
    tiers: {
      dustThresholdSol: 0.001,
      criticalMinSol: 0.1,
      normalMinSol: 0.5,
      abundantMinSol: 2.0,
      sovereignMinSol: 5.0,
    },
    rails: {
      perTxCapSol: 0.25,
      dailyCapSol: 1.0,
      maxTxPerCycle: 2,
      maxTxPerDay: 20,
      killSwitch: false,
    },
    replication: {
      thresholdSol: 5.0,
      sustainedCycles: 5,
      childSeedSol: 0.5,
      maxPopulation: 4,
    },
    seed: { airdropSol: 1.0 },
  };
  return { ...base, ...overrides };
}
