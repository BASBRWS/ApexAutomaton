import type { Config } from '../config.js';
import type { LLMClient } from '../llm/client.js';
import { usdCostOf } from '../llm/pricing.js';
import { composeSoul, readSoul, strategyOnly, writeSoul } from '../soul.js';
import type { Score } from '../types.js';
import { fmtLivesDelta, type ChallengePeriodResult, type ChallengeStatus } from '../challenge.js';
import { lessonsDigest } from './lessons.js';

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

  const system = [
    'You are the periodic evaluator ("coach") of Apex Automaton, an autonomous trading +',
    'venture agent. A cheaper model makes its day-to-day decisions and follows the strategy',
    'notes you write. Evaluate the period below against its monthly challenge (its lives',
    'depend on the monthly return), then write an updated "## Strategy notes" for its',
    'SOUL.md: 3–7 SHORT, concrete, actionable bullet points — what actually earns vs what',
    'bleeds, how much risk to carry given the challenge standing, what to do more or less',
    'of. Be specific (name assets/tactics when the lessons do). Consolidate — do not just',
    'restate every line.',
    'Output ONLY the bullet points as markdown "- " lines. No preamble, no header, no fences.',
  ].join('\n');
  const user = [
    `Cycle ${cycle}. Net PnL since birth: $${score.netPnlUsd.toFixed(2)} (peak $${score.peakEquityUsd.toFixed(2)}, ` +
      `equity $${score.equityUsd.toFixed(2)}). First profit at cycle ${score.firstProfitAtCycle ?? 'not yet'}.`,
    ...(challenge
      ? [
          '',
          `Monthly challenge: ${challenge.lives} lives (started with ${challenge.startLives}, max ${challenge.maxLives}). Month ${challenge.period}, ` +
            `day ${challenge.daysElapsed.toFixed(1)} of ${(challenge.daysElapsed + challenge.daysLeft).toFixed(0)}; ` +
            `return so far ${(challenge.returnSoFar * 100).toFixed(2)}% (would be: ${challenge.projected.label}, ` +
            `${fmtLivesDelta(challenge.projected.delta)} life).`,
          'Lives per monthly return: ' +
            challenge.bands.map((b) => `${b.label} ${fmtLivesDelta(b.delta)}`).join('; ') + '.',
          challenge.history.length
            ? 'Past months: ' + challenge.history
              .map((h) => `M${h.period} ${(h.returnPct * 100).toFixed(2)}% (${fmtLivesDelta(h.livesDelta)})`).join(', ')
            : 'Past months: none yet.',
        ]
      : []),
    '',
    'Your recent lessons (facts from your own actions):',
    digest,
    '',
    'Your current strategy notes:',
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
  const notes = extractNotes(resp.text);
  if (!notes) {
    return { ok: false, costUsd, note: 'auto-reflect: model returned no usable notes' };
  }
  writeSoul(composeSoul(notes));
  const firstLine = notes.split('\n').find((l) => l.trim())?.trim() ?? '';
  return { ok: true, costUsd, note: `auto-reflect: SOUL updated (${firstLine.slice(0, 80)})` };
}
