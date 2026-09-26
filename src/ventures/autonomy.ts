import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import type { Venture } from './types.js';

// Only project metadata for valueless devnet experiments is published here.
// GitHub Pages may not be used as the venture's checkout or commercial SaaS.
const METADATA_BASE = 'https://basbrws.github.io/ApexAutomaton/state/metadata/';

export function autonomousMetadataUrl(id: string): string {
  if (!/^v\d{4,}$/.test(id)) throw new Error('invalid venture id for metadata');
  return new URL(`${id}.json`, METADATA_BASE).toString();
}

export function autonomousMetadata(venture: Venture): { name: string; symbol: string; description: string } {
  if (!venture.splToken || venture.launchMode !== 'autonomous-devnet' ||
      venture.splToken.uri !== autonomousMetadataUrl(venture.id)) {
    throw new Error('venture is not eligible for autonomous metadata');
  }
  return {
    name: venture.splToken.name,
    symbol: venture.splToken.symbol,
    description: venture.thesis.slice(0, 500),
  };
}

/** Write project metadata before activating the venture. The heartbeat commits
 * it and Pages publishes it before the signer may mint on a later cycle. */
export function publishAutonomousMetadata(venture: Venture): void {
  const metadata = autonomousMetadata(venture);
  const dir = path.join(STATE_DIR, 'metadata');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${venture.id}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, file);
}
