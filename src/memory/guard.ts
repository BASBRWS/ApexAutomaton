/**
 * memory/guard.ts — what reflection may NOT write into SOUL.md.
 *
 * SOUL.md is read by every trade decision. A reflection that writes a calendar
 * goal ("the month needs +$5"), a life count or urgency ("doing nothing costs a
 * life") into it turns a scoring rule into decision pressure, and the next
 * decision then treats resting as failure and forces trades without edge — the
 * market does not know what month it is. Reflection may record observations and
 * lessons; lines that carry goals, lives or urgency are dropped before writing.
 */

const BLOCKED: { why: string; re: RegExp }[] = [
  { why: 'lives', re: /\b(lives|a life|half a life|one life|lose a life|lost a life|costs? (you )?a life|extra life)\b/i },
  { why: 'challenge', re: /\bchallenge\b/i },
  // Any month at all: the decider's notes have no business with the calendar.
  { why: 'calendar goal', re: /\bmonth(s|ly)?\b/i },
  { why: 'urgency', re: /\b(deadline|urgent|urgency|running out of time|time is running out|before it'?s too late)\b/i },
  {
    why: 'resting framed as failure',
    re: /\b(doing nothing|inaction|sitting out|staying flat|resting|dorman(t|cy))\b[^.\n]*\b(costs? (you )?(a life|lives)|not safe|unsafe|failure|fails?|death|die|punish)/i,
  },
  {
    why: 'dollar target',
    re: /\b(target|goal|quota)\b[^.\n]*\$\d|\$\d[\d.,]*\s*(goal|target|quota)\b|\$\d[\d.,]*\s*(–|-|to)\s*\$?\d[\d.,]*\s*(realized|target|goal)/i,
  },
];

export interface GuardResult {
  text: string;
  dropped: { line: string; why: string }[];
}

/** Drop every line (with its indented continuation) that carries a goal, a life
 * count or urgency. Headings and blank lines pass through untouched. */
export function guardSoulText(text: string): GuardResult {
  const out: string[] = [];
  const dropped: GuardResult['dropped'] = [];
  let skippingContinuation = false;
  for (const line of (text ?? '').split(/\r?\n/)) {
    const isContinuation = /^\s{2,}\S/.test(line) && !/^\s*[-*]\s/.test(line);
    if (skippingContinuation && isContinuation) continue;
    skippingContinuation = false;
    if (/^\s*#/.test(line) || line.trim() === '') {
      out.push(line);
      continue;
    }
    const hit = BLOCKED.find((b) => b.re.test(line));
    if (hit) {
      dropped.push({ line: line.trim().slice(0, 160), why: hit.why });
      skippingContinuation = true;
      continue;
    }
    out.push(line);
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), dropped };
}
