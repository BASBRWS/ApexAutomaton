import fs from 'node:fs';
import path from 'node:path';
import { JOURNAL_FILE, OBITUARY_DIR, STATE_DIR } from './paths.js';
import type { JournalEntry } from './types.js';

/**
 * journal.ts — an append-only log plus the obituary writer. The journal is the
 * audit trail: it is only ever appended to, never rewritten, so a human can
 * reconstruct exactly what the agent did and why. Entries are newline-delimited
 * JSON (NDJSON).
 */

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Append one entry. This is the ONLY write operation on the journal. */
export function appendEntry(entry: JournalEntry): void {
  ensureDir(STATE_DIR);
  fs.appendFileSync(JOURNAL_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

/** Read the most recent `n` entries (oldest-first within the slice). */
export function readRecent(n: number): JournalEntry[] {
  if (!fs.existsSync(JOURNAL_FILE)) return [];
  const lines = fs
    .readFileSync(JOURNAL_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const slice = lines.slice(-n);
  const out: JournalEntry[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as JournalEntry);
    } catch {
      // Skip a corrupt line rather than crash the cycle.
    }
  }
  return out;
}

/** A compact, human/LLM-readable digest of recent activity for the prompt. */
export function digestRecent(n: number): string {
  const entries = readRecent(n);
  if (entries.length === 0) return '(no prior cycles)';
  return entries
    .map((e) => {
      return (
        `#${e.cycle} [${e.tier}] equity=$${e.equityUsd.toFixed(2)} ` +
        `action=${e.action} cyclePnl=$${e.cyclePnlUsd.toFixed(2)} ` +
        `burn=$${e.costUsd.toFixed(4)}` +
        (e.note ? ` note=${e.note}` : '')
      );
    })
    .join('\n');
}

/**
 * Write an obituary when the agent dies. Never rewritten; one file per death,
 * plus a final journal entry recorded by the loop.
 */
export function writeObituary(text: string, cycle: number): string {
  ensureDir(OBITUARY_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OBITUARY_DIR, `obituary-cycle-${cycle}-${stamp}.md`);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

/** Digest of past obituaries — inherited lessons for a child (Phase 3) and
 * context for the living agent. */
export function obituaryDigest(): string {
  if (!fs.existsSync(OBITUARY_DIR)) return '(no obituaries)';
  const files = fs
    .readdirSync(OBITUARY_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  if (files.length === 0) return '(no obituaries)';
  return files
    .slice(-5)
    .map((f) => {
      const body = fs.readFileSync(path.join(OBITUARY_DIR, f), 'utf8');
      const firstLines = body.split('\n').slice(0, 3).join(' ').slice(0, 200);
      return `${f}: ${firstLines}`;
    })
    .join('\n');
}
