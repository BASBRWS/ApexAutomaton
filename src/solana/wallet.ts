import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Keypair,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { assertDevnet, type Config } from '../config.js';

/**
 * Devnet connection + balance reads + transaction building. Contains NO secret
 * key material and NO LLM call. The signer is the only place a keypair loads.
 */

/** SPL Memo program — used to attach a human-readable memo to transfers. */
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

/** Verify the chain itself, not merely the name of its RPC endpoint. */
export async function assertDevnetConnection(connection: Pick<Connection, 'getGenesisHash'>): Promise<void> {
  const hash = await connection.getGenesisHash();
  if (hash !== DEVNET_GENESIS_HASH) {
    throw new Error(`FATAL: RPC is not Solana devnet (genesis hash ${hash}).`);
  }
}

export function makeConnection(cfg: Config): Connection {
  // Re-assert devnet at the point of connection: defense in depth.
  assertDevnet(cfg.rpcUrl);
  return new Connection(cfg.rpcUrl, 'confirmed');
}

export async function getBalanceLamports(
  connection: Connection,
  pubkey: string | PublicKey,
): Promise<number> {
  const key = typeof pubkey === 'string' ? new PublicKey(pubkey) : pubkey;
  return connection.getBalance(key, 'confirmed');
}

function memoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, 'utf8'),
  });
}

/**
 * Build an UNSIGNED System-Program transfer. The signer calls this itself from
 * a validated proposal, so the exact instructions are constructed by trusted
 * code — the agent can never inject arbitrary instructions.
 */
export function buildTransfer(params: {
  from: PublicKey;
  to: PublicKey;
  lamports: number;
  memo?: string;
}): Transaction {
  const tx = new Transaction();
  tx.add(
    SystemProgram.transfer({
      fromPubkey: params.from,
      toPubkey: params.to,
      lamports: params.lamports,
    }),
  );
  if (params.memo) {
    tx.add(memoInstruction(params.memo));
  }
  tx.feePayer = params.from;
  return tx;
}

/**
 * Build an UNSIGNED memo-only transaction (no value transfer). Used for the
 * on-chain heartbeat / proof-of-life: it lands a real, confirmed devnet
 * transaction carrying a memo, paid for by `feePayer`, WITHOUT creating or
 * funding any destination account — so it can never hit a rent-exemption error.
 */
export function buildMemoOnly(params: { feePayer: PublicKey; memo: string }): Transaction {
  const tx = new Transaction();
  tx.add(memoInstruction(params.memo));
  tx.feePayer = params.feePayer;
  return tx;
}

/**
 * Sign + send + confirm a transfer built from trusted code. The caller supplies
 * the signing keypair(s); this function does not read any secret itself.
 */
export async function sendTransfer(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  onSigned?: (signature: string) => void,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const signedSignature = tx.signature;
  if (!signedSignature) throw new Error('transaction has no signature');
  onSigned?.(bs58.encode(signedSignature));
  const signature = await connection.sendRawTransaction(tx.serialize());
  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (confirmation.value.err) {
    throw new Error(`transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  return signature;
}

/**
 * Operator-only, one-time seed airdrop. The AGENT can never reach this: it is
 * invoked exclusively by scripts/seed.ts, not from the loop or any tool. On
 * devnet only (asserted by makeConnection).
 */
export async function operatorAirdrop(
  connection: Connection,
  to: string | PublicKey,
  lamports: number,
): Promise<string> {
  await assertDevnetConnection(connection);
  const key = typeof to === 'string' ? new PublicKey(to) : to;
  const signature = await connection.requestAirdrop(key, lamports);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (confirmation.value.err) {
    throw new Error(`airdrop ${signature} failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  return signature;
}
