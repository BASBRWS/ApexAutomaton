import type { Config } from '../config.js';
import type { LLMClient } from '../llm/client.js';
import { usdCostOf } from '../llm/pricing.js';
import { composeSoul, readSoul, strategyOnly, writeSoul } from '../soul.js';
import type { Score } from '../types.js';
import { fmtLivesDelta, type ChallengePeriodResult, type ChallengeStatus } from '../challenge.js';
import { lessonsDigest, realizedByAsset, recentLessons } from './lessons.js';
import { guardSoulText } from './guard.js';

/**
 * memory/reflect.ts — GUARANTEED reflection, run as a periodic evaluation. When it
 * is due (every N days), the loop calls this instead of merely nudging the agent:
 * a heavier model (the "coach") reviews the recent lessons, performance and the
 * monthly challenge, and distils them into a concise "## Strategy notes" section
 * in SOUL.md that the cheap decision model follows until the next evaluation. So the agent's memory
 * consolidates on schedule whether or not the agent itself ever chooses to
 * reflect. The fixed identity preamble is preserved; only the notes are rewritten.
 */

export interface ReflectResult {
  ok: boolean;
  costUsd: number;
  note: string;
}

export function extractNotes(text: string): string {
  let t = (text ?? '').trim();
  // Strip a ```/```markdown fence if the model wrapped its answer.
  const fence = t.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) t = fence[1].trim();
  // Drop a leading "## Strategy notes" header if the model repeated it.
  t = t.replace(/^#+\s*strategy notes\s*/i, '').trim();
  return t.slice(0, 2000);
}

export async function autoReflect(
  llm: LLMClient,
  args: {
    cfg: Config;
    cycle: number;
    score: Score;
    lessonsShown: number;
    /** current SOL price, so the facts can state equity in SOL correctly. */
    solPriceUsd?: number;
    challenge?: ChallengeStatus & { history: ChallengePeriodResult[] };
  },
): Promise<ReflectResult> {
  const { cfg, cycle, score, challenge } = args;
  const model = cfg.memory.reflectModel;
  const digest = lessonsDigest(Math.max(args.lessonsShown, 12));
  if (digest.startsWith('(no lessons')) {
    return { ok: false, costUsd: 0, note: 'auto-reflect skipped: no lessons yet' };
  }
  const currentNotes = strategyOnly(readSoul());

  // Verified facts, computed by code. The evaluator must use only these numbers:
  // earlier notes re-derived and carried numbers forward until they drifted far
  // from the books (e.g. a stale equity figure, invented alt losses).
  const realized = realizedByAsset(recentLessons(Number.MAX_SAFE_INTEGER));
  const realizedLines = Object.entries(realized)
    .sort((a, b) => b[1].pnlUsd - a[1].pnlUsd)
    .map(([asset, r]) => `  ${asset}: ${r.pnlUsd >= 0 ? '+' : '-'}$${Math.abs(r.pnlUsd).toFixed(2)} over ${r.closes} close(s), ${r.wins} winner(s)`);
  const sol = args.solPriceUsd && args.solPriceUsd > 0 ? args.solPriceUsd : 0;
  const facts = [
    'VERIFIED FACTS (computed by code — use ONLY these numbers):',
    `- Equity now: $${score.equityUsd.toFixed(2)}` + (sol ? ` (${(score.equityUsd / sol).toFixed(4)} SOL at $${sol.toFixed(2)}/SOL)` : ''),
    `- Start equity: $${score.startEquityUsd.toFixed(2)} · peak $${score.peakEquityUsd.toFixed(2)} · net PnL $${score.netPnlUsd.toFixed(2)}`,
    `- Cumulative model (compute) cost: $${score.cumulativeBurnUsd.toFixed(2)}`,
    '- Realized PnL per asset (closed or reduced positions, all time):',
    ...(realizedLines.length ? realizedLines : ['  (none yet)']),
  ];

  const system = [
    'You are the periodic evaluator ("coach") of Apex Automaton, an autonomous agent trading',
    'a paper book against real market prices. A cheaper model makes the day-to-day decisions',
    'and follows the strategy notes you write. Judge the EDGE in its decisions, not the calendar.',
    '',
    'Write an updated "## Strategy notes" for its SOUL.md: 3–7 SHORT, concrete, evidence-based',
    'bullet points — which setups had a real edge, which bled, how to size so a single loss',
    'stays small, what to do more or less of. Name assets/tactics when the facts do.',
    '',
    'Hard rules for the notes (lines that break them are deleted before saving):',
    '- Use ONLY the verified facts below for numbers. Never copy numbers from the previous',
    '  notes — they may be stale or wrong. If a number is not in the facts, do not state it.',
    '- No goals, targets, deadlines, life counts, months or urgency. The decision-maker must',
    '  not trade to meet a date: the market does not know what month it is.',
    '- Resting when no setup has an edge is a correct decision. Never write that inaction is',
    '  unsafe or costly, and never loosen entry rules just to trade more.',
    '- Every rule must be satisfiable with the facts as they are now (no gates on equity or',
    '  conditions that cannot occur), and the notes must not contradict each other.',
    '',
    'Output ONLY the bullet points as markdown "- " lines. No preamble, no header, no fences.',
  ].join('\n');
  const user = [
    `Cycle ${cycle}. First profit at cycle ${score.firstProfitAtCycle ?? 'not yet'}.`,
    '',
    ...facts,
    ...(challenge
      ? [
          '',
          'Context for you only (a scoring rule of the experiment — never a reason to trade, and',
          'never to be mentioned in the notes; over many months only a real edge keeps it healthy):',
          `- ${challenge.lives} lives; current period day ${challenge.daysElapsed.toFixed(1)}, return so far ` +
            `${(challenge.returnSoFar * 100).toFixed(2)}%. Past periods: ` +
            (challenge.history.length
              ? challenge.history.map((h) => `${(h.returnPct * 100).toFixed(2)}% (${fmtLivesDelta(h.livesDelta)})`).join(', ')
              : 'none yet') + '.',
        ]
      : []),
    '',
    'Recent lessons (facts from its own actions):',
    digest,
    '',
    'Previous strategy notes (may contain stale numbers — do not copy them):',
    currentNotes,
    '',
    'Write the updated strategy-notes bullets now.',
  ].join('\n');

  const resp = await llm.generate({
    model, // heavier than the decision model: this runs weekly, so depth is affordable
    system,
    messages: [{ role: 'user', content: user }],
    // Room for adaptive thinking plus the notes; thinking counts against max_tokens.
    maxTokens: 6000,
    effort: 'medium',
  });
  const costUsd = usdCostOf(model, resp.usage);
  const guarded = guardSoulText(extractNotes(resp.text));
  const notes = guarded.text.trim();
  // Count only: this note lands in the journal digest the decider reads, so it
  // must not repeat what was removed.
  const droppedNote = guarded.dropped.length ? ` · SOUL guard removed ${guarded.dropped.length} line(s)` : '';
  if (!/^\s*[-*]\s/m.test(notes)) {
    return { ok: false, costUsd, note: `auto-reflect: no usable notes after the guard — kept the previous notes${droppedNote}` };
  }
  writeSoul(composeSoul(notes));
  return { ok: true, costUsd, note: `auto-reflect: SOUL updated by ${model}${droppedNote}` };
}
