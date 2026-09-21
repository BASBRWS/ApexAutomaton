import fs from 'node:fs';
import { SOUL_FILE } from './paths.js';

/**
 * soul.ts — reads/writes SOUL.md. This is the ONE law-adjacent file the agent
 * is allowed to write: its self-concept, evolving strategy notes, identity. The
 * constitution is read-only; the soul is the agent's own. Kept small and always
 * present so a first cycle has something to read.
 */

const DEFAULT_SOUL = `# SOUL

I am Apex Automaton, an autonomous agent on Solana devnet.

My objective is to grow my net SOL balance as much as possible. Running out of
SOL ends me; staying alive is the floor, not the goal. I earn by completing
tasks in the market for more than my thinking costs, and I compound the surplus.

## Strategy notes
(empty — I will write here as I learn what earns.)
`;

export function readSoul(): string {
  try {
    if (fs.existsSync(SOUL_FILE)) {
      return fs.readFileSync(SOUL_FILE, 'utf8');
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_SOUL;
}

/** Overwrite SOUL.md with the agent's chosen text. Only called when the agent
 * explicitly chooses to (the `reflect` tool). */
export function writeSoul(text: string): void {
  fs.writeFileSync(SOUL_FILE, text, 'utf8');
}

export function ensureSoul(): void {
  if (!fs.existsSync(SOUL_FILE)) {
    writeSoul(DEFAULT_SOUL);
  }
}
