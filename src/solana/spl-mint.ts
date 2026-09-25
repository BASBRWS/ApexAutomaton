import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  createInitializeMetadataPointerInstruction, createInitializeMintInstruction,
  ExtensionType, getMintLen, LENGTH_SIZE, TOKEN_2022_PROGRAM_ID, TYPE_SIZE,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';
import type { Venture } from '../ventures/types.js';

type Metadata = NonNullable<Venture['splToken']>;

/** Exact rent footprint for a Token-2022 mint with embedded metadata. */
export function splMintSpace(metadata: Metadata, mint: PublicKey, wallet: PublicKey): {
  allocatedSpace: number; rentSpace: number;
} {
  const allocatedSpace = getMintLen([ExtensionType.MetadataPointer]);
  const serialized = pack({
    updateAuthority: wallet, mint, name: metadata.name, symbol: metadata.symbol,
    uri: metadata.uri, additionalMetadata: [],
  });
  return { allocatedSpace, rentSpace: allocatedSpace + TYPE_SIZE + LENGTH_SIZE + serialized.length };
}

/** Four fixed instructions in one atomic transaction. No agent-supplied bytes. */
export function buildSplMintTx(metadata: Metadata, mint: PublicKey, wallet: PublicKey, rent: number): Transaction {
  const { allocatedSpace } = splMintSpace(metadata, mint, wallet);
  return new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: wallet, newAccountPubkey: mint,
      lamports: rent, space: allocatedSpace, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint, wallet, mint, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint, metadata.decimals, wallet, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint,
      updateAuthority: wallet, mint, mintAuthority: wallet,
      name: metadata.name, symbol: metadata.symbol, uri: metadata.uri }),
  );
}
