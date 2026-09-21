import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Generate a fresh Solana keypair for setup (agent, market, compute-provider).
 * Prints the public key and BOTH secret formats the loader accepts. NEVER commit
 * a secret — put it in a GitHub Actions secret or a local .env only.
 *
 *   npm run keygen
 */
const kp = Keypair.generate();

console.log('Public key  :', kp.publicKey.toBase58());
console.log('Secret (b58):', bs58.encode(kp.secretKey));
console.log('Secret (json):', JSON.stringify(Array.from(kp.secretKey)));
console.log('');
console.log('Keep the secret out of git. Set it as AGENT_KEYPAIR / MARKET_KEYPAIR');
console.log('in a GitHub Actions secret or your local .env (never committed).');
