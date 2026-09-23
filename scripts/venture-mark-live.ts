import { loadVentureBook, saveVentureBook, markLive } from '../src/ventures/store.js';

/**
 * venture-mark-live.ts — flip one venture to LIVE from CI.
 *
 * Driven by the venture-ops workflow when the human opens a "venture-live:" issue
 * (the dashboard "Mark live" button). No secrets or full config needed: it only
 * touches state/ventures.json via the store. Starts the kill-criteria clock and
 * lets the loop begin monitoring the listing.
 *
 *   npx tsx scripts/venture-mark-live.ts <ventureId> [liveUrl]
 */
async function main(): Promise<void> {
  const id = (process.argv[2] ?? '').trim();
  const url = (process.argv[3] ?? '').trim();
  if (!id) {
    console.error('usage: venture-mark-live <ventureId> [liveUrl]');
    process.exit(2);
  }
  const book = loadVentureBook();
  const res = markLive(book, id, url, -1, new Date().toISOString(), 10);
  if (!res.ok) {
    console.error(`mark-live failed: ${res.reason}`);
    process.exit(1);
  }
  saveVentureBook(book);
  console.log(`marked ${id} LIVE${res.venture?.liveUrl ? ` @ ${res.venture.liveUrl}` : ' (no url given)'}`);
}

main().catch((err) => {
  console.error(`venture-mark-live failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
