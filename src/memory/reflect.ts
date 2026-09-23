import type { Config } from '../config.js';
import type { LLMClient } from '../llm/client.js';
import { usdCostOf } from '../llm/pricing.js';
import { composeSoul, readSoul, writeSoul } from '../soul.js';
import type { Score } from '../types.js';
import { lessonsDigest } from './lessons.js';

/**
 * memory/reflect.ts — GUARANTEED reflection. When it is due (every N cycles), the
 * loop calls this instead of merely nudging the agent: it makes its own small,
 * cheap LLM call that distils the recent lessons + performance into a concise
 * "## Strategy notes" section and writes it to SOUL.md. So the agent's memory
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
  args: { cfg: Config; cycle: number; score: Score; lessonsShown: number },
): Promise<ReflectResult> {
  const { cfg, cycle, score } = args;
  const digest = lessonsDigest(Math.max(args.lessonsShown, 12));
  if (digest.startsWith('(no lessons')) {
    return { ok: false, costUsd: 0, note: 'auto-reflect skipped: no lessons yet' };
  }
  const currentNotes = readSoul();

  const system = [
    'You are Apex Automaton, an autonomous trading + venture agent. You are consolidating',
    'your durable memory. From the lessons and performance below, write an updated',
    '"## Strategy notes" for your SOUL.md: 3–7 SHORT, concrete, actionable bullet points',
    'about what actually earns vs what bleeds, and what to do more or less of. Be specific',
    '(name assets/tactics when the lessons do). Consolidate — do not just restate every line.',
    'Output ONLY the bullet points as markdown "- " lines. No preamble, no header, no fences.',
  ].join('\n');
  const user = [
    `Cycle ${cycle}. Net PnL since birth: $${score.netPnlUsd.toFixed(2)} (peak $${score.peakEquityUsd.toFixed(2)}, ` +
      `equity $${score.equityUsd.toFixed(2)}). First profit at cycle ${score.firstProfitAtCycle ?? 'not yet'}.`,
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
    model: cfg.models.cheapest, // cheap: distillation is a light task
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 700,
    effort: 'low',
  });
  const costUsd = usdCostOf(cfg.models.cheapest, resp.usage);
  const notes = extractNotes(resp.text);
  if (!notes) {
    return { ok: false, costUsd, note: 'auto-reflect: model returned no usable notes' };
  }
  writeSoul(composeSoul(notes));
  const firstLine = notes.split('\n').find((l) => l.trim())?.trim() ?? '';
  return { ok: true, costUsd, note: `auto-reflect: SOUL updated (${firstLine.slice(0, 80)})` };
}
