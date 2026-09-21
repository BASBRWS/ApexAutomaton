import { solToLamports } from '../config.js';
import { writeSoul } from '../soul.js';
import type { TransferProposal } from '../types.js';
import { ToolRegistry, type Tool } from './registry.js';

/**
 * Phase 1 ships three safe example tools plus `rest`:
 *  - `do_task`     — completes a modeled task via the cycle's revenue adapter;
 *                    the payout is a REAL devnet transfer. This is how the agent
 *                    earns.
 *  - `write_journal` — records a note for the audit trail (no value moved).
 *  - `reflect`     — rewrites SOUL.md (the agent's own file; no value moved).
 *  - `rest`        — does nothing this cycle (still pays the compute burn).
 *
 * Phase 2 adds `transfer` — a value-moving tool, offered only when
 * PHASE2_TOOLS_ENABLED is set and only at NORMAL+ tiers. It is fully
 * policy-gated: the signer rejects any off-allowlist destination or over-cap
 * amount, so the tool cannot escape the rails.
 */

const doTask: Tool = {
  name: 'do_task',
  description:
    'Complete a paid task. You are paid SOL on-chain. This is your primary way ' +
    'to earn. Prefer it whenever earning exceeds the cost of this cycle.',
  movesValue: true,
  inputHint: '{ "taskId"?: "label-batch" | "summarize-doc" | "extract-fields" | "reconcile-ledger" }',
  async execute(input, ctx) {
    const taskId = typeof input.taskId === 'string' ? input.taskId : undefined;
    const res = await ctx.revenue.earn(taskId);
    return {
      summary: `completed task "${res.taskId}", earned ${res.lamports / 1e9} SOL (${res.adapter})`,
      revenueLamports: res.lamports,
      taskCompleted: true,
      signatures: [res.signature],
      note: `revenue from ${res.taskId} via ${res.adapter}`,
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

/** Phase 2 — value-moving, policy-gated. Off unless PHASE2_TOOLS_ENABLED. */
const transfer: Tool = {
  name: 'transfer',
  description:
    'Move SOL to an ALLOWLISTED account (compute-provider, market, or a known ' +
    'child). The signer rejects any other destination and any amount over the ' +
    'caps — you cannot move value outside the rails.',
  movesValue: true,
  inputHint: '{ "to": "<base58 pubkey>", "sol": <number>, "reason": "<why>", "memo"?: "<text>" }',
  async execute(input, ctx) {
    const to = typeof input.to === 'string' ? input.to : '';
    const solRaw = typeof input.sol === 'number' ? input.sol : Number(input.sol);
    const reason = typeof input.reason === 'string' ? input.reason : 'agent transfer';
    const memo = typeof input.memo === 'string' ? input.memo : undefined;

    if (!to || !Number.isFinite(solRaw) || solRaw <= 0) {
      return { summary: 'transfer: invalid input', note: 'bad transfer input' };
    }

    const proposal: TransferProposal = { to, lamports: solToLamports(solRaw), reason, memo };
    // Check first so a rejection is a clean journal note rather than a throw.
    const decision = ctx.signer.check(proposal);
    if (!decision.ok) {
      return {
        summary: `transfer rejected by policy: ${decision.reason}`,
        note: `transfer rejected: ${decision.reason}`,
      };
    }
    const res = await ctx.signer.signAndSend(proposal);
    return {
      summary: `transferred ${solRaw} SOL to ${to}`,
      signatures: [res.signature],
      note: `transfer: ${reason}`,
    };
  },
};

export function buildRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(doTask)
    .register(writeJournal)
    .register(reflect)
    .register(rest)
    .register(transfer);
}

export const BUILTIN_TOOLS = [doTask, writeJournal, reflect, rest, transfer];
