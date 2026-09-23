# Reliable heartbeat trigger — Cloudflare Worker

GitHub Actions' `schedule:` cron is best-effort and often delays or skips runs —
that's why the heartbeat "hangs". This tiny Cloudflare Worker replaces the flaky
clock: on its Cron Trigger it calls the GitHub API to dispatch `heartbeat.yml`,
which runs the normal burst on GitHub's runners.

**Purely additive & safe.** The repo's own cron keeps running as a backup, and
the heartbeat's stale-guard + concurrency group turn any redundant trigger into a
cheap no-op — so there's never a double-tick and never a gap. You can set this up
with zero downtime; if the Worker isn't ready or fails, GitHub's cron still fires.

Cloudflare's free plan includes Cron Triggers, so this costs nothing.

---

## One-time setup (~10 minutes)

### 1. Create a GitHub token (lets the Worker start the workflow)
- Go to **GitHub → Settings → Developer settings → Personal access tokens →
  Fine-grained tokens → Generate new token**.
- **Repository access:** Only select repositories → `BASBRWS/ApexAutomaton`.
- **Permissions → Repository permissions → Actions: Read and write.**
- Generate and **copy** the token (starts with `github_pat_…`). You won't see it again.

> Classic token alternative: scopes `repo` + `workflow`.

### 2. Get Wrangler (Cloudflare's CLI)
```bash
cd ops/cron-worker
npx wrangler login          # opens a browser to authorize your Cloudflare account
```
(No global install needed — `npx wrangler …` works. A free Cloudflare account is enough.)

### 3. Store the token as a secret (never commit it)
```bash
npx wrangler secret put GH_TOKEN
# paste the github_pat_… token when prompted
```
Optional — enable the manual test endpoint with your own random string:
```bash
npx wrangler secret put TEST_KEY
# paste any random string, e.g. from: openssl rand -hex 16
```

### 4. Deploy
```bash
npx wrangler deploy
```
Wrangler prints your Worker URL, e.g. `https://apex-automaton-cron.<you>.workers.dev`.

### 5. Verify
- **Manual (if you set TEST_KEY):**
  ```bash
  curl "https://apex-automaton-cron.<you>.workers.dev/?key=YOUR_TEST_KEY"
  ```
  A `{"ok": true, "status": 204, …}` response means it dispatched.
- **In GitHub:** Actions → **automaton-heartbeat** → you'll see a run whose event
  is **workflow_dispatch** (not `schedule`) — that's this Worker.
- **Logs:** `npx wrangler tail` streams each fire's result line.

That's it. The Worker now fires every 30 minutes (see `[triggers]` in
`wrangler.toml` to change the cadence). Leave GitHub's own cron enabled as a backup.

---

## Config reference
| Where | Name | Purpose | Default |
|---|---|---|---|
| secret | `GH_TOKEN` | GitHub token, Actions: read & write | — (required) |
| secret | `TEST_KEY` | enables `?key=…` manual test hit | — (optional) |
| var | `GH_OWNER` | repo owner | `BASBRWS` |
| var | `GH_REPO` | repo name | `ApexAutomaton` |
| var | `GH_WORKFLOW` | workflow file to dispatch | `heartbeat.yml` |
| var | `GH_REF` | git ref to run | `main` |

## Troubleshooting
- **403 from GitHub / "Resource not accessible":** the token is missing
  **Actions: read & write**, or wasn't granted access to this repo.
- **404:** wrong `GH_OWNER`/`GH_REPO`/`GH_WORKFLOW`, or the token can't see the repo.
- **No new run appears:** confirm `heartbeat.yml` has a `workflow_dispatch:` trigger
  (it does) and that it lives on the `GH_REF` branch (`main`).
- **Nothing in `wrangler tail`:** the cron only fires on schedule; use the
  `?key=…` test endpoint to trigger on demand.
