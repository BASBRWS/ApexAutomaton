import { loadConfig, lamportsToSol, solToLamports } from '../src/config.js';
import { makeConnection, getBalanceLamports, operatorAirdrop } from '../src/solana/wallet.js';

/**
 * Operator-only, one-time seed airdrop. This is the ONLY way SOL ever enters the
 * agent's wallet other than market revenue. The AGENT cannot run this — it calls
 * the devnet faucet directly, which the agent has no tool for. Devnet only.
 *
 *   npm run seed
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const connection = makeConnection(cfg);

  const before = await getBalanceLamports(connection, cfg.agentPubkey);
  console.log(`Agent ${cfg.agentPubkey}`);
  console.log(`Balance before: ${lamportsToSol(before)} SOL`);

  const lamports = solToLamports(cfg.seed.airdropSol);
  console.log(`Requesting devnet airdrop of ${cfg.seed.airdropSol} SOL...`);
  const sig = await operatorAirdrop(connection, cfg.agentPubkey, lamports);
  console.log(`Airdrop signature: ${sig}`);

  const after = await getBalanceLamports(connection, cfg.agentPubkey);
  console.log(`Balance after: ${lamportsToSol(after)} SOL`);
}

main().catch((err) => {
  console.error(`seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
