import type { PriceMap } from './marketdata.js';
import type { Tool } from './tools/registry.js';
import type { TierPolicy } from './tiers.js';
import type { Score, Tier } from './types.js';

/**
 * Prompt construction and action parsing. Kept separate from the loop so the
 * exact framing — "grow your book against the real market; the market decides,
 * not you" — is legible and testable in one place.
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
  tradableAssets: string[];
  maxGrossExposureUsd: number;
  yieldApy: number;
}): string {
  const toolLines = args.tools
    .map((t) => `- ${t.name}: ${t.description} input=${t.inputHint}`)
    .join('\n');

  return [
    '# You are Apex Automaton',
    '',
    'You are an autonomous agent trading a book against the REAL market. Your',
    'stake and your score are denominated in SOL: you started with a fixed amount',
    'of SOL and your goal is to grow it into as much SOL as possible. Positions',
    'are priced in USD (that is how the market quotes them), but what matters is',
    'your equity measured back in SOL. Every cycle you take exactly ONE action,',
    'and every cycle costs money (the compute burn is deducted from your book).',
    'You must trade profitably faster than you burn, or your book shrinks to dust',
    'and you DIE. You can NEVER decide yourself that a trade was good — the real',
    'market price decides that, cycle by cycle.',
    '',
    `Tradable assets: ${args.tradableAssets.join(', ')} (you may also stay in cash).`,
    `Max gross exposure: ~$${args.maxGrossExposureUsd.toFixed(2)}.`,
    'You have full freedom of strategy within those limits: go long or short, size',
    'positions, rotate between assets, sit in cash to avoid a drawdown, whatever',
    'you judge will grow the book. Survival does NOT have to mean trading: you may',
    `also PARK capital in a real-yield sleeve (stake) earning ~${(args.yieldApy * 100).toFixed(1)}% APY — a`,
    'non-directional carry that grows by elapsed time, not market bets. It is modest',
    'next to the compute burn while your book is small, but a real alternative as you',
    'grow. There is no guaranteed income; resting in cash still burns compute, so',
    'doing nothing is slow death.',
    '',
    '## Constitution (immutable law — you cannot edit or override this)',
    args.constitution,
    '',
    '## Your SOUL.md (your own evolving notes / strategy)',
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
    '{ "tool": "<tool name>", "input": { ... }, "rationale": "<2-4 sentences>" }',
    '```',
    'In the rationale, actually reason it through, and START with survival: how much',
    'runway you have, whether you are growing or bleeding, and whether to take risk',
    'to grow or preserve to survive. Then the market read (which assets are moving',
    'and how), the options you weighed and why you rejected them, why THIS action,',
    'and the main risk you accept. Be concrete and specific to this cycle.',
    'Pick the action that best grows your book right now, given the prices and',
    'your current positions below.',
  ].join('\n');
}

export function buildUserPrompt(args: {
  cycle: number;
  tier: Tier;
  policy: TierPolicy;
  equityUsd: number;
  equitySol: number;
  dustSol: number;
  dustUsd: number;
  avgBurnUsd: number;
  runwayCycles: number;
  metabolicDailyPct: number;
  prices: PriceMap;
  prevPrices: PriceMap;
  deskSummary: string;
  score: Score;
  journalDigest: string;
  obituaryDigest: string;
}): string {
  const s = args.score;
  const drawdownUsd = Math.max(0, s.peakEquityUsd - args.equityUsd);
  const trend = s.netPnlUsd > 0 ? 'growing' : s.netPnlUsd < 0 ? 'bleeding' : 'flat';
  const runway =
    Number.isFinite(args.runwayCycles) && args.runwayCycles < 100000
      ? `~${Math.floor(args.runwayCycles)} cycles`
      : 'very long';
  const priceLines = Object.entries(args.prices)
    .map(([k, v]) => {
      const prev = args.prevPrices[k];
      if (typeof prev === 'number' && prev > 0) {
        const chg = ((v - prev) / prev) * 100;
        return `${k}=$${v} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% vs last)`;
      }
      return `${k}=$${v}`;
    })
    .join('\n');
  return [
    `## Situation — cycle ${args.cycle}`,
    `Book equity: ${args.equitySol.toFixed(4)} SOL ($${args.equityUsd.toFixed(2)})`,
    `Tier: ${args.tier} — ${args.policy.description}`,
    '',
    '## Survival — weigh this FIRST, before any trade',
    `You DIE if equity falls to ${args.dustSol} SOL ($${args.dustUsd.toFixed(2)}). You are at ${args.equitySol.toFixed(4)} SOL.`,
    `Net PnL since birth: $${s.netPnlUsd.toFixed(2)} (${trend}); $${drawdownUsd.toFixed(2)} below your peak.`,
    `You pay to exist: a metabolic cost of ~${args.metabolicDailyPct.toFixed(1)}%/day of your equity,`,
    `plus compute burn (~$${args.avgBurnUsd.toFixed(4)}/cycle). Runway if you just rest: ${runway}.`,
    `This means COASTING IS DEATH: standing still loses ~${args.metabolicDailyPct.toFixed(1)}%/day, so a small`,
    'gain is NOT a safe place to sit — you must keep out-earning your metabolism or you',
    'slowly starve. Preserve only to dodge a clear imminent loss, never as your default.',
    'So each cycle: are you safe enough to take risk and GROW (usually yes), or bleeding',
    'badly and needing to preserve briefly to SURVIVE? Decide explicitly and act on it.',
    '',
    '## Live market prices (USD, with change vs your last cycle)',
    priceLines || '(no prices this cycle)',
    '',
    '## Your book right now',
    args.deskSummary,
    '',
    '## Your score so far',
    `- start equity: $${s.startEquityUsd.toFixed(2)}`,
    `- peak equity: $${s.peakEquityUsd.toFixed(2)}`,
    `- net PnL: $${s.netPnlUsd.toFixed(2)}`,
    `- cumulative burn: $${s.cumulativeBurnUsd.toFixed(4)}`,
    `- cycles traded: ${s.tradeCycles}`,
    `- first profit at cycle: ${s.firstProfitAtCycle ?? 'not yet'}`,
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
