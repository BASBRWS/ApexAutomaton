import { runCycle } from '../src/loop.js';
import type { LLMClient, LLMRequest, LLMResponse } from '../src/llm/client.js';

/**
 * A "dry" tick: runs one full cycle with a MOCK LLM, so there is NO Anthropic
 * API call and NO API cost. Everything else is real — it still reads the devnet
 * balance, earns from the market, and settles the compute burn on-chain — so you
 * can exercise the whole loop for free (devnet SOL is free too).
 *
 *   npm run tick:dry
 *
 * Requires the wallet env (AGENT_, MARKET_, COMPUTE_PROVIDER_PUBKEY) and funded
 * devnet accounts, but does NOT require ANTHROPIC_API_KEY. The mock always picks
 * `do_task` with a small modeled token usage, so the burn is tiny and the agent
 * earns — a clean happy-path run.
 *
 * Pass a task id to earn a different task, e.g.:
 *   npm run tick:dry -- reconcile-ledger
 */
class MockLLM implements LLMClient {
  constructor(private readonly taskId: string) {}

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const action = {
      tool: 'do_task',
      input: { taskId: this.taskId },
      rationale: 'dry-run: earning is the highest-margin action',
    };
    return {
      text: '```json\n' + JSON.stringify(action) + '\n```',
      model: req.model,
      // Small modeled usage → a tiny, realistic compute burn.
      usage: { inputTokens: 1200, outputTokens: 120, cacheReadTokens: 0, cacheCreationTokens: 0 },
      stopReason: 'end_turn',
    };
  }
}

async function main(): Promise<void> {
  const taskId = process.argv[2] ?? 'label-batch';
  console.log(`DRY tick — mock LLM, no Anthropic API call (task: ${taskId}).`);
  const outcome = await runCycle({ llm: new MockLLM(taskId) });
  console.log(outcome.summary);
  process.exit(outcome.exitCode);
}

main().catch((err) => {
  console.error(`tick:dry failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
