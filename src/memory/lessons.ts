import fs from 'node:fs';
import { LESSONS_FILE, STATE_DIR } from '../paths.js';

/**
 * memory/lessons.ts — a durable, append-only "lessons learned" ledger, separate
 * from the cycle journal. The journal is a rolling window of the last few cycles;
 * this is the curated long-term memory of what actually WORKED or hurt, fed back
 * into every prompt so the agent can act on its own track record and consolidate
 * it into SOUL.md when it reflects.
 *
 * Two sources feed it:
 *   - automatic, factual lessons the loop records on notable events (a realized
 *     trade PnL on close, a new peak, first profit, a death, a venture outcome);
 *   - the agent's own reflections (when it rewrites SOUL.md).
 * The automatic ones are plain facts (no model judgement), so the memory stays
 * honest even if the agent never reflects.
 */

export type LessonKind = 'trade' | 'milestone' | 'venture' | 'death' | 'reflection';

export interface Lesson {
  cycle: number;
  at: string;
  kind: LessonKind;
  /** short, human/LLM-readable statement of the lesson or fact. */
  text: string;
  /** realized USD impact where one applies (trade close, venture revenue). */
  pnlUsd?: number;
}

export function appendLesson(lesson: Lesson): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(LESSONS_FILE, JSON.stringify(lesson) + '\n', 'utf8');
}

export function recentLessons(n: number): Lesson[] {
  if (!fs.existsSync(LESSONS_FILE)) return [];
  const lines = fs.readFileSync(LESSONS_FILE, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  const out: Lesson[] = [];
  for (const line of lines.slice(-n)) {
    try {
      out.push(JSON.parse(line) as Lesson);
    } catch {
      /* skip a corrupt line rather than crash the cycle */
    }
  }
  return out;
}

/** Compact digest of the most recent lessons for the prompt (newest last). */
export function lessonsDigest(n: number): string {
  const ls = recentLessons(n);
  if (ls.length === 0) return '(no lessons recorded yet)';
  return ls
    .map((l) => {
      const pnl = typeof l.pnlUsd === 'number' ? ` (${l.pnlUsd >= 0 ? '+' : '-'}$${Math.abs(l.pnlUsd).toFixed(2)})` : '';
      return `#${l.cycle} [${l.kind}] ${l.text}${pnl}`;
    })
    .join('\n');
}

export interface PositionLite {
  units: number;
  entryPriceUsd: number;
}

export interface RealizedResult {
  /** total realized USD across every position that closed or shrank this action. */
  realizedUsd: number;
  /** short descriptions of the closed/reduced legs, e.g. "BTC +$4.20". */
  legs: string[];
}

/**
 * Realized PnL from positions that CLOSED or were REDUCED between `before` and
 * `after` (same asset keys). Pure and testable. For the portion removed in the
 * original direction, realized = removedUnits * (markPrice - entryPrice). A sign
 * flip realizes the entire prior position (the new leg opens fresh at mark).
 */
export function realizedFromClose(
  before: Record<string, PositionLite>,
  after: Record<string, { units: number }>,
  prices: Record<string, number>,
): RealizedResult {
  let realizedUsd = 0;
  const legs: string[] = [];
  for (const asset of Object.keys(before)) {
    const b = before[asset]!;
    const bUnits = Number(b.units) || 0;
    if (bUnits === 0) continue;
    const aUnits = Number(after[asset]?.units) || 0;
    const flipped = Math.sign(aUnits) !== Math.sign(bUnits) && aUnits !== 0;
    const closedSigned =
      aUnits === 0 || flipped
        ? bUnits // fully closed (or flipped: prior leg fully realized)
        : Math.abs(aUnits) < Math.abs(bUnits)
          ? bUnits - aUnits // reduced in the same direction
          : 0; // grew or unchanged → nothing realized
    if (closedSigned === 0) continue;
    const price = Number(prices[asset]);
    const mark = Number.isFinite(price) && price > 0 ? price : b.entryPriceUsd;
    const legPnl = closedSigned * (mark - b.entryPriceUsd);
    if (!Number.isFinite(legPnl)) continue;
    realizedUsd += legPnl;
    legs.push(`${asset} ${legPnl >= 0 ? '+' : '-'}$${Math.abs(legPnl).toFixed(2)}`);
  }
  return { realizedUsd, legs };
}
