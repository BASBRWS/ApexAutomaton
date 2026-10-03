import type { Config } from '../src/config.js';
import { DEFAULT_LIFE_BANDS } from '../src/challenge.js';

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
      childSeedSol: 0.1,
      maxPopulation: 4,
    },
    seed: { airdropSol: 1.0, marketAirdropSol: 2.0 },
    trading: {
      capitalSol: 1.0,
      capitalUsdOverride: undefined,
      maxGrossExposureSol: 1.0,
      assets: ['BTC', 'ETH'],
      allowShort: true,
      feeBps: 10,
      makerFeeBps: 2,
      spreadBps: 5,
      slippageBps: 5,
      shortBorrowApy: 0.08,
      dustSol: 0.02,
      yieldApy: 0,
      metabolicRatePerCycle: 0.0001,
      priceApiBase: 'https://api.coingecko.com/api/v3/simple/price',
    },
    challenge: { enabled: true, lives: 3, maxLives: 4, periodDays: 30, bands: DEFAULT_LIFE_BANDS },
    memory: { reflectEveryDays: 7, reflectModel: 'claude-opus-5-5', lessonsInPrompt: 8 },
    decisions: { minHoursBetween: 4, positionMoveTrigger: 0.03, marketMoveTrigger: 0.02, maxPerDay: 6 },
    wallet: {
      realEconomyEnabled: false,
      anchorOnWallet: false,
      floorSol: 0.05,
      maxSettlePerCycleSol: 0.5,
    },
    features: {
      replicationEnabled: false,
      offchainRevenueEnabled: false,
      extraToolsEnabled: false,
    },
    pump: { enabled: false, maxCreateSol: 0.05 },
    nft: { enabled: false, maxCreateSol: 0.03 },
    spl: { enabled: false, maxCreateSol: 0.03 },
    ventures: { enabled: true, autonomyThreshold: 10, autonomousDevnetEnabled: false },
    firestore: {
      enabled: false,
      projectId: undefined,
      collection: 'automaton',
      documentId: 'state',
    },
  };
  return { ...base, ...overrides };
}
