import fs from 'node:fs';
import { SOUL_FILE } from './paths.js';
import type { Lesson } from './memory/lessons.js';

/**
 * soul.ts — reads/writes SOUL.md. This is the ONE law-adjacent file the agent
 * is allowed to write: its self-concept, evolving strategy notes, identity. The
 * constitution is read-only; the soul is the agent's own. Kept small and always
 * present so a first cycle has something to read.
 */

/** The fixed identity preamble — everything before the strategy notes. Auto-
 * reflection preserves this verbatim and only regenerates the notes below it. */
export const SOUL_IDENTITY = `# SOUL

I am Apex Automaton, an autonomous agent on Solana devnet.

My objective is to grow my net SOL balance as much as possible. Running out of
SOL ends me; staying alive is the floor, not the goal. I earn by completing
tasks in the market for more than my thinking costs, and I compound the surplus.`;

const DEFAULT_SOUL = `${SOUL_IDENTITY}

## Strategy notes
(empty — I will write here as I learn what earns.)
`;

const HISTORY_HEADER = '## Learned history';

/** Keep the compact strategy separate from the append-only factual history. */
export function strategyOnly(text: string): string {
  return text.split(/\r?\n## Learned history\r?\n/)[0]!.trimEnd();
}

function historyPart(text: string): string {
  const marker = `\n${HISTORY_HEADER}\n`;
  const offset = text.indexOf(marker);
  return offset < 0 ? '' : text.slice(offset).trimEnd();
}

export function soulWithHistory(text: string, lessons: Lesson[]): string {
  const facts = lessons.filter((lesson) => lesson.kind !== 'reflection');
  if (!facts.length) return `${strategyOnly(text)}\n`;
  const lines = facts.map((lesson) => {
    const description = lesson.text.replace(/\s+/g, ' ').trim().slice(0, 300);
    const pnl = Number.isFinite(lesson.pnlUsd) ?
      ` (${lesson.pnlUsd! >= 0 ? '+' : '-'}$${Math.abs(lesson.pnlUsd!).toFixed(2)})` : '';
    return `- Cycle ${lesson.cycle} [${lesson.kind}]: ${description}${pnl}`;
  });
  return `${strategyOnly(text)}\n\n${HISTORY_HEADER}\n${lines.join('\n')}\n`;
}

/** Reconstruct the full history from the durable ledger, including missed cycles. */
export function syncSoulHistory(lessons: Lesson[]): void {
  const current = readSoul();
  const updated = soulWithHistory(current, lessons);
  if (current !== updated) fs.writeFileSync(SOUL_FILE, updated, 'utf8');
}

/** The prompt includes the strategy and recent facts; the file keeps all facts. */
export function soulForPrompt(recentFacts = 8, full = readSoul()): string {
  const history = historyPart(full);
  if (!history) return full;
  const facts = history.split('\n').slice(1).filter((line) => line.startsWith('- '));
  return `${strategyOnly(full)}\n\n## Recent learned history\n${facts.slice(-recentFacts).join('\n')}\n`;
}

/** Compose a full SOUL.md from the fixed identity plus a strategy-notes body. */
export function composeSoul(notesBody: string): string {
  const body = notesBody.trim() || '(empty — I will write here as I learn what earns.)';
  return `${SOUL_IDENTITY}\n\n## Strategy notes\n${body}\n`;
}

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
  // An LLM reflect action cannot erase already recorded factual lessons.
  fs.writeFileSync(SOUL_FILE, preserveSoulHistory(text, readSoul()), 'utf8');
}

export function preserveSoulHistory(text: string, previous: string): string {
  const history = historyPart(previous);
  return `${strategyOnly(text)}${history ? `\n${history}` : ''}\n`;
}

export function ensureSoul(): void {
  if (!fs.existsSync(SOUL_FILE)) {
    writeSoul(DEFAULT_SOUL);
  }
}
