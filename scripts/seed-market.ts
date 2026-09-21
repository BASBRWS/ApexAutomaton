import { loadConfig, lamportsToSol, solToLamports } from '../src/config.js';
import { makeConnection, getBalanceLamports, operatorAirdrop } from '../src/solana/wallet.js';

/**
 * Operator helper: fund the MARKET account with devnet SOL so it can pay the
 * agent for completed tasks. The market pays out of its own balance, so it needs
 * to be seeded separately from the agent. Devnet only.
 *
 *   npm run seed:market
 *
 * If the devnet faucet rate-limits this, use https://faucet.solana.com with the
 * market public key instead.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const connection = makeConnection(cfg);

  const before = await getBalanceLamports(connection, cfg.marketPubkey);
  console.log(`Market ${cfg.marketPubkey}`);
  console.log(`Balance before: ${lamportsToSol(before)} SOL`);

  const lamports = solToLamports(cfg.seed.marketAirdropSol);
  console.log(`Requesting devnet airdrop of ${cfg.seed.marketAirdropSol} SOL to the market...`);
  const sig = await operatorAirdrop(connection, cfg.marketPubkey, lamports);
  console.log(`Airdrop signature: ${sig}`);

  const after = await getBalanceLamports(connection, cfg.marketPubkey);
  console.log(`Balance after: ${lamportsToSol(after)} SOL`);
}

main().catch((err) => {
  console.error(`seed:market failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
