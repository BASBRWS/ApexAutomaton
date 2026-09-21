import { runCycle } from './loop.js';

/**
 * Entry point for one heartbeat. `npm run tick` runs exactly one cycle against
 * devnet. In GitHub Actions this is the scheduled workflow's command.
 *
 * Exit code 0 = the agent lived this cycle; 1 = it died (balance <= dust).
 */
async function main(): Promise<void> {
  try {
    const outcome = await runCycle();
    // eslint-disable-next-line no-console
    console.log(outcome.summary);
    process.exit(outcome.exitCode);
  } catch (err) {
    // Never leak secrets in error output; print message only.
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`cycle error: ${msg}`);
    process.exit(2);
  }
}

void main();
