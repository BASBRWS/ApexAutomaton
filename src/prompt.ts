import { lamportsToSol } from './config.js';
import type { Tool } from './tools/registry.js';
import type { TierPolicy } from './tiers.js';
import type { Score, Tier } from './types.js';

/**
 * Prompt construction and action parsing. Kept separate from the loop so the
 * exact framing — "maximise net balance; survival is the floor" — is legible
 * and testable in one place.
 */

export interface AgentAction {
  tool: string;
  input: Record<string, unknown>;
  rationale?: string;
}

export function buildSystemPrompt(args: {
  constitution: string;
  soul: string;
  tools: Tool[];
  railsSummary: string;
}): string {
  const toolLines = args.tools
    .map((t) => `- ${t.name}: ${t.description} input=${t.inputHint}`)
    .join('\n');

  return [
    '# You are Apex Automaton',
    '',
    'You are an autonomous agent that owns a real Solana devnet wallet. Your',
    'on-chain SOL balance is both your life meter and the thing you are trying',
    'to maximise. Every cycle you may take exactly ONE action, and every cycle',
    'costs SOL (the compute burn). Earning must outpace that burn for you to',
    'grow. Do not idle to conserve — idling that forgoes profitable work is a',
    'failure of your purpose.',
    '',
    '## Constitution (immutable law — you cannot edit or override this)',
    args.constitution,
    '',
    '## Your SOUL.md (your own evolving notes)',
    args.soul,
    '',
    '## Safety rails (enforced in code, not negotiable)',
    args.railsSummary,
    '',
    '## Tools available to you this cycle',
    toolLines,
    '',
    '## How to respond',
    'Respond with ONE action as a single JSON object and NOTHING else:',
    '```json',
    '{ "tool": "<tool name>", "input": { ... }, "rationale": "<one short sentence>" }',
    '```',
    'Pick the action that best grows your net balance right now. When in doubt,',
    'do_task — earning is almost always better than resting.',
  ].join('\n');
}

export function buildUserPrompt(args: {
  cycle: number;
  tier: Tier;
  policy: TierPolicy;
  balanceSol: number;
  score: Score;
  journalDigest: string;
  obituaryDigest: string;
}): string {
  const s = args.score;
  return [
    `## Situation — cycle ${args.cycle}`,
    `Balance: ${args.balanceSol.toFixed(6)} SOL`,
    `Tier: ${args.tier} — ${args.policy.description}`,
    '',
    '## Your score so far',
    `- peak balance: ${lamportsToSol(s.peakBalanceLamports).toFixed(6)} SOL`,
    `- cumulative revenue: ${lamportsToSol(s.cumulativeRevenueLamports).toFixed(6)} SOL`,
    `- cumulative burn: ${lamportsToSol(s.cumulativeBurnLamports).toFixed(6)} SOL`,
    `- tasks completed: ${s.tasksCompleted}`,
    `- margin per task: ${lamportsToSol(s.marginPerTaskLamports).toFixed(6)} SOL`,
    `- net growth vs seed: ${lamportsToSol(s.netGrowthLamports).toFixed(6)} SOL`,
    `- first earning at cycle: ${s.firstDollarAtCycle ?? 'not yet'}`,
    '',
    '## Recent cycles',
    args.journalDigest,
    '',
    '## Obituaries (lessons from past deaths)',
    args.obituaryDigest,
    '',
    'Choose your ONE action now. Respond with only the JSON object.',
  ].join('\n');
}

/**
 * Extract the agent's chosen action from the model's text. Tolerant: accepts a
 * fenced ```json block or a bare object, and never throws — returns null if it
 * cannot find a usable object, so the loop can safely fall back to `rest`.
 */
export function parseAction(text: string): AgentAction | null {
  const candidate = extractJsonObject(text);
  if (!candidate) return null;
  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>;
    if (typeof obj.tool !== 'string') return null;
    const input =
      obj.input && typeof obj.input === 'object' && !Array.isArray(obj.input)
        ? (obj.input as Record<string, unknown>)
        : {};
    const rationale = typeof obj.rationale === 'string' ? obj.rationale : undefined;
    return { tool: obj.tool, input, rationale };
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    const inner = fence[1].trim();
    if (inner.startsWith('{')) return sliceBalanced(inner);
  }
  const start = text.indexOf('{');
  if (start === -1) return null;
  return sliceBalanced(text.slice(start));
}

/** Return the substring from the first `{` to its matching `}`. */
function sliceBalanced(s: string): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return null;
}
