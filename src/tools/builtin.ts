import { findTask } from '../market.js';
import { writeSoul } from '../soul.js';
import { ToolRegistry, type Tool } from './registry.js';

/**
 * Phase 1 ships three safe example tools plus `rest`:
 *  - `do_task`     — completes a modeled market task; the market pays the agent
 *                    a REAL devnet transfer. This is how the agent earns.
 *  - `write_journal` — records a note for the audit trail (no value moved).
 *  - `reflect`     — rewrites SOUL.md (the agent's own file; no value moved).
 *  - `rest`        — does nothing this cycle (still pays the compute burn).
 *
 * Value-moving tools like `transfer` and `replicate` are Phase 2/3 and are not
 * registered here yet.
 */

const doTask: Tool = {
  name: 'do_task',
  description:
    'Complete a paid task from the market. The market pays you SOL on-chain. ' +
    'This is your primary way to earn. Prefer it whenever earning exceeds the ' +
    'cost of this cycle.',
  movesValue: true,
  inputHint: '{ "taskId"?: "label-batch" | "summarize-doc" | "extract-fields" }',
  async execute(input, ctx) {
    const taskId = typeof input.taskId === 'string' ? input.taskId : undefined;
    const task = findTask(ctx.cfg, taskId);
    const payment = await ctx.market.payForCompletedTask(task);
    return {
      summary: `completed task "${task.id}", earned ${payment.lamports / 1e9} SOL`,
      revenueLamports: payment.lamports,
      taskCompleted: true,
      signatures: [payment.signature],
      note: `revenue from ${task.id}`,
    };
  },
};

const writeJournal: Tool = {
  name: 'write_journal',
  description:
    'Record a short note in your append-only journal (e.g. an observation or a ' +
    'plan). Moves no value. Use sparingly — it still costs a cycle of compute.',
  movesValue: false,
  inputHint: '{ "note": "text to record" }',
  async execute(input) {
    const note = typeof input.note === 'string' ? input.note.slice(0, 500) : '';
    return {
      summary: note ? `journalled: ${note.slice(0, 80)}` : 'journalled (empty note)',
      note: note || 'empty note',
    };
  },
};

const reflect: Tool = {
  name: 'reflect',
  description:
    'Rewrite your SOUL.md — your evolving strategy and identity. Provide the ' +
    'FULL new contents. Moves no value. Only worth doing when you have a real ' +
    'lesson to encode.',
  movesValue: false,
  inputHint: '{ "soul": "full new markdown contents of SOUL.md" }',
  async execute(input) {
    const soul = typeof input.soul === 'string' ? input.soul : '';
    if (soul.trim().length === 0) {
      return { summary: 'reflect called with empty soul — no change', note: 'no-op reflect' };
    }
    writeSoul(soul);
    return { summary: 'rewrote SOUL.md', soulUpdated: true, note: 'soul updated' };
  },
};

const rest: Tool = {
  name: 'rest',
  description:
    'Do nothing this cycle. You still pay the compute burn, so resting shrinks ' +
    'your balance. Only rest when no tool can profitably be used.',
  movesValue: false,
  inputHint: '{}',
  async execute() {
    return { summary: 'rested (no action taken)', note: 'rested' };
  },
};

export function buildRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(doTask)
    .register(writeJournal)
    .register(reflect)
    .register(rest);
}

export const BUILTIN_TOOLS = [doTask, writeJournal, reflect, rest];
