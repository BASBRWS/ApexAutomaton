import fs from 'node:fs';
import { STATE_DIR, STATE_FILE } from './paths.js';
import type { Config } from './config.js';
import { initialScore } from './score.js';
import { initUnfundedDesk } from './trading/desk.js';
import type { AutomatonState, DailyCaps, TxRecord } from './types.js';

/**
 * state.ts — load/save the committed runtime state. In GitHub Actions this file
 * is committed each cycle (or written to Firestore if FIRESTORE_* is present —
 * Phase 2). The agent may write here; it may NOT write the constitution.
 */

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function freshCaps(): DailyCaps {
  return { date: utcDate(), lamportsSpentToday: 0, txCountToday: 0 };
}

export function freshState(cfg: Config): AutomatonState {
  const now = new Date().toISOString();
  return {
    bornAt: now,
    cycle: 0,
    lastRunAt: null,
    // Unfunded: the SOL stake is priced to USD at genesis, once the loop sees a
    // real SOL price. Until then the book carries no cash and no baseline.
    desk: initUnfundedDesk(),
    lastPrices: {},
    genesisSolPriceUsd: 0,
    children: [],
    caps: freshCaps(),
    recentSignatures: [],
    score: initialScore(0),
    sustainedSovereignCycles: 0,
    dead: false,
  };
}

export function loadState(cfg: Config): AutomatonState {
  if (!fs.existsSync(STATE_FILE)) {
    return freshState(cfg);
  }
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  const parsed = JSON.parse(raw) as AutomatonState;
  return ensureCapsForToday(parsed);
}

/** Roll the daily caps over at the UTC date boundary. */
export function ensureCapsForToday(state: AutomatonState): AutomatonState {
  const today = utcDate();
  if (state.caps.date !== today) {
    state.caps = freshCaps();
  }
  return state;
}

export function saveState(state: AutomatonState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** Keep only the most recent N tx records in state to bound file growth. The
 * full history lives in the append-only journal. */
export function recordTx(state: AutomatonState, tx: TxRecord, keep = 25): void {
  state.recentSignatures.push(tx);
  if (state.recentSignatures.length > keep) {
    state.recentSignatures = state.recentSignatures.slice(-keep);
  }
}
