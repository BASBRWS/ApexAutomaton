/**
 * Apex Automaton — reliable heartbeat trigger (Cloudflare Worker).
 *
 * GitHub Actions' own `schedule:` cron is best-effort: runs are frequently
 * delayed or skipped, which is why the heartbeat "hangs". This Worker replaces
 * the unreliable clock with Cloudflare's rock-solid Cron Trigger: on each firing
 * it calls the GitHub API to dispatch the `heartbeat.yml` workflow, which then
 * runs the usual burst on GitHub's runners. Compute stays on GitHub Actions —
 * only the trigger moves here.
 *
 * It is purely ADDITIVE: the repo's own cron keeps running as a backup, and the
 * heartbeat's stale-guard + concurrency group make redundant triggers cheap
 * no-ops, so there is never a double-tick and never a gap.
 *
 * Config:
 *   - Secret  GH_TOKEN   : a GitHub token with Actions: read & write on the repo.
 *   - Secret  TEST_KEY   : (optional) a random string to allow a manual test hit.
 *   - Var     GH_OWNER   : repository owner (default BASBRWS).
 *   - Var     GH_REPO    : repository name  (default ApexAutomaton).
 *   - Var     GH_WORKFLOW: workflow file    (default heartbeat.yml).
 *   - Var     GH_REF     : git ref to run   (default main).
 * See README.md for the exact setup + deploy steps.
 */

async function dispatchHeartbeat(env) {
  const owner = env.GH_OWNER || 'BASBRWS';
  const repo = env.GH_REPO || 'ApexAutomaton';
  const workflow = env.GH_WORKFLOW || 'heartbeat.yml';
  const ref = env.GH_REF || 'main';

  if (!env.GH_TOKEN) {
    return { ok: false, status: 0, detail: 'GH_TOKEN secret is not set' };
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub's API rejects requests without a User-Agent.
        'User-Agent': 'ApexAutomaton-cron-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    });
    // A successful dispatch returns 204 No Content.
    if (res.status === 204) {
      return { ok: true, status: 204, detail: `dispatched ${workflow}@${ref}` };
    }
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, detail: text.slice(0, 500) || res.statusText };
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}

export default {
  // Fired by the Cron Trigger in wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      dispatchHeartbeat(env).then((r) => {
        console.log(`[cron ${event.cron}] ${r.ok ? 'OK' : 'FAIL'} (${r.status}) ${r.detail}`);
      }),
    );
  },

  // Optional manual test / health endpoint.
  //   GET /            -> plain status text (no dispatch)
  //   GET /?key=SECRET -> dispatches once if key matches TEST_KEY
  async fetch(req, env) {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (key && env.TEST_KEY && key === env.TEST_KEY) {
      const r = await dispatchHeartbeat(env);
      return new Response(JSON.stringify(r, null, 2), {
        status: r.ok ? 200 : 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    const owner = env.GH_OWNER || 'BASBRWS';
    const repo = env.GH_REPO || 'ApexAutomaton';
    return new Response(
      `Apex Automaton cron worker.\n` +
        `Target: ${owner}/${repo} (${env.GH_WORKFLOW || 'heartbeat.yml'} @ ${env.GH_REF || 'main'})\n` +
        `Token set: ${env.GH_TOKEN ? 'yes' : 'NO — set the GH_TOKEN secret'}\n` +
        `It dispatches on its Cron Trigger. To test now, append ?key=YOUR_TEST_KEY.\n`,
      { headers: { 'content-type': 'text/plain' } },
    );
  },
};
